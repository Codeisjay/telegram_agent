import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const POLL_INTERVAL_MINUTES = 60
const YOUTUBE_SYNC_INTERVAL_MINUTES = 360
export const YOUTUBE_ANALYTICS_SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
]
export const YOUTUBE_OAUTH_CALLBACK_PATH = '/api/digital-footprint/youtube/oauth/callback'

function serviceError(message, status = 502) {
  return Object.assign(new Error(message), { status })
}

function sanitizedError(error, credentials = {}) {
  let message = String(error?.message || 'Digital Footprint polling failed.')
  for (const value of Object.values(credentials)) {
    if (typeof value === 'string' && value) message = message.replaceAll(value, '[redacted]')
  }
  return message.slice(0, 500)
}

function normalizeActivity(source, item) {
  const externalId = String(item.externalId || '').trim().slice(0, 200)
  const title = String(item.title || '').trim().slice(0, 300)
  const url = String(item.url || '').trim().slice(0, 1000)
  if (!externalId || !title || !url) return null
  return {
    source,
    externalId,
    title,
    summary: String(item.summary || '').trim().slice(0, 1000),
    url,
    publishedAt: String(item.publishedAt || '').trim() || new Date().toISOString(),
  }
}

function isoDate(date) {
  return date.toISOString().slice(0, 10)
}

function subtractDays(date, days) {
  const result = new Date(date)
  result.setUTCDate(result.getUTCDate() - days)
  return result
}

function parseIsoDuration(value) {
  const match = String(value || '').match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/)
  if (!match) return null
  return (Number(match[1] || 0) * 3600) + (Number(match[2] || 0) * 60) + Number(match[3] || 0)
}

function reportRows(report) {
  const columns = (report.columnHeaders || []).map((column) => column.name)
  return (report.rows || []).map((row) => Object.fromEntries(
    columns.map((column, index) => [column, row[index] ?? null]),
  ))
}

function numericValue(value) {
  if (value === null || value === undefined || value === '') return null
  const result = Number(value)
  return Number.isFinite(result) ? result : null
}

async function fetchJson(fetchImpl, url, options, provider) {
  for (let attempt = 0; attempt < 4; attempt++) {
    let response
    try {
      response = await fetchImpl(url, {
        ...options,
        signal: AbortSignal.timeout(15000),
      })
    } catch (error) {
      if (attempt < 3 && error.name !== 'TimeoutError') {
        await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt)))
        continue
      }
      throw serviceError(`${provider} request failed: ${error.name === 'TimeoutError' ? 'request timed out.' : 'could not reach the official API.'}`)
    }
    if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 3) {
      const retryAfter = Number(response.headers.get('retry-after'))
      await new Promise((resolve) => setTimeout(resolve, Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 5000)
        : 250 * (2 ** attempt)))
      continue
    }
    let body
    try {
      body = await response.json()
    } catch {
      throw serviceError(`${provider} returned an invalid response (HTTP ${response.status}).`)
    }
    if (!response.ok) {
      const message = provider === 'YouTube'
        ? body.error?.message
        : body.message
      const reason = body.error?.errors?.[0]?.reason
      const quotaMessage = reason === 'quotaExceeded' || reason === 'dailyLimitExceeded'
        ? ' The YouTube API quota is exhausted; retry after its daily quota resets.'
        : ''
      throw serviceError(`${provider} API request failed (HTTP ${response.status})${message ? `: ${String(message).slice(0, 240)}` : '.'}${quotaMessage}`)
    }
    return body
  }
  throw serviceError(`${provider} request failed after retries.`)
}

