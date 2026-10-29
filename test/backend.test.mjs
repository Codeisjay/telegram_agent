import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { JobDatabase } from '../job-intelligence.mjs'

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const tempRoot = await mkdtemp(path.join(tmpdir(), 'agentflow-backend-test-'))
const secretDirectory = path.join(tempRoot, 'local-app-data')
const secretKeys = ['GEMINI_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'TAVILY_SEARCH_KEY', 'TELEGRAM_BOT_TOKEN']
let server
let baseUrl
function makeTestEnvironment(overrides = {}) {
  const environment = { ...process.env, LOCALAPPDATA: secretDirectory, AGENTFLOW_PORT: '0' }
  environment.AGENTFLOW_ENV_FILE = path.join(tempRoot, 'empty-project.env')
  for (const key of [...secretKeys, 'NODE_ENV', 'AGENTFLOW_HOST', 'AGENTFLOW_USERNAME', 'AGENTFLOW_PASSWORD', 'AGENTFLOW_DATA_DIR', 'AGENTFLOW_SECRET_FILE']) delete environment[key]
  environment.GROQ_API_KEY = 'environment-stale-test-key'
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete environment[key]
    else environment[key] = value
  }
  return environment
}

function startTestBackend(overrides) {
  const child = spawn(process.execPath, ['--import', './test-support/mock-fetch.mjs', 'server.mjs'], {
    cwd: projectRoot,
    env: makeTestEnvironment(overrides),
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const started = new Promise((resolve, reject) => {
    let output = ''
    const timeout = setTimeout(() => reject(new Error(`Backend did not start. ${output}`)), 10000)
    child.once('error', (error) => { clearTimeout(timeout); reject(error) })
    child.stdout.on('data', (chunk) => {
      output += chunk.toString()
      const match = output.match(/listening on http:\/\/[^:]+:(\d+)/)
      if (!match) return
      clearTimeout(timeout)
      resolve(`http://127.0.0.1:${match[1]}`)
    })
    child.stderr.on('data', (chunk) => { output += chunk.toString() })
    child.once('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`Backend exited before starting (${code}). ${output}`))
    })
  })
  return { child, started }
}

before(async () => {
  const backend = startTestBackend()
  server = backend.child
  baseUrl = await backend.started
})

after(async () => {
  if (server && server.exitCode === null) {
    server.kill()
    await new Promise((resolve) => server.once('exit', resolve))
  }
  await rm(tempRoot, { recursive: true, force: true })
})

test('health endpoint reports status without returning credential values', async () => {
  const response = await fetch(`${baseUrl}/api/health`)
  const health = await response.json()
  assert.equal(response.status, 200)
  assert.equal(health.ok, true)
  assert.equal(health.service, 'agentflow-api')
  assert.equal(Object.hasOwn(health, 'secrets'), false)
  assert.equal(Object.hasOwn(health, 'credentials'), false)
})

test('uses the platform PORT when AGENTFLOW_PORT is not configured', async () => {
  const backend = startTestBackend({ AGENTFLOW_PORT: undefined, PORT: '0' })
  try {
    const url = await backend.started
    const response = await fetch(`${url}/api/health`)
    assert.equal(response.status, 200)
  } finally {
    if (backend.child.exitCode === null) {
      backend.child.kill()
      await new Promise((resolve) => backend.child.once('exit', resolve))
    }
  }
})

test('local credential override can clear a project .env credential', async () => {
  const save = await fetch(`${baseUrl}/api/secrets`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'GEMINI_API_KEY', value: 'test-only-placeholder' }),
  })
  assert.equal(save.status, 200)
  assert.equal((await save.json()).configured, true)

  const remove = await fetch(`${baseUrl}/api/secrets`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'GEMINI_API_KEY', value: '' }),
  })
  assert.equal(remove.status, 200)
  assert.equal((await remove.json()).configured, false)

  const healthResponse = await fetch(`${baseUrl}/api/health`)
  const health = await healthResponse.json()
  assert.equal(health.ok, true)
  assert.equal(Object.hasOwn(health, 'credentials'), false)
})

