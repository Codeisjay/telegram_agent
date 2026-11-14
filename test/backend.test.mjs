import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_COMPANION_CHAT_ID,
  DEFAULT_COMPANION_SETTINGS,
  getDueEventReminders,
  getDueGreeting,
  getLocalDateParts,
  nextOccurrenceDate,
  normalizeCompanionSettings,
  parseNaturalLanguageEvent,
  zonedDateTimeToDate,
} from '../companion-intelligence.mjs'
import { JobDatabase } from '../job-intelligence.mjs'

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const tempRoot = await mkdtemp(path.join(tmpdir(), 'agentflow-backend-test-'))
const secretDirectory = path.join(tempRoot, 'local-app-data')
const secretKeys = ['GEMINI_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'TAVILY_SEARCH_KEY', 'TELEGRAM_BOT_TOKEN', 'GITHUB_TOKEN', 'YOUTUBE_API_KEY']
let server
let baseUrl
function makeTestEnvironment(overrides = {}) {
  const environment = { ...process.env, LOCALAPPDATA: secretDirectory, AGENTFLOW_PORT: '0' }
  environment.AGENTFLOW_ENV_FILE = path.join(tempRoot, 'empty-project.env')
  for (const key of [...secretKeys, 'PSIT_ERP_CREDENTIAL_ENCRYPTION_KEY', 'PSIT_ERP_BASE_URL', 'PSIT_ERP_USER_ID', 'PSIT_ERP_PASSWORD', 'PSIT_ERP_SYNC_INTERVAL_MINUTES', 'AGENTFLOW_PSIT_ERP_CRON_SECRET', 'AGENTFLOW_NEWS_CRON_SECRET', 'AGENTFLOW_COMPANION_CRON_SECRET', 'CALENDARIFIC_API_KEY', 'DATABASE_URL', 'MOCK_TELEGRAM_UPDATE_TEXT', 'NODE_ENV', 'AGENTFLOW_HOST', 'AGENTFLOW_USERNAME', 'AGENTFLOW_PASSWORD', 'AGENTFLOW_DATA_DIR', 'AGENTFLOW_SECRET_FILE', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'YOUTUBE_OAUTH_TOKEN_ENCRYPTION_KEY', 'YOUTUBE_OAUTH_REDIRECT_URI', 'RENDER_EXTERNAL_HOSTNAME']) delete environment[key]
  environment.GROQ_API_KEY = 'environment-stale-test-key'
  environment.PSIT_ERP_CREDENTIAL_ENCRYPTION_KEY = '2a'.repeat(32)
  environment.AGENTFLOW_COMPANION_CRON_SECRET = 'test-companion-cron-secret'
  environment.GOOGLE_CLIENT_ID = 'test-youtube-client.apps.googleusercontent.com'
  environment.GOOGLE_CLIENT_SECRET = 'test-youtube-client-secret'
  environment.YOUTUBE_OAUTH_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64)
  environment.GOOGLE_REDIRECT_URI = 'http://localhost:3001/api/digital-footprint/youtube/oauth/callback'
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

test('companion greeting schedule and natural language parsing work as expected', () => {
  assert.equal(DEFAULT_COMPANION_CHAT_ID, '1207882899')
  assert.equal(DEFAULT_COMPANION_SETTINGS.notificationChatId, '1207882899')
  assert.equal(normalizeCompanionSettings({ notificationChatId: '' }, {
    ...DEFAULT_COMPANION_SETTINGS,
    notificationChatId: '',
  }).notificationChatId, '1207882899')

  const settings = normalizeCompanionSettings({
    personalName: 'Jay',
    greetingTimes: { morning: '08:00', afternoon: '13:00', evening: '18:00', night: '22:00' },
    greetings: { morning: true, afternoon: true, evening: true, night: true },
    quietStart: '22:30',
    quietEnd: '07:00',
  })
  const greeting = getDueGreeting(settings, new Date('2026-11-12T08:00:00+05:30'))
  assert.ok(greeting)
  assert.equal(greeting.kind, 'morning')
  assert.equal(greeting.message.includes('Jay'), true)
  const later = getDueGreeting(settings, new Date('2026-11-12T23:00:00+05:30'))
  assert.equal(later, null)
  const event = parseNaturalLanguageEvent("My friend's birthday is on 12 March. Wish them every year.", new Date('2026-01-01T00:00:00Z'))
  assert.equal(event.category, 'Birthday')
  assert.equal(event.recurrence, 'Yearly')
  assert.equal(event.title, "friend's birthday")
  assert.equal(event.eventDate, '2026-03-12')
  const interview = parseNaturalLanguageEvent('Remind me about my interview on 12 March at 10 am, one day before', new Date('2026-01-01T00:00:00Z'))
  assert.equal(interview.title, 'interview')
  assert.equal(interview.eventTime, '10:00')
  assert.deepEqual(interview.reminderMinutes, [1440, 0])
  assert.equal(parseNaturalLanguageEvent('Remind me about my exam', new Date('2026-01-01T00:00:00Z')), null)
  assert.equal(zonedDateTimeToDate('2026-11-12', '08:00').toISOString(), '2026-11-12T02:30:00.000Z')
  assert.equal(nextOccurrenceDate('2024-02-29', 'Yearly'), '2025-02-28')
  const due = getDueEventReminders({
    id: 1, title: 'Interview', eventDate: '2026-03-12', nextOccurrence: '2026-03-12',
    eventTime: '10:00', timezone: 'Asia/Kolkata', reminderMinutes: [1440, 0],
  }, new Date('2026-03-11T04:30:00Z'))
  assert.deepEqual(due.map((reminder) => reminder.reminderMinutes), [1440])
})

test('companion scheduler records interrupted runs after restart', async () => {
  const database = await JobDatabase.open(path.join(tempRoot, 'companion-run-recovery.sqlite'))
  const runId = database.startCompanionRun('events', 'test')
  const recovered = database.recoverInterruptedCompanionRuns(new Date('2026-03-12T00:00:00Z'))
  const run = database.listCompanionRuns().find((item) => item.id === runId)
  database.close()
  assert.equal(recovered, 1)
  assert.equal(run.status, 'interrupted')
  assert.equal(run.completedAt, '2026-03-12T00:00:00.000Z')
})

test('companion settings default to the configured Telegram recipient for fresh and legacy records', async () => {
  const database = await JobDatabase.open(path.join(tempRoot, 'companion-default-chat.sqlite'))
  assert.equal(database.getCompanionSettings().notificationChatId, '1207882899')
  database.db.prepare("UPDATE companion_settings SET settings_json = '{\"notificationChatId\":\"\"}' WHERE id = 1").run()
  assert.equal(database.getCompanionSettings().notificationChatId, '1207882899')
  database.close()
})

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

test('PSIT ERP status exposes no credentials and AI requests reject credential-like text', async () => {
  const response = await fetch(`${baseUrl}/api/psit-erp`)
  assert.equal(response.status, 200)
  const state = await response.json()
  assert.equal(state.connected, false)
  assert.equal(state.encryptionConfigured, true)
  assert.equal(state.dataRetrievalAvailable, false)
  assert.equal(state.automaticSyncEnabled, false)
  assert.equal(state.retrievedRecordCount, 0)
  assert.equal(state.lastSyncError, '')
  assert.equal(JSON.stringify(state).includes('credential_ciphertext'), false)
  assert.equal(JSON.stringify(state).includes('PSIT_ERP_CREDENTIAL_ENCRYPTION_KEY'), false)

  const invalidConnect = await fetch(`${baseUrl}/api/psit-erp/connect`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: '', password: '' }),
  })
  assert.equal(invalidConnect.status, 400)
  const missingConnectionSync = await fetch(`${baseUrl}/api/psit-erp/sync`, { method: 'POST' })
  assert.equal(missingConnectionSync.status, 409)
  const crossOrigin = await fetch(`${baseUrl}/api/psit-erp/connect`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://untrusted.example' },
    body: JSON.stringify({ userId: 'student', password: 'not-a-real-password' }),
  })
  assert.equal(crossOrigin.status, 403)

  const credentialQuery = 'my ERP password is do-not-forward-this'
  const blockedQuery = await fetch(`${baseUrl}/api/agent/test`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: credentialQuery, settings: { provider: 'openrouter' } }),
  })
  assert.equal(blockedQuery.status, 400)
  const blockedBody = await blockedQuery.text()
  assert.equal(blockedBody.includes('do-not-forward-this'), false)
})

