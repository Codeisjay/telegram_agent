import { createHash } from 'node:crypto'

export const DEFAULT_NEWS_CATEGORIES = [
  'AI/ML',
  'Generative AI',
  'Software engineering',
  'Technology',
  'Indian startups',
  'Fresher jobs',
  'Internships',
  'Engineering innovations',
]

function normalizeCategoryValue(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 60)
}

export function normalizeNewsSettings(input = {}, current = {}) {
  const requestedCategories = Array.isArray(input.categories)
    ? input.categories
    : Array.isArray(current.categories)
      ? current.categories
      : DEFAULT_NEWS_CATEGORIES
  const uniqueCategories = new Map()
  for (const value of requestedCategories) {
    const category = normalizeCategoryValue(value)
    if (category && !uniqueCategories.has(category.toLowerCase())) uniqueCategories.set(category.toLowerCase(), category)
  }
  const categories = [...uniqueCategories.values()].slice(0, 15)
  if (!categories.length) categories.push(...(Array.isArray(current.categories) && current.categories.length
    ? current.categories.map(normalizeCategoryValue).filter(Boolean).slice(0, 15)
    : DEFAULT_NEWS_CATEGORIES))
  const enabled = typeof input.enabled === 'boolean' ? input.enabled : Boolean(current.enabled)
  const intervalHours = Number.isInteger(input.intervalHours)
    ? Math.min(24, Math.max(1, input.intervalHours))
    : Number.isInteger(current.intervalHours)
      ? Math.min(24, Math.max(1, current.intervalHours))
      : 3
  const quietStart = typeof input.quietStart === 'string' && /^\d{2}:\d{2}$/.test(input.quietStart)
    ? input.quietStart
    : typeof current.quietStart === 'string' && /^\d{2}:\d{2}$/.test(current.quietStart)
      ? current.quietStart
      : '23:00'
  const quietEnd = typeof input.quietEnd === 'string' && /^\d{2}:\d{2}$/.test(input.quietEnd)
    ? input.quietEnd
    : typeof current.quietEnd === 'string' && /^\d{2}:\d{2}$/.test(current.quietEnd)
      ? current.quietEnd
      : '07:00'
  const maxNotificationsPerDay = Number.isInteger(input.maxNotificationsPerDay)
    ? Math.min(10, Math.max(1, input.maxNotificationsPerDay))
    : Number.isInteger(current.maxNotificationsPerDay)
      ? Math.min(10, Math.max(1, current.maxNotificationsPerDay))
      : 4
  return {
    enabled,
    intervalHours,
    categories: categories.slice(0, 15),
    quietStart,
    quietEnd,
    maxNotificationsPerDay,
    nextRunAt: typeof current.nextRunAt === 'string' ? current.nextRunAt : '',
    updatedAt: typeof current.updatedAt === 'string' ? current.updatedAt : new Date().toISOString(),
  }
}

export function buildNewsSearchQuery(categories = DEFAULT_NEWS_CATEGORIES) {
  const selected = categories.length ? categories : DEFAULT_NEWS_CATEGORIES
  const terms = selected
    .map((category) => normalizeCategoryValue(category))
    .filter(Boolean)
    .slice(0, 15)
  if (!terms.length) return 'latest AI ML startup engineering news in India'
  return `latest ${terms.join(' OR ')} news in India and globally recent reliable sources`
}