test('live query rejects empty input and reports missing provider credentials', async () => {
  const emptyResponse = await fetch(`${baseUrl}/api/agent/test`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: '', settings: {} }),
  })
  assert.equal(emptyResponse.status, 400)

  const missingKeyResponse = await fetch(`${baseUrl}/api/agent/test`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'backend test', settings: { provider: 'gemini' } }),
  })
  assert.equal(missingKeyResponse.status, 400)
  assert.match((await missingKeyResponse.json()).error, /Save a Gemini API key/)

  const defaultProviderResponse = await fetch(`${baseUrl}/api/agent/test`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'backend test', settings: {} }),
  })
  assert.equal(defaultProviderResponse.status, 400)
  assert.match((await defaultProviderResponse.json()).error, /Save an OpenRouter API key/)
})

test('credential testing rejects malformed draft values without exposing them', async () => {
  const response = await fetch(`${baseUrl}/api/secrets/test`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'groq', value: 123 }),
  })
  const result = await response.json()
  assert.equal(response.status, 400)
  assert.equal(result.error, 'Invalid credential value.')
  assert.equal(JSON.stringify(result).includes('123'), false)
})

test('saved dashboard Groq key overrides a stale process environment key', async () => {
  for (const [name, value] of [
    ['GROQ_API_KEY', 'saved-test-key'],
    ['TAVILY_SEARCH_KEY', 'saved-test-search-key'],
  ]) {
    const response = await fetch(`${baseUrl}/api/secrets`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, value }),
    })
    assert.equal(response.status, 200)
  }

  const response = await fetch(`${baseUrl}/api/agent/test`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: 'verify local provider selection',
      settings: { provider: 'groq' },
    }),
  })
  const result = await response.json()
  assert.equal(response.status, 200, result.error)
  assert.match(result.answer, /^Mock Groq response/)
})