test('news settings API persists user-selected notification topics', async () => {
  const response = await fetch(`${baseUrl}/api/news`)
  assert.equal(response.status, 200)
  const { settings } = await response.json()
  const update = await fetch(`${baseUrl}/api/news/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...settings,
      categories: ['crime', 'politics'],
      telegramChatId: '1207882899',
      intervalHours: 2,
      maxArticlesPerNotification: 6,
      maxNotificationsPerDay: 3,
      inputTokenBudget: 4500,
      outputTokenBudget: 900,
    }),
  })

  assert.equal(update.status, 200)
  const saved = (await update.json()).settings
  assert.deepEqual(saved.categories, ['crime', 'politics'])
  assert.equal(saved.telegramChatId, '1207882899')
  assert.equal(saved.intervalHours, 2)
  assert.equal(saved.maxArticlesPerNotification, 6)
  assert.equal(saved.maxNotificationsPerDay, 3)
  assert.equal(saved.inputTokenBudget, 4500)
  assert.equal(saved.outputTokenBudget, 900)
  const persisted = await fetch(`${baseUrl}/api/news`).then((result) => result.json())
  assert.deepEqual(persisted.settings.categories, ['crime', 'politics'])
  assert.equal(persisted.settings.telegramChatId, '1207882899')
  const interests = await fetch(`${baseUrl}/api/news/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      interests: [
        { topic: 'Generative AI', enabled: true, priority: 'high' },
        { topic: 'Browser Engineering', enabled: false, priority: 'low' },
      ],
    }),
  }).then((result) => result.json())
  assert.equal(interests.settings.interests[0].priority, 'high')
  assert.deepEqual(interests.settings.categories, ['Generative AI'])
})

