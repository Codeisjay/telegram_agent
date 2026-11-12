import { createHash } from 'node:crypto'

export const DEFAULT_NEWS_CATEGORIES = [
  'Artificial Intelligence and Generative AI',
  'Machine Learning and Deep Learning',
  'AI Agents and LLMs',
  'Python, C++ and Software Engineering',
  'Browser Engineering',
  'Technology breakthroughs',
  'Indian startups',
  'Fresher jobs',
  'Internships',
  'Engineering innovations',
]

const PRIORITY_WEIGHT = { high: 3, medium: 2, low: 1 }
const MAX_INTERESTS = 25

function normalizeInterest(value, index) {
  const topic = String(typeof value === 'string' ? value : value?.topic || '').trim().replace(/\s+/g, ' ').slice(0, 80)
  if (!topic) return null
  const requestedPriority = typeof value === 'object' && value ? value.priority : 'medium'
  const priority = ['high', 'medium', 'low'].includes(requestedPriority) ? requestedPriority : 'medium'
  return {
    topic,
    enabled: typeof value === 'object' && value ? value.enabled !== false : true,
    priority,
    order: Number.isInteger(value?.order) && value.order >= 0 ? value.order : index,
  }
}

export function normalizeNewsInterests(input, current = []) {
  let source = Array.isArray(input)
    ? input
    : Array.isArray(current) && current.length
      ? current
      : DEFAULT_NEWS_CATEGORIES
  if (!source.length && Array.isArray(current) && current.length) source = current
  const unique = new Map()
  source.forEach((value, index) => {
    const interest = normalizeInterest(value, index)
    if (interest && !unique.has(interest.topic.toLowerCase())) unique.set(interest.topic.toLowerCase(), interest)
  })
  return [...unique.values()].slice(0, MAX_INTERESTS).map((interest, order) => ({ ...interest, order }))
}

export function normalizeNewsSettings(input = {}, current = {}) {
  const currentInterests = normalizeNewsInterests(current.interests, current.categories)
  const categoriesChanged = Array.isArray(input.categories)
    && JSON.stringify(input.categories) !== JSON.stringify(current.categories || [])
  const interestsChanged = Array.isArray(input.interests)
    && JSON.stringify(input.interests) !== JSON.stringify(current.interests || [])
  const requestedInterests = Array.isArray(input.interests) && !(categoriesChanged && !interestsChanged)
    ? input.interests
    : Array.isArray(input.categories)
      ? input.categories
      : currentInterests
  const interests = normalizeNewsInterests(requestedInterests, currentInterests)
  const enabledInterests = interests.filter((interest) => interest.enabled)
  const enabled = typeof input.enabled === 'boolean' ? input.enabled : Boolean(current.enabled)
  const intervalHours = Number.isInteger(input.intervalHours)
    ? Math.min(24, Math.max(1, input.intervalHours))
    : Number.isInteger(current.intervalHours)
      ? Math.min(24, Math.max(1, current.intervalHours))
      : 3
  const timeValue = (inputValue, currentValue, fallback) => (
    typeof inputValue === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(inputValue)
      ? inputValue
      : typeof currentValue === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(currentValue)
        ? currentValue
        : fallback
  )
  const boundedInteger = (inputValue, currentValue, fallback, min, max) => (
    Number.isInteger(inputValue) ? Math.min(max, Math.max(min, inputValue))
      : Number.isInteger(currentValue) ? Math.min(max, Math.max(min, currentValue)) : fallback
  )
  const currentNextRunAt = typeof current.nextRunAt === 'string' ? current.nextRunAt : ''
  const changedInterval = intervalHours !== current.intervalHours
  const changedEnablement = enabled && current.enabled === false
  const nextRunAt = typeof input.nextRunAt === 'string'
    ? input.nextRunAt
    : !enabled
      ? ''
      : !currentNextRunAt || changedInterval || changedEnablement
        ? new Date(Date.now() + intervalHours * 60 * 60 * 1000).toISOString()
        : currentNextRunAt
  return {
    enabled,
    intervalHours,
    interests,
    categories: enabledInterests.map((interest) => interest.topic),
    quietStart: timeValue(input.quietStart, current.quietStart, '23:00'),
    quietEnd: timeValue(input.quietEnd, current.quietEnd, '07:00'),
    maxNotificationsPerDay: boundedInteger(input.maxNotificationsPerDay, current.maxNotificationsPerDay, 4, 1, 20),
    maxArticlesPerNotification: boundedInteger(input.maxArticlesPerNotification, current.maxArticlesPerNotification, 4, 1, 10),
    inputTokenBudget: boundedInteger(input.inputTokenBudget, current.inputTokenBudget, 6000, 1000, 12000),
    outputTokenBudget: boundedInteger(input.outputTokenBudget, current.outputTokenBudget, 1200, 200, 3000),
    telegramChatId: typeof input.telegramChatId === 'string'
      && (input.telegramChatId === '' || /^-?\d{1,20}$/.test(input.telegramChatId))
      ? input.telegramChatId
      : typeof current.telegramChatId === 'string' ? current.telegramChatId : '',
    nextRunAt,
    lastSuccessfulAt: typeof current.lastSuccessfulAt === 'string' ? current.lastSuccessfulAt : '',
    groqCooldownUntil: typeof current.groqCooldownUntil === 'string' ? current.groqCooldownUntil : '',
    updatedAt: typeof current.updatedAt === 'string' ? current.updatedAt : new Date().toISOString(),
  }
}

