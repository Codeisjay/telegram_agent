import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'

export const emptyProfile = {
  graduationYear: '',
  degree: '',
  branch: '',
  college: '',
  academicEligibility: '',
  backlogStatus: '',
  skills: [],
  experience: '',
  preferredRoles: [],
  locations: [],
  workMode: '',
  salaryPreference: '',
  employmentTypes: [],
}

const profileStringFields = [
  'graduationYear', 'degree', 'branch', 'college', 'academicEligibility',
  'experience', 'workMode', 'salaryPreference', 'backlogStatus',
]
const profileListFields = ['skills', 'preferredRoles', 'locations', 'employmentTypes']

export function normalizeCandidateProfile(input = {}) {
  const profile = { ...emptyProfile }
  for (const field of profileStringFields) {
    if (typeof input[field] === 'string') profile[field] = input[field].trim().slice(0, 1000)
  }
  for (const field of profileListFields) {
    if (Array.isArray(input[field])) {
      profile[field] = [...new Set(input[field]
        .filter((value) => typeof value === 'string')
        .map((value) => value.trim().slice(0, 100))
        .filter(Boolean))].slice(0, 100)
    }
  }
  return profile
}

export function classifyEligibility(profileInput, job) {
  const profile = normalizeCandidateProfile(profileInput)
  const unknown = []
  const missingProfile = []
  const conflicts = []
  const evidence = []
  const notes = []
  const graduationYear = profile.graduationYear ? Number(profile.graduationYear) : Number.NaN
  const eligibleYears = (job.eligibleGraduationYears || []).map(Number).filter(Number.isInteger)
  if (eligibleYears.length) {
    if (!Number.isInteger(graduationYear)) {
      unknown.push('candidate graduation year')
      missingProfile.push('candidate graduation year')
    } else if (!eligibleYears.includes(graduationYear)) conflicts.push(`Graduation year ${graduationYear} is not in the stated eligible years (${eligibleYears.join(', ')}).`)
    else evidence.push(`Graduation year ${graduationYear} matches the stated eligible years.`)
  } else {
    unknown.push('graduation-year eligibility')
  }

  const requiredDegrees = (job.requiredDegrees || []).map((value) => value.toLowerCase())
  if (requiredDegrees.length) {
    if (!profile.degree) {
      unknown.push('candidate degree')
      missingProfile.push('candidate degree')
    }
    else {
      const candidateDegree = profile.degree.toLowerCase()
      const candidateHasBachelor = /b\.?\s?tech|b\.?\s?e\.?|bachelor/.test(candidateDegree)
      const degreeMatches = requiredDegrees.some((value) =>
        candidateDegree.includes(value) || value.includes(candidateDegree)
        || (candidateHasBachelor && /bachelor|undergraduate|engineering degree/.test(value)))
      if (!degreeMatches) conflicts.push(`Required degree: ${requiredDegrees.join(', ')}.`)
      else evidence.push(`Degree matches stated requirement (${profile.degree}).`)
    }
  } else {
    unknown.push('degree requirement')
  }

  const requiredBranches = (job.requiredBranches || []).map((value) => value.toLowerCase())
  if (requiredBranches.length) {
    if (!profile.branch) {
      unknown.push('candidate branch')
      missingProfile.push('candidate branch')
    }
    else if (!requiredBranches.some((value) => profile.branch.toLowerCase().includes(value))) conflicts.push(`Required branch: ${requiredBranches.join(', ')}.`)
    else evidence.push(`Branch matches stated requirement (${profile.branch}).`)
  } else {
    unknown.push('branch requirement')
  }

  if (job.minimumCgpa != null) {
    const cgpa = Number(profile.academicEligibility.match(/(?:cgpa|gpa)\s*[:>=-]?\s*(\d+(?:\.\d+)?)/i)?.[1])
    if (!Number.isFinite(cgpa)) {
      unknown.push('candidate CGPA')
      missingProfile.push('candidate CGPA')
    }
    else if (cgpa < job.minimumCgpa) conflicts.push(`Required CGPA is ${job.minimumCgpa}; candidate CGPA is ${cgpa}.`)
    else evidence.push(`Candidate CGPA meets the stated minimum of ${job.minimumCgpa}.`)
  } else {
    unknown.push('academic cutoff')
  }

  if (job.maxBacklogs != null) {
    const activeBacklogs = Number(profile.backlogStatus.match(/(?:active|current|standing)\s*(?:backlogs?)?\s*[:=]?\s*(\d+)/i)?.[1]
      ?? profile.backlogStatus.match(/(\d+)\s*(?:active|current|standing)\s+backlogs?/i)?.[1]
      ?? (/no active backlogs?/i.test(profile.backlogStatus) ? 0 : Number.NaN))
    if (!Number.isFinite(activeBacklogs)) {
      unknown.push('candidate active backlog count')
      missingProfile.push('candidate active backlog count')
    } else if (activeBacklogs > job.maxBacklogs) {
      conflicts.push(`The vacancy allows at most ${job.maxBacklogs} active backlogs; candidate reports ${activeBacklogs}.`)
    } else {
      evidence.push(`Active backlog count (${activeBacklogs}) is within the stated maximum (${job.maxBacklogs}).`)
    }
  } else if (job.backlogRequirement) {
    unknown.push('backlog requirement could not be structured')
  } else {
    unknown.push('backlog requirement')
  }

  if (job.experience) {
    const requirement = job.experience.match(/(\d+(?:\.\d+)?)\s*(years?|yrs?|months?)/i)
    const candidate = profile.experience.match(/(\d+(?:\.\d+)?)\s*(years?|yrs?|months?)/i)
    if (!requirement) unknown.push('experience requirement could not be structured')
    else if (!candidate && !/\b(fresher|no experience|0 experience)\b/i.test(profile.experience)) {
      unknown.push('candidate experience')
      missingProfile.push('candidate experience')
    } else {
      const minimumYears = Number(requirement[1]) / (/month/i.test(requirement[2]) ? 12 : 1)
      const candidateYears = candidate
        ? Number(candidate[1]) / (/month/i.test(candidate[2]) ? 12 : 1)
        : 0
      if (candidateYears < minimumYears) conflicts.push(`The vacancy requires ${requirement[0]}; candidate experience is ${candidate ? candidate[0] : '0 years (fresher)'}.`)
      else evidence.push(`Candidate experience (${candidate ? candidate[0] : 'fresher'}) meets the stated minimum (${requirement[0]}).`)
    }
  }

  if (job.employmentType && profile.employmentTypes.length) {
    const allowedTypes = profile.employmentTypes.map((type) => type.toLowerCase())
    if (!allowedTypes.some((type) => type === job.employmentType.toLowerCase())) {
      conflicts.push(`Employment type ${job.employmentType} is outside the candidate's explicitly accepted types (${profile.employmentTypes.join(', ')}).`)
    } else {
      evidence.push(`Employment type ${job.employmentType} is accepted by the candidate.`)
    }
  }
  if (job.location && profile.locations.length
    && !profile.locations.some((location) => job.location.toLowerCase().includes(location.toLowerCase()))) {
    notes.push(`Job location ${job.location} differs from preferred locations (${profile.locations.join(', ')}); preference is not treated as an eligibility restriction.`)
  }

  if (conflicts.length) {
    return { status: 'Not eligible', reason: [...conflicts, ...notes].join(' '), missing: [...unknown, ...missingProfile], evidence, conflicts, unknown, notes }
  }
  if (!job.verifiedOpen) {
    return {
      status: 'Insufficient evidence',
      reason: 'The vacancy is not verified as currently open on a company-operated career page or employer-linked application page.',
      missing: [...unknown, ...missingProfile], evidence, conflicts, unknown, notes,
    }
  }
  const candidateCoreMissing = ['candidate graduation year', 'candidate degree', 'candidate branch']
    .filter((field) => !profile[field === 'candidate graduation year' ? 'graduationYear' : field === 'candidate degree' ? 'degree' : 'branch'])
  if (candidateCoreMissing.length) {
    return {
      status: 'Insufficient evidence',
      reason: `Core candidate details are missing: ${candidateCoreMissing.join(', ')}.`,
      missing: [...new Set([...unknown, ...missingProfile, ...candidateCoreMissing])], evidence, conflicts, unknown, notes,
    }
  }
  if (missingProfile.length) {
    const coreMissing = missingProfile.some((item) => ['candidate graduation year', 'candidate degree', 'candidate branch'].includes(item))
    return {
      status: coreMissing ? 'Insufficient evidence' : 'Manual verification required',
      reason: `Candidate information needed to assess this vacancy: ${missingProfile.join(', ')}.${evidence.length ? ` ${evidence.join(' ')}` : ''}`,
      missing: [...unknown, ...missingProfile], evidence, conflicts, unknown, notes,
    }
  }
  if (unknown.length) {
    return { status: 'Likely eligible', reason: `No known conflict; verify requirements that were not stated or could not be interpreted: ${unknown.join(', ')}.${evidence.length ? ` ${evidence.join(' ')}` : ''}${notes.length ? ` ${notes.join(' ')}` : ''}`, missing: unknown, evidence, conflicts, unknown, notes }
  }
  if (job.requirementsVerified) {
    return { status: 'Eligible', reason: [...evidence, ...notes].join(' '), missing: [], evidence, conflicts, unknown, notes }
  }
  return { status: 'Manual verification required', reason: `${[...evidence, ...notes].join(' ')} The vacancy has other requirements that need manual confirmation.`, missing: [], evidence, conflicts, unknown: ['other requirements'], notes }
}