test('digital footprint API persists isolated settings, polls official endpoints, and excludes credentials', async () => {
  const initialResponse = await fetch(`${baseUrl}/api/digital-footprint`)
  assert.equal(initialResponse.status, 200)
  const initial = await initialResponse.json()
  assert.equal(initial.settings.enabled, false)
  assert.equal(initial.sources.youtubeApiKeyConfigured, false)
  assert.equal(JSON.stringify(initial).includes('environment-stale-test-key'), false)

  const invalid = await fetch(`${baseUrl}/api/digital-footprint/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: true, githubUsername: 'invalid username' }),
  })
  assert.equal(invalid.status, 400)

  const update = await fetch(`${baseUrl}/api/digital-footprint/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: true, githubUsername: 'octocat', youtubeChannelId: '' }),
  })
  assert.equal(update.status, 200)
  assert.equal((await update.json()).settings.enabled, true)

  const run = await fetch(`${baseUrl}/api/digital-footprint/run`, { method: 'POST' })
  assert.equal(run.status, 200)
  const result = await run.json()
  assert.equal(result.status, 'completed')
  assert.equal(result.githubCount, 1)
  assert.equal(result.state.activities[0].source, 'github')

  const stopped = await fetch(`${baseUrl}/api/digital-footprint/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: false }),
  })
  assert.equal(stopped.status, 200)
  assert.equal((await stopped.json()).settings.enabled, false)

  const connectResponse = await fetch(`${baseUrl}/api/digital-footprint/youtube/oauth/connect`, { method: 'POST' })
  assert.equal(connectResponse.status, 200)
  const { authorizationUrl } = await connectResponse.json()
  const authorization = new URL(authorizationUrl)
  assert.equal(authorization.origin, 'https://accounts.google.com')
  assert.equal(authorization.searchParams.get('redirect_uri'), 'http://localhost:3001/api/digital-footprint/youtube/oauth/callback')
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256')
  assert.deepEqual(
    authorization.searchParams.get('scope').split(' '),
    [
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/yt-analytics.readonly',
    ],
  )

  const callback = await fetch(
    `${baseUrl}/api/digital-footprint/youtube/oauth/callback?state=${encodeURIComponent(authorization.searchParams.get('state'))}&code=mock-authorization-code`,
    { redirect: 'manual' },
  )
  assert.equal(callback.status, 302)
  assert.equal(callback.headers.get('location'), 'http://localhost:5173/?digitalFootprintOAuth=connected#digital-footprint')

  const analyticsResponse = await fetch(`${baseUrl}/api/digital-footprint/youtube/analytics/refresh`, { method: 'POST' })
  const analyticsPayload = await analyticsResponse.json()
  assert.equal(analyticsResponse.status, 200, JSON.stringify(analyticsPayload))
  assert.equal(analyticsPayload.youtubeSync.status, 'completed')
  const analytics = analyticsPayload.youtubeAnalytics
  assert.equal(analytics.views, 321)
  assert.equal(analytics.watchMinutes, 654.5)
  assert.equal(analytics.subscribersGained, 12)
  assert.deepEqual(analytics.audience.map((item) => item.gender), ['FEMALE', 'MALE'])
  const channelAnalytics = analyticsPayload.state.youtubeIntelligence
  assert.equal(channelAnalytics.channel.channelId, 'UC1234567890123456789012')
  assert.equal(channelAnalytics.channel.title, 'Caash Aminati')
  assert.equal(channelAnalytics.channel.views, 12345)
  assert.equal(channelAnalytics.channel.subscribers, 789)
  assert.equal(channelAnalytics.videoCount, 2)
  assert.deepEqual(channelAnalytics.videos.map((video) => video.videoId).sort(), ['mock-video-1', 'mock-video-2'])
  assert.deepEqual(channelAnalytics.videos.map((video) => video.analytics.views), [321, 321])
  assert.deepEqual(channelAnalytics.videos.map((video) => video.analytics.subscribersGained), [12, 12])
  assert.equal(channelAnalytics.reports.demographics.rows.length, 2)
  assert.equal(channelAnalytics.availability.thumbnailImpressions.startsWith('unavailable'), true)

  const oauthState = await fetch(`${baseUrl}/api/digital-footprint`).then((response) => response.json())
  assert.equal(oauthState.youtubeOAuth.connected, true)
  assert.equal(oauthState.youtubeOAuth.channel.channelId, 'UC1234567890123456789012')
  assert.equal(JSON.stringify(oauthState).includes('oauth-access'), false)
  assert.equal(JSON.stringify(oauthState).includes('oauth-refresh'), false)
  assert.equal(JSON.stringify(oauthState).includes('test-youtube-client-secret'), false)

  const telegramCredential = await fetch(`${baseUrl}/api/secrets`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'TELEGRAM_BOT_TOKEN', value: 'youtube-test-telegram-token' }),
  })
  assert.equal(telegramCredential.status, 200)
  const youtubeMonitoring = await fetch(`${baseUrl}/api/digital-footprint/youtube/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: true, alertsEnabled: true, dailyReportEnabled: true, weeklyReportEnabled: true }),
  })
  assert.equal(youtubeMonitoring.status, 200)
  const analyticsRun = await fetch(`${baseUrl}/api/digital-footprint/run`, { method: 'POST' })
  assert.equal(analyticsRun.status, 200)
  const runState = await analyticsRun.json()
  assert.equal(runState.status, 'completed')
  assert.equal(runState.githubCount, 0)
  assert.equal(runState.state.settings.enabled, false)
  assert.equal(runState.state.youtubeIntelligence.monitoring.enabled, true)
  assert.equal(runState.state.youtubeAnalytics.subscribersGained, 12)
  assert.equal(runState.state.youtubeIntelligence.notifications.some((item) => item.type === 'subscriber-growth' && item.status === 'delivered'), true)
  const secondAnalyticsRun = await fetch(`${baseUrl}/api/digital-footprint/run`, { method: 'POST' }).then((response) => response.json())
  assert.equal(secondAnalyticsRun.state.youtubeIntelligence.notifications.filter((item) => item.type === 'subscriber-growth' && item.status === 'delivered').length, 1)
  await fetch(`${baseUrl}/api/digital-footprint/youtube/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: false }),
  })
  await fetch(`${baseUrl}/api/secrets`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'TELEGRAM_BOT_TOKEN', value: '' }),
  })
})

test('Personal Assistant API saves, edits, and deletes events', async () => {
  const companion = await fetch(`${baseUrl}/api/companion`).then((response) => response.json())
  assert.equal(companion.settings.notificationChatId, '1207882899')
  const date = getLocalDateParts(new Date(), 'Asia/Kolkata')
  const eventDate = `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`
  const createdResponse = await fetch(`${baseUrl}/api/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'Calendar API interview',
      category: 'Interview',
      eventDate,
      eventTime: '10:30',
      recurrence: 'Yearly',
      reminderMinutes: [10080, 1440, 0],
      importance: 'High',
    }),
  })
  assert.equal(createdResponse.status, 200)
  const created = (await createdResponse.json()).event
  assert.deepEqual(created.reminderMinutes, [10080, 1440, 0])
  assert.equal(created.recurrence, 'Yearly')
  const updateResponse = await fetch(`${baseUrl}/api/events/${created.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Updated interview', eventTime: '11:00' }),
  })
  assert.equal(updateResponse.status, 200)
  assert.equal((await updateResponse.json()).event.title, 'Updated interview')
  assert.equal((await fetch(`${baseUrl}/api/events/${created.id}`, { method: 'DELETE' })).status, 200)
  const invalidDate = await fetch(`${baseUrl}/api/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Invalid', eventDate: '2026-02-31' }),
  })
  assert.equal(invalidDate.status, 400)
})

