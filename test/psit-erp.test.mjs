import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import {
  decryptErpCredentials,
  encryptErpCredentials,
  formatErpAnswer,
  getErpEncryptionKey,
  PsitErpService,
  resolveErpOperation,
  validateErpOperation,
} from '../psit-erp.mjs'
import { JobDatabase } from '../job-intelligence.mjs'

const key = '2a'.repeat(32)
const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'agentflow-psit-erp-'))
const databases = []

after(async () => {
  for (const database of databases) database.close()
  await rm(temporaryDirectory, { recursive: true, force: true })
})

test('ERP credentials are authenticated-encrypted and tampering is rejected', () => {
  const credentials = { userId: 'student-12345', password: 'a-private-test-password' }
  const encrypted = encryptErpCredentials(credentials, key)
  assert.match(encrypted, /^v1:/)
  assert.equal(encrypted.includes(credentials.userId), false)
  assert.equal(encrypted.includes(credentials.password), false)
  assert.deepEqual(decryptErpCredentials(encrypted, key), credentials)
  assert.throws(() => decryptErpCredentials(`${encrypted.slice(0, -2)}aa`, key))
  assert.throws(() => getErpEncryptionKey('not-a-32-byte-hex-key'))
})

test('natural-language ERP requests resolve only to validated local operations', () => {
  assert.equal(resolveErpOperation('How much attendance do I have?'), 'attendance')
  assert.equal(resolveErpOperation('How many classes should I attend to reach 80%?'), 'attendance')
  assert.equal(resolveErpOperation('What is my timetable tomorrow?'), 'timetable-tomorrow')
  assert.equal(resolveErpOperation('When is my next lecture?'), 'next-lecture')
  assert.equal(resolveErpOperation('Show my internal marks'), 'marks')
  assert.equal(resolveErpOperation('Any important academic notices?'), 'notices')
  assert.equal(resolveErpOperation('Give me my academic summary for this week'), 'academic-summary')
  assert.equal(resolveErpOperation('What are my outstanding library dues?'), 'student-services')
  assert.equal(validateErpOperation('arbitrary-sql'), null)
  assert.match(formatErpAnswer('attendance', {
    connected: false,
    dataRetrievalAvailable: false,
  }), /No academic data has been retrieved or fabricated/)
  assert.equal(resolveErpOperation('Tell me a joke'), null)
})

test('ERP connection stores encrypted credentials, reports unmapped pages, and disconnects cleanly', async () => {
  const database = await JobDatabase.open(path.join(temporaryDirectory, 'erp-connection.sqlite'))
  databases.push(database)
  const requests = []
  const fetchImpl = async (url, options = {}) => {
    const requestUrl = new URL(url)
    requests.push({ url: requestUrl, options })
    if (options.method === 'POST' && requestUrl.pathname === '/Erp/Auth') {
      return new Response('', {
        status: 302,
        headers: { location: '/Erp/Student/Home', 'set-cookie': 'ERPSESSION=private-session; Path=/; HttpOnly' },
      })
    }
    if (requestUrl.pathname === '/Erp/Student/Home') {
      return new Response('<h1>Student portal</h1>', { status: 200 })
    }
    return new Response(`<form action="https://erp.psit.ac.in/Erp/Auth" method="POST">
      <input name="username"><input name="password" type="password">
    </form>`, {
      status: 200,
      headers: { 'set-cookie': 'ERPSESSION=login-session; Path=/; HttpOnly' },
    })
  }
  const service = new PsitErpService({ database, encryptionKey: key, fetchImpl })
  const result = await service.connect('student-12345', 'private-test-password')
  assert.equal(result.status, 'connected')
  assert.equal(result.message.includes('private-test-password'), false)
  const state = service.getState()
  assert.equal(state.connected, true)
  assert.equal(state.credentialsStored, true)
  assert.equal(state.userIdMasked, 's••••45')
  assert.equal(state.dataRetrievalAvailable, false)
  assert.equal(JSON.stringify(state).includes('private-test-password'), false)
  assert.equal(JSON.stringify(state).includes('student-12345'), false)
  const stored = database.db.prepare('SELECT credential_ciphertext FROM psit_erp_connection WHERE id = 1').get()
  assert.match(stored.credential_ciphertext, /^v1:/)
  assert.equal(stored.credential_ciphertext.includes('private-test-password'), false)
  const loginRequest = requests.find(({ options }) => options.method === 'POST')
  assert.equal(loginRequest.url.origin, 'https://erp.psit.ac.in')
  assert.match(new Headers(loginRequest.options.headers).get('content-type'), /application\/x-www-form-urlencoded/)
  assert.match(loginRequest.options.body, /private-test-password/)
  const resultSync = await service.sync()
  assert.equal(resultSync.status, 'data-source-pending')
  assert.equal(service.getState().history[0].status, 'data-source-pending')
  assert.equal(service.disconnect().disconnected, true)
  assert.equal(service.getState().connected, false)
  assert.equal(service.getState().credentialsStored, false)
  assert.equal(service.getCredentialRecord(), undefined)
})