test('job research verifies official pages, stores evidence, and deduplicates repeat runs', async () => {
  const profileResponse = await fetch(`${baseUrl}/api/jobs/profile`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      graduationYear: '2027',
      degree: 'BTech',
      branch: 'Computer Science',
      academicEligibility: 'CGPA 8.1',
      backlogStatus: 'No active backlogs',
      experience: 'Fresher',
      employmentTypes: ['Internship'],
      skills: ['Java', 'Python'],
    }),
  })
  assert.equal(profileResponse.status, 200)

  const settingsResponse = await fetch(`${baseUrl}/api/jobs/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: 'groq',
      targetGraduationYear: 2027,
      companies: [{ name: 'Example Systems', officialDomains: ['careers.example.com'] }],
    }),
  })
  assert.equal(settingsResponse.status, 200)

  const firstRun = await fetch(`${baseUrl}/api/jobs/run`, { method: 'POST' })
  const firstResult = await firstRun.json()
  assert.equal(firstRun.status, 200, firstResult.error)
  assert.equal(firstResult.newJobsCount, 1)
  const jobsResponse = await fetch(`${baseUrl}/api/jobs`)
  const jobs = (await jobsResponse.json()).jobs
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].verifiedOpen, true)
  assert.equal(jobs[0].eligibilityStatus, 'Eligible')
  assert.equal(jobs[0].sources[0].verificationStatus, 'official_page')
  assert.ok(jobs[0].evidence.length)
  assert.equal(jobs[0].sourceUrl, 'https://careers.example.com/jobs/INT-27')
  assert.equal(jobs[0].applicationUrl, 'https://careers.example.com/jobs/INT-27')

  const secondRun = await fetch(`${baseUrl}/api/jobs/run`, { method: 'POST' })
  const secondResult = await secondRun.json()
  assert.equal(secondRun.status, 200, secondResult.error)
  assert.equal(secondResult.newJobsCount, 0)
  const secondState = await fetch(`${baseUrl}/api/jobs/state`).then((result) => result.json())
  assert.equal((await fetch(`${baseUrl}/api/jobs`)).status, 200)
  assert.equal(secondState.coverage.configuredCompanies, 1)
  assert.ok(secondState.coverage.checkedDomains >= 1)
  assert.equal(secondState.providerUsage.filter((entry) => entry.operation === 'page-extraction').length, 1)
  assert.equal(secondState.providerUsage.filter((entry) => entry.operation === 'job-analysis').length, 1)
})

test('OpenRouter job extraction bounds prompts, retries token limits, and continues other jobs', async () => {
  for (const [name, value] of [
    ['OPENROUTER_API_KEY', 'test-openrouter-key'],
    ['TAVILY_SEARCH_KEY', 'test-tavily-key'],
  ]) {
    const saved = await fetch(`${baseUrl}/api/secrets`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, value }),
    })
    assert.equal(saved.status, 200)
  }

  const settings = await fetch(`${baseUrl}/api/jobs/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: 'openrouter',
      targetGraduationYear: 2027,
      companies: [{ name: 'Large Jobs Co', officialDomains: ['careers.example.com'] }],
    }),
  })
  assert.equal(settings.status, 200)

  const run = await fetch(`${baseUrl}/api/jobs/run`, { method: 'POST' })
  const result = await run.json()
  assert.equal(run.status, 200, result.error)
  assert.equal(result.status, 'completed')

  const jobs = (await fetch(`${baseUrl}/api/jobs`).then((response) => response.json())).jobs
    .filter((job) => job.company === 'Large Jobs Co')
  assert.equal(jobs.length, 2)
  assert.deepEqual(new Set(jobs.map((job) => job.jobId)), new Set(['job-a-27', 'job-b-27']))

  const state = await fetch(`${baseUrl}/api/jobs/state`).then((response) => response.json())
  const analyses = state.providerUsage.filter((entry) => entry.provider === 'openrouter' && entry.operation === 'job-analysis')
  assert.equal(analyses.length, 5, JSON.stringify(analyses))
  assert.equal(analyses.filter((entry) => entry.status === '400').length, 3)
  assert.equal(analyses.filter((entry) => entry.status === '200').length, 2)
  assert.equal(state.runs[0].status, 'completed')
})

test('OpenRouter job extraction retries transient in-flight credit reservation failures', async () => {
  const baselineState = await fetch(`${baseUrl}/api/jobs/state`).then((item) => item.json())
  const baselineAnalyses = baselineState.providerUsage.filter((entry) => entry.provider === 'openrouter'
    && entry.operation === 'job-analysis')
  const baselineCapacityFailures = baselineAnalyses.filter((entry) => entry.status === '402').length
  const baselineSuccesses = baselineAnalyses.filter((entry) => entry.status === '200').length

  for (const [name, value] of [
    ['OPENROUTER_API_KEY', 'test-openrouter-key'],
    ['TAVILY_SEARCH_KEY', 'test-tavily-key'],
  ]) {
    const saved = await fetch(`${baseUrl}/api/secrets`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, value }),
    })
    assert.equal(saved.status, 200)
  }

  await fetch(`${baseUrl}/api/jobs/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: 'openrouter',
      targetGraduationYear: 2027,
      companies: [{ name: 'CreditRetryCo', officialDomains: ['careers.example.com'] }],
    }),
  })

  const response = await fetch(`${baseUrl}/api/jobs/run`, { method: 'POST' })
  const result = await response.json()
  assert.equal(response.status, 200, result.error)
  assert.equal(result.status, 'completed')

  const jobs = (await fetch(`${baseUrl}/api/jobs`).then((item) => item.json())).jobs
    .filter((job) => job.company === 'CreditRetryCo')
  assert.equal(jobs.length, 1)

  const state = await fetch(`${baseUrl}/api/jobs/state`).then((item) => item.json())
  const analyses = state.providerUsage.filter((entry) => entry.provider === 'openrouter'
    && entry.operation === 'job-analysis')
  assert.equal(analyses.filter((entry) => entry.status === '402').length - baselineCapacityFailures, 1)
  assert.equal(analyses.filter((entry) => entry.status === '200').length - baselineSuccesses, 1)
})

test('job research reports provider/search failures as failed runs', async () => {
  const settingsResponse = await fetch(`${baseUrl}/api/jobs/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: 'groq',
      companies: [{ name: 'FailCo', officialDomains: ['careers.failco.example'] }],
    }),
  })
  assert.equal(settingsResponse.status, 200)
  const response = await fetch(`${baseUrl}/api/jobs/run`, { method: 'POST' })
  assert.equal(response.status, 502)
  assert.match((await response.json()).error, /Temporary search failure/)
  const state = await fetch(`${baseUrl}/api/jobs/state`).then((result) => result.json())
  assert.equal(state.runs[0].status, 'failed')
  assert.match(state.runs[0].error, /FailCo/)
})