test('authenticated companion cron delivers deduplicated greetings, festivals, and event reminders', async () => {
  const stop = await fetch(`${baseUrl}/api/agent/stop`, { method: 'POST' })
  assert.equal(stop.status, 200)
  const token = await fetch(`${baseUrl}/api/secrets`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'TELEGRAM_BOT_TOKEN', value: 'test-telegram-token' }),
  })
  assert.equal(token.status, 200)
  const secretPath = path.join(secretDirectory, 'AgentFlow', '.env')
  await mkdir(path.dirname(secretPath), { recursive: true })
  await writeFile(secretPath, 'TELEGRAM_BOT_TOKEN="test-telegram-token"\nCALENDARIFIC_API_KEY="test-calendar-key"\n')

  const now = new Date()
  const local = getLocalDateParts(now, 'Asia/Kolkata')
  const date = `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`
  const minute = local.hour * 60 + local.minute
  const greetingMinute = Math.max(0, minute - 1)
  const greetingTime = `${String(Math.floor(greetingMinute / 60)).padStart(2, '0')}:${String(greetingMinute % 60).padStart(2, '0')}`
  const settings = await fetch(`${baseUrl}/api/companion`).then((response) => response.json())
  const saveSettings = await fetch(`${baseUrl}/api/companion/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...settings.settings,
      personalName: 'Jay',
      timezone: 'Asia/Kolkata',
      notificationChatId: '123',
      greetings: { morning: true, afternoon: false, evening: false, night: false },
      greetingTimes: { ...settings.settings.greetingTimes, morning: greetingTime },
      quietStart: '23:59',
      quietEnd: '00:00',
      festivalRegion: 'Uttar Pradesh',
      festivalEnabled: true,
      paused: false,
    }),
  })
  assert.equal(saveSettings.status, 200)

  const eventResponse = await fetch(`${baseUrl}/api/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'Automatic test reminder',
      category: 'Personal milestone',
      eventDate: date,
      eventTime: '00:00',
      timezone: 'Asia/Kolkata',
      reminderMinutes: [0],
    }),
  })
  assert.equal(eventResponse.status, 200)

  const headers = { authorization: 'Bearer test-companion-cron-secret' }
  const firstResponse = await fetch(`${baseUrl}/api/cron/companion`, { method: 'POST', headers })
  assert.equal(firstResponse.status, 200)
  const first = await firstResponse.json()
  assert.equal(first.status, 'completed')
  const history = await fetch(`${baseUrl}/api/companion`).then((response) => response.json())
  assert.equal(history.notifications.some((item) => item.type === 'greeting' && item.status === 'delivered'), true)
  assert.equal(history.notifications.some((item) => item.type === 'festival' && item.title === 'Verified Test Festival' && item.status === 'delivered'), true)
  assert.equal(history.notifications.some((item) => item.type === 'event' && item.title === 'Automatic test reminder' && item.status === 'delivered'), true)
  assert.equal(history.calendarConfigured, true)
  const secondResponse = await fetch(`${baseUrl}/api/cron/companion`, { method: 'POST', headers })
  assert.equal(secondResponse.status, 200)
  const secondRun = await secondResponse.json()
  assert.equal(secondRun.schedulers.find((item) => item.schedulerName === 'events').status, 'interval-not-due')
  const afterRetry = await fetch(`${baseUrl}/api/companion`).then((response) => response.json())
  assert.equal(afterRetry.notifications.filter((item) => item.idempotencyKey.startsWith('greeting:') && item.status === 'delivered').length, 1)
  assert.equal(afterRetry.notifications.filter((item) => item.idempotencyKey.startsWith('festival:') && item.status === 'delivered').length, 1)

  await fetch(`${baseUrl}/api/agent/stop`, { method: 'POST' })
  await fetch(`${baseUrl}/api/secrets`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'TELEGRAM_BOT_TOKEN', value: '' }),
  })
  await fetch(`${baseUrl}/api/companion/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...afterRetry.settings, notificationChatId: '', paused: true }),
  })
})

test('Telegram saves a personal event from natural language without a command', async () => {
  const previousServer = server
  const previousUrl = baseUrl
  const backend = startTestBackend({
    AGENTFLOW_DATA_DIR: path.join(tempRoot, 'telegram-companion-data'),
    TELEGRAM_BOT_TOKEN: 'test-telegram-token',
    MOCK_TELEGRAM_UPDATE_TEXT: 'Remember my birthday on 12 March every year, one week before.',
  })
  server = backend.child
  try {
    baseUrl = await backend.started
    let companion
    for (let attempt = 0; attempt < 100; attempt += 1) {
      companion = await fetch(`${baseUrl}/api/companion`).then((response) => response.json())
      if (companion.events.length) break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(companion.events.length, 1)
    assert.equal(companion.events[0].category, 'Birthday')
    assert.equal(companion.events[0].recurrence, 'Yearly')
    assert.equal(companion.events[0].reminderMinutes.includes(10080), true)
    assert.equal(companion.settings.notificationChatId, '123')
  } finally {
    await fetch(`${baseUrl}/api/agent/stop`, { method: 'POST' }).catch(() => {})
    if (server && server.exitCode === null) {
      server.kill()
      await new Promise((resolve) => server.once('exit', resolve))
    }
    server = previousServer
    baseUrl = previousUrl
  }
})

test('Telegram natural-language updates and deletes uniquely matched events', async () => {
  const previousServer = server
  const previousUrl = baseUrl
  const dataDirectory = path.join(tempRoot, 'telegram-event-edit-data')
  const localDatabase = await JobDatabase.open(path.join(dataDirectory, 'jobs.sqlite'))
  const today = getLocalDateParts(new Date(), 'Asia/Kolkata')
  const date = `${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`
  localDatabase.createLifeEvent({ title: 'Interview', category: 'Interview', eventDate: date, reminderMinutes: [0] })
  localDatabase.close()

  const startConversation = (message) => startTestBackend({
    AGENTFLOW_DATA_DIR: dataDirectory,
    TELEGRAM_BOT_TOKEN: 'test-telegram-token',
    MOCK_TELEGRAM_UPDATE_TEXT: message,
  })
  try {
    let backend = startConversation('reschedule interview to tomorrow')
    server = backend.child
    baseUrl = await backend.started
    let companion
    for (let attempt = 0; attempt < 100; attempt += 1) {
      companion = await fetch(`${baseUrl}/api/companion`).then((response) => response.json())
      if (companion.events[0]?.eventDate !== date) break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    const tomorrow = new Date(Date.UTC(today.year, today.month - 1, today.day + 1)).toISOString().slice(0, 10)
    assert.equal(companion.events[0].eventDate, tomorrow)
    server.kill('SIGTERM')
    await new Promise((resolve) => server.once('exit', resolve))

    backend = startConversation('delete my interview')
    server = backend.child
    baseUrl = await backend.started
    for (let attempt = 0; attempt < 100; attempt += 1) {
      companion = await fetch(`${baseUrl}/api/companion`).then((response) => response.json())
      if (!companion.events.length) break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(companion.events.length, 0)
  } finally {
    if (server && server.exitCode === null) {
      server.kill('SIGTERM')
      await new Promise((resolve) => server.once('exit', resolve))
    }
    server = previousServer
    baseUrl = previousUrl
  }
})

test('companion notification claims retry failures and remain deduplicated after database restart', async () => {
  const dataDirectory = path.join(tempRoot, 'companion-retry-data')
  const file = path.join(dataDirectory, 'jobs.sqlite')
  let store = await JobDatabase.open(file)
  const startedAt = new Date('2026-03-01T10:00:00.000Z')
  store.enqueueCompanionNotification({
    idempotencyKey: 'event:42:2026-03-01:0',
    type: 'event',
    title: 'Retry test',
    message: 'Reminder',
    scheduledAt: startedAt,
    availableAt: startedAt,
  })
  assert.equal(store.claimCompanionNotification('event:42:2026-03-01:0', startedAt), true)
  store.finishCompanionNotification('event:42:2026-03-01:0', { delivered: false, error: 'temporary failure', now: startedAt })
  assert.equal(store.claimCompanionNotification('event:42:2026-03-01:0', new Date(startedAt.getTime() + 4 * 60000)), false)
  assert.equal(store.claimCompanionNotification('event:42:2026-03-01:0', new Date(startedAt.getTime() + 5 * 60000)), true)
  store.finishCompanionNotification('event:42:2026-03-01:0', { delivered: true, now: new Date(startedAt.getTime() + 5 * 60000) })
  store.close()

  store = await JobDatabase.open(file)
  assert.equal(store.claimCompanionNotification('event:42:2026-03-01:0', new Date(startedAt.getTime() + 10 * 60000)), false)
  assert.equal(store.listCompanionNotifications().find((item) => item.title === 'Retry test').status, 'delivered')
  store.close()
})

test('news cron is authenticated, deduplicates before Groq, and sends automatic briefings', async () => {
  const dataDirectory = path.join(tempRoot, 'news-automation-data')
  const backend = startTestBackend({
    AGENTFLOW_DATA_DIR: dataDirectory,
    AGENTFLOW_NEWS_CRON_SECRET: 'test-news-cron-secret',
    TAVILY_SEARCH_KEY: 'test-tavily-key',
    GROQ_API_KEY: 'test-groq-key',
    TELEGRAM_BOT_TOKEN: 'test-telegram-token',
  })
  try {
    const url = await backend.started
    const unauthorized = await fetch(`${url}/api/cron/news`, { method: 'POST' })
    assert.equal(unauthorized.status, 401)
    const update = await fetch(`${url}/api/news/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        intervalHours: 3,
        categories: ['Generative AI'],
        telegramChatId: '12345',
        quietStart: '00:00',
        quietEnd: '00:01',
        maxArticlesPerNotification: 3,
        maxNotificationsPerDay: 4,
      }),
    })
    assert.equal(update.status, 200)
    const database = await JobDatabase.open(path.join(dataDirectory, 'jobs.sqlite'))
    database.setNewsNextRun(new Date(Date.now() - 1000).toISOString())
    database.close()

    const headers = { authorization: 'Bearer test-news-cron-secret' }
    const first = await fetch(`${url}/api/cron/news`, { method: 'POST', headers })
    assert.equal(first.status, 200)
    const result = await first.json()
    assert.equal(result.delivered, 1)

    const resetSchedule = await JobDatabase.open(path.join(dataDirectory, 'jobs.sqlite'))
    resetSchedule.setNewsNextRun(new Date(Date.now() - 1000).toISOString())
    resetSchedule.close()
    const second = await fetch(`${url}/api/cron/news`, { method: 'POST', headers })
    assert.equal(second.status, 200)
    assert.equal((await second.json()).delivered, 0)
    const state = await fetch(`${url}/api/news`).then((response) => response.json())
    assert.equal(state.usage.filter((entry) => entry.provider === 'groq').reduce((sum, entry) => sum + entry.requests, 0), 1)
    assert.equal(state.notifications.length, 1)
    assert.equal(state.history[0].delivered_count, 0)
  } finally {
    if (backend.child.exitCode === null) {
      backend.child.kill()
      await new Promise((resolve) => backend.child.once('exit', resolve))
    }
  }
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

