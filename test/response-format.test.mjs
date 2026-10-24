import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatTelegramAnswer } from '../response-format.mjs'

test('formats Markdown tables as readable Telegram bullets', () => {
  const answer = [
    '| Category | Headline | Brief Summary |',
    '|----------|----------|---------------|',
    '| World | Example summit | Leaders agreed on a verified plan. |',
  ].join('\n')
  const formatted = formatTelegramAnswer(answer)
  assert.match(formatted, /• World — Example summit/)
  assert.match(formatted, /Leaders agreed on a verified plan\./)
  assert.equal(formatted.includes('|'), false)
})

test('removes model-generated URLs and source sections in favor of verified results', () => {
  const answer = [
    'A claim with a made-up link: [Source](https://fake.example/story).',
    '',
    'Sources:',
    '[1] Fake outlet — https://fake.example/story',
  ].join('\n')
  const formatted = formatTelegramAnswer(answer, [{
    index: 1,
    title: 'Verified result',
    url: 'https://trusted.example/result',
  }])
  assert.equal(formatted.includes('fake.example'), false)
  assert.match(formatted, /Verified result — https:\/\/trusted\.example\/result/)
})

test('does not invent an answer when there is no search evidence', () => {
  assert.match(formatTelegramAnswer('', []), /could not find enough reliable source material/i)
})
