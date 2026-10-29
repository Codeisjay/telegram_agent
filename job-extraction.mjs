function normalizedText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function quoteIsPresent(text, quote) {
  const normalizedQuote = normalizedText(quote)
  return normalizedQuote.length >= 12 && normalizedText(text).includes(normalizedQuote)
}

export function cleanJobPageContent(content, maxCharacters = 8000) {
  const maximum = Number.isInteger(maxCharacters) && maxCharacters > 0 ? maxCharacters : 8000
  const cleanedHtml = String(content || '')
    .replace(/<(script|style|nav|header|footer|aside|form|iframe|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '\n')
    .replace(/<(div|section|ul|ol)[^>]*(?:id|class)=["'][^"']*(?:cookie|consent|navigation|menu|footer|header|social|share)[^"']*["'][^>]*>[\s\S]*?<\/\1\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
  const boilerplate = /\b(cookie preferences|cookie settings|accept all cookies|manage cookies|privacy choices|skip to content|all rights reserved|subscribe to our newsletter|follow us on)\b/i
  const seen = new Set()
  const paragraphs = cleanedHtml
    .split(/\r?\n|(?<=[.!?])\s{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter((paragraph) => paragraph && !boilerplate.test(paragraph))
    .filter((paragraph) => {
      const normalized = normalizedText(paragraph)
      if (seen.has(normalized)) return false
      seen.add(normalized)
      return true
    })
  return paragraphs.join('\n').slice(0, maximum)
}

function canonicalUrl(value) {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return ''
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_.+|ref|source|campaign|trk)$/i.test(key)) url.searchParams.delete(key)
    }
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    return url.toString()
  } catch {
    return ''
  }
}

export function deduplicateExtractedJobs(jobs) {
  const seenUrls = new Set()
  const seenEmployerTitles = new Set()
  return jobs.filter((job) => {
    const url = canonicalUrl(job.applicationUrl)
    const employerTitle = `${normalizedText(job.company)}|${normalizedText(job.title)}`
    if ((url && seenUrls.has(url)) || seenEmployerTitles.has(employerTitle)) return false
    if (url) seenUrls.add(url)
    seenEmployerTitles.add(employerTitle)
    return true
  })
}

export function extractJson(content) {
  if (Array.isArray(content)) return content
  const cleaned = String(content || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start < 0 || end < start) throw new Error('AI provider returned invalid job-extraction JSON.')
  try {
    const value = JSON.parse(cleaned.slice(start, end + 1))
    if (!Array.isArray(value)) throw new Error('Expected a JSON array.')
    return value
  } catch {
    throw new Error('AI provider returned invalid job-extraction JSON.')
  }
}

export function validateExtractedJobs(content, pages, company) {
  const allowedPages = new Map(pages.map((page) => [page.url, page]))
  const allowedDomains = [...company.officialDomains, ...(company.applicationDomains || [])]
    .map((domain) => domain.toLowerCase().replace(/^www\./, ''))
  const isAllowedEmployerDomain = (value) => {
    try {
      const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, '')
      return allowedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
    } catch {
      return false
    }
  }
  const output = []
  for (const candidate of extractJson(content).slice(0, 30)) {
    if (!candidate || typeof candidate !== 'object' || typeof candidate.title !== 'string') continue
    const page = allowedPages.get(candidate.sourceUrl)
    if (!page) continue
    const evidenceObject = candidate.evidence && typeof candidate.evidence === 'object' ? candidate.evidence : {}
    const evidence = Object.entries(evidenceObject)
      .filter(([, quote]) => typeof quote === 'string' && quoteIsPresent(page.content, quote))
      .map(([field, quote]) => ({ field, quote: quote.slice(0, 500), sourceUrl: page.url }))
    const verifiedField = (field) => evidence.some((item) => item.field === field)
    const filteredArray = (field, evidenceField = field) => verifiedField(evidenceField) && Array.isArray(candidate[field])
      ? candidate[field].filter((value) => typeof value === 'string').map((value) => value.slice(0, 100)).slice(0, 30)
      : []
    const statusEvidence = evidence.find((item) => item.field === 'openStatus')
    const statusText = normalizedText(statusEvidence?.quote)
    const titleEvidence = evidence.find((item) => item.field === 'title')
    const titleIsSupported = Boolean(titleEvidence
      && normalizedText(titleEvidence.quote).includes(normalizedText(candidate.title)))
    const verifiedOpen = normalizedText(candidate.openStatus) === 'open'
      && Boolean(statusEvidence)
      && titleIsSupported
      && /\b(open|apply now|applications? (?:are )?open|accepting applications|apply by)\b/i.test(statusText)
    const verifiedClosed = normalizedText(candidate.openStatus) === 'closed'
      && Boolean(statusEvidence)
      && titleIsSupported
      && /\b(closed|no longer accepting|applications? (?:are )?closed|position filled|job is filled)\b/i.test(statusText)
    const jobId = verifiedField('jobId') && typeof candidate.jobId === 'string' ? candidate.jobId.slice(0, 120) : ''
    const candidateApplicationUrl = typeof candidate.applicationUrl === 'string' ? candidate.applicationUrl : ''
    const applicationUrlEvidence = evidence.some((item) => item.field === 'applicationUrl'
      && normalizedText(item.quote).includes(normalizedText(candidateApplicationUrl)))
    const applicationUrl = candidateApplicationUrl
      && applicationUrlEvidence
      && isAllowedEmployerDomain(candidateApplicationUrl)
      ? candidateApplicationUrl
      : page.url
    const employerIdentity = verifiedField('company') && typeof candidate.company === 'string'
      ? candidate.company.slice(0, 120)
      : company.name
    const entry = {
      company: employerIdentity,
      employerIdentity,
      title: candidate.title.slice(0, 240),
      sourceUrl: page.url,
      applicationUrl,
      location: verifiedField('location') && typeof candidate.location === 'string' ? candidate.location.slice(0, 240) : '',
      jobId,
      officialUrl: page.url,
      deadline: verifiedField('deadline') && typeof candidate.deadline === 'string' ? candidate.deadline.slice(0, 120) : '',
      experience: verifiedField('experience') && typeof candidate.experience === 'string' ? candidate.experience.slice(0, 300) : '',
      eligibleGraduationYears: filteredArray('eligibleGraduationYears'),
      requiredDegrees: filteredArray('requiredDegrees'),
      requiredBranches: filteredArray('requiredBranches'),
      minimumCgpa: verifiedField('minimumCgpa') && Number.isFinite(Number(candidate.minimumCgpa))
        ? Number(candidate.minimumCgpa) : null,
      maxBacklogs: verifiedField('maxBacklogs') && Number.isInteger(Number(candidate.maxBacklogs))
        ? Number(candidate.maxBacklogs) : null,
      backlogRequirement: verifiedField('backlogRequirement') && typeof candidate.backlogRequirement === 'string'
        ? candidate.backlogRequirement.slice(0, 300) : '',
      skills: filteredArray('skills'),
      employmentType: verifiedField('employmentType') && typeof candidate.employmentType === 'string'
        ? candidate.employmentType.slice(0, 120) : '',
      salary: verifiedField('salary') && typeof candidate.salary === 'string' ? candidate.salary.slice(0, 120) : '',
      verifiedOpen,
      verifiedClosed,
      officialPageFetched: true,
      verifiedAt: page.fetchedAt || new Date().toISOString(),
      requirementsVerified: ['eligibleGraduationYears', 'requiredDegrees', 'requiredBranches', 'minimumCgpa',
        'backlogRequirement', 'experience', 'employmentType']
        .every(verifiedField),
      confidence: verifiedOpen && evidence.length >= 3 ? 'high' : evidence.length ? 'medium' : 'low',
      evidence: evidence.map(({ field, quote }) => `${field}: ${quote}`),
      sources: [{
        url: page.url, snippet: page.content.slice(0, 1200), kind: 'official_career_page',
        verified: true, applicationUrl, employerIdentity,
      }],
    }
    if (entry.title && (entry.verifiedOpen || entry.verifiedClosed)) output.push(entry)
  }
  return output
}