test('OpenRouter job extraction retries with the affordable completion-token limit', async () => {
  const baselineState = await fetch(`${baseUrl}/api/jobs/state`).then((item) => item.json())
  const baselineAnalyses = baselineState.providerUsage.filter((entry) => entry.provider === 'openrouter'
    && entry.operation === 'job-analysis')
  const baselineBudgetFailures = baselineAnalyses.filter((entry) => entry.status === '402').length
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

  const settings = await fetch(`${baseUrl}/api/jobs/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: 'openrouter',
      targetGraduationYear: 2027,
      companies: [{ name: 'CreditBudgetCo', officialDomains: ['careers.example.com'] }],
    }),
  })
  assert.equal(settings.status, 200)

  const response = await fetch(`${baseUrl}/api/jobs/run`, { method: 'POST' })
  const result = await response.json()
  assert.equal(response.status, 200, result.error)
  assert.equal(result.status, 'completed')

  const jobs = (await fetch(`${baseUrl}/api/jobs`).then((item) => item.json())).jobs
    .filter((job) => job.company === 'CreditBudgetCo')
  assert.equal(jobs.length, 1)

  const state = await fetch(`${baseUrl}/api/jobs/state`).then((item) => item.json())
  const analyses = state.providerUsage.filter((entry) => entry.provider === 'openrouter'
    && entry.operation === 'job-analysis')
  assert.equal(analyses.filter((entry) => entry.status === '402').length - baselineBudgetFailures, 1)
  assert.equal(analyses.filter((entry) => entry.status === '200').length - baselineSuccesses, 1)
})

test('Groq job extraction retries TPM rate limits after the provider wait time', async () => {
  const settings = await fetch(`${baseUrl}/api/jobs/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: 'groq',
      targetGraduationYear: 2027,
      companies: [{ name: 'GroqTPMRetryCo', officialDomains: ['careers.example.com'] }],
    }),
  })
  assert.equal(settings.status, 200)

  const response = await fetch(`${baseUrl}/api/jobs/run`, { method: 'POST' })
  const result = await response.json()
  assert.equal(response.status, 200, result.error)
  assert.equal(result.status, 'completed')

  const jobs = (await fetch(`${baseUrl}/api/jobs`).then((item) => item.json())).jobs
    .filter((job) => job.company === 'GroqTPMRetryCo')
  assert.equal(jobs.length, 1)

  const state = await fetch(`${baseUrl}/api/jobs/state`).then((item) => item.json())
  const analyses = state.providerUsage.filter((entry) => entry.provider === 'groq'
    && entry.operation === 'job-analysis')
  assert.ok(analyses.some((entry) => entry.status === '429'))
  assert.ok(analyses.some((entry) => entry.status === '200'))
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
    body: JSON.stringify({ provider: 'gemini', access: 'whitelist', whitelist: [] }),
  })
  assert.equal(updateSettings.status, 200)
  const jobSettings = await fetch(`${baseUrl}/api/jobs/state`).then((response) => response.json())
  assert.equal(jobSettings.settings.provider, 'gemini')
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
    AGENTFLOW_PSIT_ERP_CRON_SECRET: 'test-psit-erp-cron-secret',
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

    const deniedCompanionCron = await fetch(`${productionUrl}/api/cron/companion`, { method: 'POST' })
    assert.equal(deniedCompanionCron.status, 401)
    const authorizedCompanionCron = await fetch(`${productionUrl}/api/cron/companion`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-companion-cron-secret' },
    })
    assert.equal(authorizedCompanionCron.status, 200)
    assert.equal((await authorizedCompanionCron.json()).status, 'completed')

    const deniedPsitErpCron = await fetch(`${productionUrl}/api/cron/psit-erp`, { method: 'POST' })
    assert.equal(deniedPsitErpCron.status, 401)
    const authorizedPsitErpCron = await fetch(`${productionUrl}/api/cron/psit-erp`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-psit-erp-cron-secret' },
    })
    assert.equal(authorizedPsitErpCron.status, 200)
    assert.equal((await authorizedPsitErpCron.json()).status, 'waiting_for_credentials')

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
