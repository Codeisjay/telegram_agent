import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { JobDatabase } from '../job-intelligence.mjs'
import { DigitalFootprintIntelligence } from '../digital-footprint.mjs'

test('digital footprint stores public GitHub and YouTube activity separately and deduplicates notifications', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'agentflow-digital-footprint-'))
  const database = await JobDatabase.open(path.join(directory, 'test.sqlite'))
  const requests = []
  const notifications = []
  let githubEvents = [{
    id: 'github-1',
    type: 'PushEvent',
    repo: { name: 'octocat/hello-world' },
    payload: { commits: [{ sha: 'abc' }] },
    created_at: '2026-11-12T10:00:00Z',
  }]
  const fetchImpl = async (input) => {
    const url = new URL(input)
    requests.push(url)
    if (url.hostname === 'api.github.com') return Response.json(githubEvents)
    if (url.pathname.endsWith('/channels')) {
      return Response.json({ items: [{ contentDetails: { relatedPlaylists: { uploads: 'uploads-1' } } }] })
    }
    return Response.json({
      items: [{
        contentDetails: { videoId: 'video-1', videoPublishedAt: '2026-11-12T11:00:00Z' },
        snippet: { title: 'A new upload', description: 'Video description' },
      }],
    })
  }
  const footprint = new DigitalFootprintIntelligence({
    database,
    fetchImpl,
    getCredentials: () => ({ YOUTUBE_API_KEY: 'server-side-test-key' }),
    notify: async ({ message }) => { notifications.push(message); return true },
  })

  assert.throws(() => footprint.saveSettings({ enabled: true }), /Add a GitHub username or YouTube channel ID/)
  footprint.saveSettings({ enabled: true, githubUsername: 'octocat', youtubeChannelId: 'UC1234567890123456789012' })
  const first = await footprint.run('test')
  assert.equal(first.status, 'completed')
  assert.equal(first.githubCount, 1)
  assert.equal(first.youtubeCount, 1)
  assert.equal(first.notificationsSent, 0)
  assert.equal(notifications.length, 0)
  assert.equal(requests.some((url) => url.hostname === 'api.github.com'), true)
  assert.equal(requests.some((url) => url.hostname === 'www.googleapis.com' && url.searchParams.get('key') === 'server-side-test-key'), true)

  const second = await footprint.run('test')
  assert.equal(second.githubCount, 0)
  assert.equal(second.youtubeCount, 0)
  assert.equal(second.notificationsSent, 0)
  assert.equal(notifications.length, 0)

  githubEvents = [...githubEvents, {
    id: 'github-2',
    type: 'WatchEvent',
    repo: { name: 'octocat/another-repo' },
    created_at: '2026-11-13T10:00:00Z',
  }]
  const third = await footprint.run('test')
  assert.equal(third.githubCount, 1)
  assert.equal(third.notificationsSent, 1)
  const state = footprint.getState()
  assert.equal(state.activities.length, 3)
  assert.equal(state.activities.some((activity) => activity.source === 'youtube'), true)
  assert.equal(state.runs.length, 3)
  assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM digital_footprint_activity").get().count, 3)
  assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM jobs").get().count, 0)
  assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM news_articles").get().count, 0)

  database.close()
  await rm(directory, { recursive: true, force: true })
})

test('digital footprint reports unavailable YouTube credentials without exposing them', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'agentflow-digital-footprint-'))
  const database = await JobDatabase.open(path.join(directory, 'test.sqlite'))
  const footprint = new DigitalFootprintIntelligence({
    database,
    getCredentials: () => ({}),
    fetchImpl: async () => { throw new Error('YouTube should not be requested without a key') },
  })
  footprint.saveSettings({ enabled: true, youtubeChannelId: 'UC1234567890123456789012' })
  const result = await footprint.run('test')
  assert.equal(result.status, 'failed')
  assert.match(result.errors[0], /Set YOUTUBE_API_KEY/)
  assert.equal(JSON.stringify(footprint.getState()).includes('server-side-test-key'), false)
  database.close()
  await rm(directory, { recursive: true, force: true })
})