test('job research reports Tavily rate limits, timeouts, extraction and LLM failures', async () => {
  for (const [name, expected] of [
    ['RateLimitCo', /Search rate limit/],
    ['TimeoutCo', /timed out/],
    ['ExtractFailCo', /Temporary extraction failure/],
    ['ExtractTimeoutCo', /timed out/],
    ['LlmFailCo', /Temporary LLM failure/],
    ['LlmTimeoutCo', /timed out/],
  ]) {
    await fetch(`${baseUrl}/api/jobs/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'groq',
        companies: [{ name, officialDomains: ['careers.example.com'] }],
      }),
    })
    const response = await fetch(`${baseUrl}/api/jobs/run`, { method: 'POST' })
    assert.equal(response.status, 502, `${name} should be recorded as an error`)
    assert.match((await response.json()).error, expected)
  }
  const state = await fetch(`${baseUrl}/api/jobs/state`).then((result) => result.json())
  assert.ok(state.providerUsage.some((entry) => entry.status === '429'))
  assert.ok(state.providerUsage.some((entry) => entry.status === 'network_error'))
  assert.ok(state.runs.filter((run) => run.status === 'failed').length >= 7)
})

test('overlapping manual research runs are rejected', async () => {
  await fetch(`${baseUrl}/api/jobs/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: 'groq',
      companies: [{ name: 'SlowCo', officialDomains: ['careers.example.com'] }],
    }),
  })
  const firstRun = fetch(`${baseUrl}/api/jobs/run`, { method: 'POST' })
  await new Promise((resolve) => setTimeout(resolve, 30))
  const overlapping = await fetch(`${baseUrl}/api/jobs/run`, { method: 'POST' })
  assert.equal(overlapping.status, 409)
  assert.match((await overlapping.json()).error, /already in progress/)
  assert.equal((await firstRun).status, 200)
})

test('Telegram rate limits are recorded and failed notifications can be retried without duplicate sends', async () => {
  await fetch(`${baseUrl}/api/agent/stop`, { method: 'POST' })
  const saveToken = await fetch(`${baseUrl}/api/secrets`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'TELEGRAM_BOT_TOKEN', value: 'test-telegram-token' }),
  })
  assert.equal(saveToken.status, 200)
  await fetch(`${baseUrl}/api/jobs/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: 'groq',
      telegramChatId: '429',
      companies: [{ name: 'NotificationCo', officialDomains: ['careers.example.com'] }],
    }),
  })
  const failedRun = await fetch(`${baseUrl}/api/jobs/run`, { method: 'POST' })
  assert.equal(failedRun.status, 200)
  let state = await fetch(`${baseUrl}/api/jobs/state`).then((result) => result.json())
  assert.ok(state.providerUsage.some((entry) => entry.operation === 'job-notification' && entry.status === 'failed'))
  assert.equal(state.coverage.companies[0].verifiedOpenVacancies, 1)

  await fetch(`${baseUrl}/api/jobs/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: 'groq',
      telegramChatId: '123',
      companies: [{ name: 'NotificationCo', officialDomains: ['careers.example.com'] }],
    }),
  })
  const retryRun = await fetch(`${baseUrl}/api/jobs/run`, { method: 'POST' })
  assert.equal(retryRun.status, 200)
  const duplicateRun = await fetch(`${baseUrl}/api/jobs/run`, { method: 'POST' })
  assert.equal(duplicateRun.status, 200)
  state = await fetch(`${baseUrl}/api/jobs/state`).then((result) => result.json())
  assert.equal(state.providerUsage.filter((entry) => entry.operation === 'job-notification').length, 2)
  assert.equal(state.providerUsage.filter((entry) => entry.operation === 'job-notification' && entry.status === 'delivered').length, 1)
  await fetch(`${baseUrl}/api/secrets`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'TELEGRAM_BOT_TOKEN', value: '' }),
  })
})