export class DigitalFootprintIntelligence {
  constructor({
    database,
    fetchImpl = globalThis.fetch,
    getCredentials = () => ({}),
    getOAuthConfig = () => ({}),
    notify = async () => false,
    onError = () => {},
  }) {
    this.db = database.db
    this.fetchImpl = fetchImpl
    this.getCredentials = getCredentials
    this.getOAuthConfig = getOAuthConfig
    this.notify = notify
    this.onError = onError
    this.running = false
    this.timer = null
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS digital_footprint_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        enabled INTEGER NOT NULL DEFAULT 0,
        github_username TEXT NOT NULL DEFAULT '',
        youtube_channel_id TEXT NOT NULL DEFAULT '',
        next_run_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS digital_footprint_activity (
        id INTEGER PRIMARY KEY,
        source TEXT NOT NULL CHECK (source IN ('github', 'youtube')),
        external_id TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL,
        published_at TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        notified_at TEXT,
        UNIQUE (source, external_id)
      );
      CREATE INDEX IF NOT EXISTS digital_footprint_activity_published
        ON digital_footprint_activity(published_at DESC);
      CREATE TABLE IF NOT EXISTS digital_footprint_runs (
        id INTEGER PRIMARY KEY,
        trigger TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        github_count INTEGER NOT NULL DEFAULT 0,
        youtube_count INTEGER NOT NULL DEFAULT 0,
        notifications_sent INTEGER NOT NULL DEFAULT 0,
        error TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS digital_footprint_youtube_oauth (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        access_token_enc TEXT NOT NULL,
        refresh_token_enc TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        scopes_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS digital_footprint_youtube_oauth_states (
        state_hash TEXT PRIMARY KEY,
        verifier_enc TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS digital_footprint_youtube_analytics (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        report_json TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS digital_footprint_youtube_channel (
        channel_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        custom_url TEXT NOT NULL DEFAULT '',
        published_at TEXT NOT NULL DEFAULT '',
        uploads_playlist_id TEXT NOT NULL DEFAULT '',
        statistics_json TEXT NOT NULL DEFAULT '{}',
        last_synced_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS digital_footprint_youtube_channel_candidates (
        channel_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        custom_url TEXT NOT NULL DEFAULT '',
        thumbnails_json TEXT NOT NULL DEFAULT '{}',
        discovered_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS digital_footprint_youtube_channel_daily (
        channel_id TEXT NOT NULL,
        stat_date TEXT NOT NULL,
        metrics_json TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (channel_id, stat_date)
      );
      CREATE TABLE IF NOT EXISTS digital_footprint_youtube_videos (
        channel_id TEXT NOT NULL,
        video_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        published_at TEXT NOT NULL DEFAULT '',
        duration_seconds INTEGER,
        thumbnail_url TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL,
        public_statistics_json TEXT NOT NULL DEFAULT '{}',
        last_seen_at TEXT NOT NULL,
        PRIMARY KEY (channel_id, video_id)
      );
      CREATE INDEX IF NOT EXISTS digital_footprint_youtube_videos_published
        ON digital_footprint_youtube_videos(channel_id, published_at DESC);
      CREATE TABLE IF NOT EXISTS digital_footprint_youtube_video_daily (
        channel_id TEXT NOT NULL,
        video_id TEXT NOT NULL,
        stat_date TEXT NOT NULL,
        range_start TEXT NOT NULL,
        range_end TEXT NOT NULL,
        metrics_json TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (channel_id, video_id, stat_date)
      );
      CREATE TABLE IF NOT EXISTS digital_footprint_youtube_reports (
        channel_id TEXT NOT NULL DEFAULT '',
        report_name TEXT NOT NULL,
        range_start TEXT NOT NULL,
        range_end TEXT NOT NULL,
        status TEXT NOT NULL,
        report_json TEXT NOT NULL,
        error TEXT NOT NULL DEFAULT '',
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (channel_id, report_name, range_start, range_end)
      );
      CREATE TABLE IF NOT EXISTS digital_footprint_youtube_comments (
        channel_id TEXT NOT NULL,
        comment_id TEXT NOT NULL,
        video_id TEXT NOT NULL,
        text_display TEXT NOT NULL,
        published_at TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        PRIMARY KEY (channel_id, comment_id)
      );
      CREATE TABLE IF NOT EXISTS digital_footprint_youtube_notifications (
        notification_key TEXT PRIMARY KEY,
        notification_type TEXT NOT NULL,
        message TEXT NOT NULL,
        delivery_status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        delivered_at TEXT
      );
      CREATE TABLE IF NOT EXISTS digital_footprint_youtube_monitoring (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        enabled INTEGER NOT NULL DEFAULT 0,
        alerts_enabled INTEGER NOT NULL DEFAULT 1,
        daily_report_enabled INTEGER NOT NULL DEFAULT 1,
        weekly_report_enabled INTEGER NOT NULL DEFAULT 1,
        daily_report_hour INTEGER NOT NULL DEFAULT 9,
        weekly_report_hour INTEGER NOT NULL DEFAULT 9,
        weekly_report_day INTEGER NOT NULL DEFAULT 1,
        next_run_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );
      INSERT OR IGNORE INTO digital_footprint_youtube_monitoring(id, updated_at)
        VALUES (1, datetime('now'));
      INSERT OR IGNORE INTO digital_footprint_settings(id, updated_at) VALUES (1, datetime('now'));
    `)
    const monitoringColumns = new Set(this.db.prepare('PRAGMA table_info(digital_footprint_youtube_monitoring)').all().map((column) => column.name))
    for (const [name, definition] of [
      ['weekly_report_hour', 'INTEGER NOT NULL DEFAULT 9'],
      ['next_run_at', "TEXT NOT NULL DEFAULT ''"],
    ]) {
      if (!monitoringColumns.has(name)) {
        this.db.exec(`ALTER TABLE digital_footprint_youtube_monitoring ADD COLUMN ${name} ${definition}`)
      }
    }
    this.db.prepare(`
      UPDATE digital_footprint_runs
      SET status = 'interrupted', completed_at = ?, error = 'Process stopped during this poll.'
      WHERE status = 'running'
    `).run(new Date().toISOString())
  }

  getSettings() {
    const row = this.db.prepare(`
      SELECT enabled, github_username AS githubUsername,
        youtube_channel_id AS youtubeChannelId, next_run_at AS nextRunAt,
        updated_at AS updatedAt
      FROM digital_footprint_settings WHERE id = 1
    `).get()
    return { ...row, enabled: Boolean(row.enabled) }
  }

  getState({ githubTokenConfigured = false, youtubeApiKeyConfigured = false, telegramConfigured = false } = {}) {
    const activities = this.db.prepare(`
      SELECT id, source, external_id AS externalId, title, summary, url,
        published_at AS publishedAt, fetched_at AS fetchedAt
      FROM digital_footprint_activity
      ORDER BY published_at DESC, id DESC LIMIT 40
    `).all()
    const runs = this.db.prepare(`
      SELECT id, trigger, status, started_at AS startedAt, completed_at AS completedAt,
        github_count AS githubCount, youtube_count AS youtubeCount,
        notifications_sent AS notificationsSent, error
      FROM digital_footprint_runs ORDER BY id DESC LIMIT 10
    `).all()
    return {
      settings: this.getSettings(),
      activities,
      runs,
      youtubeAnalytics: this.getYoutubeAnalytics(),
      youtubeOAuth: this.getYoutubeOAuthStatus(),
      youtubeIntelligence: this.getYoutubeIntelligenceState(),
      sources: { githubTokenConfigured, youtubeApiKeyConfigured, telegramConfigured },
    }
  }

  getEncryptionKey() {
    const value = this.getOAuthConfig().tokenEncryptionKey || ''
    if (!/^[\da-f]{64}$/i.test(value)) {
      throw serviceError('Set YOUTUBE_OAUTH_TOKEN_ENCRYPTION_KEY to a 64-character hexadecimal key.', 503)
    }
    return Buffer.from(value, 'hex')
  }

  encryptToken(value) {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.getEncryptionKey(), iv)
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.')
  }

  decryptToken(value) {
    const [encodedIv, encodedTag, encodedCiphertext] = String(value).split('.')
    if (!encodedIv || !encodedTag || !encodedCiphertext) throw serviceError('Stored YouTube OAuth credentials are invalid.', 500)
    const decipher = createDecipheriv('aes-256-gcm', this.getEncryptionKey(), Buffer.from(encodedIv, 'base64url'))
    decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'))
    try {
      return Buffer.concat([
        decipher.update(Buffer.from(encodedCiphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8')
    } catch {
      throw serviceError('Could not decrypt saved YouTube OAuth credentials. Check YOUTUBE_OAUTH_TOKEN_ENCRYPTION_KEY.', 500)
    }
  }

  getOAuthConfiguration() {
    const config = this.getOAuthConfig()
    const redirectUri = String(config.redirectUri || '')
    let parsedRedirect
    try {
      parsedRedirect = new URL(redirectUri)
    } catch {
      throw serviceError('Set GOOGLE_REDIRECT_URI or YOUTUBE_OAUTH_REDIRECT_URI to the registered Google OAuth callback URL.', 503)
    }
    if (parsedRedirect.pathname !== YOUTUBE_OAUTH_CALLBACK_PATH || parsedRedirect.search || parsedRedirect.hash
      || parsedRedirect.username || parsedRedirect.password
      || (parsedRedirect.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsedRedirect.hostname))
      || (config.production && parsedRedirect.protocol !== 'https:')) {
      throw serviceError(`YOUTUBE_OAUTH_REDIRECT_URI must use HTTPS and end with ${YOUTUBE_OAUTH_CALLBACK_PATH}.`, 503)
    }
    if (!config.clientId || !config.clientSecret) {
      throw serviceError('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (or GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET) on the server.', 503)
    }
    this.getEncryptionKey()
    return { ...config, redirectUri }
  }

  getYoutubeOAuthStatus() {
    let configured = false
    let setupError = ''
    let redirectUri = ''
    try {
      const config = this.getOAuthConfiguration()
      configured = true
      redirectUri = config.redirectUri
    } catch (error) {
      setupError = error.message
    }
    const row = this.db.prepare(`
      SELECT expires_at AS expiresAt, scopes_json AS scopesJson
      FROM digital_footprint_youtube_oauth WHERE id = 1
    `).get()
    const intelligence = this.getYoutubeIntelligenceState()
    return {
      configured,
      connected: Boolean(row),
      redirectUri,
      scopes: row ? JSON.parse(row.scopesJson) : [],
      expiresAt: row?.expiresAt || '',
      channel: intelligence.channel,
      channelCandidates: intelligence.channelCandidates,
      setupError,
    }
  }

  getYoutubeIntelligenceState() {
    const channelRow = this.db.prepare(`
      SELECT channel_id AS channelId, title, description, custom_url AS customUrl,
        published_at AS publishedAt, statistics_json AS statisticsJson,
        last_synced_at AS lastSyncedAt
      FROM digital_footprint_youtube_channel ORDER BY last_synced_at DESC LIMIT 1
    `).get()
    const channel = channelRow ? (() => {
      const statistics = JSON.parse(channelRow.statisticsJson || '{}')
      return {
        channelId: channelRow.channelId,
        title: channelRow.title,
        description: channelRow.description,
        customUrl: channelRow.customUrl,
        publishedAt: channelRow.publishedAt,
        lastSyncedAt: channelRow.lastSyncedAt,
        views: statistics.viewCount ?? null,
        subscribers: statistics.subscriberCount ?? null,
        hiddenSubscriberCount: Boolean(statistics.hiddenSubscriberCount),
        publicVideoCount: statistics.videoCount ?? null,
        availability: {
          views: statistics.viewCount == null ? 'unavailable' : 'available',
          subscribers: statistics.subscriberCount == null ? 'unavailable' : 'available',
          publicVideoCount: statistics.videoCount == null ? 'unavailable' : 'available',
          impressions: 'unavailable',
          clickThroughRate: 'unavailable',
        },
      }
    })() : null
    const candidates = this.db.prepare(`
      SELECT channel_id AS channelId, title, custom_url AS customUrl,
        thumbnails_json AS thumbnailsJson
      FROM digital_footprint_youtube_channel_candidates ORDER BY title COLLATE NOCASE
    `).all().map(({ thumbnailsJson, ...candidate }) => ({
      ...candidate,
      thumbnails: JSON.parse(thumbnailsJson || '{}'),
    }))
    const channelId = channel?.channelId || ''
    const videoCount = channelId ? Number(this.db.prepare(`
      SELECT COUNT(*) AS count FROM digital_footprint_youtube_videos WHERE channel_id = ?
    `).get(channelId).count) : 0
    const allDailyStats = channelId ? this.db.prepare(`
      SELECT stat_date AS date, metrics_json AS metricsJson
      FROM digital_footprint_youtube_channel_daily
      WHERE channel_id = ? ORDER BY stat_date
    `).all(channelId).map(({ date, metricsJson }) => ({ date, ...JSON.parse(metricsJson) })) : []
    const dailyStats = allDailyStats.slice(-180)
    const byMonth = new Map()
    for (const day of allDailyStats) {
      const month = day.date.slice(0, 7)
      const aggregate = byMonth.get(month) || {
        date: month, views: 0, watchMinutes: 0, subscribersGained: 0,
        subscribersLost: 0, likes: 0, comments: 0, shares: 0, counts: {},
        durationWeight: 0, percentageWeight: 0,
        weightedDuration: 0, weightedPercentage: 0,
      }
      for (const [source, target] of [
        ['views', 'views'], ['estimatedMinutesWatched', 'watchMinutes'],
        ['subscribersGained', 'subscribersGained'], ['subscribersLost', 'subscribersLost'],
        ['likes', 'likes'], ['comments', 'comments'], ['shares', 'shares'],
      ]) {
        if (day[source] != null) {
          aggregate[target] += Number(day[source])
          aggregate.counts[target] = (aggregate.counts[target] || 0) + 1
        }
      }
      if (day.averageViewDuration != null && day.views) {
        aggregate.durationWeight += Number(day.views)
        aggregate.weightedDuration += Number(day.averageViewDuration) * Number(day.views)
      }
      if (day.averageViewPercentage != null && day.views) {
        aggregate.percentageWeight += Number(day.views)
        aggregate.weightedPercentage += Number(day.averageViewPercentage) * Number(day.views)
      }
      byMonth.set(month, aggregate)
    }
    const monthlyStats = [...byMonth.values()].map((month) => ({
      date: month.date,
      views: month.counts.views ? month.views : null,
      watchMinutes: month.counts.watchMinutes ? month.watchMinutes : null,
      subscribersGained: month.counts.subscribersGained ? month.subscribersGained : null,
      subscribersLost: month.counts.subscribersLost ? month.subscribersLost : null,
      likes: month.counts.likes ? month.likes : null,
      comments: month.counts.comments ? month.comments : null,
      shares: month.counts.shares ? month.shares : null,
      averageViewDuration: month.durationWeight ? month.weightedDuration / month.durationWeight : null,
      averageViewPercentage: month.percentageWeight ? month.weightedPercentage / month.percentageWeight : null,
    }))
    const videos = channelId ? this.db.prepare(`
      SELECT video_id AS videoId, title, description, published_at AS publishedAt,
        duration_seconds AS durationSeconds, thumbnail_url AS thumbnailUrl,
        url, public_statistics_json AS publicStatisticsJson
      FROM digital_footprint_youtube_videos WHERE channel_id = ?
      ORDER BY published_at DESC LIMIT 1000
    `).all(channelId).map((video) => {
      const stats = this.db.prepare(`
        SELECT range_start AS rangeStart, range_end AS rangeEnd, metrics_json AS metricsJson
        FROM digital_footprint_youtube_video_daily
        WHERE channel_id = ? AND video_id = ? ORDER BY stat_date DESC LIMIT 1
      `).get(channelId, video.videoId)
      const publicStatistics = JSON.parse(video.publicStatisticsJson || '{}')
      return {
        videoId: video.videoId,
        title: video.title,
        description: video.description,
        publishedAt: video.publishedAt,
        durationSeconds: video.durationSeconds,
        thumbnailUrl: video.thumbnailUrl,
        url: video.url,
        publicViews: publicStatistics.viewCount ?? null,
        publicLikes: publicStatistics.likeCount ?? null,
        publicComments: publicStatistics.commentCount ?? null,
        analytics: stats ? {
          rangeStart: stats.rangeStart,
          rangeEnd: stats.rangeEnd,
          ...JSON.parse(stats.metricsJson),
        } : null,
      }
    }) : []
    const reports = channelId ? this.db.prepare(`
      SELECT r.report_name AS name, r.status, r.range_start AS rangeStart,
        r.range_end AS rangeEnd, r.report_json AS reportJson,
        r.error, r.fetched_at AS fetchedAt
      FROM digital_footprint_youtube_reports r
      WHERE r.channel_id = ? AND r.fetched_at = (
        SELECT MAX(latest.fetched_at) FROM digital_footprint_youtube_reports latest
        WHERE latest.channel_id = r.channel_id AND latest.report_name = r.report_name
      )
    `).all(channelId).reduce((result, report) => {
      result[report.name] = {
        status: report.status,
        error: report.error,
        rangeStart: report.rangeStart,
        rangeEnd: report.rangeEnd,
        fetchedAt: report.fetchedAt,
        ...JSON.parse(report.reportJson),
      }
      return result
    }, {}) : {}
    const notifications = this.db.prepare(`
      SELECT notification_type AS type, message, delivery_status AS status,
        attempts, last_error AS error, created_at AS createdAt,
        delivered_at AS deliveredAt
      FROM digital_footprint_youtube_notifications
      ORDER BY created_at DESC LIMIT 40
    `).all()
    return {
      channel,
      channelCandidates: candidates,
      videoCount,
      monitoring: this.getYoutubeMonitoringSettings(),
      dailyStats,
      monthlyStats,
      videos,
      topVideos: videos.filter((video) => video.analytics?.views != null)
        .sort((a, b) => b.analytics.views - a.analytics.views).slice(0, 10),
      fastestGrowingVideos: videos.filter((video) => video.analytics?.viewsChange7Days > 0)
        .sort((a, b) => b.analytics.viewsChange7Days - a.analytics.viewsChange7Days).slice(0, 10),
      losingMomentumVideos: videos.filter((video) => video.analytics?.viewsChange7Days < 0)
        .sort((a, b) => a.analytics.viewsChange7Days - b.analytics.viewsChange7Days).slice(0, 10),
      highRetentionVideos: videos.filter((video) => video.analytics?.averageViewPercentage != null)
        .sort((a, b) => b.analytics.averageViewPercentage - a.analytics.averageViewPercentage).slice(0, 10),
      bestUploadPeriods: [...videos.reduce((groups, video) => {
        const period = video.publishedAt.slice(0, 7)
        if (!period || video.analytics?.views == null) return groups
        const group = groups.get(period) || { period, views: 0, videos: 0 }
        group.views += Number(video.analytics.views)
        group.videos++
        groups.set(period, group)
        return groups
      }, new Map()).values()].map((period) => ({
        ...period,
        averageViews: period.videos ? period.views / period.videos : null,
      })).sort((a, b) => (b.averageViews || 0) - (a.averageViews || 0)).slice(0, 6),
      reports,
      notifications,
      availability: {
        thumbnailImpressions: 'unavailable via the YouTube Data API v3 and Analytics API query reports',
        clickThroughRate: 'unavailable via the YouTube Data API v3 and Analytics API query reports',
      },
    }
  }

  getYoutubeAnalytics() {
    const row = this.db.prepare(`
      SELECT report_json AS reportJson, fetched_at AS fetchedAt
      FROM digital_footprint_youtube_analytics WHERE id = 1
    `).get()
    return row ? { ...JSON.parse(row.reportJson), fetchedAt: row.fetchedAt } : null
  }

  beginYoutubeAuthorization() {
    const config = this.getOAuthConfiguration()
    const state = randomBytes(32).toString('base64url')
    const verifier = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const now = new Date()
    this.db.prepare('DELETE FROM digital_footprint_youtube_oauth_states WHERE expires_at <= ?').run(now.toISOString())
    this.db.prepare(`
      INSERT INTO digital_footprint_youtube_oauth_states(state_hash, verifier_enc, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(
      createHash('sha256').update(state).digest('hex'),
      this.encryptToken(verifier),
      now.toISOString(),
      new Date(now.getTime() + 10 * 60000).toISOString(),
    )
    const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    authorizationUrl.searchParams.set('client_id', config.clientId)
    authorizationUrl.searchParams.set('redirect_uri', config.redirectUri)
    authorizationUrl.searchParams.set('response_type', 'code')
    authorizationUrl.searchParams.set('scope', YOUTUBE_ANALYTICS_SCOPES.join(' '))
    authorizationUrl.searchParams.set('access_type', 'offline')
    authorizationUrl.searchParams.set('prompt', 'consent')
    authorizationUrl.searchParams.set('include_granted_scopes', 'true')
    authorizationUrl.searchParams.set('state', state)
    authorizationUrl.searchParams.set('code_challenge', challenge)
    authorizationUrl.searchParams.set('code_challenge_method', 'S256')
    return authorizationUrl.toString()
  }

  async exchangeYoutubeAuthorizationCode({ code, verifier, config }) {
    const body = new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    })
    return this.fetchOAuthToken(body, [code, verifier, config.clientSecret])
  }

  async fetchOAuthToken(body, sensitiveValues = []) {
    let response
    try {
      response = await this.fetchImpl('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(15000),
      })
    } catch (error) {
      throw serviceError(`Google OAuth token request failed${error.name === 'TimeoutError' ? ' (timed out).' : '.'}`)
    }
    let token
    try {
      token = await response.json()
    } catch {
      throw serviceError(`Google OAuth token endpoint returned an invalid response (HTTP ${response.status}).`)
    }
    if (!response.ok) {
      let reason = typeof token.error_description === 'string'
        ? token.error_description
        : typeof token.error === 'string' ? token.error : ''
      for (const value of sensitiveValues) {
        if (typeof value === 'string' && value) reason = String(reason || '').replaceAll(value, '[redacted]')
      }
      throw serviceError(`Google OAuth token request failed (HTTP ${response.status})${reason ? `: ${reason.slice(0, 200)}` : '.'}`, 502)
    }
    if (typeof token.access_token !== 'string' || !Number.isFinite(Number(token.expires_in)) || Number(token.expires_in) <= 0) {
      throw serviceError('Google OAuth returned an incomplete access-token response.')
    }
    return token
  }

  async completeYoutubeAuthorization({ state, code, error }) {
    const config = this.getOAuthConfiguration()
    if (typeof state !== 'string' || state.length < 32 || state.length > 200) {
      throw serviceError('Invalid or expired Google OAuth state. Start the connection again.', 400)
    }
    const stateHash = createHash('sha256').update(state).digest('hex')
    const stateRow = this.db.prepare(`
      SELECT verifier_enc AS verifierEnc, expires_at AS expiresAt
      FROM digital_footprint_youtube_oauth_states WHERE state_hash = ?
    `).get(stateHash)
    if (!stateRow) throw serviceError('Invalid or expired Google OAuth state. Start the connection again.', 400)
    this.db.prepare('DELETE FROM digital_footprint_youtube_oauth_states WHERE state_hash = ?').run(stateHash)
    if (Date.parse(stateRow.expiresAt) <= Date.now()) {
      throw serviceError('Google OAuth request expired. Start the connection again.', 400)
    }
    if (error) throw serviceError('Google authorization was denied or cancelled.', 400)
    if (typeof code !== 'string' || !code || code.length > 4096) {
      throw serviceError('Google did not return an authorization code.', 400)
    }
    const verifier = this.decryptToken(stateRow.verifierEnc)
    const token = await this.exchangeYoutubeAuthorizationCode({ code, verifier, config })
    const scopes = typeof token.scope === 'string'
      ? token.scope.split(/\s+/).filter(Boolean)
      : YOUTUBE_ANALYTICS_SCOPES
    if (!YOUTUBE_ANALYTICS_SCOPES.every((scope) => scopes.includes(scope))) {
      throw serviceError('Google did not grant all required read-only YouTube Analytics permissions.', 403)
    }
    const previous = this.db.prepare(`
      SELECT refresh_token_enc AS refreshTokenEnc
      FROM digital_footprint_youtube_oauth WHERE id = 1
    `).get()
    const refreshToken = token.refresh_token
      || (previous ? this.decryptToken(previous.refreshTokenEnc) : '')
    if (!refreshToken) {
      throw serviceError('Google did not return a refresh token. Reconnect and approve offline access.', 502)
    }
    this.saveYoutubeOAuthTokens({
      accessToken: token.access_token,
      refreshToken,
      expiresIn: Number(token.expires_in),
      scopes,
    })
    try {
      await this.discoverYoutubeChannel(await this.getYoutubeAccessToken())
    } catch (discoveryError) {
      const message = sanitizedError(discoveryError, { ...config, accessToken: token.access_token })
      this.saveYoutubeReport(
        'channel_discovery', '', '', 'unavailable', { availableMetrics: [], rows: [] },
        message,
      )
      this.onError(new Error(`YouTube channel discovery failed: ${message}`))
    }
    return this.getYoutubeOAuthStatus()
  }

  saveYoutubeOAuthTokens({ accessToken, refreshToken, expiresIn, scopes }) {
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()
    this.db.prepare(`
      INSERT INTO digital_footprint_youtube_oauth(
        id, access_token_enc, refresh_token_enc, expires_at, scopes_json, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        access_token_enc = excluded.access_token_enc,
        refresh_token_enc = excluded.refresh_token_enc,
        expires_at = excluded.expires_at,
        scopes_json = excluded.scopes_json,
        updated_at = excluded.updated_at
    `).run(
      this.encryptToken(accessToken),
      this.encryptToken(refreshToken),
      expiresAt,
      JSON.stringify(scopes),
      new Date().toISOString(),
    )
  }

  async getYoutubeAccessToken() {
    const row = this.db.prepare(`
      SELECT access_token_enc AS accessTokenEnc, refresh_token_enc AS refreshTokenEnc,
        expires_at AS expiresAt, scopes_json AS scopesJson
      FROM digital_footprint_youtube_oauth WHERE id = 1
    `).get()
    if (!row) throw serviceError('Connect your Google account to retrieve YouTube Analytics.', 400)
    if (Date.parse(row.expiresAt) > Date.now() + 120000) return this.decryptToken(row.accessTokenEnc)
    const config = this.getOAuthConfiguration()
    const refreshToken = this.decryptToken(row.refreshTokenEnc)
    const token = await this.fetchOAuthToken(new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }), [refreshToken, config.clientSecret])
    const scopes = typeof token.scope === 'string' ? token.scope.split(/\s+/).filter(Boolean) : JSON.parse(row.scopesJson)
    this.saveYoutubeOAuthTokens({
      accessToken: token.access_token,
      refreshToken: token.refresh_token || this.decryptToken(row.refreshTokenEnc),
      expiresIn: Number(token.expires_in),
      scopes,
    })
    return token.access_token
  }

  async fetchYoutubeAnalyticsReport({ accessToken, startDate, endDate, metrics, dimensions = '' }) {
    const url = new URL('https://youtubeanalytics.googleapis.com/v2/reports')
    url.searchParams.set('ids', 'channel==MINE')
    url.searchParams.set('startDate', startDate)
    url.searchParams.set('endDate', endDate)
    url.searchParams.set('metrics', metrics)
    if (dimensions) url.searchParams.set('dimensions', dimensions)
    return fetchJson(this.fetchImpl, url, {
      headers: { authorization: `Bearer ${accessToken}` },
    }, 'YouTube Analytics')
  }

  async fetchYoutubeAnalyticsRows({ accessToken, channelId = '', startDate, endDate, metrics, dimensions = '', filters = '', sort = '' }) {
    const allRows = []
    let columnHeaders = []
    const maxRows = 10000
    for (let startIndex = 1; startIndex <= maxRows; startIndex += 200) {
      const url = new URL('https://youtubeanalytics.googleapis.com/v2/reports')
      url.searchParams.set('ids', channelId ? `channel==${channelId}` : 'channel==MINE')
      url.searchParams.set('startDate', startDate)
      url.searchParams.set('endDate', endDate)
      url.searchParams.set('metrics', metrics)
      if (dimensions) url.searchParams.set('dimensions', dimensions)
      if (filters) url.searchParams.set('filters', filters)
      if (sort) url.searchParams.set('sort', sort)
      url.searchParams.set('maxResults', '200')
      url.searchParams.set('startIndex', String(startIndex))
      const result = await fetchJson(this.fetchImpl, url, {
        headers: { authorization: `Bearer ${accessToken}` },
      }, 'YouTube Analytics')
      if (!columnHeaders.length) columnHeaders = result.columnHeaders || []
      const rows = result.rows || []
      allRows.push(...rows)
      if (rows.length < 200) break
    }
    return { columnHeaders, rows: allRows, truncated: allRows.length >= maxRows }
  }

  async fetchYoutubeData(path, params, accessToken) {
    const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`)
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
    }
    return fetchJson(this.fetchImpl, url, {
      headers: { authorization: `Bearer ${accessToken}` },
    }, 'YouTube')
  }

  async discoverYoutubeChannel(accessToken) {
    const result = await this.fetchYoutubeData('channels', {
      part: 'id,snippet,statistics,contentDetails',
      mine: 'true',
      maxResults: 50,
    }, accessToken)
    if (!Array.isArray(result.items) || !result.items.length) {
      throw serviceError('No YouTube channel was returned for the authorized Google account.', 404)
    }
    const now = new Date().toISOString()
    this.db.prepare('DELETE FROM digital_footprint_youtube_channel_candidates').run()
    const insertCandidate = this.db.prepare(`
      INSERT INTO digital_footprint_youtube_channel_candidates(
        channel_id, title, custom_url, thumbnails_json, discovered_at
      ) VALUES (?, ?, ?, ?, ?)
    `)
    for (const item of result.items) {
      if (!item.id) continue
      insertCandidate.run(
        String(item.id),
        String(item.snippet?.title || ''),
        String(item.snippet?.customUrl || ''),
        JSON.stringify(item.snippet?.thumbnails || {}),
        now,
      )
    }
    const exactName = result.items.filter((item) => String(item.snippet?.title || '').trim().toLowerCase() === 'caash aminati')
    const previousChannelId = this.db.prepare(`
      SELECT channel_id AS channelId FROM digital_footprint_youtube_channel
      ORDER BY last_synced_at DESC LIMIT 1
    `).get()?.channelId
    const selected = exactName.length === 1
      ? exactName[0]
      : result.items.length === 1 ? result.items[0]
        : result.items.find((item) => String(item.id) === previousChannelId) || null
    if (!selected) {
      if (previousChannelId && !result.items.some((item) => String(item.id) === previousChannelId)) {
        this.db.prepare('DELETE FROM digital_footprint_youtube_channel WHERE channel_id = ?').run(previousChannelId)
      }
      return { status: 'channel-selection-required', candidates: this.getYoutubeIntelligenceState().channelCandidates }
    }
    this.saveYoutubeChannel(selected)
    return { status: 'connected', channelId: String(selected.id) }
  }

  saveYoutubeChannel(item) {
    const channelId = String(item.id || '')
    const uploadsPlaylistId = String(item.contentDetails?.relatedPlaylists?.uploads || '')
    if (!/^UC[A-Za-z0-9_-]{20,}$/.test(channelId)) {
      throw serviceError('Google returned an invalid authorized YouTube channel ID.', 502)
    }
    const statistics = item.statistics || {}
    const safeStatistics = {
      viewCount: numericValue(statistics.viewCount),
      subscriberCount: item.statistics?.hiddenSubscriberCount ? null : numericValue(statistics.subscriberCount),
      hiddenSubscriberCount: Boolean(statistics.hiddenSubscriberCount),
      videoCount: numericValue(statistics.videoCount),
    }
    const now = new Date().toISOString()
    this.db.prepare(`
      INSERT INTO digital_footprint_youtube_channel(
        channel_id, title, description, custom_url, published_at,
        uploads_playlist_id, statistics_json, last_synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(channel_id) DO UPDATE SET
        title = excluded.title, description = excluded.description,
        custom_url = excluded.custom_url, published_at = excluded.published_at,
        uploads_playlist_id = excluded.uploads_playlist_id,
        statistics_json = excluded.statistics_json, last_synced_at = excluded.last_synced_at
    `).run(
      channelId,
      String(item.snippet?.title || ''),
      String(item.snippet?.description || ''),
      String(item.snippet?.customUrl || ''),
      String(item.snippet?.publishedAt || ''),
      uploadsPlaylistId,
      JSON.stringify(safeStatistics),
      now,
    )
    return channelId
  }

  async selectYoutubeChannel(channelId) {
    const candidate = this.db.prepare(`
      SELECT channel_id AS channelId FROM digital_footprint_youtube_channel_candidates WHERE channel_id = ?
    `).get(String(channelId || ''))
    if (!candidate) throw serviceError('Select a channel returned by the connected Google account.', 400)
    const accessToken = await this.getYoutubeAccessToken()
    const result = await this.fetchYoutubeData('channels', {
      part: 'id,snippet,statistics,contentDetails',
      mine: 'true',
      maxResults: 50,
    }, accessToken)
    const ownedChannel = result.items?.find((item) => String(item.id) === candidate.channelId)
    if (!ownedChannel) throw serviceError('The selected channel is not available to the connected Google account.', 403)
    this.saveYoutubeChannel(ownedChannel)
    return this.getYoutubeIntelligenceState()
  }

  saveYoutubeReport(name, startDate, endDate, status, report, error = '', channelId = '') {
    this.db.prepare(`
      INSERT INTO digital_footprint_youtube_reports(
        channel_id, report_name, range_start, range_end, status, report_json, error, fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(channel_id, report_name, range_start, range_end) DO UPDATE SET
        status = excluded.status, report_json = excluded.report_json,
        error = excluded.error, fetched_at = excluded.fetched_at
    `).run(
      channelId, name, startDate, endDate, status, JSON.stringify(report),
      String(error).slice(0, 500), new Date().toISOString(),
    )
  }

  async requestAndSaveReport({ name, accessToken, channelId = '', startDate, endDate, metrics, dimensions = '', sort = '' }) {
    try {
      const response = await this.fetchYoutubeAnalyticsRows({
        accessToken, channelId, startDate, endDate, metrics, dimensions, sort,
      })
      const headers = response.columnHeaders.map((column) => column.name)
      const rows = reportRows(response)
      const report = {
        availableMetrics: headers.filter((header) => !['day', 'month', 'video', 'country', 'ageGroup', 'gender', 'deviceType', 'insightTrafficSourceType', 'insightTrafficSourceDetail'].includes(header)),
        rows,
        truncated: response.truncated,
      }
      this.saveYoutubeReport(name, startDate, endDate, rows.length ? 'available' : 'empty', report, '', channelId)
      return { rows, availableMetrics: report.availableMetrics, status: rows.length ? 'available' : 'empty', truncated: response.truncated }
    } catch (error) {
      const message = sanitizedError(error, { ...this.getOAuthConfig(), accessToken })
      this.saveYoutubeReport(name, startDate, endDate, 'unavailable', { availableMetrics: [], rows: [] }, message, channelId)
      this.onError(new Error(`YouTube Analytics ${name} report unavailable: ${message}`))
      return { rows: [], availableMetrics: [], status: 'unavailable', error: message }
    }
  }

  async requestAndSaveVideoReport({ name, accessToken, channelId, startDate, endDate, metrics, sort = '' }) {
    const indexedIds = this.db.prepare(`
      SELECT video_id AS videoId FROM digital_footprint_youtube_videos
      WHERE channel_id = ? ORDER BY published_at DESC
    `).all(channelId).map((video) => video.videoId)
    const maxVideos = 5000
    const videoIds = indexedIds.slice(0, maxVideos)
    const truncated = indexedIds.length > maxVideos
    const groups = []
    for (let offset = 0; offset < videoIds.length; offset += 50) groups.push(videoIds.slice(offset, offset + 50))
    const rows = []
    let availableMetrics = []
    let queryError = ''
    try {
      for (const group of groups.length ? groups : [[]]) {
        const singleVideo = group.length === 1
        const result = await this.fetchYoutubeAnalyticsRows({
          accessToken,
          channelId,
          startDate,
          endDate,
          metrics,
          dimensions: singleVideo || group.length === 0 ? '' : 'video',
          filters: group.length ? `video==${group.join(',')}` : '',
          sort: singleVideo || group.length === 0 ? '' : sort,
        })
        if (!availableMetrics.length) {
          availableMetrics = result.columnHeaders.map((column) => column.name)
            .filter((header) => !['video'].includes(header))
        }
        const parsedRows = reportRows(result)
        if (singleVideo && parsedRows[0]) rows.push({ video: group[0], ...parsedRows[0] })
        else rows.push(...parsedRows)
        if (result.truncated) {
          queryError = 'Analytics report reached its 10,000-row pagination safety limit.'
          break
        }
      }
    } catch (error) {
      queryError = sanitizedError(error, { ...this.getOAuthConfig(), accessToken })
    }
    const status = queryError ? rows.length ? 'partial' : 'unavailable' : rows.length ? 'available' : 'empty'
    const report = { availableMetrics, rows, truncated: truncated || Boolean(queryError) }
    this.saveYoutubeReport(name, startDate, endDate, status, report, queryError, channelId)
    if (queryError) this.onError(new Error(`YouTube Analytics ${name} report ${status}: ${queryError}`))
    return { rows, availableMetrics, status, truncated: report.truncated, error: queryError }
  }

  async refreshYoutubeAnalytics() {
    const result = await this.syncYoutubeChannel()
    if (this.getYoutubeMonitoringSettings().enabled && ['completed', 'partial'].includes(result.status)) {
      this.db.prepare('UPDATE digital_footprint_youtube_monitoring SET next_run_at = ? WHERE id = 1')
        .run(new Date(Date.now() + YOUTUBE_SYNC_INTERVAL_MINUTES * 60000).toISOString())
    }
    return result
  }

  getYoutubeMonitoringSettings() {
    const row = this.db.prepare(`
      SELECT enabled, alerts_enabled AS alertsEnabled,
        daily_report_enabled AS dailyReportEnabled,
        weekly_report_enabled AS weeklyReportEnabled,
        daily_report_hour AS dailyReportHour,
        weekly_report_hour AS weeklyReportHour,
        weekly_report_day AS weeklyReportDay,
        next_run_at AS nextRunAt,
        updated_at AS updatedAt
      FROM digital_footprint_youtube_monitoring WHERE id = 1
    `).get()
    return {
      ...row,
      enabled: Boolean(row.enabled),
      alertsEnabled: Boolean(row.alertsEnabled),
      dailyReportEnabled: Boolean(row.dailyReportEnabled),
      weeklyReportEnabled: Boolean(row.weeklyReportEnabled),
      timezone: 'Asia/Kolkata',
    }
  }

  saveYoutubeMonitoringSettings(input = {}) {
    const current = this.getYoutubeMonitoringSettings()
    const next = {
      enabled: Object.hasOwn(input, 'enabled') ? input.enabled : current.enabled,
      alertsEnabled: Object.hasOwn(input, 'alertsEnabled') ? input.alertsEnabled : current.alertsEnabled,
      dailyReportEnabled: Object.hasOwn(input, 'dailyReportEnabled') ? input.dailyReportEnabled : current.dailyReportEnabled,
      weeklyReportEnabled: Object.hasOwn(input, 'weeklyReportEnabled') ? input.weeklyReportEnabled : current.weeklyReportEnabled,
      dailyReportHour: Object.hasOwn(input, 'dailyReportHour') ? Number(input.dailyReportHour) : current.dailyReportHour,
      weeklyReportHour: Object.hasOwn(input, 'weeklyReportHour') ? Number(input.weeklyReportHour) : current.weeklyReportHour,
      weeklyReportDay: Object.hasOwn(input, 'weeklyReportDay') ? Number(input.weeklyReportDay) : current.weeklyReportDay,
    }
    for (const key of ['enabled', 'alertsEnabled', 'dailyReportEnabled', 'weeklyReportEnabled']) {
      if (typeof next[key] !== 'boolean') throw serviceError(`${key} must be true or false.`, 400)
    }
    if (!Number.isInteger(next.dailyReportHour) || next.dailyReportHour < 0 || next.dailyReportHour > 23) {
      throw serviceError('Daily report hour must be between 0 and 23 (Asia/Kolkata).', 400)
    }
    if (!Number.isInteger(next.weeklyReportHour) || next.weeklyReportHour < 0 || next.weeklyReportHour > 23) {
      throw serviceError('Weekly report hour must be between 0 and 23 (Asia/Kolkata).', 400)
    }
    if (!Number.isInteger(next.weeklyReportDay) || next.weeklyReportDay < 0 || next.weeklyReportDay > 6) {
      throw serviceError('Weekly report day must be between 0 and 6 (Sunday to Saturday).', 400)
    }
    const connected = Boolean(this.db.prepare('SELECT 1 FROM digital_footprint_youtube_oauth WHERE id = 1').get())
    if (next.enabled && !connected) throw serviceError('Connect Google and authorize your YouTube channel before enabling monitoring.', 400)
    const selectedChannel = Boolean(this.db.prepare('SELECT 1 FROM digital_footprint_youtube_channel LIMIT 1').get())
    if (next.enabled && !selectedChannel) throw serviceError('Select an authorized YouTube channel before enabling monitoring.', 400)
    const nextRunAt = next.enabled && !current.enabled ? new Date().toISOString() : current.nextRunAt
    this.db.prepare(`
      UPDATE digital_footprint_youtube_monitoring
      SET enabled = ?, alerts_enabled = ?, daily_report_enabled = ?,
        weekly_report_enabled = ?, daily_report_hour = ?, weekly_report_hour = ?,
        weekly_report_day = ?, next_run_at = ?, updated_at = ?
      WHERE id = 1
    `).run(
      next.enabled ? 1 : 0,
      next.alertsEnabled ? 1 : 0,
      next.dailyReportEnabled ? 1 : 0,
      next.weeklyReportEnabled ? 1 : 0,
      next.dailyReportHour,
      next.weeklyReportHour,
      next.weeklyReportDay,
      nextRunAt,
      new Date().toISOString(),
    )
    return this.getYoutubeMonitoringSettings()
  }

  queueYoutubeNotification(type, key, message) {
    const settings = this.getYoutubeMonitoringSettings()
    if (!settings.enabled) return
    if (type === 'daily-report' && !settings.dailyReportEnabled) return
    if (type === 'weekly-report' && !settings.weeklyReportEnabled) return
    if (type !== 'daily-report' && type !== 'weekly-report' && !settings.alertsEnabled) return
    this.db.prepare(`
      INSERT OR IGNORE INTO digital_footprint_youtube_notifications(
        notification_key, notification_type, message, created_at
      ) VALUES (?, ?, ?, ?)
    `).run(`${type}:${key}`.slice(0, 500), type, String(message).slice(0, 4000), new Date().toISOString())
  }

  async deliverYoutubeNotifications() {
    const pending = this.db.prepare(`
      SELECT notification_key AS notificationKey, message
      FROM digital_footprint_youtube_notifications
      WHERE delivery_status = 'pending'
      ORDER BY created_at LIMIT 20
    `).all()
    let delivered = 0
    for (const notification of pending) {
      try {
        const wasSent = await this.notify({ message: notification.message, source: 'youtube-analytics' })
        this.db.prepare(`
          UPDATE digital_footprint_youtube_notifications
          SET attempts = attempts + 1,
            delivery_status = CASE WHEN ? THEN 'delivered' ELSE 'pending' END,
            delivered_at = CASE WHEN ? THEN ? ELSE delivered_at END,
            last_error = CASE WHEN ? THEN '' ELSE 'Telegram is not configured or did not confirm delivery.' END
          WHERE notification_key = ?
        `).run(
          wasSent ? 1 : 0,
          wasSent ? 1 : 0,
          new Date().toISOString(),
          wasSent ? 1 : 0,
          notification.notificationKey,
        )
        if (wasSent) delivered++
      } catch (error) {
        const message = sanitizedError(error)
        const ambiguous = /timed out|could not reach Telegram/i.test(message)
        this.db.prepare(`
          UPDATE digital_footprint_youtube_notifications
          SET attempts = attempts + 1,
            delivery_status = CASE WHEN ? THEN 'unknown' ELSE 'pending' END,
            last_error = ?
          WHERE notification_key = ?
        `).run(ambiguous ? 1 : 0, message, notification.notificationKey)
        this.onError(new Error(`YouTube Analytics notification failed: ${message}`))
      }
    }
    return delivered
  }

  async syncYoutubeVideos(channelId, playlistId, accessToken) {
    if (!playlistId) return { added: 0, count: 0 }
    const knownVideos = Number(this.db.prepare(`
      SELECT COUNT(*) AS count FROM digital_footprint_youtube_videos WHERE channel_id = ?
    `).get(channelId).count)
    let added = 0
    let count = 0
    let pageToken = ''
    let pageCount = 0
    let foundKnownPage = false
    do {
      const page = await this.fetchYoutubeData('playlistItems', {
        part: 'snippet,contentDetails',
        playlistId,
        maxResults: 50,
        pageToken,
      }, accessToken)
      const items = Array.isArray(page.items) ? page.items : []
      if (!items.length) break
      pageCount++
      const videoIds = [...new Set(items.map((item) => String(
        item.contentDetails?.videoId || item.snippet?.resourceId?.videoId || '',
      )).filter(Boolean))]
      const detailed = new Map()
      for (let offset = 0; offset < videoIds.length; offset += 50) {
        const result = await this.fetchYoutubeData('videos', {
          part: 'snippet,contentDetails,statistics',
          id: videoIds.slice(offset, offset + 50).join(','),
          maxResults: 50,
        }, accessToken)
        for (const video of result.items || []) detailed.set(String(video.id), video)
      }
      let existingInPage = 0
      const now = new Date().toISOString()
      const insert = this.db.prepare(`
        INSERT INTO digital_footprint_youtube_videos(
          channel_id, video_id, title, description, published_at, duration_seconds,
          thumbnail_url, url, public_statistics_json, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(channel_id, video_id) DO UPDATE SET
          title = excluded.title, description = excluded.description,
          published_at = excluded.published_at, duration_seconds = excluded.duration_seconds,
          thumbnail_url = excluded.thumbnail_url, public_statistics_json = excluded.public_statistics_json,
          last_seen_at = excluded.last_seen_at
      `)
      for (const item of items) {
        const videoId = String(item.contentDetails?.videoId || item.snippet?.resourceId?.videoId || '')
        if (!videoId) continue
        const exists = this.db.prepare(`
          SELECT 1 FROM digital_footprint_youtube_videos WHERE channel_id = ? AND video_id = ?
        `).get(channelId, videoId)
        if (exists) existingInPage++
        const video = detailed.get(videoId)
        const snippet = video?.snippet || item.snippet || {}
        const statistics = video?.statistics || {}
        const publishedAt = video?.snippet?.publishedAt
          || item.contentDetails?.videoPublishedAt || item.snippet?.publishedAt || ''
        const thumbnails = snippet.thumbnails || {}
        const thumbnailUrl = thumbnails.maxres?.url || thumbnails.high?.url
          || thumbnails.medium?.url || thumbnails.default?.url || ''
        insert.run(
          channelId,
          videoId,
          String(snippet.title || 'Untitled video'),
          String(snippet.description || '').slice(0, 5000),
          String(publishedAt),
          parseIsoDuration(video?.contentDetails?.duration),
          String(thumbnailUrl),
          `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
          JSON.stringify({
            viewCount: numericValue(statistics.viewCount),
            likeCount: numericValue(statistics.likeCount),
            commentCount: numericValue(statistics.commentCount),
          }),
          now,
        )
        if (!exists) {
          added++
          if (knownVideos > 0) {
            this.queueYoutubeNotification(
              'new-video',
              videoId,
              `New YouTube upload: ${String(snippet.title || 'Untitled video')}\nhttps://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
            )
          }
        }
        count++
      }
      if (knownVideos > 0 && existingInPage === items.length) {
        foundKnownPage = true
        break
      }
      pageToken = String(page.nextPageToken || '')
      if (pageCount >= 1000 && pageToken) {
        throw serviceError('YouTube upload indexing reached the 50,000-video per-sync safety limit; retry after reviewing channel size.')
      }
    } while (pageToken)
    return { added, count, baseline: knownVideos === 0, stoppedAtKnownPage: foundKnownPage }
  }

  async syncYoutubeComments(channelId, accessToken) {
    const recent = this.db.prepare(`
      SELECT COUNT(*) AS count FROM digital_footprint_youtube_comments WHERE channel_id = ?
    `).get(channelId)
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO digital_footprint_youtube_comments(
        channel_id, comment_id, video_id, text_display, published_at, first_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    let added = 0
    let pageToken = ''
    let pageCount = 0
    do {
      const response = await this.fetchYoutubeData('commentThreads', {
        part: 'snippet',
        allThreadsRelatedToChannelId: channelId,
        order: 'time',
        maxResults: 100,
        pageToken,
      }, accessToken)
      const threads = response.items || []
      if (!threads.length) break
      pageCount++
      let existingInPage = 0
      for (const thread of threads) {
        const comment = thread.snippet?.topLevelComment
        const commentId = String(comment?.id || '')
        if (!commentId) continue
        const existed = Boolean(this.db.prepare(`
          SELECT 1 FROM digital_footprint_youtube_comments WHERE channel_id = ? AND comment_id = ?
        `).get(channelId, commentId))
        if (existed) existingInPage++
        const snippet = comment.snippet || {}
        const videoId = String(thread.snippet?.videoId || '')
        const text = String(snippet.textDisplay || snippet.textOriginal || '').replace(/\s+/g, ' ').trim().slice(0, 300)
        const publishedAt = String(snippet.publishedAt || '')
        const result = insert.run(channelId, commentId, videoId, text, publishedAt, new Date().toISOString())
        if (Number(result.changes)) {
          added++
          if (Number(recent.count) > 0) {
            const video = this.db.prepare(`
              SELECT title FROM digital_footprint_youtube_videos WHERE channel_id = ? AND video_id = ?
            `).get(channelId, videoId)
            this.queueYoutubeNotification(
              'new-comment',
              commentId,
              `New comment on ${video?.title || 'your YouTube channel'}:\n“${text || '(comment text unavailable)'}”\nhttps://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
            )
          }
        }
      }
      if (existingInPage === threads.length) break
      pageToken = String(response.nextPageToken || '')
      if (pageCount >= 10 && pageToken) return { added, status: 'partial', truncated: true }
    } while (pageToken)
    return { added, status: 'available', truncated: false }
  }

  async syncYoutubeAnalyticsReports(channelId, channelPublishedAt, accessToken) {
    const endDate = isoDate(subtractDays(new Date(), 2))
    const channelStart = String(channelPublishedAt || '').slice(0, 10)
    const startDate = channelStart && channelStart >= '2005-04-23' ? channelStart : '2005-04-23'
    const channelMetrics = 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,likes,comments,shares'
    const daily = await this.requestAndSaveReport({
      name: 'channel_daily', accessToken, channelId, startDate, endDate,
      metrics: channelMetrics, dimensions: 'day',
    })
    if (daily.status === 'available') {
      const insert = this.db.prepare(`
        INSERT INTO digital_footprint_youtube_channel_daily(channel_id, stat_date, metrics_json, fetched_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(channel_id, stat_date) DO UPDATE SET
          metrics_json = excluded.metrics_json, fetched_at = excluded.fetched_at
      `)
      const metricNames = ['views', 'estimatedMinutesWatched', 'averageViewDuration', 'averageViewPercentage',
        'subscribersGained', 'subscribersLost', 'likes', 'comments', 'shares']
      const available = new Set(daily.availableMetrics)
      const now = new Date().toISOString()
      for (const row of daily.rows) {
        const values = { metricsAvailability: Object.fromEntries(metricNames.map((name) => [name, available.has(name)])) }
        for (const name of metricNames) values[name] = available.has(name) ? numericValue(row[name]) : null
        insert.run(channelId, String(row.day), JSON.stringify(values), now)
      }
    }
    const recentEnd = endDate
    const recentStart = isoDate(subtractDays(new Date(`${recentEnd}T00:00:00.000Z`), 27))
    const last7Start = isoDate(subtractDays(new Date(`${recentEnd}T00:00:00.000Z`), 6))
    const previous7End = isoDate(subtractDays(new Date(`${recentEnd}T00:00:00.000Z`), 7))
    const previous7Start = isoDate(subtractDays(new Date(`${recentEnd}T00:00:00.000Z`), 13))
    const videoMetrics = 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,likes,comments,shares'
    const [summary, video28, video7, videoPrevious7, countries, demographics, devices, traffic] = await Promise.all([
      this.requestAndSaveReport({
        name: 'channel_summary_28d', accessToken, channelId, startDate: recentStart, endDate: recentEnd,
        metrics: videoMetrics,
      }),
      this.requestAndSaveVideoReport({
        name: 'video_performance_28d', accessToken, channelId, startDate: recentStart, endDate: recentEnd,
        metrics: videoMetrics, sort: '-views',
      }),
      this.requestAndSaveVideoReport({
        name: 'video_performance_7d', accessToken, channelId, startDate: last7Start, endDate: recentEnd,
        metrics: videoMetrics, sort: '-views',
      }),
      this.requestAndSaveVideoReport({
        name: 'video_performance_previous_7d', accessToken, channelId, startDate: previous7Start, endDate: previous7End,
        metrics: videoMetrics, sort: '-views',
      }),
      this.requestAndSaveReport({
        name: 'geography', accessToken, channelId, startDate: recentStart, endDate: recentEnd,
        metrics: 'views,estimatedMinutesWatched', dimensions: 'country', sort: '-views',
      }),
      this.requestAndSaveReport({
        name: 'demographics', accessToken, channelId, startDate: recentStart, endDate: recentEnd,
        metrics: 'viewerPercentage', dimensions: 'ageGroup,gender',
      }),
      this.requestAndSaveReport({
        name: 'devices', accessToken, channelId, startDate: recentStart, endDate: recentEnd,
        metrics: 'views,estimatedMinutesWatched', dimensions: 'deviceType', sort: '-views',
      }),
      this.requestAndSaveReport({
        name: 'traffic_sources', accessToken, channelId, startDate: recentStart, endDate: recentEnd,
        metrics: 'views,estimatedMinutesWatched', dimensions: 'insightTrafficSourceType', sort: '-views',
      }),
    ])
    const availability = new Set(video28.availableMetrics)
    const reportByVideo = (report) => new Map(report.rows.map((row) => [String(row.video || ''), row]))
    const recentByVideo = reportByVideo(video7)
    const previousByVideo = reportByVideo(videoPrevious7)
    const saveVideo = this.db.prepare(`
      INSERT INTO digital_footprint_youtube_video_daily(
        channel_id, video_id, stat_date, range_start, range_end, metrics_json, fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(channel_id, video_id, stat_date) DO UPDATE SET
        range_start = excluded.range_start, range_end = excluded.range_end,
        metrics_json = excluded.metrics_json, fetched_at = excluded.fetched_at
    `)
    const saveMetric = (name, value) => availability.has(name) ? numericValue(value) : null
    const topBefore = this.db.prepare(`
      SELECT report_json AS reportJson FROM digital_footprint_youtube_reports
      WHERE channel_id = ? AND report_name = 'video_performance_28d'
      ORDER BY fetched_at DESC LIMIT 1
    `).get(channelId)
    const previousTopId = topBefore
      ? JSON.parse(topBefore.reportJson).rows?.[0]?.video || ''
      : ''
    if (video28.status === 'available') {
      const now = new Date().toISOString()
      for (const row of video28.rows) {
        const videoId = String(row.video || '')
        if (!videoId) continue
        const recent = recentByVideo.get(videoId) || {}
        const previous = previousByVideo.get(videoId) || {}
        const metrics = {}
        for (const name of videoMetrics.split(',')) metrics[name] = saveMetric(name, row[name])
        metrics.viewsLast7Days = numericValue(recent.views)
        metrics.viewsPrevious7Days = numericValue(previous.views)
        metrics.viewsChange7Days = metrics.viewsLast7Days == null || metrics.viewsPrevious7Days == null
          ? null : metrics.viewsLast7Days - metrics.viewsPrevious7Days
        metrics.metricsAvailability = Object.fromEntries(videoMetrics.split(',').map((name) => [name, availability.has(name)]))
        saveVideo.run(channelId, videoId, isoDate(new Date()), recentStart, recentEnd, JSON.stringify(metrics), now)
      }
    }
    const nextTopId = video28.rows[0]?.video || ''
    if (previousTopId && nextTopId && previousTopId !== nextTopId) {
      const title = this.db.prepare(`
        SELECT title FROM digital_footprint_youtube_videos WHERE channel_id = ? AND video_id = ?
      `).get(channelId, nextTopId)?.title || 'a video'
      this.queueYoutubeNotification(
        'top-performer',
        `${endDate}:${nextTopId}`,
        `A new YouTube top performer is leading the last 28 days: ${title}\nhttps://www.youtube.com/watch?v=${encodeURIComponent(nextTopId)}`,
      )
    }
    return {
      startDate, endDate, daily, summary, video28, video7, videoPrevious7,
      countries, demographics, devices, traffic, recentStart, last7Start, previous7Start, previous7End,
    }
  }

  latestChannelMetric(channelId, date) {
    const row = this.db.prepare(`
      SELECT metrics_json AS metricsJson FROM digital_footprint_youtube_channel_daily
      WHERE channel_id = ? AND stat_date = (
        SELECT MAX(stat_date) FROM digital_footprint_youtube_channel_daily
        WHERE channel_id = ? AND stat_date <= ?
      )
      LIMIT 1
    `).get(channelId, channelId, date)
    return row ? JSON.parse(row.metricsJson) : null
  }

  queueYoutubePerformanceAlerts(channelId, endDate) {
    const settings = this.getYoutubeMonitoringSettings()
    if (!settings.enabled) return
    const latest = this.latestChannelMetric(channelId, endDate)
    if (settings.alertsEnabled && latest) {
      const netSubscribers = latest.subscribersGained == null || latest.subscribersLost == null
        ? null : latest.subscribersGained - latest.subscribersLost
      if (netSubscribers != null && netSubscribers >= 10) {
        this.queueYoutubeNotification(
          'subscriber-growth',
          endDate,
          `YouTube subscriber growth alert: net +${netSubscribers} subscribers on ${endDate} (${latest.subscribersGained} gained, ${latest.subscribersLost} lost).`,
        )
      }
      const priorDays = this.db.prepare(`
        SELECT metrics_json AS metricsJson FROM digital_footprint_youtube_channel_daily
        WHERE channel_id = ? AND stat_date < ? ORDER BY stat_date DESC LIMIT 7
      `).all(channelId, endDate).map((row) => JSON.parse(row.metricsJson)).filter((row) => row.views != null)
      if (latest.views != null && priorDays.length) {
        const average = priorDays.reduce((sum, row) => sum + Number(row.views), 0) / priorDays.length
        if (latest.views >= 100 && latest.views >= Math.max(average * 3, 100)) {
          this.queueYoutubeNotification(
            'view-spike',
            endDate,
            `Unusual YouTube view increase on ${endDate}: ${latest.views} views versus a recent daily average of ${Math.round(average)}.`,
          )
        }
      }
      const recentDaily = this.db.prepare(`
        SELECT stat_date AS date, metrics_json AS metricsJson FROM digital_footprint_youtube_channel_daily
        WHERE channel_id = ? AND stat_date <= ? ORDER BY stat_date DESC LIMIT 7
      `).all(channelId, endDate).map((row) => ({ ...JSON.parse(row.metricsJson), date: row.date }))
      const previousDaily = this.db.prepare(`
        SELECT stat_date AS date, metrics_json AS metricsJson FROM digital_footprint_youtube_channel_daily
        WHERE channel_id = ? AND stat_date < ? ORDER BY stat_date DESC LIMIT 7
      `).all(channelId, recentDaily.at(-1)?.date || endDate).map((row) => JSON.parse(row.metricsJson))
      const engagementRate = (rows) => {
        const views = rows.reduce((total, row) => total + (row.views == null ? 0 : Number(row.views)), 0)
        const interactions = rows.reduce((total, row) => total
          + (row.likes == null ? 0 : Number(row.likes))
          + (row.comments == null ? 0 : Number(row.comments)), 0)
        const hasData = rows.some((row) => row.views != null && (row.likes != null || row.comments != null))
        return hasData && views > 0 ? interactions / views : null
      }
      const currentEngagement = engagementRate(recentDaily)
      const previousEngagement = engagementRate(previousDaily)
      if (currentEngagement != null && previousEngagement != null
        && Math.abs(currentEngagement - previousEngagement) >= 0.02
        && Math.abs(currentEngagement - previousEngagement) / Math.max(previousEngagement, 0.01) >= 0.5) {
        this.queueYoutubeNotification(
          'engagement-change',
          endDate,
          `Significant YouTube engagement change: ${(previousEngagement * 100).toFixed(1)}% to ${(currentEngagement * 100).toFixed(1)}% interaction rate between recent and previous 7-day periods.`,
        )
      }
    }
    const localDateTime = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
    }).formatToParts(new Date()).reduce((result, part) => {
      result[part.type] = part.value
      return result
    }, {})
    const today = `${localDateTime.year}-${localDateTime.month}-${localDateTime.day}`
    const currentHour = Number(localDateTime.hour)
    if (settings.dailyReportEnabled && currentHour >= settings.dailyReportHour) {
      const daily = this.db.prepare(`
        SELECT metrics_json AS metricsJson FROM digital_footprint_youtube_channel_daily
        WHERE channel_id = ? AND stat_date = (
          SELECT MAX(stat_date) FROM digital_footprint_youtube_channel_daily
          WHERE channel_id = ? AND stat_date <= ?
        ) LIMIT 1
      `).get(channelId, channelId, endDate)
      const channel = this.db.prepare(`
        SELECT channel_id AS channelId, title, statistics_json AS statisticsJson
        FROM digital_footprint_youtube_channel ORDER BY last_synced_at DESC LIMIT 1
      `).get()
      const metrics = daily ? JSON.parse(daily.metricsJson) : {}
      const top = this.db.prepare(`
        SELECT v.title, v.video_id AS videoId, d.metrics_json AS metricsJson
        FROM digital_footprint_youtube_video_daily d
        JOIN digital_footprint_youtube_videos v
          ON v.channel_id = d.channel_id AND v.video_id = d.video_id
        WHERE d.channel_id = ? AND d.stat_date = ?
        ORDER BY CAST(json_extract(d.metrics_json, '$.views') AS REAL) DESC LIMIT 3
      `).all(channelId, isoDate(new Date())).map((row) => ({
        ...row, metrics: JSON.parse(row.metricsJson),
      }))
      const stats = JSON.parse(channel?.statisticsJson || '{}')
      const topText = top.length
        ? top.map((video, index) => `${index + 1}. ${video.title} (${video.metrics.views ?? 'n/a'} views)\nhttps://www.youtube.com/watch?v=${encodeURIComponent(video.videoId)}`).join('\n')
        : 'No video performance rows are available yet.'
      const net = metrics.subscribersGained == null || metrics.subscribersLost == null
        ? 'unavailable' : metrics.subscribersGained - metrics.subscribersLost
      this.queueYoutubeNotification(
        'daily-report',
        today,
        `YouTube daily report (${endDate}) — ${channel?.title || 'channel'}\n`
          + `Total channel views: ${stats.viewCount ?? 'unavailable'}\n`
          + `Current subscribers: ${stats.subscriberCount ?? 'unavailable'}\n`
          + `Daily views: ${metrics.views ?? 'unavailable'}\n`
          + `Subscribers gained/lost/net: ${metrics.subscribersGained ?? 'unavailable'} / ${metrics.subscribersLost ?? 'unavailable'} / ${net}\n`
          + `Watch time: ${metrics.estimatedMinutesWatched == null ? 'unavailable' : `${(metrics.estimatedMinutesWatched / 60).toFixed(1)} hours`}\n`
          + `Top videos (last 28 days):\n${topText}`,
      )
    }
    const weekday = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[localDateTime.weekday]
    if (settings.weeklyReportEnabled && weekday === settings.weeklyReportDay && currentHour >= settings.weeklyReportHour) {
      const recentRows = this.db.prepare(`
        SELECT stat_date AS date, metrics_json AS metricsJson
        FROM digital_footprint_youtube_channel_daily WHERE channel_id = ? AND stat_date <= ?
        ORDER BY stat_date DESC LIMIT 7
      `).all(channelId, endDate).map((row) => ({ ...JSON.parse(row.metricsJson), date: row.date }))
      const priorRows = this.db.prepare(`
        SELECT stat_date AS date, metrics_json AS metricsJson
        FROM digital_footprint_youtube_channel_daily WHERE channel_id = ? AND stat_date < ?
        ORDER BY stat_date DESC LIMIT 7
      `).all(channelId, recentRows.at(-1)?.date || endDate).map((row) => JSON.parse(row.metricsJson))
      const sum = (rows, key) => {
        const values = rows.map((row) => row[key]).filter((value) => value != null)
        return values.length ? values.reduce((total, value) => total + Number(value), 0) : null
      }
      const views = sum(recentRows, 'views')
      const oldViews = sum(priorRows, 'views')
      const subscriberNet = (rows) => {
        const gained = sum(rows, 'subscribersGained')
        const lost = sum(rows, 'subscribersLost')
        return gained == null || lost == null ? null : gained - lost
      }
      const viewsChange = views == null || oldViews == null || oldViews === 0
        ? 'unavailable' : `${(((views - oldViews) / oldViews) * 100).toFixed(1)}%`
      const topVideo = this.db.prepare(`
        SELECT v.title, v.video_id AS videoId, d.metrics_json AS metricsJson
        FROM digital_footprint_youtube_video_daily d
        JOIN digital_footprint_youtube_videos v
          ON v.channel_id = d.channel_id AND v.video_id = d.video_id
        WHERE d.channel_id = ? AND d.stat_date = ?
        ORDER BY CAST(json_extract(d.metrics_json, '$.views') AS REAL) DESC LIMIT 3
      `).all(channelId, isoDate(new Date())).map((row) => `${row.title} (${JSON.parse(row.metricsJson).views ?? 'n/a'} views)`)
      const audience = this.db.prepare(`
        SELECT report_json AS reportJson FROM digital_footprint_youtube_reports
        WHERE channel_id = ? AND report_name IN ('traffic_sources', 'geography')
        ORDER BY fetched_at DESC LIMIT 2
      `).all(channelId).map((row) => JSON.parse(row.reportJson).rows || []).flat()
      const insights = audience.slice(0, 3).map((row) => `${row.insightTrafficSourceType || row.country}: ${row.views ?? 'n/a'} views`)
      this.queueYoutubeNotification(
        'weekly-report',
        today,
        `YouTube weekly report (${recentRows.at(-1)?.date || endDate} to ${recentRows[0]?.date || endDate})\n`
          + `Views: ${views ?? 'unavailable'} (${viewsChange} vs previous week)\n`
          + `Net subscriber growth: ${subscriberNet(recentRows) ?? 'unavailable'} (previous: ${subscriberNet(priorRows) ?? 'unavailable'})\n`
          + `Watch time: ${sum(recentRows, 'estimatedMinutesWatched') == null ? 'unavailable' : `${(sum(recentRows, 'estimatedMinutesWatched') / 60).toFixed(1)} hours`}\n`
          + `Top videos: ${topVideo.length ? topVideo.join('; ') : 'unavailable'}\n`
          + `Traffic/audience insights: ${insights.length ? insights.join('; ') : 'unavailable'}\n`
          + 'Summary generated from the channel metrics; no paid AI service was used.',
      )
    }
  }

