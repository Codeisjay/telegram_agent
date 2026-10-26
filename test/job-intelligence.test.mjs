import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { DailyScheduler } from '../daily-scheduler.mjs'
import {
  classifyEligibility, isTelegramUserAdmin, isTelegramUserAuthorized, JobDatabase, makeJobKey, nextDailyRun, shouldNotifyJob,
} from '../job-intelligence.mjs'

let directory
let database

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'agentflow-jobs-test-'))
  database = await JobDatabase.open(path.join(directory, 'jobs.sqlite'))
})

after(() => {
  database.close()
  return rm(directory, { recursive: true, force: true })
})

const matchingProfile = {
  graduationYear: '2027',
  degree: 'BTech',
  branch: 'Computer Science',
  academicEligibility: 'CGPA 8.1',
  backlogStatus: 'No active backlogs',
  experience: 'Fresher',
  employmentTypes: ['Internship'],
}

const verifiedJob = {
  company: 'Example Systems',
  title: 'Software Engineer Intern',
  jobId: 'INT-27',
  officialUrl: 'https://careers.example.com/jobs/INT-27?utm_source=search',
  eligibleGraduationYears: [2027],
  requiredDegrees: ['BTech'],
  requiredBranches: ['Computer Science'],
  minimumCgpa: 7,
  maxBacklogs: 0,
  backlogRequirement: 'No active backlogs',
  experience: '0 years of experience',
  employmentType: 'Internship',
  verifiedOpen: true,
  officialPageFetched: true,
  requirementsVerified: true,
  evidence: ['Graduation year 2027'],
  sources: [{ url: 'https://careers.example.com/jobs/INT-27', snippet: 'Graduation year 2027', verified: true }],
}

test('eligibility classification distinguishes conflict and missing evidence', () => {
  assert.equal(classifyEligibility(matchingProfile, verifiedJob).status, 'Eligible')
  assert.equal(classifyEligibility({ ...matchingProfile, graduationYear: '2026' }, verifiedJob).status, 'Not eligible')
  assert.equal(classifyEligibility({ ...matchingProfile, degree: 'BA' }, verifiedJob).status, 'Not eligible')
  assert.equal(classifyEligibility({ ...matchingProfile, branch: 'Electrical Engineering' }, verifiedJob).status, 'Not eligible')
  assert.equal(classifyEligibility({ ...matchingProfile, academicEligibility: '' }, verifiedJob).status, 'Manual verification required')
  assert.equal(classifyEligibility({ ...matchingProfile, academicEligibility: 'CGPA 6.4' }, verifiedJob).status, 'Not eligible')
  assert.equal(classifyEligibility({ ...matchingProfile, backlogStatus: '2 active backlogs' }, verifiedJob).status, 'Not eligible')
  assert.equal(classifyEligibility({ ...matchingProfile, experience: '6 months' }, { ...verifiedJob, experience: '1 year required' }).status, 'Not eligible')
  assert.equal(classifyEligibility({ ...matchingProfile, experience: '' }, { ...verifiedJob, experience: '1 year required' }).status, 'Manual verification required')
  assert.equal(classifyEligibility({ ...matchingProfile, employmentTypes: ['Internship'] }, { ...verifiedJob, employmentType: 'Full-time' }).status, 'Not eligible')
  const locationPreference = classifyEligibility({ ...matchingProfile, locations: ['Pune'] }, { ...verifiedJob, location: 'Bengaluru' })
  assert.equal(locationPreference.status, 'Eligible')
  assert.match(locationPreference.reason, /differs from preferred locations/)
  assert.equal(classifyEligibility({ ...matchingProfile, backlogStatus: '' }, verifiedJob).status, 'Manual verification required')
  assert.equal(classifyEligibility(matchingProfile, { ...verifiedJob, eligibleGraduationYears: [] }).status, 'Likely eligible')
  assert.equal(classifyEligibility(matchingProfile, { ...verifiedJob, verifiedOpen: false }).status, 'Insufficient evidence')
  assert.equal(classifyEligibility({}, { ...verifiedJob, eligibleGraduationYears: [], requiredDegrees: [], requiredBranches: [], requirementsVerified: false }).status, 'Insufficient evidence')
})