export function buildNewsSearchQueries(interests = []) {
  const active = normalizeNewsInterests(interests).filter((interest) => interest.enabled)
  if (!active.length) return []
  const groups = [
    { name: 'AI and machine learning', matches: /artificial intelligence|generative ai|\bai\b|machine learning|deep learning|llm|agent/i },
    { name: 'software and browser engineering', matches: /python|c\+\+|software|browser|engineering|developer/i },
    { name: 'startups and careers', matches: /startup|job|intern|company|hiring|career/i },
  ]
  const buckets = new Map(groups.map((group) => [group.name, []]))
  const other = []
  for (const interest of active) {
    const group = groups.find((candidate) => candidate.matches.test(interest.topic))
    if (group) buckets.get(group.name).push(interest)
    else other.push(interest)
  }
  for (const interest of other) {
    const leastPopulated = [...buckets.entries()].sort((left, right) => left[1].length - right[1].length)[0]
    buckets.get(leastPopulated[0]).push(interest)
  }
  const orderedBuckets = [...buckets.entries()]
    .map(([name, values]) => ({ name, interests: values }))
    .filter((entry) => entry.interests.length)
    .sort((left, right) => {
      const priority = (items) => Math.max(...items.map((item) => PRIORITY_WEIGHT[item.priority]))
      return priority(right.interests) - priority(left.interests)
    })
  return orderedBuckets.map(({ name, interests: topics }) => {
    const selected = topics
      .sort((left, right) => PRIORITY_WEIGHT[right.priority] - PRIORITY_WEIGHT[left.priority] || left.order - right.order)
      .map((interest) => `"${interest.topic}"`)
    return {
      label: name,
      query: `latest ${selected.join(' OR ')} news`,
      interests: topics.map((interest) => interest.topic),
    }
  })
}

export function rankNewsArticles(articles = [], interests = [], now = new Date()) {
  const enabled = normalizeNewsInterests(interests).filter((interest) => interest.enabled)
  const deduplicated = deduplicateNewsResults(articles)
  return deduplicated.map((article) => {
    const text = `${article.title}\n${article.content}`
    const matched = enabled.filter((interest) => matchNewsCategory(text, [interest.topic]))
    const publishedTime = Date.parse(article.publishedAt)
    const ageHours = Number.isFinite(publishedTime) ? Math.max(0, (now.getTime() - publishedTime) / 3600000) : 72
    let hostname = ''
    try { hostname = new URL(article.url).hostname.toLowerCase() } catch {}
    const reliableSource = /(^|\.)((reuters|apnews|bbc|theguardian|nytimes|wsj|ft|techcrunch|economictimes|hindustantimes|thehindu|indianexpress|yourstory|moneycontrol|arstechnica|wired|nature|science)\.com|gov|edu)$/.test(hostname)
    const priority = matched.reduce((sum, interest) => sum + PRIORITY_WEIGHT[interest.priority], 0)
    const recency = ageHours <= 24 ? 3 : ageHours <= 72 ? 2 : ageHours <= 168 ? 1 : 0
    return {
      ...article,
      matchedInterests: matched.map((interest) => interest.topic),
      relevanceScore: priority + recency + (reliableSource ? 2 : 0),
      ageHours,
      reliableSource,
    }
  }).filter((article) => article.matchedInterests.length && article.ageHours <= 168)
    .sort((left, right) => right.relevanceScore - left.relevanceScore
      || left.ageHours - right.ageHours
      || left.title.localeCompare(right.title))
}