  async syncYoutubeChannel() {
    const accessToken = await this.getYoutubeAccessToken()
    let channel = this.db.prepare(`
      SELECT channel_id AS channelId, title, published_at AS publishedAt,
        uploads_playlist_id AS uploadsPlaylistId
      FROM digital_footprint_youtube_channel ORDER BY last_synced_at DESC LIMIT 1
    `).get()
    if (!channel) {
      const discovery = await this.discoverYoutubeChannel(accessToken)
      if (discovery.status !== 'connected') return discovery
      channel = this.db.prepare(`
        SELECT channel_id AS channelId, title, published_at AS publishedAt,
          uploads_playlist_id AS uploadsPlaylistId
        FROM digital_footprint_youtube_channel ORDER BY last_synced_at DESC LIMIT 1
      `).get()
    }
    const freshChannel = await this.fetchYoutubeData('channels', {
      part: 'id,snippet,statistics,contentDetails',
      id: channel.channelId,
      maxResults: 50,
    }, accessToken)
    const current = freshChannel.items?.find((item) => String(item.id) === channel.channelId)
    if (!current) throw serviceError('The selected YouTube channel is no longer available to the connected Google account.', 403)
    this.saveYoutubeChannel(current)
    const videoSync = await this.syncYoutubeVideos(channel.channelId, current.contentDetails?.relatedPlaylists?.uploads, accessToken)
    let comments = { status: 'unavailable', added: 0 }
    try {
      comments = await this.syncYoutubeComments(channel.channelId, accessToken)
      this.saveYoutubeReport('comments', '', '', 'available', { availableMetrics: ['newComments'], rows: [{ newComments: comments.added }] }, '', channel.channelId)
    } catch (error) {
      const message = sanitizedError(error, { ...this.getOAuthConfig(), accessToken })
      this.saveYoutubeReport('comments', '', '', 'unavailable', { availableMetrics: [], rows: [] }, message, channel.channelId)
      this.onError(new Error(`YouTube comment sync unavailable: ${message}`))
    }
    const analytics = await this.syncYoutubeAnalyticsReports(channel.channelId, current.snippet?.publishedAt, accessToken)
    this.queueYoutubePerformanceAlerts(channel.channelId, analytics.endDate)
    const deliveredNotifications = await this.deliverYoutubeNotifications()
    const updated = this.db.prepare(`
      UPDATE digital_footprint_youtube_channel SET last_synced_at = ? WHERE channel_id = ?
    `).run(new Date().toISOString(), channel.channelId)
    void updated
    const legacy = {
      dateRange: { startDate: analytics.recentStart, endDate: analytics.endDate },
      views: numericValue(analytics.summary.rows[0]?.views),
      watchMinutes: numericValue(analytics.summary.rows[0]?.estimatedMinutesWatched),
      subscribersGained: numericValue(analytics.summary.rows[0]?.subscribersGained),
      audience: analytics.demographics.rows,
      fetchedAt: new Date().toISOString(),
    }
    this.db.prepare(`
      INSERT INTO digital_footprint_youtube_analytics(id, report_json, fetched_at)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET report_json = excluded.report_json, fetched_at = excluded.fetched_at
    `).run(JSON.stringify(legacy), legacy.fetchedAt)
    const reportErrors = [
      ['channel daily history', analytics.daily],
      ['channel summary', analytics.summary],
      ['video performance', analytics.video28],
    ].filter(([, report]) => report.status === 'unavailable')
      .map(([name, report]) => `${name}: ${report.error || 'unavailable'}`)
    return {
      status: reportErrors.length ? 'partial' : 'completed',
      channelId: channel.channelId,
      videosIndexed: videoSync.count,
      newVideos: videoSync.added,
      comments,
      reports: {
        daily: analytics.daily.status,
        videoPerformance: analytics.video28.status,
        geography: analytics.countries.status,
        demographics: analytics.demographics.status,
        devices: analytics.devices.status,
        trafficSources: analytics.traffic.status,
      },
      deliveredNotifications,
      errors: reportErrors,
      fetchedAt: legacy.fetchedAt,
    }
  }