test('deduplicates by company and job ID or normalized official URL while retaining evidence', () => {
  assert.equal(
    makeJobKey({ company: 'Example Systems', jobId: 'INT-27', officialUrl: verifiedJob.officialUrl }),
    makeJobKey({ ...verifiedJob, officialUrl: 'https://careers.example.com/jobs/INT-27' }),
  )
  const first = database.upsertJob(verifiedJob, matchingProfile)
  const second = database.upsertJob({
    ...verifiedJob,
    officialUrl: 'https://careers.example.com/jobs/INT-27?utm_campaign=weekly',
    evidence: ['BTech students graduating in 2027'],
    sources: [{ url: 'https://careers.example.com/jobs/INT-27', snippet: 'Applications remain open', verified: true }],
  }, matchingProfile)
  assert.equal(first.isNew, true)
  assert.equal(first.materiallyChanged, false)
  assert.equal(second.isNew, false)
  assert.equal(second.materiallyChanged, false)
  const job = database.getJob(first.id)
  assert.equal(job.evidence.length, 2)
  assert.equal(job.sources.length, 2)
  assert.equal(job.officialUrl, 'https://careers.example.com/jobs/INT-27')
  const changed = database.upsertJob({ ...verifiedJob, deadline: 'January 31, 2027' }, matchingProfile)
  assert.equal(changed.materiallyChanged, true)
})

test('retains application history and suppresses duplicate notification fingerprints', () => {
  const job = database.listJobs()[0]
  assert.equal(database.updateJob(job.id, 'save').saved, true)
  assert.equal(database.updateJob(job.id, 'applied', 'Submitted online').applicationStatus, 'applied')
  assert.equal(database.recordNotification(job.id, 'new-opening'), true)
  database.markNotificationDelivered(job.id, 'new-opening')
  assert.equal(database.recordNotification(job.id, 'new-opening'), false)
  assert.equal(database.recordNotification(job.id, 'deadline-changed'), true)
  assert.equal(database.recordNotification(job.id, 'deadline-changed'), false)
})

test('only notifies for vacancies verified open on an official page', () => {
  assert.equal(shouldNotifyJob({ verifiedOpen: true }, { isNew: true }), true)
  assert.equal(shouldNotifyJob({ verifiedOpen: true }, { materiallyChanged: true }), true)
  assert.equal(shouldNotifyJob({ verifiedOpen: true }, {}), false)
  assert.equal(shouldNotifyJob({ verifiedOpen: false }), false)
})

test('failed rechecks remove the current-open claim but retain past evidence', () => {
  const job = database.listJobs()[0]
  const originalEvidence = job.evidence
  const rechecked = database.markJobUnverified(job.officialUrl)
  assert.equal(rechecked.verifiedOpen, false)
  assert.equal(rechecked.status, 'unverified')
  assert.equal(rechecked.needsRecheck, true)
  assert.deepEqual(rechecked.evidence, originalEvidence)
  assert.equal(rechecked.eligibilityStatus, 'Insufficient evidence')
})

test('old verification is not presented as current open evidence', () => {
  const stored = database.upsertJob({ ...verifiedJob, jobId: 'STALE-27', officialUrl: 'https://careers.example.com/jobs/STALE-27' }, matchingProfile)
  database.db.prepare("UPDATE jobs SET last_verified_at='2020-01-01T00:00:00.000Z' WHERE id=?").run(stored.id)
  const stale = database.getJob(stored.id)
  assert.equal(stale.verifiedOpen, false)
  assert.equal(stale.status, 'unverified')
  assert.equal(stale.needsRecheck, true)
  assert.equal(stale.eligibilityStatus, 'Insufficient evidence')
})

test('persistent run records recover interrupted work as a failure', () => {
  const runId = database.createRun('simulated-crash')
  assert.equal(database.recoverInterruptedRuns(), 1)
  assert.equal(database.getRun(runId).status, 'failed')
  const missedRunId = database.markMissedRun()
  assert.equal(database.getRun(missedRunId).status, 'missed')
})

test('database backup can be reopened with jobs and evidence intact', async () => {
  const backupPath = path.join(directory, 'jobs-backup.sqlite')
  await database.backupTo(backupPath)
  const restored = await JobDatabase.open(backupPath)
  assert.equal(restored.listJobs().length, database.listJobs().length)
  assert.ok(restored.listJobs().some((job) => job.sources.length > 0 && job.evidence.length > 0))
  assert.equal(restored.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version, 6)
  restored.close()
})

test('OpenRouter is the default and migrates saved Gemini defaults once', async () => {
  const providerDatabasePath = path.join(directory, 'provider-default.sqlite')
  let providerDatabase = await JobDatabase.open(providerDatabasePath)
  assert.equal(providerDatabase.getSettings().provider, 'openrouter')
  providerDatabase.saveSettings({ provider: 'gemini' })
  providerDatabase.saveAgentPreferences({ provider: 'gemini' }, true)
  providerDatabase.db.prepare('DELETE FROM schema_migrations WHERE version = 6').run()
  providerDatabase.close()

  providerDatabase = await JobDatabase.open(providerDatabasePath)
  assert.equal(providerDatabase.getSettings().provider, 'openrouter')
  assert.equal(providerDatabase.getAgentPreferences().settings.provider, 'openrouter')
  providerDatabase.saveSettings({ provider: 'groq' })
  providerDatabase.close()

  providerDatabase = await JobDatabase.open(providerDatabasePath)
  assert.equal(providerDatabase.getSettings().provider, 'groq')
  providerDatabase.close()
})