export function deduplicateNewsResults(items = []) {
  const seen = new Set()
  const output = []
  for (const item of Array.isArray(items) ? items : []) {
    const title = typeof item?.title === 'string' ? item.title.trim() : ''
    const url = typeof item?.url === 'string' ? item.url.trim() : ''
    const content = typeof item?.content === 'string' ? item.content.trim() : ''
    if (!title && !url && !content) continue
    const key = (url || title || content).toLowerCase().replace(/^https?:\/\//, '').replace(/[?#].*$/, '').replace(/\/$/, '')
    if (!key || seen.has(key)) continue
    seen.add(key)
    output.push({
      title,
      url,
      content,
      source: typeof item?.source === 'string' ? item.source.trim() : '',
      publishedAt: typeof item?.publishedAt === 'string' ? item.publishedAt : '',
    })
  }
  return output
}

export function matchNewsCategory(articleText, categories = DEFAULT_NEWS_CATEGORIES) {
  const input = (articleText || '').toLowerCase()
  if (!input) return false
  const keywords = categories
    .map((category) => normalizeCategoryValue(category).toLowerCase())
    .filter(Boolean)
  if (!keywords.length) return false
  const matches = keywords.some((category) => {
    const exact = category.replace(/\//g, ' ')
    const pieces = exact.split(/\s+/).filter(Boolean)
    if (!pieces.length) return false
    if (input.includes(category)) return true
    if (pieces.length > 1) {
      return pieces.every((piece) => input.includes(piece))
    }
    return input.includes(pieces[0])
  })
  return matches
}

export function formatNewsArticles(articles = [], categories = DEFAULT_NEWS_CATEGORIES) {
  return articles.filter((article) => categories.some((category) => (
    matchNewsCategory(`${article.title || ''}\n${article.content || ''}`, [category])
  ))).slice(0, 4).map((article) => {
    const text = `${article.title || ''}\n${article.content || ''}`
    const matchedCategories = categories.filter((category) => matchNewsCategory(text, [category]))
    return {
      title: String(article.title || 'Recent news update').trim().slice(0, 200),
      summary: String(article.content || 'Open the source for details.').trim().slice(0, 450),
      whyItMatters: `Matches your monitored topic${matchedCategories.length === 1 ? '' : 's'}: ${matchedCategories.join(', ') || 'your interests'}.`,
      sourceUrl: String(article.url || '').trim(),
      source: String(article.source || '').trim(),
      categories: matchedCategories,
    }
  })
}

export function isQuietHours(date = new Date(), quietStart = '23:00', quietEnd = '07:00', timeZone = 'Asia/Kolkata') {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = formatter.formatToParts(date)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0)
  const nowMinutes = hour * 60 + minute
  const [startHour, startMinute] = quietStart.split(':').map(Number)
  const [endHour, endMinute] = quietEnd.split(':').map(Number)
  const start = startHour * 60 + startMinute
  const end = endHour * 60 + endMinute
  if (start === end) return true
  if (start < end) return nowMinutes >= start && nowMinutes < end
  return nowMinutes >= start || nowMinutes < end
}

export async function withRateLimitRetry(operation, { retries = 3, baseDelayMs = 1000, statusCodes = [429, 500, 502, 503, 504] } = {}) {
  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      const status = Number(error?.status || error?.cause?.status || 0)
      const failedForRetry = statusCodes.includes(status) || /429|rate limit|timed out|timeout/i.test(String(error?.message || ''))
      if (attempt >= retries || !failedForRetry) throw error
      const delayMs = baseDelayMs * (2 ** attempt)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  throw lastError
}

export function makeNewsDigestHash(article) {
  const raw = (article?.url || article?.title || '').trim().toLowerCase()
  return createHash('sha256').update(raw).digest('hex')
}

export class NewsScheduler {
  constructor({ database, run, onError = () => {}, intervalMs = 30000 }) {
    this.database = database
    this.run = run
    this.onError = onError
    this.intervalMs = intervalMs
    this.started = false
    this.running = false
    this.timer = null
  }

  async start() {
    if (this.started) return
    this.started = true
    const settings = this.database.getNewsSettings()
    if (!settings.nextRunAt) {
      this.database.setNewsNextRun(new Date(Date.now() + settings.intervalHours * 60 * 60 * 1000).toISOString())
    }
    await this.tick(true)
    this.timer = setInterval(() => {
      this.tick().catch((error) => this.onError(error))
    }, this.intervalMs)
    this.timer.unref?.()
  }

  async tick(recoverMissed = false, now = new Date()) {
    const settings = this.database.getNewsSettings()
    if (!settings.enabled) return { status: 'disabled' }
    if (this.running) return { status: 'overlap-skipped' }
    const nextRunTime = settings.nextRunAt ? new Date(settings.nextRunAt).getTime() : Number.POSITIVE_INFINITY
    if (nextRunTime > now.getTime()) return { status: 'not-due' }
    this.running = true
    try {
      const next = new Date(now.getTime() + settings.intervalHours * 60 * 60 * 1000)
      this.database.setNewsNextRun(next.toISOString())
      const result = await this.run(recoverMissed ? 'news-recovery' : 'news-schedule')
      return result
    } finally {
      this.running = false
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.started = false
  }
}