test('ambiguous Telegram timeout is persisted without an immediate duplicate retry', async () => {
  await fetch(`${baseUrl}/api/agent/stop`, { method: 'POST' })
  await fetch(`${baseUrl}/api/secrets`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'TELEGRAM_BOT_TOKEN', value: 'test-telegram-token' }),
  })
  await fetch(`${baseUrl}/api/jobs/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: 'groq',
      telegramChatId: '-987',
      companies: [{ name: 'TelegramTimeoutCo', officialDomains: ['careers.example.com'] }],
    }),
  })
  const run = await fetch(`${baseUrl}/api/jobs/run`, { method: 'POST' })
  assert.equal(run.status, 200)
  let state = await fetch(`${baseUrl}/api/jobs/state`).then((response) => response.json())
  assert.ok(state.providerUsage.some((entry) => entry.operation === 'job-notification'
    && entry.status === 'failed' && /timed out/i.test(entry.error)),
  JSON.stringify({ runs: state.runs.slice(0, 2), jobs: state.jobs.map(({ company, title, verifiedOpen }) => ({ company, title, verifiedOpen })), usage: state.providerUsage.slice(0, 5) }))

  await fetch(`${baseUrl}/api/jobs/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: 'groq',
      telegramChatId: '123',
      companies: [{ name: 'TelegramTimeoutCo', officialDomains: ['careers.example.com'] }],
    }),
  })
  await fetch(`${baseUrl}/api/jobs/run`, { method: 'POST' })
  state = await fetch(`${baseUrl}/api/jobs/state`).then((response) => response.json())
  assert.equal(state.providerUsage.filter((entry) => entry.operation === 'job-notification'
    && entry.error.includes('timed out')).length, 1)
  await fetch(`${baseUrl}/api/secrets`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'TELEGRAM_BOT_TOKEN', value: '' }),
  })
})

