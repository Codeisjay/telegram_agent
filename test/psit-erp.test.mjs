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
const loginPage = `<form action="https://erp.psit.ac.in/Erp/Auth" method="POST">
  <input name="username"><input name="password" type="password">
</form>`
const authenticatedStudentPage = `<html><head><title>Notice Dashboard For Student</title></head><body>
  <a href="/Student/Logout">Logout</a><a href="/Student/Profile">My Profile</a>
  <a href="/Student/Attendance">Attendance</a><a href="/Student/TimeTable">Timetable</a>
  <a href="/Student/ExamCalender/2026">Exam Calendar</a>
  <a href="/assets/Notice/notice-a.pdf">Important test notice</a>
</body></html>`
const authenticatedTimetablePage = `<a href="/Student/Logout">Logout</a><table>
  <thead><tr><th>Day/ Lecture</th><th>1st 09.15-10.05</th><th>2nd 10.05-10.55</th></tr></thead>
  <tbody>
    <tr><td>Monday</td><td><h5>Subject A<br>Faculty A<br>Room 101</h5></td><td></td></tr>
    <tr><td>Tuesday</td><td></td><td><h5>Subject B<br>Faculty B<br>Room 102</h5></td></tr>
  </tbody>
</table>`
const authenticatedExamCalendarPage = `<a href="/Student/Logout">Logout</a><table>
  <thead><tr><th>Examination</th><th>CT I</th><th>CT II</th><th>PU</th></tr></thead>
  <tbody><tr><td>Semester Test</td><td>2026-11-20</td><td>2026-12-10</td><td>2027-01-05</td></tr></tbody>
</table>`

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
  const cachedState = {
    connected: true,
    availability: { timetable: true, notices: true, examCalendar: true },
    data: {
      timetable: { days: [{ day: 'Monday', periods: [{ startTime: '09:15', endTime: '10:05', subject: 'Computer Science', faculty: 'Faculty A', room: 'Room 101' }] }] },
      academic: { examCalendar: { exams: [{ Examination: 'CT I', Date: '2026-11-20' }] } },
      notices: [{ title: 'Assignment deadline notice' }],
    },
  }
  assert.match(formatErpAnswer('timetable-week', cachedState), /Computer Science/)
  assert.match(formatErpAnswer('notices', cachedState), /Assignment deadline notice/)
  assert.match(formatErpAnswer('academic-summary', cachedState), /CT I/)
  assert.equal(resolveErpOperation('Tell me a joke'), null)
})

test('ERP connection stores encrypted credentials and syncs verified student pages', async () => {
  const database = await JobDatabase.open(path.join(temporaryDirectory, 'erp-connection.sqlite'))
  databases.push(database)
  const requests = []
  const diagnostics = []
  let studentPageReceivedCookie = false
  let timetablePageReceivedCookie = false
  const fetchImpl = async (url, options = {}) => {
    const requestUrl = new URL(url)
    requests.push({ url: requestUrl, options })
    if (options.method === 'POST' && requestUrl.pathname === '/Erp/Auth') {
      return new Response('', {
        status: 302,
        headers: { location: '/Student/', 'set-cookie': 'ci_session=verified-session; Path=/; HttpOnly' },
      })
    }
    if (requestUrl.pathname === '/Student/MyTimeTable') {
      timetablePageReceivedCookie = new Headers(options.headers).get('cookie') === 'ci_session=verified-session'
      return new Response(authenticatedTimetablePage, { status: 200 })
    }
    if (requestUrl.pathname === '/Student/ExamCalender/2026') {
      return new Response(authenticatedExamCalendarPage, { status: 200 })
    }
    if (requestUrl.pathname === '/Student/') {
      studentPageReceivedCookie = new Headers(options.headers).get('cookie') === 'ci_session=verified-session'
      return new Response(authenticatedStudentPage, { status: 200 })
    }
    return new Response(`${loginPage}<p>All user passwords have expired. Please change your password to continue.</p>`, {
      status: 200,
      headers: { 'set-cookie': 'ci_session=login-session; Path=/; HttpOnly' },
    })
  }
  const service = new PsitErpService({ database, encryptionKey: key, fetchImpl, onDiagnostic: (entry) => diagnostics.push(entry) })
  const result = await service.connect('student-12345', 'private-test-password')
  assert.equal(result.status, 'connected')
  assert.equal(result.message.includes('private-test-password'), false)
  assert.equal(studentPageReceivedCookie, true)
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
  assert.deepEqual(diagnostics[0].responses.map(({ httpStatus }) => httpStatus), [200, 302, 200])
  assert.equal(diagnostics[0].responses[1].redirectUrl, 'https://erp.psit.ac.in/Student/')
  assert.equal(diagnostics[0].pageType, 'authenticated_student')
  assert.equal(diagnostics[0].authenticationState, 'connected')
  assert.equal(JSON.stringify(diagnostics).includes('private-test-password'), false)
  assert.equal(JSON.stringify(diagnostics).includes('student-12345'), false)
  assert.equal(JSON.stringify(diagnostics).includes('verified-session'), false)
  const resultSync = await service.sync()
  assert.equal(resultSync.status, 'partial')
  assert.equal(timetablePageReceivedCookie, true)
  const syncedState = service.getState()
  assert.equal(syncedState.history[0].status, 'partial')
  assert.equal(syncedState.lastSyncAt !== null, true)
  assert.equal(syncedState.availability.timetable, true)
  assert.equal(syncedState.availability.examCalendar, true)
  assert.equal(syncedState.availability.notices, true)
  assert.equal(syncedState.availability.attendance, false)
  assert.equal(syncedState.data.timetable.days[0].periods[0].subject, 'Subject A')
  assert.equal(syncedState.data.academic.examCalendar.exams[0]['CT I'], '2026-11-20')
  assert.equal(syncedState.data.notices.length, 1)
  await service.sync()
  assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM psit_erp_notices').get().count, 1)
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
      return new Response(`<h1>Change password</h1><p>Your account requires a password change.</p>
        <form><input type="password" name="oldPassword"><input type="password" name="newPassword"></form>`, { status: 200 })
    }
    return new Response(loginPage, { status: 200 })
  }
  const service = new PsitErpService({ database, encryptionKey: key, fetchImpl })
  const result = await service.connect('student-67890', 'expired-password')
  assert.equal(result.status, 'password_change_required')
  assert.equal(service.getState().connected, false)
  assert.equal(service.getCredentialRecord().credentialCiphertext, null)
  assert.equal(service.getState().history[0].message.includes('expired-password'), false)
})