export function startOfDayInTimeZone(date = new Date(), timeZone = 'Asia/Kolkata') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const part = (type) => parts.find((entry) => entry.type === type)?.value
  const dateString = `${part('year')}-${part('month')}-${part('day')}`
  const offset = timeZone === 'Asia/Kolkata' ? '+05:30' : 'Z'
  return new Date(`${dateString}T00:00:00${offset}`)
}

export function buildNewsSearchQuery(categories = DEFAULT_NEWS_CATEGORIES) {
  const selected = categories.length ? categories : DEFAULT_NEWS_CATEGORIES
  const terms = selected
    .map((category) => normalizeInterest(category, 0)?.topic || '')
    .filter(Boolean)
    .slice(0, 15)
  if (!terms.length) return 'latest AI ML startup engineering news in India'
  return `latest ${terms.join(' OR ')} news in India and globally recent reliable sources`
}

function normalizeCategoryValue(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 60)
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
  const isMatch = (value) => {
    const category = normalizeCategoryValue(value).toLowerCase()
    if (!category) return false
    if (/artificial intelligence|generative ai/.test(category)) {
      return /artificial intelligence|generative ai|genai|large language model|\bllm\b|\bllms\b|\bai\b/.test(input)
    }
    if (/^ai\/ml$/.test(category)) return /artificial intelligence|machine learning|deep learning|\bai\b|\bml\b/.test(input)
    if (/machine learning|deep learning/.test(category)) {
      return /machine learning|deep learning|\bml\b|\bdl\b|neural network/.test(input)
    }
    if (/ai agents|llms/.test(category)) {
      return /ai agent|agentic ai|large language model|\bllm\b|\bllms\b/.test(input)
    }
    if (/python.*c\+\+.*software/.test(category)) {
      return /\bpython\b|c\+\+|software engineering|software development/.test(input)
    }
    if (/browser engineering/.test(category)) {
      return /\bbrowser\b|chromium|webkit|firefox|browser engine|rendering engine/.test(input)
    }
    if (/technology breakthroughs/.test(category)) {
      return /technology breakthrough|tech breakthrough|technology innovation|new technology|scientific breakthrough/.test(input)
    }
    if (/indian startups/.test(category)) {
      return /indian startup|startups? in india|startup.*india/.test(input)
    }
    if (/fresher jobs/.test(category)) {
      return /fresher|entry.level|graduate role|new.grad|campus hiring/.test(input)
    }
    if (/internships/.test(category)) return /intern(ship)?/.test(input)
    const terms = category.replace(/[,/]/g, ' ').split(/\s+/)
      .filter((term) => term && !['and', 'or', 'the', 'for', 'in', 'of', 'to'].includes(term))
    const matched = terms.filter((term) => term.length <= 3
      ? new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(input)
      : input.includes(term))
    return matched.length >= (terms.length > 2 ? 2 : terms.length)
  }
  return categories.some(isMatch)
}

export function formatNewsArticles(articles = [], categories = DEFAULT_NEWS_CATEGORIES) {
  return articles.slice(0, 4).map((article) => {
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
    const interruptedRuns = this.database.recoverInterruptedNewsRuns()
    if (interruptedRuns > 0) this.database.setNewsNextRun(new Date().toISOString())
    const settings = this.database.getNewsSettings()
    if (settings.enabled && !settings.nextRunAt) {
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
