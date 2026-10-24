function normalizedText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function quoteIsPresent(text, quote) {
  const normalizedQuote = normalizedText(quote)
  return normalizedQuote.length >= 12 && normalizedText(text).includes(normalizedQuote)
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