test('the portal-wide expiry notice is not account evidence and ambiguous login responses are not saved', async () => {
  const database = await JobDatabase.open(path.join(temporaryDirectory, 'erp-portal-expiry.sqlite'))
  databases.push(database)
  let submitted = false
  const fetchImpl = async (_url, options = {}) => {
    if (options.method === 'POST') submitted = true
    return new Response(`${loginPage}<p>All user passwords have expired. Please change your password to continue.</p>`, { status: 200 })
  }
  const service = new PsitErpService({ database, encryptionKey: key, fetchImpl })
  const result = await service.connect('student-11111', 'not-submitted-password')
  assert.equal(result.status, 'unknown_response')
  assert.equal(submitted, true)
  assert.equal(service.getState().connected, false)
  assert.equal(service.getCredentialRecord().credentialCiphertext, null)
})

test('invalid credentials are reported only when the portal explicitly rejects them', async () => {
  const database = await JobDatabase.open(path.join(temporaryDirectory, 'erp-invalid-credentials.sqlite'))
  databases.push(database)
  const fetchImpl = async (_url, options = {}) => new Response(options.method === 'POST'
    ? `${loginPage}<p>Invalid username or password.</p>`
    : loginPage, { status: 200 })
  const service = new PsitErpService({ database, encryptionKey: key, fetchImpl, onDiagnostic: () => {} })
  const result = await service.connect('student-33333', 'invalid-password')
  assert.equal(result.status, 'invalid_credentials')
  assert.equal(service.getCredentialRecord().credentialCiphertext, null)
})

test('session expiration and network failures have distinct states', async () => {
  const expiredDatabase = await JobDatabase.open(path.join(temporaryDirectory, 'erp-session-expired.sqlite'))
  databases.push(expiredDatabase)
  const expiredFetch = async (_url, options = {}) => new Response(options.method === 'POST'
    ? `<p>Your session has expired. Please log in again.</p>${loginPage}`
    : loginPage, { status: 200 })
  const expiredService = new PsitErpService({ database: expiredDatabase, encryptionKey: key, fetchImpl: expiredFetch, onDiagnostic: () => {} })
  assert.equal((await expiredService.connect('student-44444', 'test-password')).status, 'session_expired')
  assert.equal(expiredService.getCredentialRecord().credentialCiphertext, null)

  const networkDatabase = await JobDatabase.open(path.join(temporaryDirectory, 'erp-network-error.sqlite'))
  databases.push(networkDatabase)
  const networkService = new PsitErpService({
    database: networkDatabase,
    encryptionKey: key,
    fetchImpl: async () => { throw new Error('test network failure') },
    onDiagnostic: () => {},
  })
  assert.equal((await networkService.connect('student-55555', 'test-password')).status, 'network_error')
  assert.equal(networkService.getCredentialRecord().credentialCiphertext, null)
})

test('generic non-login pages are unknown rather than successful authentication', async () => {
  const database = await JobDatabase.open(path.join(temporaryDirectory, 'erp-unknown-page.sqlite'))
  databases.push(database)
  const fetchImpl = async (url, options = {}) => {
    const requestUrl = new URL(url)
    if (options.method === 'POST') return new Response('', { status: 302, headers: { location: '/Student/Home' } })
    if (requestUrl.pathname === '/Student/Home') return new Response('<h1>Student portal</h1>', { status: 200 })
    return new Response(loginPage, { status: 200 })
  }
  const service = new PsitErpService({ database, encryptionKey: key, fetchImpl, onDiagnostic: () => {} })
  assert.equal((await service.connect('student-66666', 'test-password')).status, 'unknown_response')
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
    return new Response(loginPage, { status: 200 })
  }
  const service = new PsitErpService({ database, encryptionKey: key, fetchImpl, onDiagnostic: () => {} })
  const result = await service.connect('student-22222', 'manual-challenge-password')
  assert.equal(result.status, 'manual_auth_required')
  assert.match(result.message, /will not bypass CAPTCHA or MFA/)
  assert.equal(service.getCredentialRecord().credentialCiphertext, null)
})