  saveSettings(input = {}) {
    const current = this.getSettings()
    const githubUsername = Object.hasOwn(input, 'githubUsername')
      ? String(input.githubUsername || '').trim()
      : current.githubUsername
    const youtubeChannelId = Object.hasOwn(input, 'youtubeChannelId')
      ? String(input.youtubeChannelId || '').trim()
      : current.youtubeChannelId
    const enabled = Object.hasOwn(input, 'enabled') ? input.enabled : current.enabled
    if (typeof enabled !== 'boolean') throw Object.assign(new Error('Monitoring enabled must be true or false.'), { status: 400 })
    if (githubUsername && (!/^[A-Za-z0-9-]{1,39}$/.test(githubUsername) || githubUsername.startsWith('-') || githubUsername.endsWith('-'))) {
      throw Object.assign(new Error('Enter a valid GitHub username.'), { status: 400 })
    }
    if (youtubeChannelId && !/^UC[A-Za-z0-9_-]{20,}$/.test(youtubeChannelId)) {
      throw Object.assign(new Error('Enter a YouTube channel ID beginning with UC.'), { status: 400 })
    }
    const hasYoutubeOAuth = Boolean(this.db.prepare('SELECT 1 FROM digital_footprint_youtube_oauth WHERE id = 1').get())
    if (enabled && !githubUsername && !youtubeChannelId && !hasYoutubeOAuth) {
      throw Object.assign(new Error('Add a GitHub username or YouTube channel ID before enabling monitoring.'), { status: 400 })
    }
    const now = new Date().toISOString()
    const nextRunAt = enabled
      ? current.enabled && current.githubUsername === githubUsername && current.youtubeChannelId === youtubeChannelId
        ? current.nextRunAt || now
        : now
      : ''
    this.db.prepare(`
      UPDATE digital_footprint_settings
      SET enabled = ?, github_username = ?, youtube_channel_id = ?, next_run_at = ?, updated_at = ?
      WHERE id = 1
    `).run(enabled ? 1 : 0, githubUsername, youtubeChannelId, nextRunAt, now)
    return this.getSettings()
  }

