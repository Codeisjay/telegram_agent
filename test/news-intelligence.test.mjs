import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { JobDatabase } from '../job-intelligence.mjs'
import { buildNewsSearchQuery, matchNewsCategory, NewsScheduler, deduplicateNewsResults, isQuietHours, normalizeNewsSettings, withRateLimitRetry } from '../news-intelligence.mjs'

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