export function normalizeJobUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return ''
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

export function normalizeCompany(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function isTelegramUserAuthorized(settings, userId, chatId) {
  if (settings.access === 'public') return true
  const whitelist = Array.isArray(settings.whitelist) ? settings.whitelist : []
  return whitelist.includes(String(userId)) || whitelist.includes(String(chatId))
}

export function isTelegramUserAdmin(settings, userId, chatId) {
  const whitelist = Array.isArray(settings.whitelist) ? settings.whitelist : []
  return whitelist.includes(String(userId)) || whitelist.includes(String(chatId))
}

export function shouldNotifyJob(job, change = {}) {
  return Boolean(job.verifiedOpen && (change.isNew || change.materiallyChanged || change.notificationPending))
}

export function makeJobKey(job) {
  const company = normalizeCompany(job.company)
  const jobId = String(job.jobId || '').trim().toLowerCase()
  if (company && jobId) return `job:${createHash('sha256').update(`${company}|${jobId}`).digest('hex')}`
  const url = normalizeJobUrl(job.officialUrl)
  if (url) return `url:${createHash('sha256').update(url).digest('hex')}`
  return `fallback:${createHash('sha256').update(`${company}|${String(job.title || '').toLowerCase().trim()}`).digest('hex')}`
}

function notificationFacts(job) {
  return JSON.stringify([
    job.title || '',
    job.deadline || '',
    Boolean(job.verifiedOpen),
    job.location || '',
    job.experience || '',
    job.eligibleGraduationYears || [],
    job.requiredDegrees || [],
    job.requiredBranches || [],
    job.minimumCgpa ?? null,
    job.salary || '',
    job.maxBacklogs ?? null,
    job.backlogRequirement || '',
    job.employmentType || '',
  ])
}

export function nextDailyRun(now = new Date()) {
  const localDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
  const [year, month, day] = localDate.split('-').map(Number)
  const todayAtNine = Date.UTC(year, month - 1, day, 3, 30)
  return new Date(now.getTime() < todayAtNine ? todayAtNine : todayAtNine + 86400000).toISOString()
}

export class JobDatabase {
  constructor(file) {
    this.file = file
    this.db = new DatabaseSync(file)
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
    this.migrate()
  }

  static async open(file) {
    await mkdir(path.dirname(file), { recursive: true })
    return new JobDatabase(file)
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS candidate_profile (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS job_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        companies_json TEXT NOT NULL DEFAULT '[]',
        provider TEXT NOT NULL DEFAULT 'openrouter',
        target_graduation_year INTEGER NOT NULL DEFAULT 2027,
        telegram_chat_id TEXT NOT NULL DEFAULT '',
        paused INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY,
        dedupe_key TEXT NOT NULL UNIQUE,
        company TEXT NOT NULL,
        title TEXT NOT NULL,
        location TEXT NOT NULL DEFAULT '',
        job_id TEXT NOT NULL DEFAULT '',
        official_url TEXT NOT NULL DEFAULT '',
        deadline TEXT NOT NULL DEFAULT '',
        experience TEXT NOT NULL DEFAULT '',
        eligible_years_json TEXT NOT NULL DEFAULT '[]',
        degrees_json TEXT NOT NULL DEFAULT '[]',
        branches_json TEXT NOT NULL DEFAULT '[]',
        minimum_cgpa REAL,
        skills_json TEXT NOT NULL DEFAULT '[]',
        employment_type TEXT NOT NULL DEFAULT '',
        salary TEXT NOT NULL DEFAULT '',
        evidence_json TEXT NOT NULL DEFAULT '[]',
        confidence TEXT NOT NULL DEFAULT 'low',
        status TEXT NOT NULL DEFAULT 'unverified',
        verified_open INTEGER NOT NULL DEFAULT 0,
        requirements_verified INTEGER NOT NULL DEFAULT 0,
        eligibility_status TEXT NOT NULL DEFAULT 'Insufficient evidence',
        eligibility_reason TEXT NOT NULL DEFAULT '',
        eligibility_missing_json TEXT NOT NULL DEFAULT '[]',
        saved INTEGER NOT NULL DEFAULT 0,
        application_status TEXT NOT NULL DEFAULT 'not_applied',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_verified_at TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS source_page_cache (
        source_url TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS company_search_runs (
        id INTEGER PRIMARY KEY,
        run_id INTEGER NOT NULL REFERENCES search_runs(id) ON DELETE CASCADE,
        company TEXT NOT NULL,
        domains_json TEXT NOT NULL,
        status TEXT NOT NULL,
        result_count INTEGER NOT NULL DEFAULT 0,
        verified_count INTEGER NOT NULL DEFAULT 0,
        new_jobs_count INTEGER NOT NULL DEFAULT 0,
        unresolved_count INTEGER NOT NULL DEFAULT 0,
        error TEXT NOT NULL DEFAULT '',
        searched_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS company_search_runs_company_date
        ON company_search_runs(company, searched_at DESC);
      CREATE TABLE IF NOT EXISTS provider_usage (
        id INTEGER PRIMARY KEY,
        provider TEXT NOT NULL,
        operation TEXT NOT NULL,
        status TEXT NOT NULL,
        input_tokens INTEGER,
        output_tokens INTEGER,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS jobs_company_job_id
        ON jobs(lower(company), lower(job_id)) WHERE job_id != '';
      CREATE UNIQUE INDEX IF NOT EXISTS jobs_official_url
        ON jobs(official_url) WHERE official_url != '';
      CREATE TABLE IF NOT EXISTS job_sources (
        id INTEGER PRIMARY KEY,
        job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        source_url TEXT NOT NULL,
        snippet TEXT NOT NULL,
        source_kind TEXT NOT NULL DEFAULT 'search_result',
        verification_status TEXT NOT NULL DEFAULT 'unverified',
        verified_at TEXT NOT NULL DEFAULT '',
        captured_at TEXT NOT NULL,
        UNIQUE(job_id, source_url, snippet)
      );
      CREATE TABLE IF NOT EXISTS job_page_cache (
        cache_key TEXT PRIMARY KEY,
        extracted_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS search_runs (
        id INTEGER PRIMARY KEY,
        status TEXT NOT NULL,
        trigger TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL DEFAULT '',
        companies_count INTEGER NOT NULL DEFAULT 0,
        results_count INTEGER NOT NULL DEFAULT 0,
        new_jobs_count INTEGER NOT NULL DEFAULT 0,
        error TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS job_notifications (
        id INTEGER PRIMARY KEY,
        job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        fingerprint TEXT NOT NULL,
        created_at TEXT NOT NULL,
        delivered_at TEXT NOT NULL DEFAULT '',
        UNIQUE(job_id, fingerprint)
      );
      CREATE TABLE IF NOT EXISTS scheduler_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        paused INTEGER NOT NULL DEFAULT 0,
        next_run_at TEXT NOT NULL,
        last_run_id INTEGER,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_preferences (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        settings_json TEXT NOT NULL DEFAULT '{}',
        auto_start INTEGER NOT NULL DEFAULT 1,
        auto_start_configured INTEGER NOT NULL DEFAULT 0,
        access_configured INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS job_applications (
        id INTEGER PRIMARY KEY,
        job_id INTEGER NOT NULL REFERENCES jobs(id),
        status TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      INSERT OR IGNORE INTO candidate_profile(id, data_json, updated_at)
        VALUES (1, '{}', datetime('now'));
      INSERT OR IGNORE INTO job_settings(id, companies_json, provider, target_graduation_year, updated_at)
        VALUES (1, '[]', 'openrouter', 2027, datetime('now'));
      INSERT OR IGNORE INTO scheduler_state(id, paused, next_run_at, updated_at)
        VALUES (1, 0, '', datetime('now'));
      INSERT OR IGNORE INTO agent_preferences(id, settings_json, auto_start, updated_at)
        VALUES (1, '{}', 1, datetime('now'));
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, datetime('now'));
    `)
    const settingsColumns = new Set(this.db.prepare('PRAGMA table_info(job_settings)').all().map((column) => column.name))
    if (!settingsColumns.has('telegram_chat_id')) {
      this.db.exec("ALTER TABLE job_settings ADD COLUMN telegram_chat_id TEXT NOT NULL DEFAULT ''")
    }
    const jobColumns = new Set(this.db.prepare('PRAGMA table_info(jobs)').all().map((column) => column.name))
    for (const [column, declaration] of [
      ['source_url', "TEXT NOT NULL DEFAULT ''"],
      ['application_url', "TEXT NOT NULL DEFAULT ''"],
      ['employer_identity', "TEXT NOT NULL DEFAULT ''"],
      ['max_backlogs', 'INTEGER'],
      ['backlog_requirement', "TEXT NOT NULL DEFAULT ''"],
    ]) {
      if (!jobColumns.has(column)) this.db.exec(`ALTER TABLE jobs ADD COLUMN ${column} ${declaration}`)
    }
    const sourceColumns = new Set(this.db.prepare('PRAGMA table_info(job_sources)').all().map((column) => column.name))
    for (const [column, declaration] of [
      ['application_url', "TEXT NOT NULL DEFAULT ''"],
      ['employer_identity', "TEXT NOT NULL DEFAULT ''"],
    ]) {
      if (!sourceColumns.has(column)) this.db.exec(`ALTER TABLE job_sources ADD COLUMN ${column} ${declaration}`)
    }
    const notificationColumns = new Set(this.db.prepare('PRAGMA table_info(job_notifications)').all().map((column) => column.name))
    for (const [column, declaration] of [
      ['claimed_at', "TEXT NOT NULL DEFAULT ''"],
      ['last_error', "TEXT NOT NULL DEFAULT ''"],
      ['attempts', 'INTEGER NOT NULL DEFAULT 0'],
    ]) {
      if (!notificationColumns.has(column)) this.db.exec(`ALTER TABLE job_notifications ADD COLUMN ${column} ${declaration}`)
    }
    const agentPreferenceColumns = new Set(this.db.prepare('PRAGMA table_info(agent_preferences)').all().map((column) => column.name))
    if (!agentPreferenceColumns.has('auto_start_configured')) {
      this.db.exec('ALTER TABLE agent_preferences ADD COLUMN auto_start_configured INTEGER NOT NULL DEFAULT 0')
    }
    if (!agentPreferenceColumns.has('access_configured')) {
      this.db.exec('ALTER TABLE agent_preferences ADD COLUMN access_configured INTEGER NOT NULL DEFAULT 0')
    }
    this.db.exec(`
      UPDATE jobs SET source_url=official_url WHERE source_url='';
      UPDATE jobs SET application_url=official_url WHERE application_url='';
      UPDATE agent_preferences SET auto_start=1, auto_start_configured=1 WHERE auto_start_configured=0;
      UPDATE agent_preferences
        SET settings_json=json_set(settings_json, '$.access', 'public'), access_configured=1
        WHERE access_configured=0;
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (2, datetime('now'));
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (3, datetime('now'));
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (4, datetime('now'));
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (5, datetime('now'));
    `)
    if (!this.db.prepare('SELECT 1 FROM schema_migrations WHERE version = 6').get()) {
      const updatedAt = new Date().toISOString()
      this.db.prepare("UPDATE job_settings SET provider = 'openrouter', updated_at = ? WHERE provider = 'gemini'").run(updatedAt)
      this.db.prepare(`UPDATE agent_preferences
        SET settings_json = json_set(settings_json, '$.provider', 'openrouter'), updated_at = ?
        WHERE json_extract(settings_json, '$.provider') = 'gemini'`).run(updatedAt)
      this.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (6, ?)')
        .run(updatedAt)
    }
    const schedule = this.db.prepare('SELECT next_run_at FROM scheduler_state WHERE id = 1').get()
    if (!schedule.next_run_at) {
      this.db.prepare('UPDATE scheduler_state SET next_run_at = ?, updated_at = ? WHERE id = 1')
        .run(nextDailyRun(), new Date().toISOString())
    }
  }

  getProfile() {
    const row = this.db.prepare('SELECT data_json, updated_at FROM candidate_profile WHERE id = 1').get()
    return { ...normalizeCandidateProfile(JSON.parse(row.data_json)), updatedAt: row.updated_at }
  }

  saveProfile(profile) {
    const normalized = normalizeCandidateProfile(profile)
    this.db.prepare('UPDATE candidate_profile SET data_json = ?, updated_at = ? WHERE id = 1')
      .run(JSON.stringify(normalized), new Date().toISOString())
    const current = this.getProfile()
    const jobs = this.db.prepare('SELECT * FROM jobs').all()
    const updateEligibility = this.db.prepare(`UPDATE jobs SET eligibility_status=?, eligibility_reason=?,
      eligibility_missing_json=?, updated_at=? WHERE id=?`)
    const now = new Date().toISOString()
    for (const row of jobs) {
      const eligibility = classifyEligibility(current, {
        eligibleGraduationYears: JSON.parse(row.eligible_years_json),
        requiredDegrees: JSON.parse(row.degrees_json),
        requiredBranches: JSON.parse(row.branches_json),
        minimumCgpa: row.minimum_cgpa,
        maxBacklogs: row.max_backlogs,
        backlogRequirement: row.backlog_requirement,
        employmentType: row.employment_type,
        verifiedOpen: Boolean(row.verified_open),
        requirementsVerified: Boolean(row.requirements_verified),
      })
      updateEligibility.run(eligibility.status, eligibility.reason, JSON.stringify(eligibility.missing), now, row.id)
    }
    return current
  }

  getSettings() {
    const row = this.db.prepare('SELECT companies_json, provider, target_graduation_year, telegram_chat_id, paused, updated_at FROM job_settings WHERE id = 1').get()
    return {
      companies: JSON.parse(row.companies_json),
      provider: row.provider,
      targetGraduationYear: row.target_graduation_year,
      telegramChatId: row.telegram_chat_id,
      paused: Boolean(row.paused),
      updatedAt: row.updated_at,
    }
  }

  saveSettings(input = {}) {
    const current = this.getSettings()
    const companies = Array.isArray(input.companies)
      ? input.companies
        .filter((company) => company && typeof company.name === 'string' && Array.isArray(company.officialDomains))
        .map((company) => ({
          name: company.name.trim().slice(0, 120),
          officialDomains: [...new Set(company.officialDomains
            .filter((domain) => typeof domain === 'string')
            .map((domain) => domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, ''))
            .filter((domain) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)))].slice(0, 10),
          applicationDomains: [...new Set((Array.isArray(company.applicationDomains) ? company.applicationDomains : [])
            .filter((domain) => typeof domain === 'string')
            .map((domain) => domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, ''))
            .filter((domain) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)))].slice(0, 10),
        }))
        .filter((company) => company.name && company.officialDomains.length)
        .slice(0, 100)
      : current.companies
    const provider = ['gemini', 'groq', 'openrouter'].includes(input.provider) ? input.provider : current.provider
    const year = Number(input.targetGraduationYear)
    const targetYear = Number.isInteger(year) && year >= 2020 && year <= 2040 ? year : current.targetGraduationYear
    const paused = typeof input.paused === 'boolean' ? input.paused : current.paused
    const telegramChatId = typeof input.telegramChatId === 'string' && /^-?\d{1,20}$/.test(input.telegramChatId)
      ? input.telegramChatId
      : current.telegramChatId
    const updatedAt = new Date().toISOString()
    this.db.prepare('UPDATE job_settings SET companies_json = ?, provider = ?, target_graduation_year = ?, telegram_chat_id = ?, paused = ?, updated_at = ? WHERE id = 1')
      .run(JSON.stringify(companies), provider, targetYear, telegramChatId, Number(paused), updatedAt)
    this.db.prepare('UPDATE scheduler_state SET paused = ?, updated_at = ? WHERE id = 1')
      .run(Number(paused), updatedAt)
    return this.getSettings()
  }

  getAgentPreferences() {
    const row = this.db.prepare('SELECT settings_json, auto_start FROM agent_preferences WHERE id = 1').get()
    return { settings: JSON.parse(row.settings_json), autoStart: Boolean(row.auto_start) }
  }

  saveAgentPreferences(settings, autoStart) {
    this.db.prepare('UPDATE agent_preferences SET settings_json = ?, auto_start = ?, auto_start_configured = 1, access_configured = 1, updated_at = ? WHERE id = 1')
      .run(JSON.stringify(settings), Number(autoStart), new Date().toISOString())
    return this.getAgentPreferences()
  }

  getScheduler() {
    return this.db.prepare('SELECT paused, next_run_at, last_run_id, updated_at FROM scheduler_state WHERE id = 1').get()
  }

  setNotificationChatId(chatId) {
    this.db.prepare('UPDATE job_settings SET telegram_chat_id=?, updated_at=? WHERE id=1')
      .run(String(chatId), new Date().toISOString())
  }

  recoverInterruptedRuns() {
    const now = new Date().toISOString()
    return this.db.prepare("UPDATE search_runs SET status='failed', completed_at=?, error='Process stopped during this run.' WHERE status='running'")
      .run(now).changes
  }

  markMissedRun(error = 'Scheduled run was missed while the service was stopped.') {
    const now = new Date().toISOString()
    const result = this.db.prepare(`INSERT INTO search_runs(status, trigger, started_at, completed_at, error)
      VALUES('missed', 'schedule-recovery', ?, ?, ?)`).run(now, now, error)
    return Number(result.lastInsertRowid)
  }

  setNextRun(value) {
    this.db.prepare('UPDATE scheduler_state SET next_run_at = ?, updated_at = ? WHERE id = 1')
      .run(value, new Date().toISOString())
  }

  createRun(trigger) {
    const now = new Date().toISOString()
    const result = this.db.prepare('INSERT INTO search_runs(status, trigger, started_at) VALUES (?, ?, ?)')
      .run('running', trigger, now)
    return Number(result.lastInsertRowid)
  }

  completeRun(id, result) {
    const now = new Date().toISOString()
    this.db.prepare(`UPDATE search_runs SET status = ?, completed_at = ?, companies_count = ?,
      results_count = ?, new_jobs_count = ?, error = ? WHERE id = ?`)
      .run(result.status, now, result.companiesCount || 0, result.resultsCount || 0, result.newJobsCount || 0, result.error || '', id)
    this.db.prepare('UPDATE scheduler_state SET last_run_id = ?, updated_at = ? WHERE id = 1')
      .run(id, now)
  }

  getRun(id) {
    return this.db.prepare('SELECT * FROM search_runs WHERE id=?').get(id)
  }

  listRuns(limit = 20) {
    return this.db.prepare('SELECT * FROM search_runs ORDER BY id DESC LIMIT ?').all(limit)
  }

  recordCompanySearch(result) {
    this.db.prepare(`INSERT INTO company_search_runs(
      run_id, company, domains_json, status, result_count, verified_count, new_jobs_count,
      unresolved_count, error, searched_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      result.runId, result.company, JSON.stringify(result.domains || []), result.status,
      result.resultCount || 0, result.verifiedCount || 0, result.newJobsCount || 0,
      result.unresolvedCount || 0, result.error || '', result.searchedAt || new Date().toISOString(),
    )
  }

  getCoverage() {
    const settings = this.getSettings()
    const companies = settings.companies.map((company) => {
      const latestSuccess = this.db.prepare(`SELECT searched_at, new_jobs_count FROM company_search_runs
        WHERE company=? AND status='completed' ORDER BY searched_at DESC LIMIT 1`).get(company.name)
      const failures = this.db.prepare(`SELECT COUNT(*) AS count FROM company_search_runs
        WHERE company=? AND status='failed'`).get(company.name).count
      const latest = this.db.prepare(`SELECT unresolved_count FROM company_search_runs
        WHERE company=? ORDER BY searched_at DESC LIMIT 1`).get(company.name)
      const unresolved = this.db.prepare(`SELECT COUNT(*) AS count FROM jobs
        WHERE lower(company)=lower(?) AND status='recheck_pending'`).get(company.name).count
      const open = this.db.prepare(`SELECT COUNT(*) AS count FROM jobs
        WHERE lower(company)=lower(?) AND verified_open=1
          AND last_verified_at >= ?`).get(company.name, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).count
      return {
        name: company.name,
        domains: company.officialDomains,
        applicationDomains: company.applicationDomains || [],
        lastSuccessfulSearch: latestSuccess?.searched_at || null,
        failedSearches: failures,
        verifiedOpenVacancies: open,
        newlyDiscoveredVacancies: latestSuccess?.new_jobs_count || 0,
        unresolvedVerificationFailures: Math.max(unresolved, latest?.unresolved_count || 0),
      }
    })
    return {
      configuredCompanies: companies.length,
      checkedDomains: companies.reduce((count, company) => count + company.domains.length, 0),
      companies,
    }
  }

  recordProviderUsage(result) {
    this.db.prepare(`INSERT INTO provider_usage(
      provider, operation, status, input_tokens, output_tokens, duration_ms, error, created_at
    ) VALUES(?,?,?,?,?,?,?,?)`).run(
      result.provider, result.operation, result.status,
      Number.isInteger(result.inputTokens) ? result.inputTokens : null,
      Number.isInteger(result.outputTokens) ? result.outputTokens : null,
      Number.isFinite(result.durationMs) ? Math.max(0, Math.round(result.durationMs)) : 0,
      String(result.error || '').slice(0, 350), new Date().toISOString(),
    )
  }

  listProviderUsage(limit = 50) {
    return this.db.prepare(`SELECT provider, operation, status, input_tokens AS inputTokens,
      output_tokens AS outputTokens, duration_ms AS durationMs, error, created_at AS createdAt
      FROM provider_usage ORDER BY id DESC LIMIT ?`).all(limit)
  }

  getCachedPage(url, maxAgeMs) {
    const row = this.db.prepare('SELECT content, fetched_at FROM source_page_cache WHERE source_url=?').get(url)
    if (!row || Date.now() - Date.parse(row.fetched_at) > maxAgeMs) return null
    return { url, content: row.content, fetchedAt: row.fetched_at }
  }

  cachePage(url, content, fetchedAt = new Date().toISOString()) {
    this.db.prepare(`INSERT INTO source_page_cache(source_url, content, fetched_at) VALUES(?,?,?)
      ON CONFLICT(source_url) DO UPDATE SET content=excluded.content, fetched_at=excluded.fetched_at`)
      .run(url, content, fetchedAt)
  }

  upsertJob(job, profile) {
    const now = new Date().toISOString()
    const dedupeKey = makeJobKey(job)
    const eligibility = classifyEligibility(profile, job)
    const existing = this.db.prepare(`SELECT id, saved, application_status, evidence_json, title, deadline,
      verified_open, location, experience, eligible_years_json, degrees_json, branches_json, minimum_cgpa, salary,
      max_backlogs, backlog_requirement, employment_type
      FROM jobs
      WHERE dedupe_key = ? OR (job_id != '' AND lower(company) = lower(?) AND lower(job_id) = lower(?))
      OR (official_url != '' AND official_url = ?) LIMIT 1`).get(dedupeKey, job.company, job.jobId || '', normalizeJobUrl(job.officialUrl))
    const verifiedOpen = Boolean(job.verifiedOpen && job.officialUrl && job.officialPageFetched)
    const verifiedClosed = Boolean(job.verifiedClosed && job.officialUrl && job.officialPageFetched)
    const materiallyChanged = Boolean(existing && notificationFacts({
      title: existing.title,
      deadline: existing.deadline,
      verifiedOpen: Boolean(existing.verified_open),
      location: existing.location,
      experience: existing.experience,
      eligibleGraduationYears: JSON.parse(existing.eligible_years_json),
      requiredDegrees: JSON.parse(existing.degrees_json),
      requiredBranches: JSON.parse(existing.branches_json),
      minimumCgpa: existing.minimum_cgpa,
      salary: existing.salary,
      maxBacklogs: existing.max_backlogs,
      backlogRequirement: existing.backlog_requirement,
      employmentType: existing.employment_type,
    }) !== notificationFacts({ ...job, verifiedOpen }))
    const values = [
      job.company, job.title, job.location || '', job.jobId || '', normalizeJobUrl(job.officialUrl),
      job.deadline || '', job.experience || '', JSON.stringify(job.eligibleGraduationYears || []),
      JSON.stringify(job.requiredDegrees || []), JSON.stringify(job.requiredBranches || []),
      Number.isFinite(job.minimumCgpa) ? job.minimumCgpa : null, JSON.stringify(job.skills || []),
      job.employmentType || '', job.salary || '', job.confidence || 'low',
      verifiedOpen ? 'open_verified' : verifiedClosed ? 'closed_verified' : 'unverified', Number(verifiedOpen),
      Number(Boolean(job.requirementsVerified)), eligibility.status, eligibility.reason,
      JSON.stringify(eligibility.missing), now,
    ]
    let id
    let isNew = false
    if (existing) {
      id = existing.id
      const mergedEvidence = [...JSON.parse(existing.evidence_json), ...(job.evidence || [])]
      this.db.prepare(`UPDATE jobs SET company=?, title=?, location=?, job_id=?, official_url=?, deadline=?,
        experience=?, eligible_years_json=?, degrees_json=?, branches_json=?, minimum_cgpa=?, skills_json=?,
        employment_type=?, salary=?, confidence=?, status=?, verified_open=?, requirements_verified=?,
        eligibility_status=?, eligibility_reason=?, eligibility_missing_json=?, evidence_json=?, updated_at=?,
        last_verified_at=CASE WHEN ? THEN ? ELSE last_verified_at END,
        source_url=?, application_url=?, employer_identity=?, max_backlogs=?, backlog_requirement=? WHERE id=?`)
        .run(...values.slice(0, 21), JSON.stringify([...new Set(mergedEvidence)]), now,
          Number(Boolean(job.officialPageFetched)), job.verifiedAt || now,
          normalizeJobUrl(job.sourceUrl || job.officialUrl), job.applicationUrl || normalizeJobUrl(job.officialUrl), job.employerIdentity || job.company,
          Number.isInteger(job.maxBacklogs) ? job.maxBacklogs : null, job.backlogRequirement || '', id)
    } else {
      const result = this.db.prepare(`INSERT INTO jobs(dedupe_key, company, title, location, job_id, official_url,
        deadline, experience, eligible_years_json, degrees_json, branches_json, minimum_cgpa, skills_json,
        employment_type, salary, confidence, status, verified_open, requirements_verified,
        eligibility_status, eligibility_reason, eligibility_missing_json, evidence_json, created_at, updated_at, last_verified_at,
        source_url, application_url, employer_identity, max_backlogs, backlog_requirement)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(dedupeKey, ...values.slice(0, 21), JSON.stringify(job.evidence || []), now, now,
          job.officialPageFetched ? (job.verifiedAt || now) : '',
          normalizeJobUrl(job.sourceUrl || job.officialUrl), job.applicationUrl || normalizeJobUrl(job.officialUrl), job.employerIdentity || job.company,
          Number.isInteger(job.maxBacklogs) ? job.maxBacklogs : null, job.backlogRequirement || '')
      id = Number(result.lastInsertRowid)
      isNew = true
    }
    for (const source of job.sources || []) {
      this.db.prepare(`INSERT OR IGNORE INTO job_sources(job_id, source_url, snippet, source_kind,
        verification_status, verified_at, captured_at, application_url, employer_identity) VALUES(?,?,?,?,?,?,?,?,?)`)
        .run(id, source.url, source.snippet || '', source.kind || 'search_result',
          source.verified ? 'official_page' : 'unverified', source.verified ? (job.verifiedAt || now) : '', now,
          job.applicationUrl || '', job.employerIdentity || job.company)
    }
    return { id, isNew, materiallyChanged, eligibility }
  }

  listJobs(filter = {}) {
    const where = []
    const values = []
    if (filter.saved) where.push('saved = 1')
    if (filter.applied) where.push("application_status = 'applied'")
    if (filter.eligibility) { where.push('eligibility_status = ?'); values.push(filter.eligibility) }
    if (filter.company) { where.push('lower(company) LIKE ?'); values.push(`%${filter.company.toLowerCase()}%`) }
    const query = `SELECT * FROM jobs${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
      ORDER BY CASE eligibility_status WHEN 'Eligible' THEN 0 WHEN 'Likely eligible' THEN 1 ELSE 2 END,
      deadline ASC, updated_at DESC LIMIT 200`
    const profile = this.getProfile()
    return this.db.prepare(query).all(...values).map((row) => this.presentJob(row, profile))
  }

  presentJob(row, profile = this.getProfile()) {
    const lastVerifiedAt = row.last_verified_at
    const verifiedAtMs = Date.parse(lastVerifiedAt)
    const verifiedOpen = Boolean(row.verified_open
      && Number.isFinite(verifiedAtMs)
      && Date.now() - verifiedAtMs <= 24 * 60 * 60 * 1000)
    const staleEligibility = row.verified_open && !verifiedOpen
      ? classifyEligibility(profile, {
        eligibleGraduationYears: JSON.parse(row.eligible_years_json),
        requiredDegrees: JSON.parse(row.degrees_json),
        requiredBranches: JSON.parse(row.branches_json),
        minimumCgpa: row.minimum_cgpa,
        maxBacklogs: row.max_backlogs,
        backlogRequirement: row.backlog_requirement,
        employmentType: row.employment_type,
        verifiedOpen: false,
        requirementsVerified: Boolean(row.requirements_verified),
      })
      : null
    return {
      id: row.id, company: row.company, employerIdentity: row.employer_identity || row.company,
      title: row.title, location: row.location, jobId: row.job_id,
      officialUrl: row.source_url || row.official_url, sourceUrl: row.source_url || row.official_url,
      applicationUrl: row.application_url || row.official_url, deadline: row.deadline, experience: row.experience,
      eligibleGraduationYears: JSON.parse(row.eligible_years_json), requiredDegrees: JSON.parse(row.degrees_json),
      requiredBranches: JSON.parse(row.branches_json), minimumCgpa: row.minimum_cgpa,
      maxBacklogs: row.max_backlogs, backlogRequirement: row.backlog_requirement,
      skills: JSON.parse(row.skills_json), employmentType: row.employment_type, salary: row.salary,
      evidence: JSON.parse(row.evidence_json), sources: this.db.prepare(`SELECT source_url AS url, snippet,
        source_kind AS kind, verification_status AS verificationStatus, verified_at AS verifiedAt,
        captured_at AS capturedAt, application_url AS applicationUrl, employer_identity AS employerIdentity
        FROM job_sources WHERE job_id=? ORDER BY id`).all(row.id),
      confidence: row.confidence,
      status: verifiedOpen ? row.status : ['open_verified', 'recheck_pending'].includes(row.status) ? 'unverified' : row.status,
      verifiedOpen, needsRecheck: Boolean(row.verified_open || row.status === 'recheck_pending'),
      eligibilityStatus: staleEligibility?.status || row.eligibility_status,
      eligibilityReason: staleEligibility?.reason || row.eligibility_reason,
      missing: staleEligibility?.missing || JSON.parse(row.eligibility_missing_json), saved: Boolean(row.saved),
      applicationStatus: row.application_status, createdAt: row.created_at, updatedAt: row.updated_at,
      lastVerifiedAt,
    }
  }

  updateJob(id, action, note = '') {
    const row = this.db.prepare('SELECT id, application_status FROM jobs WHERE id = ?').get(id)
    if (!row) return null
    if (action === 'save') this.db.prepare('UPDATE jobs SET saved=1, updated_at=? WHERE id=?').run(new Date().toISOString(), id)
    if (action === 'unsave') this.db.prepare('UPDATE jobs SET saved=0, updated_at=? WHERE id=?').run(new Date().toISOString(), id)
    if (action === 'applied') {
      const now = new Date().toISOString()
      this.db.prepare("UPDATE jobs SET application_status='applied', updated_at=? WHERE id=?").run(now, id)
      this.db.prepare('INSERT INTO job_applications(job_id, status, note, created_at) VALUES(?,?,?,?)').run(id, 'applied', note.slice(0, 1000), now)
    }
    return this.getJob(id)
  }

  getJob(id) {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id)
    return row ? this.presentJob(row) : null
  }

  markJobUnverified(officialUrl) {
    const normalizedUrl = normalizeJobUrl(officialUrl)
    const row = this.db.prepare('SELECT * FROM jobs WHERE official_url=?').get(normalizedUrl)
    if (!row) return null
    const eligibility = classifyEligibility(this.getProfile(), {
      eligibleGraduationYears: JSON.parse(row.eligible_years_json),
      requiredDegrees: JSON.parse(row.degrees_json),
      requiredBranches: JSON.parse(row.branches_json),
      minimumCgpa: row.minimum_cgpa,
      verifiedOpen: false,
      requirementsVerified: Boolean(row.requirements_verified),
    })
    this.db.prepare(`UPDATE jobs SET verified_open=0, status='recheck_pending', eligibility_status=?,
      eligibility_reason=?, eligibility_missing_json=?, updated_at=? WHERE id=?`)
      .run(eligibility.status, eligibility.reason, JSON.stringify(eligibility.missing), new Date().toISOString(), row.id)
    return this.getJob(row.id)
  }

  recordNotification(jobId, fingerprint) {
    const now = new Date().toISOString()
    const leaseExpiry = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const result = this.db.prepare(`INSERT INTO job_notifications(job_id, fingerprint, created_at, claimed_at, attempts)
      VALUES(?,?,?,?,1)
      ON CONFLICT(job_id, fingerprint) DO UPDATE SET
        claimed_at=excluded.claimed_at, attempts=job_notifications.attempts+1, last_error=''
      WHERE job_notifications.delivered_at='' AND
        (job_notifications.claimed_at='' OR job_notifications.claimed_at < ?)`)
      .run(jobId, fingerprint, now, now, leaseExpiry)
    return result.changes === 1
  }

  hasPendingNotification(jobId, fingerprint) {
    const expiredClaim = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    return Boolean(this.db.prepare(`SELECT 1 FROM job_notifications WHERE job_id=? AND fingerprint=?
      AND delivered_at='' AND
        ((claimed_at='' AND last_error!='') OR claimed_at < ?)`).get(jobId, fingerprint, expiredClaim))
  }

  markNotificationDelivered(jobId, fingerprint) {
    this.db.prepare(`UPDATE job_notifications SET delivered_at=?, claimed_at='', last_error=''
      WHERE job_id=? AND fingerprint=?`)
      .run(new Date().toISOString(), jobId, fingerprint)
  }

  failNotification(jobId, fingerprint, error, retryable = true) {
    this.db.prepare(`UPDATE job_notifications SET claimed_at=?, last_error=?
      WHERE job_id=? AND fingerprint=? AND delivered_at=''`)
      .run(retryable ? '' : new Date().toISOString(), String(error).slice(0, 350), jobId, fingerprint)
  }

  backupTo(destination) {
    return backup(this.db, destination)
  }

  getPageCache(cacheKey) {
    const row = this.db.prepare('SELECT extracted_json FROM job_page_cache WHERE cache_key=?').get(cacheKey)
    return row ? JSON.parse(row.extracted_json) : null
  }

  setPageCache(cacheKey, extracted) {
    this.db.prepare(`INSERT INTO job_page_cache(cache_key, extracted_json, updated_at) VALUES(?,?,?)
      ON CONFLICT(cache_key) DO UPDATE SET extracted_json=excluded.extracted_json, updated_at=excluded.updated_at`)
      .run(cacheKey, JSON.stringify(extracted), new Date().toISOString())
  }

  close() {
    this.db.close()
  }
}