  async fetchGitHub(username, token) {
    const headers = {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'AgentFlow-Digital-Footprint',
    }
    if (token) headers.authorization = `Bearer ${token}`
    const events = await fetchJson(
      this.fetchImpl,
      `https://api.github.com/users/${encodeURIComponent(username)}/events/public?per_page=10`,
      { headers },
      'GitHub',
    )
    if (!Array.isArray(events)) throw serviceError('GitHub API returned an unexpected activity response.')
    return events.map((event) => {
      const repo = String(event.repo?.name || '')
      const action = String(event.type || 'Activity').replace(/Event$/, '').replace(/([a-z])([A-Z])/g, '$1 $2')
      const commits = event.type === 'PushEvent' && Array.isArray(event.payload?.commits) ? event.payload.commits.length : 0
      return normalizeActivity('github', {
        externalId: event.id,
        title: `${action}${repo ? ` · ${repo}` : ''}`,
        summary: commits ? `${commits} commit${commits === 1 ? '' : 's'} pushed` : '',
        url: repo ? `https://github.com/${repo}` : `https://github.com/${encodeURIComponent(username)}`,
        publishedAt: event.created_at,
      })
    }).filter(Boolean)
  }

  async fetchYouTube(channelId, apiKey) {
    if (!apiKey) throw serviceError('Set YOUTUBE_API_KEY on the server to monitor the selected YouTube channel.', 400)
    const channelsUrl = new URL('https://www.googleapis.com/youtube/v3/channels')
    channelsUrl.searchParams.set('part', 'contentDetails')
    channelsUrl.searchParams.set('id', channelId)
    channelsUrl.searchParams.set('key', apiKey)
    const channelData = await fetchJson(this.fetchImpl, channelsUrl, {}, 'YouTube')
    const uploadsPlaylistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
    if (!uploadsPlaylistId) throw serviceError('YouTube could not find an uploads playlist for that channel ID.', 404)
    const playlistUrl = new URL('https://www.googleapis.com/youtube/v3/playlistItems')
    playlistUrl.searchParams.set('part', 'snippet,contentDetails')
    playlistUrl.searchParams.set('playlistId', uploadsPlaylistId)
    playlistUrl.searchParams.set('maxResults', '10')
    playlistUrl.searchParams.set('key', apiKey)
    const playlist = await fetchJson(this.fetchImpl, playlistUrl, {}, 'YouTube')
    if (!Array.isArray(playlist.items)) throw serviceError('YouTube API returned an unexpected uploads response.')
    return playlist.items.map((item) => {
      const videoId = String(item.contentDetails?.videoId || item.snippet?.resourceId?.videoId || '')
      return normalizeActivity('youtube', {
        externalId: videoId,
        title: item.snippet?.title,
        summary: item.snippet?.description,
        url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
        publishedAt: item.contentDetails?.videoPublishedAt || item.snippet?.publishedAt,
      })
    }).filter(Boolean)
  }

