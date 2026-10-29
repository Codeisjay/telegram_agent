import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cleanJobPageContent, deduplicateExtractedJobs, validateExtractedJobs } from '../job-extraction.mjs'

const sourceUrl = 'https://careers.example.com/jobs/SE-2027'
const applicationUrl = 'https://example.wd5.myworkdayjobs.com/en-US/early-careers/job/SE-2027'
const content = [
  'Software Engineer Intern 2027.',
  `Apply at ${applicationUrl}.`,
  'Job ID: SE-2027.',
  'Applications are open.',
  'Graduation year 2027.',
  'BTech in Computer Science.',
  'Minimum CGPA 7.5.',
  'No active backlogs.',
  'Experience: 0 years.',
  'Employment type: Internship.',
].join(' ')

const candidate = {
  company: 'Example Systems',
  title: 'Software Engineer Intern 2027',
  sourceUrl,
  applicationUrl,
  jobId: 'SE-2027',
  location: 'Bengaluru',
  experience: '0 years',
  eligibleGraduationYears: ['2027'],
  requiredDegrees: ['BTech'],
  requiredBranches: ['Computer Science'],
  minimumCgpa: 7.5,
  maxBacklogs: 0,
  backlogRequirement: 'No active backlogs',
  employmentType: 'Internship',
  openStatus: 'open',
  evidence: {
    company: 'Example Systems is hiring.',
    title: 'Software Engineer Intern 2027.',
    applicationUrl,
    jobId: 'Job ID: SE-2027.',
    openStatus: 'Applications are open.',
    eligibleGraduationYears: 'Graduation year 2027.',
    requiredDegrees: 'BTech in Computer Science.',
    requiredBranches: 'BTech in Computer Science.',
    minimumCgpa: 'Minimum CGPA 7.5.',
    maxBacklogs: 'No active backlogs.',
    backlogRequirement: 'No active backlogs.',
    experience: 'Experience: 0 years.',
    employmentType: 'Employment type: Internship.',
  },
}

test('accepts evidence-backed employer-linked ATS application URLs', () => {
  const [job] = validateExtractedJobs([candidate], [{ url: sourceUrl, content, fetchedAt: '2026-10-24T10:00:00.000Z' }], {
    name: 'Example Systems',
    officialDomains: ['careers.example.com'],
    applicationDomains: ['myworkdayjobs.com'],
  })
  assert.equal(job.verifiedOpen, true)
  assert.equal(job.sourceUrl, sourceUrl)
  assert.equal(job.applicationUrl, applicationUrl)
  assert.equal(job.jobId, 'SE-2027')
  assert.equal(job.verifiedAt, '2026-10-24T10:00:00.000Z')
  assert.equal(job.requirementsVerified, true)
  assert.ok(job.evidence.some((item) => item.includes('maxBacklogs')))
})

test('rejects unlinked ATS URLs and listings without a supported vacancy title', () => {
  const [unlinked] = validateExtractedJobs([candidate], [{ url: sourceUrl, content, fetchedAt: '' }], {
    name: 'Example Systems',
    officialDomains: ['careers.example.com'],
    applicationDomains: ['unrelated.example'],
  })
  assert.equal(unlinked.applicationUrl, sourceUrl)

  const [unsupported] = validateExtractedJobs([{
    ...candidate,
    title: 'Invented role',
    evidence: { ...candidate.evidence, title: 'Software Engineer Intern 2027.' },
  }], [{ url: sourceUrl, content }], {
    name: 'Example Systems',
    officialDomains: ['careers.example.com'],
  })
  assert.equal(unsupported, undefined)
})

test('does not treat malformed model JSON as a successful empty search', () => {
  assert.throws(() => validateExtractedJobs('not-json', [{ url: sourceUrl, content }], {
    name: 'Example Systems',
    officialDomains: ['careers.example.com'],
  }), /invalid job-extraction JSON/i)
})

test('cleans page boilerplate and duplicate content while enforcing the configured description limit', () => {
  const cleaned = cleanJobPageContent([
    '<script>tracking code</script>',
    '<nav>Home | About | Careers</nav>',
    '<div class="cookie-consent">Accept all cookies</div>',
    '<main><p>Software Engineer Intern 2027.</p><p>Software Engineer Intern 2027.</p>',
    '<p>Applications are open.</p></main>',
  ].join(''), 1000)
  assert.match(cleaned, /Software Engineer Intern 2027/)
  assert.match(cleaned, /Applications are open/)
  assert.doesNotMatch(cleaned, /tracking code|Home \| About|Accept all cookies/)
  assert.equal(cleaned.match(/Software Engineer Intern 2027/g).length, 1)
  assert.equal(cleanJobPageContent('Relevant job description '.repeat(20), 120).length, 120)
})

test('deduplicates jobs by canonical application URL and company/title', () => {
  const jobs = deduplicateExtractedJobs([
    { company: 'Example Systems', title: 'Engineer', applicationUrl: 'https://www.example.com/apply?utm_source=search' },
    { company: 'Other Systems', title: 'Different title', applicationUrl: 'https://example.com/apply' },
    { company: ' example systems ', title: 'Engineer', applicationUrl: 'https://example.com/another-role' },
    { company: 'Example Systems', title: 'Designer', applicationUrl: 'https://example.com/designer' },
  ])
  assert.equal(jobs.length, 2)
  assert.equal(jobs[0].title, 'Engineer')
  assert.equal(jobs[1].title, 'Designer')
})