test('Telegram whitelist authorization allows approved IDs and rejects others', () => {
  const settings = { access: 'whitelist', whitelist: ['12345', '-900'] }
  assert.equal(isTelegramUserAuthorized(settings, 12345, 12345), true)
  assert.equal(isTelegramUserAuthorized(settings, 123, -900), true)
  assert.equal(isTelegramUserAuthorized(settings, 777, 777), false)
  assert.equal(isTelegramUserAuthorized({ access: 'public' }, 777, 777), true)
  assert.equal(isTelegramUserAdmin({ access: 'public', whitelist: [] }, 777, 777), false)
  assert.equal(isTelegramUserAdmin(settings, 12345, 12345), true)
})

test('daily schedule advances at 09:00 Asia/Kolkata', () => {
  assert.equal(nextDailyRun(new Date('2026-10-24T03:29:00.000Z')), '2026-10-24T03:30:00.000Z')
  assert.equal(nextDailyRun(new Date('2026-10-24T03:30:00.000Z')), '2026-10-25T03:30:00.000Z')
})

test('scheduler records missed work and prevents overlapping runs', async () => {
  let runCount = 0
  let resolveRun
  const fakeDb = {
    getScheduler: () => ({ paused: 0, next_run_at: '2026-10-24T03:30:00.000Z' }),
    recoverInterruptedRuns: () => 0,
    markMissedRun: () => { fakeDb.missed++ },
    setNextRun: (value) => { fakeDb.next = value },
    missed: 0,
  }
  const scheduler = new DailyScheduler({
    database: fakeDb,
    intervalMs: 10000,
    run: () => {
      runCount++
      return new Promise((resolve) => { resolveRun = resolve })
    },
  })
  const first = scheduler.tick(true, new Date('2026-10-24T04:00:00.000Z'))
  const overlap = await scheduler.tick(false, new Date('2026-10-24T04:00:01.000Z'))
  assert.equal(overlap.status, 'overlap-skipped')
  assert.equal(fakeDb.missed, 1)
  assert.equal(runCount, 1)
  resolveRun()
  assert.equal((await first).status, 'completed')
})

test('scheduler reports failed search work and respects pause state', async () => {
  let runCount = 0
  let errors = 0
  const fakeDb = {
    paused: 0,
    getScheduler() { return { paused: this.paused, next_run_at: '2026-10-24T03:30:00.000Z' } },
    recoverInterruptedRuns() {},
    markMissedRun() {},
    setNextRun() {},
  }
  const scheduler = new DailyScheduler({
    database: fakeDb,
    intervalMs: 10000,
    run: async () => { runCount++; throw new Error('provider rate limit') },
    onError: () => { errors++ },
    maxRetries: 0,
  })
  assert.equal((await scheduler.tick(false, new Date('2026-10-24T04:00:00.000Z'))).status, 'failed')
  fakeDb.paused = 1
  assert.equal((await scheduler.tick(false, new Date('2026-10-24T04:00:00.000Z'))).status, 'paused')
  assert.equal(runCount, 1)
  assert.equal(errors, 1)
})

test('scheduler retries failed runs with a bounded retry count', async () => {
  let attempts = 0
  const fakeDb = {
    getScheduler: () => ({ paused: 0, next_run_at: '2026-10-24T03:30:00.000Z' }),
    setNextRun() {},
    markMissedRun() {},
  }
  const scheduler = new DailyScheduler({
    database: fakeDb,
    run: async () => {
      attempts++
      if (attempts < 3) throw new Error('temporary provider failure')
    },
    retryDelayMs: 0,
    maxRetries: 2,
  })
  const result = await scheduler.tick(false, new Date('2026-10-24T04:00:00.000Z'))
  assert.equal(result.status, 'completed')
  assert.equal(result.attempts, 3)
  assert.equal(attempts, 3)
})

test('scheduler startup recovers an interrupted run even if the stored next run moved forward', async () => {
  let scheduledTime = '2026-10-25T03:30:00.000Z'
  let runCount = 0
  let missedCount = 0
  const fakeDb = {
    recoverInterruptedRuns: () => 1,
    getScheduler: () => ({ paused: 0, next_run_at: scheduledTime }),
    setNextRun: (value) => { scheduledTime = value },
    markMissedRun: () => { missedCount++ },
  }
  const scheduler = new DailyScheduler({
    database: fakeDb,
    run: async (trigger) => {
      assert.equal(trigger, 'schedule-recovery')
      runCount++
    },
  })
  await scheduler.start()
  scheduler.stop()
  assert.equal(runCount, 1)
  assert.equal(missedCount, 1)
})