  saveActivities(source, activities) {
    const initialized = Boolean(this.db.prepare('SELECT 1 FROM digital_footprint_activity WHERE source = ? LIMIT 1').get(source))
    const now = new Date().toISOString()
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO digital_footprint_activity(
        source, external_id, title, summary, url, published_at, fetched_at, notified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    let added = 0
    for (const activity of activities) {
      const result = insert.run(
        source, activity.externalId, activity.title, activity.summary,
        activity.url, activity.publishedAt, now, initialized ? null : now,
      )
      added += Number(result.changes)
    }
    return added
  }

  async deliverPendingNotifications() {
    const items = this.db.prepare(`
      SELECT id, source, title, url
      FROM digital_footprint_activity
      WHERE notified_at IS NULL
      ORDER BY published_at DESC, id DESC LIMIT 8
    `).all()
    if (!items.length) return 0
    const message = [
      'Digital Footprint Intelligence found new activity:',
      ...items.map((item) => `• ${item.source === 'github' ? 'GitHub' : 'YouTube'}: ${item.title}\n${item.url}`),
    ].join('\n')
    if (!await this.notify({ message, items })) return 0
    const update = this.db.prepare('UPDATE digital_footprint_activity SET notified_at = ? WHERE id = ?')
    const deliveredAt = new Date().toISOString()
    for (const item of items) update.run(deliveredAt, item.id)
    return items.length
  }

  async run(trigger = 'manual') {
    if (this.running) return { status: 'overlap-skipped' }
    const settings = this.getSettings()
    const youtubeSettings = this.getYoutubeMonitoringSettings()
    if (!settings.enabled && !youtubeSettings.enabled) {
      return { status: 'disabled', githubCount: 0, youtubeCount: 0, notificationsSent: 0 }
    }
    this.running = true
    const startedAt = new Date().toISOString()
    const runId = Number(this.db.prepare(`
      INSERT INTO digital_footprint_runs(trigger, status, started_at) VALUES (?, 'running', ?)
    `).run(String(trigger).slice(0, 40), startedAt).lastInsertRowid)
    if (settings.enabled) {
      this.db.prepare('UPDATE digital_footprint_settings SET next_run_at = ?, updated_at = ? WHERE id = 1')
        .run(new Date(Date.now() + POLL_INTERVAL_MINUTES * 60000).toISOString(), startedAt)
    }
    const youtubeDue = !youtubeSettings.nextRunAt || Date.parse(youtubeSettings.nextRunAt) <= Date.now()
    const shouldSyncYoutubeAnalytics = youtubeSettings.enabled && (trigger === 'manual' || youtubeDue)
      || (settings.enabled && settings.youtubeChannelId
        && Boolean(this.db.prepare('SELECT 1 FROM digital_footprint_youtube_oauth WHERE id = 1').get()))
    if (youtubeSettings.enabled && shouldSyncYoutubeAnalytics) {
      this.db.prepare('UPDATE digital_footprint_youtube_monitoring SET next_run_at = ? WHERE id = 1')
        .run(new Date(Date.now() + YOUTUBE_SYNC_INTERVAL_MINUTES * 60000).toISOString())
    }
    let githubCount = 0
    let youtubeCount = 0
    let notificationsSent = 0
    const errors = []
    let successfulSources = 0
    let credentials = {}
    try {
      try {
        credentials = await this.getCredentials()
      } catch (error) {
        errors.push(`Could not read server credentials: ${sanitizedError(error)}`)
      }
      if (settings.enabled && settings.githubUsername) {
        try {
          githubCount = this.saveActivities('github', await this.fetchGitHub(settings.githubUsername, credentials.GITHUB_TOKEN || ''))
          successfulSources++
        } catch (error) {
          errors.push(sanitizedError(error, credentials))
        }
      }
      const youtubeOAuthConnected = Boolean(this.db.prepare('SELECT 1 FROM digital_footprint_youtube_oauth WHERE id = 1').get())
      const authorizedChannelId = this.db.prepare(`
        SELECT channel_id AS channelId FROM digital_footprint_youtube_channel
        ORDER BY last_synced_at DESC LIMIT 1
      `).get()?.channelId || ''
      const youtubeChannelId = settings.youtubeChannelId || (youtubeSettings.enabled ? authorizedChannelId : '')
      const shouldFetchPublicYoutube = (settings.enabled && settings.youtubeChannelId)
        || (youtubeSettings.enabled && credentials.YOUTUBE_API_KEY)
      if (shouldFetchPublicYoutube && youtubeChannelId) {
        try {
          youtubeCount = this.saveActivities('youtube', await this.fetchYouTube(youtubeChannelId, credentials.YOUTUBE_API_KEY || ''))
          successfulSources++
        } catch (error) {
          errors.push(sanitizedError(error, credentials))
        }
      }
      const shouldSyncAnalytics = shouldSyncYoutubeAnalytics && youtubeOAuthConnected
      if (shouldSyncAnalytics) {
        try {
          const youtubeSync = await this.syncYoutubeChannel()
          if (youtubeSync.status === 'completed') {
            successfulSources++
            notificationsSent += Number(youtubeSync.deliveredNotifications || 0)
          } else if (youtubeSync.status !== 'channel-selection-required') {
            successfulSources++
            errors.push(...(youtubeSync.errors?.length ? youtubeSync.errors : ['YouTube Analytics synchronization did not complete.']))
            notificationsSent += Number(youtubeSync.deliveredNotifications || 0)
          }
        } catch (error) {
          errors.push(sanitizedError(error, credentials))
        }
      }
      if (settings.enabled) {
        try {
          notificationsSent += await this.deliverPendingNotifications()
        } catch (error) {
          errors.push(`Telegram notification failed: ${sanitizedError(error, credentials)}`)
        }
      }
      const status = errors.length
        ? successfulSources ? 'partial' : 'failed'
        : 'completed'
      const completedAt = new Date().toISOString()
      this.db.prepare(`
        UPDATE digital_footprint_runs
        SET status = ?, completed_at = ?, github_count = ?, youtube_count = ?,
          notifications_sent = ?, error = ?
        WHERE id = ?
      `).run(status, completedAt, githubCount, youtubeCount, notificationsSent, errors.join('\n').slice(0, 1500), runId)
      if (errors.length) this.onError(new Error(errors.join('; ')))
      return { id: runId, status, githubCount, youtubeCount, notificationsSent, errors }
    } finally {
      this.running = false
    }
  }

  async tick() {
    const settings = this.getSettings()
    const youtubeSettings = this.getYoutubeMonitoringSettings()
    const globalDue = settings.enabled && settings.nextRunAt && Date.parse(settings.nextRunAt) <= Date.now()
    const youtubeDue = youtubeSettings.enabled && (!youtubeSettings.nextRunAt || Date.parse(youtubeSettings.nextRunAt) <= Date.now())
    if (!globalDue && !youtubeDue) return { status: 'not-due' }
    return this.run('schedule')
  }

  start() {
    if (this.timer) return
    this.timer = setInterval(() => {
      this.tick().catch((error) => this.onError(error))
    }, 60000)
    this.timer.unref?.()
    this.tick().catch((error) => this.onError(error))
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