test('restarting the Node service recovers interrupted scheduled work from SQLite', async () => {
  const database = await JobDatabase.open(path.join(secretDirectory, 'AgentFlow', 'jobs.sqlite'))
  const interruptedRunId = database.createRun('simulated-service-interruption')
  database.db.prepare('UPDATE scheduler_state SET next_run_at=? WHERE id=1')
    .run(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString())
  database.close()

  const stopped = new Promise((resolve) => server.once('exit', resolve))
  server.kill('SIGTERM')
  await stopped

  const restarted = startTestBackend()
  server = restarted.child
  baseUrl = await restarted.started
  let state
  for (let attempt = 0; attempt < 100; attempt++) {
    state = await fetch(`${baseUrl}/api/jobs/state`).then((response) => response.json())
    if (state.runs.some((run) => run.trigger === 'schedule-recovery' && run.status !== 'missed' && run.status !== 'running')) break
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  const interrupted = state.runs.find((run) => run.id === interruptedRunId)
  assert.equal(interrupted.status, 'failed')
  assert.ok(state.runs.some((run) => run.status === 'missed' && run.trigger === 'schedule-recovery'))
  assert.ok(state.runs.some((run) => run.status === 'completed' && run.trigger === 'schedule-recovery'))
})

test('agent start gives an actionable response when no Telegram token is configured', async () => {
  const response = await fetch(`${baseUrl}/api/agent/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.equal(response.status, 400)
  assert.match((await response.json()).error, /Save a Telegram bot token/)
})

test('Telegram polling splits long AI responses into valid message chunks', async () => {
  const saveToken = await fetch(`${baseUrl}/api/secrets`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'TELEGRAM_BOT_TOKEN', value: 'test-telegram-token' }),
  })
  assert.equal(saveToken.status, 200)

  const start = await fetch(`${baseUrl}/api/agent/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'groq', access: 'public' }),
  })
  assert.equal(start.status, 200, JSON.stringify(await start.json()))

  try {
    let answered = false
    let lastEvents = []
    for (let attempt = 0; attempt < 100; attempt++) {
      const status = await fetch(`${baseUrl}/api/agent/status`).then((response) => response.json())
      lastEvents = status.events
      if (status.events.some((event) => event.text.includes('groq answered user 123'))) {
        answered = true
        break
      }
      if (status.events.some((event) => event.text.includes('Could not process Telegram update'))) {
        assert.fail(status.events.find((event) => event.text.includes('Could not process Telegram update')).text)
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(answered, true, `Telegram update was not answered with split messages. ${JSON.stringify(lastEvents)}`)
  } finally {
    await fetch(`${baseUrl}/api/agent/stop`, { method: 'POST' })
  }
})

