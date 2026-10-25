import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readApiResponse } from '../src/api.js'

test('reports missing Vercel API routes instead of exposing a JSON parse error', async () => {
  const response = new Response('The page could not be found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })

  await assert.rejects(
    readApiResponse(response),
    /Backend API route not found \(404\).*API backend is not deployed/,
  )
})

test('returns JSON API payloads', async () => {
  const response = Response.json({ answer: 'test response' })
  assert.deepEqual(await readApiResponse(response), { answer: 'test response' })
})

test('rejects malformed JSON responses with a clear message', async () => {
  const response = new Response('{invalid', {
    headers: { 'content-type': 'application/json' },
  })
  await assert.rejects(readApiResponse(response), /API returned invalid JSON/)
})
