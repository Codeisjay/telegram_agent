import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import {
  decryptErpCredentials,
  encryptErpCredentials,
  formatErpAnswer,
  formatErpChangeNotification,
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
  <a href="/Student/TestSubjectMarksReport">My Marks</a>
  <a href="/Student/ExamCalender/2026">Exam Calendar</a>
  <a href="/assets/Notice/notice-a.pdf">Important test notice</a>
</body></html>`
const authenticatedTimetablePage = `<a href="/Student/Logout">Logout</a><table>
  <thead><tr><th>Day/ Lecture</th><th>1st<br>09.15-10.05</th><th>2nd<br>10.05-10.55</th>
    <th>3rd<br>11.10-12.00</th><th>4th<br>12.00-12.50</th><th>5th<br>01.40-02.25</th>
    <th>6th<br>02.25-03.10</th><th>7th<br>03.25-04.10</th><th>8th<br>04.10-04.55</th><th>9th</th></tr></thead>
  <tbody>
    <tr><td>Monday</td><td><h5>Faculty A<br>Subject A<br>Room 101</h5></td>
      <td><h5>Faculty B<br>Subject B<br>Room 102</h5></td><td><h5>Faculty C<br>Subject C<br>Room 103</h5></td>
      <td><h5>Faculty D<br>Subject D<br>Room 104</h5></td><td><h5>Faculty E<br>Subject E<br>Room 105</h5></td>
      <td><h5>Faculty F<br>Subject F<br>Room 106</h5></td><td><h5>Faculty G<br>Subject G<br>Room 107</h5></td>
      <td><h5>Faculty H<br>Subject H<br>Room 108</h5></td><td></td></tr>
    <tr><td>Tuesday</td><td></td><td><h5>Faculty I<br>Subject I<br>Room 109</h5></td>
      <td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
  </tbody>
</table>`
const authenticatedAttendancePage = `<a href="/Student/Logout">Logout</a>
  <strong>Total Lecture : 200</strong><strong>Total Absent + OAA: 30</strong>
  <strong>O.A. Attendance : 5</strong><strong>Attendance % without PF : 87.5 %</strong>
  <strong>Total PF : 2</strong><strong>Attendance % with PF : 88.5 %</strong>`
const authenticatedAttendanceRequestsPage = `<a href="/Student/Logout">Logout</a><table><thead><tr>
  <th>Req.Id</th><th>Details</th><th>Proof</th><th>From Date</th><th>To Date</th>
  <th>Submitted At</th><th>Coordinator</th><th>H.o.D</th></tr></thead><tbody>
  <tr><td>REQ-100</td><td>Private reason</td><td></td><td>2026-11-10</td><td>2026-11-10</td>
  <td>2026-11-09</td><td>Approved</td><td>Pending</td></tr></tbody></table>`
const authenticatedOnlineTrainingPage = `<a href="/Student/Logout">Logout</a><table><thead><tr>
  <th>Serial No.</th><th>Exam Date</th><th>Test Name</th><th>Marks Per Ques.</th>
  <th>Negative Marks</th><th>Marks / Out of</th><th>Percentage</th><th>Action</th></tr></thead>
  <tbody><tr><td>1</td><td>2026-11-12</td><td>Practice Test</td><td>1</td><td>0</td>
  <td>8 / 10</td><td>80%</td><td><a href="/Student/OnlineTrainingDetails/private-token">View</a></td></tr></tbody></table>`
const authenticatedOdRequestPage = `<a href="/Student/Logout">Logout</a><table><thead><tr>
  <th>Request-Id</th><th>Details</th><th>Proof</th><th>Request Submitted At</th>
  <th>Assign To</th><th>Verify</th><th>HOD</th><th>Director</th></tr></thead><tbody>
  <tr><td>OD-200</td><td>Private OD reason</td><td></td><td>2026-11-11 09:00</td>
  <td>Coordinator A</td><td>Pending</td><td>Pending</td><td>Pending</td></tr></tbody></table>
  <div>Showing 1 to 1 of 1 entries</div>`
const authenticatedMarksPage = `<a href="/Student/Logout">Logout</a>
  <form action="/Student/TestSubjectMarksReport" method="post"><select name="cTest">
    <option value="">Select Test Here</option><option value="ct-2-token">CT-2</option>
    <option value="assignment-token">ASG-1</option></select><button>Show</button></form>
  <table><thead><tr><th>Semester</th><th>Marks</th><th>Percentage (%)</th></tr></thead><tbody>
    <tr><td>Semester-I</td><td>720</td><td>80</td></tr></tbody></table>`
const authenticatedExamCalendarPage = `<a href="/Student/Logout">Logout</a><table>
  <thead><tr><th>Examination</th><th>CT I</th><th>CT II</th><th>PU</th></tr></thead>
  <tbody><tr><td>Semester Test</td><td>2026-11-20</td><td>2026-12-10</td><td>2027-01-05</td></tr></tbody>
</table>`

function authenticatedTestMarksPage(subject, score) {
  return `<a href="/Student/Logout">Logout</a><table><tbody><tr>
    <td>Student_Id</td><td>RollNo</td><td>Student_Name</td><td>${subject}</td>
  </tr><tr><td>private-id</td><td>another-student</td><td>Other Student</td><td>999</td>
  </tr><tr><td>private-id</td><td>student-12345</td><td>Test Student</td><td>${score}</td></tr></tbody></table>`
}

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
  assert.equal(resolveErpOperation('Check my OD request status'), 'od-requests')
  assert.equal(resolveErpOperation('Show online training results'), 'online-training')
  assert.equal(resolveErpOperation('Any attendance request updates?'), 'attendance-requests')
  assert.equal(resolveErpOperation('Give me my academic summary for this week'), 'academic-summary')
  assert.equal(resolveErpOperation('What are my outstanding library dues?'), 'student-services')
  assert.equal(
    formatErpChangeNotification({
      page: 'od-request',
      action: 'updated',
      label: 'Request #OD-200 · Dates: 2026-11-11 to 2026-11-11',
      status: 'Verification: Approved; HOD: Pending; Director: Pending',
      sourceTimestamp: '2026-11-11 09:00',
    }),
    '• On-duty (OD) request — review status changed: Request #OD-200 · Dates: 2026-11-11 to 2026-11-11 · Verification: Approved; HOD: Pending; Director: Pending · Submitted: 2026-11-11 09:00',
  )
  assert.match(formatErpChangeNotification({
    page: 'attendance-request',
    action: 'updated',
    label: 'Request #REQ-100 · Dates: 2026-11-10 to 2026-11-10',
    status: 'Coordinator: Rejected; HOD: Pending',
    sourceTimestamp: '2026-11-09',
  }), /Coordinator: Rejected/)
  assert.equal(validateErpOperation('arbitrary-sql'), null)
  assert.match(formatErpAnswer('attendance', {
    connected: false,
    dataRetrievalAvailable: false,
  }), /No data for this section has been retrieved or fabricated/)
  const cachedState = {
    connected: true,
    availability: { attendance: true, timetable: true, marks: true, notices: true, examCalendar: true },
    data: {
      attendance: { percentageWithoutPf: 85.5, percentageWithPf: 86, totalLectures: 200, totalAbsentPlusOaa: 30, oaAttendance: 5 },
      timetable: { days: [{ day: 'Monday', periods: [{ startTime: '09:15', endTime: '10:05', subject: 'Computer Science', faculty: 'Faculty A', room: 'Room 101' }] }] },
      academic: {
        examCalendar: { exams: [{ Examination: 'CT I', Date: '2026-11-20' }] },
        marks: { semesters: [{ semester: 'Semester-I', marks: '720', percentage: '80' }], assessments: [{ test: 'CT-1', subjects: [{ subject: 'BCS-072', score: '17' }] }] },
      },
      notices: [{ title: 'Assignment deadline notice' }],
    },
  }
  assert.match(formatErpAnswer('attendance', cachedState), /85\.5%/)
  assert.match(formatErpAnswer('timetable-week', cachedState), /Computer Science/)
  assert.match(formatErpAnswer('marks', cachedState), /BCS-072 17/)
  assert.match(formatErpAnswer('od-requests', {
    data: { activity: { 'od-request': { rowCount: 1, latestLabel: 'Approved', latestStatus: 'Approved' } } },
  }), /OD requests: 1 records found/)
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
  let transientDataFailure = false
  let attendanceRequestUpdated = false
  let odRequestStatus = 'Pending'
  let odRequestDeleted = false
  const notifications = []
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
    if (requestUrl.pathname === '/Student/MyAttendanceDetail') {
      if (transientDataFailure) return new Response('Temporary failure', { status: 503 })
      return new Response(authenticatedAttendancePage, { status: 200 })
    }
    if (requestUrl.pathname === '/Student/StudentAttRequest') {
      return new Response(attendanceRequestUpdated
        ? authenticatedAttendanceRequestsPage.replace('<td>Pending</td></tr>', '<td>Approved</td></tr>')
        : authenticatedAttendanceRequestsPage, { status: 200 })
    }
    if (requestUrl.pathname === '/Student/OnlineTraining') {
      return new Response(authenticatedOnlineTrainingPage, { status: 200 })
    }
    if (requestUrl.pathname === '/Student/ODRequest') {
      const page = odRequestDeleted
        ? authenticatedOdRequestPage.replace(/<tr><td>OD-200[\s\S]*?<\/tr>/, '').replace('Showing 1 to 1 of 1 entries', 'Showing 0 to 0 of 0 entries')
        : authenticatedOdRequestPage.replace('<td>Pending</td><td>Pending</td><td>Pending</td></tr>', `<td>${odRequestStatus}</td><td>Pending</td><td>Pending</td></tr>`)
      return new Response(page, { status: 200 })
    }
    if (requestUrl.pathname === '/Student/TestSubjectMarksReport') {
      if (transientDataFailure && options.method !== 'POST') return new Response('Temporary failure', { status: 503 })
      if (options.method === 'POST') {
        const selectedTest = new URLSearchParams(options.body).get('cTest')
        return new Response(selectedTest === 'ct-2-token'
          ? authenticatedTestMarksPage('BCS-072', '17')
          : authenticatedTestMarksPage('BCS-072', '9'), { status: 200 })
      }
      return new Response(authenticatedMarksPage, { status: 200 })
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
  const service = new PsitErpService({
    database,
    encryptionKey: key,
    fetchImpl,
    notifyChanges: async (changes) => { notifications.push(...changes); return true },
    onDiagnostic: (entry) => diagnostics.push(entry),
  })
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
  assert.equal(JSON.stringify(diagnostics).includes('ct-2-token'), false)
  const resultSync = await service.sync()
  assert.equal(resultSync.status, 'partial')
  assert.equal(timetablePageReceivedCookie, true)
  const syncedState = service.getState()
  assert.equal(syncedState.history[0].status, 'partial')
  assert.equal(syncedState.lastSyncAt !== null, true)
  assert.ok(syncedState.retrievedRecordCount > 0)
  assert.equal(syncedState.automaticSyncEnabled, true)
  assert.equal(syncedState.lastSyncError, '')
  assert.equal(syncedState.availability.timetable, true)
  assert.equal(syncedState.availability.examCalendar, true)
  assert.equal(syncedState.availability.notices, true)
  assert.equal(syncedState.availability.attendance, true)
  assert.equal(syncedState.availability.marks, true)
  assert.equal(syncedState.availability.attendanceRequests, true)
  assert.equal(syncedState.availability.onlineTraining, true)
  assert.equal(syncedState.availability.odRequests, true)
  assert.equal(syncedState.data.attendance.percentageWithoutPf, 87.5)
  assert.equal(syncedState.data.attendance.percentageWithPf, 88.5)
  assert.equal(syncedState.data.attendance.subjectWise, null)
  assert.equal(syncedState.data.timetable.days[0].periods[0].subject, 'Subject A')
  assert.equal(syncedState.data.timetable.days[0].periods[0].faculty, 'Faculty A')
  assert.equal(syncedState.data.timetable.days[0].periods[1].startTime, '10:05')
  assert.equal(syncedState.data.timetable.days[0].periods[2].startTime, '11:10')
  assert.equal(syncedState.data.timetable.days[0].periods[3].startTime, '12:00')
  assert.equal(syncedState.data.timetable.days[0].periods[4].startTime, '13:40')
  assert.deepEqual(syncedState.data.academic.marks.semesters[0], {
    semester: 'Semester-I',
    marks: '720',
    percentage: '80',
  })
  assert.deepEqual(syncedState.data.academic.marks.assessments.map((assessment) => assessment.test), ['CT-2', 'ASG-1'])
  assert.deepEqual(syncedState.data.academic.marks.assessments[0].subjects, [{ subject: 'BCS-072', score: '17' }])
  assert.equal(JSON.stringify(syncedState).includes('Other Student'), false)
  assert.equal(JSON.stringify(syncedState).includes('student-12345'), false)
  assert.equal(database.db.prepare('SELECT overall_percent FROM psit_erp_attendance_snapshots ORDER BY id DESC LIMIT 1').get().overall_percent, 88.5)
  assert.equal(syncedState.data.academic.examCalendar.exams[0]['CT I'], '2026-11-20')
  assert.equal(syncedState.data.notices.length, 1)
  assert.equal(notifications.length, 0)
  await service.sync()
  assert.equal(notifications.length, 0)
  attendanceRequestUpdated = true
  await service.sync()
  assert.equal(notifications.length, 1)
  assert.equal(notifications[0].page, 'attendance-request')
  assert.equal(notifications[0].action, 'updated')
  assert.equal(JSON.stringify(notifications).includes('Private reason'), false)
  await service.sync()
  assert.equal(notifications.length, 1)
  odRequestStatus = 'Approved'
  await service.sync()
  assert.equal(notifications.length, 2)
  assert.equal(notifications[1].page, 'od-request')
  assert.equal(notifications[1].action, 'updated')
  assert.match(notifications[1].status, /Verification: Approved/)
  assert.match(notifications[1].status, /HOD: Pending/)
  assert.match(notifications[1].label, /Request #OD-200/)
  assert.equal(notifications[1].sourceTimestamp, '2026-11-11 09:00')
  assert.match(formatErpChangeNotification(notifications[1]), /review status changed/)
  assert.match(formatErpChangeNotification(notifications[1]), /2026-11-11 09:00/)
  assert.equal(JSON.stringify(notifications).includes('Private OD reason'), false)
  await service.sync()
  assert.equal(notifications.length, 2)
  odRequestDeleted = true
  await service.sync()
  assert.equal(notifications.length, 3)
  assert.equal(notifications[2].action, 'deleted')
  await service.sync()
  assert.equal(notifications.length, 3)
  transientDataFailure = true
  await service.sync()
  assert.equal(service.getState().data.attendance.percentageWithPf, 88.5)
  assert.equal(service.getState().data.academic.marks.assessments[0].subjects[0].score, '17')
  assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM psit_erp_notices').get().count, 1)
  const monitorRequestStart = requests.length
  assert.equal((await service.sync({ monitorOnly: true })).status, 'completed')
  const monitorRoutes = requests.slice(monitorRequestStart).map(({ url }) => url.pathname)
  assert.ok(monitorRoutes.includes('/Student/StudentAttRequest'))
  assert.ok(monitorRoutes.includes('/Student/OnlineTraining'))
  assert.ok(monitorRoutes.includes('/Student/ODRequest'))
  assert.equal(monitorRoutes.includes('/Student/MyTimeTable'), false)
  assert.equal(service.disconnect().disconnected, true)
  assert.equal(service.getState().connected, false)
  assert.equal(service.getState().credentialsStored, false)
  assert.equal(service.getCredentialRecord(), undefined)
})

test('environment credentials stay out of SQLite and cached sessions are reused and renewed', async () => {
  const database = await JobDatabase.open(path.join(temporaryDirectory, 'erp-environment-credentials.sqlite'))
  databases.push(database)
  const names = ['PSIT_ERP_USER_ID', 'PSIT_ERP_PASSWORD']
  const originalEnvironment = Object.fromEntries(names.map((name) => [name, process.env[name]]))
  const userId = 'env-only-student-123'
  const password = 'env-only-private-password'
  let loginCount = 0
  let monitoredPageCount = 0
  let expireFirstSession = false
  const diagnostics = []
  process.env.PSIT_ERP_USER_ID = userId
  process.env.PSIT_ERP_PASSWORD = password
  const fetchImpl = async (url, options = {}) => {
    const requestUrl = new URL(url)
    if (requestUrl.pathname === '/Erp/' && options.method !== 'POST') return new Response(loginPage, { status: 200 })
    if (options.method === 'POST' && requestUrl.pathname === '/Erp/Auth') {
      loginCount += 1
      return new Response('', {
        status: 302,
        headers: { location: '/Student/', 'set-cookie': `ci_session=env-session-${loginCount}; Path=/; HttpOnly` },
      })
    }
    if (requestUrl.pathname === '/Student/') {
      const cookie = new Headers(options.headers).get('cookie') || ''
      if (expireFirstSession && cookie.includes('env-session-1')) return new Response(loginPage, { status: 200 })
      return new Response(authenticatedStudentPage, { status: 200 })
    }
    if (requestUrl.pathname === '/Student/StudentAttRequest') {
      monitoredPageCount += 1
      return new Response(authenticatedAttendanceRequestsPage, { status: 200 })
    }
    if (requestUrl.pathname === '/Student/OnlineTraining') {
      monitoredPageCount += 1
      return new Response(authenticatedOnlineTrainingPage, { status: 200 })
    }
    if (requestUrl.pathname === '/Student/ODRequest') {
      monitoredPageCount += 1
      return new Response(authenticatedOdRequestPage, { status: 200 })
    }
    return new Response(loginPage, { status: 200 })
  }
  try {
    const service = new PsitErpService({ database, encryptionKey: key, fetchImpl, onDiagnostic: (item) => diagnostics.push(item) })
    assert.equal((await service.sync({ monitorOnly: true })).status, 'completed')
    assert.equal(loginCount, 1)
    assert.equal((await service.sync({ monitorOnly: true })).status, 'completed')
    assert.equal(loginCount, 1)
    const pageCountBeforeParallelSync = monitoredPageCount
    await Promise.all([service.sync({ monitorOnly: true }), service.sync({ monitorOnly: true })])
    assert.equal(monitoredPageCount - pageCountBeforeParallelSync, 3)
    assert.equal(loginCount, 1)
    expireFirstSession = true
    assert.equal((await service.sync({ monitorOnly: true })).status, 'completed')
    assert.equal(loginCount, 2)
    const connection = database.db.prepare(`SELECT user_id_masked AS userIdMasked,
      credential_ciphertext AS credentialCiphertext, credential_source AS credentialSource
      FROM psit_erp_connection WHERE id = 1`).get()
    assert.equal(connection.userIdMasked, '')
    assert.equal(connection.credentialCiphertext, null)
    assert.equal(connection.credentialSource, 'environment')
    assert.equal(service.getState().credentialSource, 'environment')
    assert.equal(service.getState().credentialsStored, false)
    assert.equal(service.getState().connected, true)
    assert.equal(JSON.stringify(service.getState()).includes(userId), false)
    assert.equal(JSON.stringify(service.getState()).includes(password), false)
    assert.equal(JSON.stringify(diagnostics).includes(password), false)
    assert.equal(JSON.stringify(diagnostics).includes('env-session'), false)
  } finally {
    for (const name of names) {
      if (originalEnvironment[name] === undefined) delete process.env[name]
      else process.env[name] = originalEnvironment[name]
    }
  }
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