test('Telegram listener resumes after service restarts until manually stopped', async () => {
  const originalStop = new Promise((resolve) => server.once('exit', resolve))
  server.kill('SIGTERM')
  await originalStop

  const agentDataDirectory = path.join(tempRoot, 'auto-start-agent-data')
  const firstInstance = startTestBackend({
    AGENTFLOW_DATA_DIR: agentDataDirectory,
    TELEGRAM_BOT_TOKEN: 'test-telegram-token',
  })
  server = firstInstance.child
  baseUrl = await firstInstance.started
  let status
  for (let attempt = 0; attempt < 100; attempt++) {
    status = await fetch(`${baseUrl}/api/agent/status`).then((response) => response.json())
    if (status.running) break
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.equal(status.running, true)
  assert.equal(status.autoStart, true)
  assert.equal(status.access, 'public')

  const updateSettings = await fetch(`${baseUrl}/api/agent/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ access: 'whitelist', whitelist: [] }),
  })
  assert.equal(updateSettings.status, 200)
  const savedAgentPreferences = await JobDatabase.open(path.join(agentDataDirectory, 'jobs.sqlite'))
  assert.deepEqual(JSON.parse(savedAgentPreferences.db.prepare('SELECT settings_json FROM agent_preferences WHERE id=1').get().settings_json).whitelist, ['1207882899'])
  savedAgentPreferences.close()

  const firstStop = new Promise((resolve) => server.once('exit', resolve))
  server.kill('SIGTERM')
  await firstStop
  const legacyPreferences = await JobDatabase.open(path.join(agentDataDirectory, 'jobs.sqlite'))
  legacyPreferences.db.prepare("UPDATE agent_preferences SET settings_json = ?, access_configured = 0 WHERE id = 1")
    .run(JSON.stringify({ access: 'whitelist', whitelist: [] }))
  legacyPreferences.close()

  const restarted = startTestBackend({
    AGENTFLOW_DATA_DIR: agentDataDirectory,
    TELEGRAM_BOT_TOKEN: 'test-telegram-token',
  })
  server = restarted.child
  baseUrl = await restarted.started
  for (let attempt = 0; attempt < 100; attempt++) {
    status = await fetch(`${baseUrl}/api/agent/status`).then((response) => response.json())
    if (status.running) break
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.equal(status.running, true)
  assert.equal(status.autoStart, true)
  assert.equal(status.access, 'public')
  const restartedPreferences = await JobDatabase.open(path.join(agentDataDirectory, 'jobs.sqlite'))
  assert.deepEqual(JSON.parse(restartedPreferences.db.prepare('SELECT settings_json FROM agent_preferences WHERE id=1').get().settings_json).whitelist, ['1207882899'])
  restartedPreferences.close()

  const stop = await fetch(`${baseUrl}/api/agent/stop`, { method: 'POST' })
  assert.equal(stop.status, 200)
  status = await fetch(`${baseUrl}/api/agent/status`).then((response) => response.json())
  assert.equal(status.running, false)
  assert.equal(status.autoStart, false)

  const secondStop = new Promise((resolve) => server.once('exit', resolve))
  server.kill('SIGTERM')
  await secondStop

  const stoppedBackend = startTestBackend({
    AGENTFLOW_DATA_DIR: agentDataDirectory,
    TELEGRAM_BOT_TOKEN: 'test-telegram-token',
  })
  server = stoppedBackend.child
  baseUrl = await stoppedBackend.started
  status = await fetch(`${baseUrl}/api/agent/status`).then((response) => response.json())
  assert.equal(status.running, false)
  assert.equal(status.autoStart, false)
})

test('production requires dashboard authentication and serves the built dashboard', async () => {
  const stopped = new Promise((resolve) => server.once('exit', resolve))
  server.kill('SIGTERM')
  await stopped

  const production = startTestBackend({
    NODE_ENV: 'production',
    AGENTFLOW_HOST: '127.0.0.1',
    AGENTFLOW_USERNAME: 'deploy-admin',
    AGENTFLOW_PASSWORD: 'a-long-test-password-123',
    AGENTFLOW_DATA_DIR: path.join(tempRoot, 'production-data'),
    OPENROUTER_API_KEY: 'test-openrouter-key',
    TAVILY_SEARCH_KEY: 'test-tavily-key',
  })
  server = production.child
  try {
    const productionUrl = await production.started
    const unauthenticated = await fetch(productionUrl)
    assert.equal(unauthenticated.status, 401)
    assert.match(unauthenticated.headers.get('www-authenticate'), /^Basic realm=/)

    const health = await fetch(`${productionUrl}/api/health`)
    assert.equal(health.status, 200)
    assert.deepEqual(Object.keys(await health.json()).sort(), ['ok', 'service'])

    const invalidHealthMethod = await fetch(`${productionUrl}/api/health`, { method: 'POST' })
    assert.equal(invalidHealthMethod.status, 405)
    assert.equal(invalidHealthMethod.headers.get('allow'), 'GET')

    const authorization = `Basic ${Buffer.from('deploy-admin:a-long-test-password-123').toString('base64')}`
    const dashboard = await fetch(productionUrl, { headers: { authorization } })
    assert.equal(dashboard.status, 200)
    assert.match(await dashboard.text(), /AgentFlow AI/)

    const deniedApi = await fetch(`${productionUrl}/api/jobs/state`)
    assert.equal(deniedApi.status, 401)
    const authorizedApi = await fetch(`${productionUrl}/api/jobs/state`, { headers: { authorization } })
    assert.equal(authorizedApi.status, 200)

    const deniedCron = await fetch(`${productionUrl}/api/cron/jobs`, { method: 'POST' })
    assert.equal(deniedCron.status, 401)
    assert.doesNotMatch(await deniedCron.text(), /test-tavily-key|a-long-test-password-123/)

    const invalidAuthorization = `Basic ${Buffer.from('deploy-admin:wrong-password').toString('base64')}`
    const invalidCron = await fetch(`${productionUrl}/api/cron/jobs`, {
      method: 'POST',
      headers: { authorization: invalidAuthorization },
    })
    assert.equal(invalidCron.status, 401)

    const wrongMethod = await fetch(`${productionUrl}/api/cron/jobs`, { headers: { authorization } })
    assert.equal(wrongMethod.status, 405)
    assert.equal(wrongMethod.headers.get('allow'), 'POST')

    const settings = await fetch(`${productionUrl}/api/jobs/settings`, {
      method: 'PUT',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'openrouter',
        targetGraduationYear: 2027,
        companies: [{ name: 'LlmFailCo', officialDomains: ['careers.example.com'] }],
      }),
    })
    assert.equal(settings.status, 200)

    const failedCronResponse = await fetch(`${productionUrl}/api/cron/jobs`, {
      method: 'POST',
      headers: { authorization },
    })
    const failedCronResult = await failedCronResponse.json()
    assert.equal(failedCronResponse.status, 502)
    assert.match(failedCronResult.error, /Temporary LLM failure/)
    assert.doesNotMatch(failedCronResult.error, /test-openrouter-key|test-tavily-key|a-long-test-password-123/)

    const retrySettings = await fetch(`${productionUrl}/api/jobs/settings`, {
      method: 'PUT',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'openrouter',
        targetGraduationYear: 2027,
        companies: [{ name: 'Example Systems', officialDomains: ['careers.example.com'] }],
      }),
    })
    assert.equal(retrySettings.status, 200)

    const simultaneousCronResponses = await Promise.all([0, 1].map(() => fetch(`${productionUrl}/api/cron/jobs`, {
      method: 'POST',
      headers: { authorization },
    })))
    const simultaneousResults = await Promise.all(simultaneousCronResponses.map((response) => response.json()))
    assert.deepEqual(simultaneousCronResponses.map((response) => response.status).sort(), [200, 409])
    const cronResult = simultaneousResults[simultaneousCronResponses.findIndex((response) => response.status === 200)]
    assert.equal(cronResult.status, 'completed')
    assert.equal(cronResult.replayed, false)

    const replayResponse = await fetch(`${productionUrl}/api/cron/jobs`, {
      method: 'POST',
      headers: { authorization },
    })
    const replayResult = await replayResponse.json()
    assert.equal(replayResponse.status, 200)
    assert.equal(replayResult.replayed, true)
    assert.equal(replayResult.runId, cronResult.runId)
    const state = await fetch(`${productionUrl}/api/jobs/state`, { headers: { authorization } }).then((response) => response.json())
    const cronRuns = state.runs.filter((run) => run.trigger === 'external-cron')
    assert.equal(cronRuns.length, 2)
    assert.ok(cronRuns.some((run) => run.status === 'failed'))
    assert.ok(cronRuns.some((run) => run.status === 'completed'))
    assert.doesNotMatch(JSON.stringify(cronRuns), /test-openrouter-key|test-tavily-key|a-long-test-password-123/)

    const productionStopped = new Promise((resolve) => server.once('exit', resolve))
    server.kill('SIGTERM')
    await productionStopped
    const restarted = startTestBackend({
      NODE_ENV: 'production',
      AGENTFLOW_HOST: '127.0.0.1',
      AGENTFLOW_USERNAME: 'deploy-admin',
      AGENTFLOW_PASSWORD: 'a-long-test-password-123',
      AGENTFLOW_DATA_DIR: path.join(tempRoot, 'production-data'),
      OPENROUTER_API_KEY: 'test-openrouter-key',
      TAVILY_SEARCH_KEY: 'test-tavily-key',
    })
    server = restarted.child
    const restartedUrl = await restarted.started
    const restartReplay = await fetch(`${restartedUrl}/api/cron/jobs`, {
      method: 'POST',
      headers: { authorization },
    }).then((response) => response.json())
    assert.equal(restartReplay.replayed, true)
    assert.equal(restartReplay.runId, cronResult.runId)
  } finally {
    if (server.exitCode === null) {
      const productionStopped = new Promise((resolve) => server.once('exit', resolve))
      server.kill('SIGTERM')
      await productionStopped
    }
    server = undefined
  }
})
