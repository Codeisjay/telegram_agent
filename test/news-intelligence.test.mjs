import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { JobDatabase } from '../job-intelligence.mjs'
import {
  buildNewsSearchQuery, buildNewsSearchQueries, matchNewsCategory, NewsScheduler,
  deduplicateNewsResults, isQuietHours, normalizeNewsInterests, normalizeNewsSettings,
  rankNewsArticles, startOfDayInTimeZone, withRateLimitRetry,
} from '../news-intelligence.mjs'

test('scheduler respects the configured interval and next run time', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'agentflow-news-scheduler-'))
  const db = await JobDatabase.open(path.join(tempRoot, 'news.sqlite'))
  try {
    db.saveNewsSettings({ enabled: true, intervalHours: 3, nextRunAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() })
    const scheduler = new NewsScheduler({
      database: db,
      run: async () => ({ status: 'completed', delivered: 0 }),
      intervalMs: 250,
    })
    const notDue = await scheduler.tick(false, new Date())
    assert.equal(notDue.status, 'not-due')

    db.saveNewsSettings({ enabled: true, intervalHours: 3, nextRunAt: new Date(Date.now() - 1000).toISOString() })
    const due = await scheduler.tick(false, new Date())
    assert.equal(due.status, 'completed')
  } finally {
    db.close()
  }
})

test('deduplicates repeated news sources before summarization', () => {
  const entries = deduplicateNewsResults([
    { title: 'AI Labs launch new model', url: 'https://example.com/ai', content: 'First report.' },
    { title: 'AI Labs launch new model', url: 'https://example.com/ai', content: 'First report.' },
    { title: 'Another story', url: 'https://example.com/other', content: 'Second story.' },
  ])
  assert.equal(entries.length, 2)
  assert.equal(entries[0].url, 'https://example.com/ai')
})

test('custom topics are normalized, included in search, and exclusively drive relevance matching', () => {
  const settings = normalizeNewsSettings({
    categories: [' crime ', 'Politics', 'crime', ''],
  })
  assert.deepEqual(settings.categories, ['crime', 'Politics'])
  assert.match(buildNewsSearchQuery([
    'AI/ML', 'Generative AI', 'Software engineering', 'Technology',
    'Indian startups', 'Fresher jobs', 'Internships', 'Engineering innovations',
    'Crime', 'Politics',
  ]), /Crime OR Politics/)
  assert.equal(matchNewsCategory('Police investigate a major city crime.', settings.categories), true)
  assert.equal(matchNewsCategory('A startup launches a new AI model.', settings.categories), false)
  assert.equal(matchNewsCategory('A startup launches a new AI model.', []), false)
})

test('news searches combine every enabled interest and rank fresh high-priority coverage', () => {
  const interests = normalizeNewsInterests([
    { topic: 'Generative AI', enabled: true, priority: 'high' },
    { topic: 'Browser Engineering', enabled: true, priority: 'medium' },
    { topic: 'Closed topic', enabled: false, priority: 'high' },
    { topic: 'Clean energy', enabled: true, priority: 'low' },
  ])
  const queries = buildNewsSearchQueries(interests)
  assert.ok(queries.length <= 3)
  for (const interest of interests.filter((item) => item.enabled)) {
    assert.ok(queries.some((query) => query.query.includes(`"${interest.topic}"`)))
  }
  assert.equal(queries.some((query) => query.query.includes('Closed topic')), false)
  assert.equal(queries[0].query.includes('"Generative AI"'), true)

  const ranked = rankNewsArticles([
    {
      title: 'Generative AI research update',
      url: 'https://reuters.com/technology/ai-update',
      content: 'New model research was published.',
      publishedAt: '2026-11-12T10:00:00.000Z',
    },
    {
      title: 'Generative AI old report',
      url: 'https://example.com/old-report',
      content: 'A prior update.',
      publishedAt: '2026-10-01T10:00:00.000Z',
    },
  ], interests, new Date('2026-11-12T11:00:00.000Z'))
  assert.equal(ranked.length, 1)
  assert.deepEqual(ranked[0].matchedInterests, ['Generative AI'])
  assert.equal(startOfDayInTimeZone(new Date('2026-11-12T12:00:00.000Z')).toISOString(), '2026-11-11T18:30:00.000Z')
})

test('Groq rate-limit retries recover with bounded backoff', async () => {
  let attempts = 0
  const result = await withRateLimitRetry(async () => {
    attempts += 1
    if (attempts < 3) {
      const error = new Error('rate limit')
      error.status = 429
      throw error
    }
    return 'success'
  }, { retries: 3, baseDelayMs: 1 })
  assert.equal(result, 'success')
  assert.equal(attempts, 3)
})

test('quiet hours and duplicate notification keys stop duplicate Telegram sends', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'agentflow-news-delivery-'))
  const db = await JobDatabase.open(path.join(tempRoot, 'delivered.sqlite'))
  try {
    db.saveNewsSettings({ enabled: true, quietStart: '23:00', quietEnd: '07:00', maxNotificationsPerDay: 4 })
    const stored = db.upsertNewsArticle({
      title: 'India startup funding hits record highs',
      url: 'https://example.com/startup-record',
      summary: 'Startup funding remains strong.',
      whyItMatters: 'It affects hiring in Indian startups.',
      categories: ['Indian startups'],
    })
    assert.equal(isQuietHours(new Date('2026-10-10T23:30:00Z'), '23:00', '07:00', 'UTC'), true)
    const first = db.recordNewsNotification(stored.id, 'telegram:test-1')
    const second = db.recordNewsNotification(stored.id, 'telegram:test-1')
    assert.equal(first, true)
    assert.equal(second, false)
    assert.equal(db.hasNewsNotification(stored.id, 'telegram:test-1'), true)
  } finally {
    db.close()
  }
})