test('expired ERP passwords are not stored and get an explicit password-change state', async () => {
  const database = await JobDatabase.open(path.join(temporaryDirectory, 'erp-expired-password.sqlite'))
  databases.push(database)
  const fetchImpl = async (url, options = {}) => {
    const requestUrl = new URL(url)
    if (options.method === 'POST' && requestUrl.pathname === '/Erp/Auth') {
      return new Response('', { status: 302, headers: { location: '/Erp/ForgetPassword' } })
    }
    if (requestUrl.pathname === '/Erp/ForgetPassword') {
      return new Response('<h1>Password change required</h1>', { status: 200 })
    }
    return new Response(`<form action="https://erp.psit.ac.in/Erp/Auth" method="POST">
      <input name="username"><input name="password" type="password">
    </form>`, { status: 200 })
  }
  const service = new PsitErpService({ database, encryptionKey: key, fetchImpl })
  const result = await service.connect('student-67890', 'expired-password')
  assert.equal(result.status, 'password-change-required')
  assert.equal(service.getState().connected, false)
  assert.equal(service.getCredentialRecord().credentialCiphertext, null)
  assert.equal(service.getState().history[0].message.includes('expired-password'), false)
})

test('the portal-wide expired-password notice stops login before credentials are submitted', async () => {
  const database = await JobDatabase.open(path.join(temporaryDirectory, 'erp-portal-expiry.sqlite'))
  databases.push(database)
  let submitted = false
  const fetchImpl = async () => new Response(`<form action="https://erp.psit.ac.in/Erp/Auth" method="POST">
    <input name="username"><input name="password" type="password">
  </form><p>All user passwords have expired. Please change your password to continue.</p>`, { status: 200 })
  const service = new PsitErpService({ database, encryptionKey: key, fetchImpl: async (url, options) => {
    if (options?.method === 'POST') submitted = true
    return fetchImpl(url, options)
  } })
  const result = await service.connect('student-11111', 'not-submitted-password')
  assert.equal(result.status, 'password-change-required')
  assert.equal(submitted, false)
  assert.equal(service.getState().connected, false)
  assert.equal(service.getCredentialRecord().credentialCiphertext, null)
})

test('security challenges are left for manual completion without saving credentials', async () => {
  const database = await JobDatabase.open(path.join(temporaryDirectory, 'erp-manual-challenge.sqlite'))
  databases.push(database)
  const fetchImpl = async (url, options = {}) => {
    const requestUrl = new URL(url)
    if (options.method === 'POST') {
      return new Response('', { status: 302, headers: { location: '/Erp/SecurityChallenge' } })
    }
    if (requestUrl.pathname === '/Erp/SecurityChallenge') {
      return new Response('<h1>Enter verification code</h1><input name="otp">', { status: 200 })
    }
    return new Response(`<form action="https://erp.psit.ac.in/Erp/Auth" method="POST">
      <input name="username"><input name="password" type="password">
    </form>`, { status: 200 })
  }
  const service = new PsitErpService({ database, encryptionKey: key, fetchImpl })
  const result = await service.connect('student-22222', 'manual-challenge-password')
  assert.equal(result.status, 'manual-auth-required')
  assert.match(result.message, /will not bypass CAPTCHA or MFA/)
  assert.equal(service.getCredentialRecord().credentialCiphertext, null)
})
