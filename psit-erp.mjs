import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

function resolvePortalUrl(value = process.env.PSIT_ERP_BASE_URL) {
  const url = new URL(value || 'https://erp.psit.ac.in/Erp/')
  if (url.protocol !== 'https:' || url.hostname !== 'erp.psit.ac.in'
    || url.username || url.password || url.search || url.hash
    || !/^\/(?:Erp)?\/?$/i.test(url.pathname)) {
    throw new Error('PSIT_ERP_BASE_URL must use the official https://erp.psit.ac.in/Erp/ portal.')
  }
  return `${url.origin}/Erp/`
}

export const PSIT_ERP_URL = resolvePortalUrl()
export const PSIT_ERP_PASSWORD_RESET_URL = new URL('/Erp/ForgetPassword', PSIT_ERP_URL).href

export const ERP_OPERATIONS = Object.freeze([
  'status',
  'attendance',
  'timetable-today',
  'timetable-tomorrow',
  'timetable-week',
  'next-lecture',
  'marks',
  'notices',
  'academic-summary',
  'student-services',
  'attendance-requests',
  'online-training',
  'od-requests',
])

const operationCommands = new Map([
  ['/erp', 'status'],
  ['/attendance', 'attendance'],
  ['/timetable', 'timetable-today'],
  ['/tomorrow', 'timetable-tomorrow'],
  ['/marks', 'marks'],
  ['/notices', 'notices'],
  ['/academic_summary', 'academic-summary'],
  ['/student_attendance', 'attendance-requests'],
  ['/online_training', 'online-training'],
  ['/od', 'od-requests'],
])

export function validateErpOperation(operation) {
  return ERP_OPERATIONS.includes(operation) ? operation : null
}

export function resolveErpOperation(text) {
  const input = String(text || '').trim()
  const command = input.split(/\s+/)[0].split('@')[0].toLowerCase()
  if (operationCommands.has(command)) return operationCommands.get(command)

  const query = input.toLowerCase()
  if (!/\b(attendance|timetable|lecture|class|classes|marks|internal|exam|examination|notice|academic|subject|free period|assignment|fee|library|dues|profile|od|training|request|requests)\b/.test(query)) return null
  if (/\b(next lecture|next class|upcoming lecture)\b/.test(query)) return 'next-lecture'
  if (/\b(?:attendance|att)\s+requests?\b|\battendance application\b/.test(query)) return 'attendance-requests'
  if (/\b(?:online training|online exam|online test)\b/.test(query)) return 'online-training'
  if (/\b(?:od|on duty|out.?station duty)\s+requests?\b/.test(query)) return 'od-requests'
  if (/\b(tomorrow|next day)\b/.test(query) && /\b(timetable|class|classes|lecture)\b/.test(query)) return 'timetable-tomorrow'
  if (/\b(week|weekly)\b/.test(query) && /\b(timetable|class|classes|lecture)\b/.test(query)) return 'timetable-week'
  if (/\b(attendance|attend|miss|shortage)\b/.test(query)) return 'attendance'
  if (/\b(notice|notices|announcement|announcements|calendar|deadline|deadlines)\b/.test(query)) return 'notices'
  if (/\b(mark|marks|score|scores|result|results|assignment|assignments|exam|examination)\b/.test(query)) return 'marks'
  if (/\b(fee|fees|library|dues|profile|student services?)\b/.test(query)) return 'student-services'
  if (/\b(summary|summarize|overview)\b/.test(query)) return 'academic-summary'
  if (/\b(timetable|schedule|classes|lecture|free period)\b/.test(query)) return 'timetable-today'
  if (/\b(subject|subjects|percentage|percent|75%)\b/.test(query)) return 'attendance'
  return null
}

export function getErpEncryptionKey(value = process.env.PSIT_ERP_CREDENTIAL_ENCRYPTION_KEY) {
  if (typeof value !== 'string' || !/^[a-f\d]{64}$/i.test(value)) {
    const error = new Error('Set PSIT_ERP_CREDENTIAL_ENCRYPTION_KEY to a randomly generated 32-byte hex key before connecting an ERP account.')
    error.status = 503
    throw error
  }
  return Buffer.from(value, 'hex')
}

export function encryptErpCredentials(credentials, keyValue) {
  const key = Buffer.isBuffer(keyValue) ? keyValue : getErpEncryptionKey(keyValue)
  if (key.length !== 32) throw new Error('PSIT ERP encryption key must be 32 bytes.')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(credentials), 'utf8'),
    cipher.final(),
  ])
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ciphertext.toString('base64url')}`
}

export function decryptErpCredentials(encrypted, keyValue) {
  const key = Buffer.isBuffer(keyValue) ? keyValue : getErpEncryptionKey(keyValue)
  if (key.length !== 32 || typeof encrypted !== 'string') throw new Error('Invalid encrypted ERP credential record.')
  const [version, ivText, tagText, ciphertextText, extra] = encrypted.split(':')
  if (version !== 'v1' || !ivText || !tagText || !ciphertextText || extra !== undefined) {
    throw new Error('Invalid encrypted ERP credential record.')
  }
  const iv = Buffer.from(ivText, 'base64url')
  const tag = Buffer.from(tagText, 'base64url')
  const ciphertext = Buffer.from(ciphertextText, 'base64url')
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
    throw new Error('Invalid encrypted ERP credential record.')
  }
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  const credentials = JSON.parse(plaintext)
  if (typeof credentials.userId !== 'string' || typeof credentials.password !== 'string') {
    throw new Error('Invalid encrypted ERP credential record.')
  }
  return credentials
}

export function maskErpUserId(userId) {
  const value = String(userId || '')
  return value.length < 5 ? '••••' : `${value[0]}••••${value.slice(-2)}`
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;|&#160;|&#xA0;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
  return decodeHtml(match?.[1] ?? match?.[2] ?? match?.[3] ?? '')
}

function readLoginForm(html) {
  const uncommentedHtml = html.replace(/<!--[\s\S]*?-->/g, '')
  for (const match of uncommentedHtml.matchAll(/<form\b[^>]*>[\s\S]*?<\/form\s*>/gi)) {
    const formHtml = match[0]
    const formTag = formHtml.match(/<form\b[^>]*>/i)?.[0] || ''
    const fields = [...formHtml.matchAll(/<input\b[^>]*>/gi)].map(([tag]) => ({
      name: attribute(tag, 'name'),
      type: (attribute(tag, 'type') || 'text').toLowerCase(),
      value: attribute(tag, 'value'),
    }))
    const userField = fields.find((field) => field.name === 'username')
    const passwordField = fields.find((field) => field.name === 'password' && field.type === 'password')
    if (userField && passwordField) {
      return {
        action: attribute(formTag, 'action') || PSIT_ERP_URL,
        method: (attribute(formTag, 'method') || 'get').toLowerCase(),
        fields,
        userField,
        passwordField,
      }
    }
  }
  return null
}

function cookieHeader(cookies) {
  return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ')
}

function storeResponseCookies(headers, cookies) {
  const values = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : [headers.get('set-cookie')].filter(Boolean)
  for (const value of values) {
    const pair = value.split(';', 1)[0]
    const separator = pair.indexOf('=')
    if (separator <= 0) continue
    const name = pair.slice(0, separator).trim()
    const cookieValue = pair.slice(separator + 1).trim()
    if (/max-age=0/i.test(value) || /expires=[^;]*1970/i.test(value)) cookies.delete(name)
    else cookies.set(name, cookieValue)
  }
}

const diagnosticPaths = new Map([
  ['/erp/', '/Erp/'],
  ['/erp', '/Erp'],
  ['/erp/auth', '/Erp/Auth'],
  ['/erp/forgetpassword', '/Erp/ForgetPassword'],
  ['/student/', '/Student/'],
  ['/student', '/Student'],
  ['/student/myattendancedetail', '/Student/MyAttendanceDetail'],
  ['/student/mytimetable', '/Student/MyTimeTable'],
  ['/student/testsubjectmarksreport', '/Student/TestSubjectMarksReport'],
  ['/student/studentattrequest', '/Student/StudentAttRequest'],
  ['/student/onlinetraining', '/Student/OnlineTraining'],
  ['/student/odrequest', '/Student/ODRequest'],
  ['/student/library', '/Student/Library'],
])

function safeDiagnosticUrl(url) {
  if (url.protocol !== 'https:' || url.hostname !== 'erp.psit.ac.in') return '[external origin blocked]'
  const lowerPath = url.pathname.toLowerCase()
  const pathname = /^\/student\/examcalender\/[^/]+\/?$/.test(lowerPath)
    ? '/Student/ExamCalender/:id'
    : diagnosticPaths.get(lowerPath) || '/<redacted>'
  return `https://erp.psit.ac.in${pathname}`
}

function pageText(html) {
  return decodeHtml(html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function hasSessionExpiredMessage(html) {
  return /\b(?:session (?:has )?expired|session timeout|please (?:log|sign) in again)\b/i.test(pageText(html))
}

function hasInvalidCredentialsMessage(html) {
  return /\b(?:invalid (?:credentials?|username|user id|password)|incorrect (?:username|user id|password)|wrong (?:username|user id|password)|username or password is incorrect)\b/i.test(pageText(html))
}

function hasPasswordChangeEvidence(html) {
  const passwordFields = [...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<input\b[^>]*>/gi)]
    .map(([tag]) => ({
      name: attribute(tag, 'name').toLowerCase().replace(/[^a-z]/g, ''),
      type: (attribute(tag, 'type') || 'text').toLowerCase(),
    }))
    .filter((field) => field.type === 'password')
  const names = passwordFields.map((field) => field.name)
  const hasCurrentPassword = names.some((name) => /(?:old|current).*password|password.*(?:old|current)/.test(name))
  const hasNewPassword = names.some((name) => /(?:new|confirm).*password|password.*(?:new|confirm)/.test(name))
  const text = pageText(html)
  const accountSpecificMessage = /\b(?:your password (?:has expired|must be changed|needs? to be changed)|you (?:must|are required to) change your password|your account (?:requires|needs) a password change)\b/i.test(text)
  return (hasCurrentPassword && hasNewPassword) || accountSpecificMessage
}

function hasAuthenticatedStudentPage(html, url) {
  if (!['/student', '/student/'].includes(url.pathname.toLowerCase()) || readLoginForm(html)) return false
  const title = pageText(html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] || '')
  const anchors = [...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)]
    .map(([, attributes, contents]) => ({
      href: attribute(`<a ${attributes}>`, 'href').toLowerCase(),
      text: pageText(contents).toLowerCase(),
    }))
  const hasLink = (pattern) => anchors.some(({ href, text }) => pattern.test(`${href} ${text}`))
  return /(?:dashboard.*student|student.*dashboard)/i.test(title)
    && hasLink(/(?:logout|log out|sign out)/)
    && hasLink(/profile|my account/)
    && hasLink(/attendance/)
    && hasLink(/timetable|time table/)
}

function hasAuthenticatedStudentSession(html) {
  if (readLoginForm(html) || hasSessionExpiredMessage(html)) return false
  const anchors = [...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)]
  return anchors.some(([, attributes, contents]) => {
    const href = attribute(`<a ${attributes}>`, 'href')
    return /(?:logout|log\s*out|sign\s*out)/i.test(href) || /^(?:logout|log\s*out|sign\s*out)$/i.test(pageText(contents))
  })
}

function detectPageType(html, url) {
  if (/<input\b[^>]*(?:captcha|one.?time|verification.?code|otp)/i.test(html)
    || /(?:captcha verification required|enter (?:the )?(?:otp|one.?time password|verification code)|two.factor authentication required)/i.test(pageText(html))) {
    return 'security_challenge'
  }
  if (url.pathname.toLowerCase() === '/erp/forgetpassword' && hasPasswordChangeEvidence(html)) return 'password_change'
  if (hasSessionExpiredMessage(html)) return 'session_expired'
  if (readLoginForm(html)) return 'login'
  if (hasAuthenticatedStudentPage(html, url)) return 'authenticated_student'
  return 'unknown'
}

function htmlLines(value) {
  return decodeHtml(value
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<br\b[^>]*>/gi, '\n')
    .replace(/<\/(?:h[1-6]|p|div|li)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function tableRows(table) {
  return [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)].map(([, row]) => (
    [...row.matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)]
      .map(([, tag, contents]) => ({
        tag: tag.toLowerCase(),
        lines: htmlLines(contents),
      }))
  ))
}

function readTable(html, headerPattern) {
  for (const [table] of html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi)) {
    const rows = tableRows(table)
    const headerIndex = rows.findIndex((row) => headerPattern(row.map((cell) => cell.lines.join(' '))))
    if (headerIndex < 0) continue
    return {
      headers: rows[headerIndex].map((cell) => cell.lines.join(' ')),
      rows: rows.slice(headerIndex + 1).map((row) => row.map((cell) => cell.lines)),
    }
  }
  return null
}

function parseTimetable(html) {
  const table = readTable(html, (headers) => /day\s*\/?\s*lecture/i.test(headers[0] || ''))
  if (!table || table.rows.length === 0) return null
  const slots = table.headers.slice(1).map((header) => {
    const periodMatch = header.match(/^\s*(\d+)(?:st|nd|rd|th)?\b/i)
    const timeMatch = header.match(/(\d{1,2})[.:](\d{2})\s*-\s*(\d{1,2})[.:](\d{2})/i)
    if (!periodMatch || !timeMatch) return null
    const period = Number(periodMatch[1])
    let startHour = Number(timeMatch[1])
    let endHour = Number(timeMatch[3])
    if (period >= 5 && startHour < 12) startHour += 12
    if (period >= 5 && endHour < 12) endHour += 12
    const pad = (value) => String(value).padStart(2, '0')
    return {
      period,
      startTime: `${pad(startHour)}:${timeMatch[2]}`,
      endTime: `${pad(endHour)}:${timeMatch[4]}`,
    }
  })
  const days = table.rows.map((row) => {
    const day = row[0]?.join(' ').trim()
    if (!day || !/^(?:mon|tue|wed|thu|fri|sat|sun)/i.test(day)) return null
    const periods = row.slice(1).flatMap((lines, index) => {
      if (!lines.length || !slots[index]) return []
      return [{
        ...slots[index],
        faculty: lines[0] || '',
        subject: lines[1] || '',
        room: lines[2] || '',
      }]
    })
    return { day, periods }
  }).filter(Boolean)
  return days.length ? { headers: table.headers, days } : null
}

function captureAttendanceValue(text, label) {
  const match = text.match(new RegExp(`${label}\\s*:\\s*([\\d,]+(?:\\.\\d+)?)`, 'i'))
  if (!match) return null
  const value = Number(match[1].replace(/,/g, ''))
  return Number.isFinite(value) ? value : null
}

function parseAttendance(html) {
  const text = pageText(html)
  const attendance = {
    totalLectures: captureAttendanceValue(text, 'Total\\s+Lecture'),
    totalAbsentPlusOaa: captureAttendanceValue(text, 'Total\\s+Absent\\s*\\+\\s*OAA'),
    oaAttendance: captureAttendanceValue(text, 'O\\.A\\.\\s*Attendance'),
    percentageWithoutPf: captureAttendanceValue(text, 'Attendance\\s*%\\s*without\\s*PF'),
    totalPf: captureAttendanceValue(text, 'Total\\s+PF'),
    percentageWithPf: captureAttendanceValue(text, 'Attendance\\s*%\\s*with\\s*PF'),
    subjectWise: null,
  }
  return attendance.percentageWithoutPf !== null || attendance.percentageWithPf !== null
    ? attendance
    : null
}

function parseTestOptions(html) {
  const select = [...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select\s*>/gi)]
    .find(([, attributes]) => attribute(`<select ${attributes}>`, 'name') === 'cTest')
  if (!select) return []
  return [...select[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option\s*>/gi)]
    .map(([, attributes, contents]) => ({
      value: attribute(`<option ${attributes}>`, 'value'),
      label: htmlLines(contents).join(' ').trim(),
    }))
    .filter((option) => option.value && option.label)
}

function parseMarks(html, rollNo) {
  const semesterTable = readTable(html, (headers) => (
    /semester/i.test(headers[0] || '')
    && /marks/i.test(headers[1] || '')
    && /percentage/i.test(headers[2] || '')
  ))
  const semesterHeaders = semesterTable?.headers || []
  const semesters = (semesterTable?.rows || []).map((row) => ({
    semester: row[0]?.join(' ').trim() || '',
    marks: row[semesterHeaders.findIndex((header) => /^marks$/i.test(header.trim()))]?.join(' ').trim() || null,
    percentage: row[semesterHeaders.findIndex((header) => /percentage/i.test(header))]?.join(' ').trim() || null,
  })).filter((semester) => semester.semester)
  const testOptions = parseTestOptions(html)
  return { semesters, testOptions }
}

function parseTestMarks(html, test, rollNo) {
  const table = readTable(html, (headers) => (
    headers.some((header) => /^rollno$/i.test(header.trim()))
    && headers.some((header) => /^student_name$/i.test(header.trim()))
  ))
  if (!table) return null
  const rollIndex = table.headers.findIndex((header) => /^rollno$/i.test(header.trim()))
  const student = table.rows.find((row) => row[rollIndex]?.join(' ').trim() === rollNo)
  if (!student) return null
  const subjects = table.headers.slice(3).flatMap((subject, index) => {
    const score = student[index + 3]?.join(' ').trim()
    return subject.trim() && score ? [{ subject: subject.trim(), score }] : []
  })
  return subjects.length ? { test, subjects } : null
}

function parseExamCalendar(html) {
  const table = readTable(html, (headers) => /examination/i.test(headers[0] || ''))
  if (!table) return null
  const exams = table.rows.map((row) => Object.fromEntries(
    table.headers.slice(0, row.length).map((header, index) => [header, row[index].join(' ').trim()]),
  )).filter((row) => Object.values(row).some(Boolean))
  return exams.length ? { headers: table.headers, exams } : null
}

function summarizeActivityStatus(cells) {
  const stages = []
  for (const { header, value } of cells) {
    if (!value) continue
    if (!/status|approval|verify|coordinator|h\.?\s*o\.?\s*d|head\s+of\s+department|director|result/i.test(header)) continue
    const stage = /director/i.test(header) ? 'Director'
      : /h\.?\s*o\.?\s*d|head\s+of\s+department/i.test(header) ? 'HOD'
        : /coordinator/i.test(header) ? 'Coordinator'
          : /verif/i.test(header) ? 'Verification'
            : /approval/i.test(header) ? 'Approval'
                    : /result/i.test(header) ? 'Result' : 'Status'
    stages.push({ stage, raw: value.slice(0, 200), normalized: normalizeRequestStatus(value) })
  }
  const normalized = stages.map(({ normalized: status }) => status)
  const overall = normalized.includes('Rejected')
    ? 'Rejected'
    : normalized.length && normalized.every((status) => status === 'Accepted')
                    ? 'Accepted'
                    : normalized.includes('Pending') ? 'Pending' : 'Unknown'
  return { overall, stages }
}

function normalizeRequestStatus(value) {
  const text = String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
  if (!text) return 'Unknown'
  if (/\b(reject(?:ed)?|declin(?:ed|e)|denied|not approved|disapproved)\b/.test(text)) return 'Rejected'
  if (/\b(accept(?:ed)?|approv(?:ed|al)|sanctioned)\b/.test(text)) return 'Accepted'
  if (/\b(pending|under review|in process|in progress|awaiting|submitted|forwarded|on hold)\b/.test(text)) return 'Pending'
  return 'Unknown'
}

function withSqliteTransaction(database, work) {
  database.exec('BEGIN IMMEDIATE')
  try {
    const result = work()
    database.exec('COMMIT')
    return result
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

function meaningfulRequestState(state) {
  return {
    requestType: state.requestType,
    submittedAt: state.submittedAt,
    examDate: state.examDate,
    testName: state.testName,
    score: state.score,
    percentage: state.percentage,
    purpose: state.purpose,
    requestedDates: state.requestedDates,
    status: state.status,
    statusStages: state.statusStages.map(({ stage, normalized }) => ({ stage, normalized })),
    remarks: state.remarks,
    approver: state.approver,
    presence: state.presence,
  }
}

function fingerprintRequestState(state) {
  return createHash('sha256').update(JSON.stringify(meaningfulRequestState(state))).digest('hex')
}

function parseActivityPage(html, kind) {
  const table = readTable(html, (headers) => {
    if (kind === 'attendance-request') return /req\.?\s*id/i.test(headers[0] || '')
    if (kind === 'online-training') {
      return /serial/i.test(headers[0] || '')
        && /exam\s*date/i.test(headers[1] || '')
        && /test\s*name/i.test(headers[2] || '')
    }
    return headers.length >= 2 && headers.some((header) => /request|req\.?\s*id|od\s*id|date|status|approval/i.test(header))
  })
  if (!table) return null
  const rows = table.rows.map((row) => {
    const cells = table.headers.map((header, index) => ({
      header,
      value: row[index]?.join(' ').trim() || '',
    }))
    const values = cells.map(({ value }) => value)
    const idHeader = kind === 'online-training'
      ? /^(?:serial(?:\s*(?:no|number))?|request\s*(?:id|no|number))\.?$/i
      : /^(?:(?:request|req|od)\s*[-.]?\s*(?:id|no|number))\.?$/i
    const requestId = (cells.find(({ header }) => idHeader.test(header.trim()))?.value || values[0]).slice(0, 120)
    if (!requestId) return null
    const requestType = (cells.find(({ header }) => /^(?:request\s*)?(?:type|category)$/i.test(header.trim()))?.value || '').slice(0, 120)
    const submittedAt = (cells.find(({ header }) => /submitted|submission/i.test(header))?.value || '').slice(0, 100)
    const updatedAt = (cells.find(({ header }) => /last\s*(?:updated|modified)|updated\s*at|modified\s*at/i.test(header))?.value || '').slice(0, 100)
    const examDate = (cells.find(({ header }) => /exam\s*date/i.test(header))?.value || '').slice(0, 100)
    const testName = (cells.find(({ header }) => /test\s*name|assessment/i.test(header))?.value || '').slice(0, 160)
    const score = (cells.find(({ header }) => /marks?\s*\/?\s*out\s*of|score/i.test(header))?.value || '').slice(0, 80)
    const percentage = (cells.find(({ header }) => /percentage/i.test(header))?.value || '').slice(0, 40)
    const requestedDates = cells
      .filter(({ header, value }) => value && /date/i.test(header) && !/submitted|submission|updated|modified|exam/i.test(header))
      .map(({ header, value }) => ({ header: header.trim().slice(0, 80), value: value.slice(0, 100) }))
    const purpose = (cells.find(({ header }) => /detail|purpose|description|reason/i.test(header) && !/remark/i.test(header))?.value || '').slice(0, 500)
    const remarks = cells
      .filter(({ header, value }) => value && /remark|comment|rejection\s*reason/i.test(header))
      .map(({ value }) => value)
      .join('; ').slice(0, 500)
    const approver = cells
      .filter(({ header, value }) => value && /assign\s*to|approver|approved\s*by|verified\s*by/i.test(header))
      .map(({ header, value }) => `${header.trim()}: ${value}`)
      .join('; ').slice(0, 200)
    const status = summarizeActivityStatus(cells)
    const label = [
      requestId && `Request #${requestId}`,
      requestType && `Type: ${requestType}`,
      purpose && `Purpose: ${purpose}`,
      requestedDates.length && `Dates: ${requestedDates.map(({ value }) => value).join(' to ')}`,
    ].filter(Boolean).join(' · ')
    const fields = {
      requestId,
      requestType,
      submittedAt,
      examDate,
      testName,
      score,
      percentage,
      purpose,
      requestedDates,
      status: status.overall,
      statusStages: status.stages,
      remarks,
      updatedAt,
      approver,
    }
    return {
      key: requestId,
      requestId,
      ...fields,
      values,
      label: label.slice(0, 300),
      sourceTimestamp: updatedAt || submittedAt,
    }
  }).filter(Boolean)
  const text = pageText(html)
  const count = text.match(/showing\s+1\s+to\s+(\d+)\s+of\s+(\d+)\s+entries/i)
  const empty = /showing\s+0\s+to\s+0\s+of\s+0\s+entries/i.test(text)
  return {
    headers: table.headers,
    rows,
    complete: empty || Boolean(count && count[1] === count[2] && rows.length === table.rows.length),
    unrecognizedStatusCount: rows.filter((row) => row.status === 'Unknown').length,
  }
}

function findAnchorByText(html, pattern) {
  for (const [, attributes, contents] of html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    if (pattern.test(htmlLines(contents).join(' '))) return attribute(`<a ${attributes}>`, 'href')
  }
  return ''
}

function parseNotices(html, capturedAt) {
  const notices = []
  for (const [, attributes, contents] of html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const title = htmlLines(contents).join(' ').slice(0, 500)
    const href = attribute(`<a ${attributes}>`, 'href')
    if (!title || !href || !/\/assets\/notice\//i.test(href)) continue
    let url
    try {
      url = new URL(href, PSIT_ERP_URL)
    } catch {
      continue
    }
    if (url.origin !== new URL(PSIT_ERP_URL).origin || !/^\/assets\/notice\//i.test(url.pathname)) continue
    const fingerprint = createHash('sha256').update(`${title}\n${url.pathname}`).digest('hex')
    notices.push({ fingerprint, title, publishedAt: '', url: url.href, capturedAt })
  }
  return [...new Map(notices.map((notice) => [notice.fingerprint, notice])).values()]
}

function summarizeTimetableChange(previous, current) {
  const indexPeriods = (timetable) => new Map((timetable?.days || []).flatMap((day) => (
    (day.periods || []).map((period) => [`${day.day}|${period.period}`, { day: day.day, ...period }])
  )))
  const before = indexPeriods(previous)
  const after = indexPeriods(current)
  const changed = []
  for (const [key, period] of after) {
    if (JSON.stringify(before.get(key)) === JSON.stringify(period)) continue
    changed.push(`${period.day} ${period.startTime}-${period.endTime}${period.subject ? ` ${period.subject}` : ''}`)
  }
  for (const [key, period] of before) {
    if (after.has(key)) continue
    changed.push(`${period.day} period ${period.period} removed`)
  }
  return changed.length ? `Timetable changed: ${changed.slice(0, 3).join('; ')}` : 'Weekly timetable changed'
}

function summarizeMarksChange(previous, current) {
  const before = new Map((previous?.marks?.assessments || []).map((item) => [item.test, JSON.stringify(item)]))
  const changedTests = (current?.marks?.assessments || [])
    .filter((item) => before.get(item.test) !== JSON.stringify(item))
    .map((item) => item.test)
  return changedTests.length
    ? `Marks changed for ${changedTests.slice(0, 4).join(', ')}`
    : 'Academic or semester marks changed'
}

function activityRowsCount(snapshots) {
  return snapshots.reduce((count, snapshot) => {
    const page = JSON.parse(snapshot.dataJson)
    return count + (Array.isArray(page.rows) ? page.rows.length : 0)
  }, 0)
}

async function requestOfficial(urlValue, options, cookies, fetchImpl, trace) {
  let url = new URL(urlValue)
  let method = options.method || 'GET'
  let body = options.body
  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    if (url.protocol !== 'https:' || url.hostname !== 'erp.psit.ac.in') {
      return { blockedRedirect: true, url, trace }
    }
    const headers = new Headers(options.headers || {})
    if (cookies.size) headers.set('cookie', cookieHeader(cookies))
    let response
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(20000),
      })
    } catch {
      trace.push({ method, status: null, requestUrl: safeDiagnosticUrl(url), redirectUrl: null, redirectPath: null })
      return { networkError: true, url, trace }
    }
    storeResponseCookies(response.headers, cookies)
    const isRedirect = [301, 302, 303, 307, 308].includes(response.status)
    const location = isRedirect ? response.headers.get('location') : null
    let target
    try {
      target = location ? new URL(location, url) : null
    } catch {
      trace.push({ method, status: response.status, requestUrl: safeDiagnosticUrl(url), redirectUrl: '[invalid redirect]', redirectPath: null })
      return { invalidRedirect: true, url, trace }
    }
    const targetIsOfficial = !target || (target.protocol === 'https:' && target.hostname === 'erp.psit.ac.in')
    trace.push({
      method,
      status: response.status,
      requestUrl: safeDiagnosticUrl(url),
      redirectUrl: target ? safeDiagnosticUrl(target) : null,
      redirectPath: targetIsOfficial ? target?.pathname || null : null,
    })
    if (![301, 302, 303, 307, 308].includes(response.status)) return { response, url }
    if (!location) return { response, url }
    if (!targetIsOfficial) return { blockedRedirect: true, url, trace }
    if (redirectCount === 5) return { tooManyRedirects: true, url, trace }
    url = target
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
      method = 'GET'
      body = undefined
    }
  }
  return { tooManyRedirects: true, url, trace }
}

function finishAuthentication(status, pageType, trace, onDiagnostic, privateSession = {}) {
  const diagnostic = {
    responses: trace.map(({ method, status: httpStatus, requestUrl, redirectUrl }) => ({
      method,
      httpStatus,
      requestUrl,
      redirectUrl,
    })),
    pageType,
    authenticationState: status,
  }
  onDiagnostic(diagnostic)
  return { status, pageType, ...privateSession }
}

function isTemporaryHttpFailure(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

function authenticationMessage(status, syncing = false) {
  const messages = {
    invalid_credentials: syncing
      ? 'PSIT explicitly rejected the saved credentials. Check the user ID and password on the official portal, then reconnect.'
      : 'PSIT explicitly rejected the submitted login. Check the user ID and password on the official portal, then reconnect.',
    password_change_required: 'PSIT explicitly requires a password change for this account. Update it on the official portal, then reconnect.',
    session_expired: 'PSIT reported an expired session. Reconnect from the dashboard to verify the account again.',
    network_error: 'Could not reach or read a response from the official PSIT ERP. Try again later.',
    unknown_response: 'PSIT returned an unrecognized login response. No new credentials were saved and login was not confirmed.',
    manual_auth_required: 'PSIT requires a manual security challenge. Complete it on the official portal; AgentFlow will not bypass CAPTCHA or MFA.',
  }
  if (status === 'connected') {
    return syncing
      ? 'PSIT login is valid, but no academic data was retrieved in this operation.'
      : 'PSIT login was verified using the authenticated student dashboard, and credentials were encrypted on this server. Run a manual sync to retrieve mapped academic data.'
  }
  return messages[status] || messages.unknown_response
}

async function authenticate(credentials, fetchImpl, onDiagnostic) {
  const cookies = new Map()
  const trace = []
  const login = await requestOfficial(PSIT_ERP_URL, {}, cookies, fetchImpl, trace)
  if (login.networkError) return finishAuthentication('network_error', 'unreachable', trace, onDiagnostic)
  if (login.blockedRedirect || login.tooManyRedirects || login.invalidRedirect || !login.response) {
    return finishAuthentication('unknown_response', 'unknown', trace, onDiagnostic)
  }
  let loginHtml
  try {
    loginHtml = await login.response.text()
  } catch {
    return finishAuthentication('network_error', 'unreadable_response', trace, onDiagnostic)
  }
  const loginPageType = detectPageType(loginHtml, login.url)
  if (isTemporaryHttpFailure(login.response.status)) {
    return finishAuthentication('network_error', loginPageType, trace, onDiagnostic)
  }
  if (!login.response.ok || loginPageType !== 'login') {
    return finishAuthentication('unknown_response', loginPageType, trace, onDiagnostic)
  }
  const form = readLoginForm(loginHtml)
  let action
  try {
    action = new URL(form?.action || '', login.url)
  } catch {
    return finishAuthentication('unknown_response', 'unknown', trace, onDiagnostic)
  }
  if (!form || form.method !== 'post' || action.origin !== new URL(PSIT_ERP_URL).origin) {
    return finishAuthentication('unknown_response', 'unknown', trace, onDiagnostic)
  }
  const fields = new URLSearchParams()
  for (const field of form.fields) {
    if (field.type === 'hidden' && field.name) fields.set(field.name, field.value)
  }
  fields.set(form.userField.name, credentials.userId)
  fields.set(form.passwordField.name, credentials.password)

  const result = await requestOfficial(action, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: fields.toString(),
  }, cookies, fetchImpl, trace)
  if (result.networkError) return finishAuthentication('network_error', 'unreachable', trace, onDiagnostic)
  if (result.blockedRedirect || result.tooManyRedirects || result.invalidRedirect || !result.response) {
    return finishAuthentication('unknown_response', 'unknown', trace, onDiagnostic)
  }
  let html
  try {
    html = await result.response.text()
  } catch {
    return finishAuthentication('network_error', 'unreadable_response', trace, onDiagnostic)
  }
  if (html.length > 2_000_000) return finishAuthentication('unknown_response', 'oversized_response', trace, onDiagnostic)
  const pageType = detectPageType(html, result.url)
  let status = 'unknown_response'
  if (isTemporaryHttpFailure(result.response.status)) {
    status = 'network_error'
  } else if (pageType === 'security_challenge') {
    status = 'manual_auth_required'
  } else if (pageType === 'session_expired') {
    status = 'session_expired'
  } else if (pageType === 'password_change'
    && trace.some((entry) => entry.method === 'POST' && entry.redirectPath?.toLowerCase() === '/erp/forgetpassword')) {
    status = 'password_change_required'
  } else if (pageType === 'login' && hasInvalidCredentialsMessage(html)) {
    status = 'invalid_credentials'
  } else if (result.response.ok && pageType === 'authenticated_student') {
    status = 'connected'
  }
  return finishAuthentication(status, pageType, trace, onDiagnostic, status === 'connected'
    ? { cookies, studentHtml: html }
    : {})
}

function reportStudentPageDiagnostic(onDiagnostic, trace, pageType, status) {
  onDiagnostic({
    responses: trace.map(({ method, status: httpStatus, requestUrl, redirectUrl }) => ({
      method,
      httpStatus,
      requestUrl,
      redirectUrl,
    })),
    pageType,
    authenticationState: status,
  })
}

async function fetchStudentPage(path, cookies, fetchImpl, onDiagnostic, requestOptions = {}) {
  const trace = []
  const result = await requestOfficial(new URL(path, PSIT_ERP_URL), requestOptions, cookies, fetchImpl, trace)
  if (result.networkError) {
    reportStudentPageDiagnostic(onDiagnostic, trace, 'unreachable', 'network_error')
    return { status: 'network_error' }
  }
  if (result.blockedRedirect || result.tooManyRedirects || result.invalidRedirect || !result.response) {
    reportStudentPageDiagnostic(onDiagnostic, trace, 'unknown', 'unknown_response')
    return { status: 'unknown_response' }
  }
  let html
  try {
    html = await result.response.text()
  } catch {
    reportStudentPageDiagnostic(onDiagnostic, trace, 'unreadable_response', 'network_error')
    return { status: 'network_error' }
  }
  if (html.length > 2_000_000) {
    reportStudentPageDiagnostic(onDiagnostic, trace, 'oversized_response', 'unknown_response')
    return { status: 'unknown_response' }
  }
  const pageType = detectPageType(html, result.url)
  if (pageType === 'login' || pageType === 'session_expired') {
    reportStudentPageDiagnostic(onDiagnostic, trace, pageType, 'session_expired')
    return { status: 'session_expired' }
  }
  if (isTemporaryHttpFailure(result.response.status)) {
    reportStudentPageDiagnostic(onDiagnostic, trace, pageType, 'network_error')
    return { status: 'network_error' }
  }
  const expectedPath = new URL(path, PSIT_ERP_URL).pathname.toLowerCase()
  if (!result.response.ok || result.url.pathname.toLowerCase() !== expectedPath
    || !hasAuthenticatedStudentSession(html)) {
    reportStudentPageDiagnostic(onDiagnostic, trace, pageType, 'unknown_response')
    return { status: 'unknown_response' }
  }
  reportStudentPageDiagnostic(onDiagnostic, trace, pageType, 'connected')
  return { status: 'connected', html }
}

export class PsitErpService {
  constructor({
    database,
    encryptionKey = process.env.PSIT_ERP_CREDENTIAL_ENCRYPTION_KEY,
    fetchImpl = fetch,
    monitoringIntervalMinutes = 15,
    notificationRetentionDays = 90,
    notifyChanges = async () => false,
    onDiagnostic = (diagnostic) => console.info(`[PSIT ERP auth] ${JSON.stringify(diagnostic)}`),
  }) {
    this.database = database
    this.encryptionKey = encryptionKey
    this.fetchImpl = fetchImpl
    this.monitoringIntervalMinutes = monitoringIntervalMinutes
    this.notificationRetentionDays = notificationRetentionDays
    this.notifyChanges = notifyChanges
    this.onDiagnostic = onDiagnostic
    this.session = null
    this.syncPromise = null
    this.statusParserWarnings = new Set()
  }

  getState() {
    const connection = this.database.db.prepare(`SELECT user_id_masked AS userIdMasked,
      credential_source AS credentialSource, status,
      connected_at AS connectedAt, last_sync_at AS lastSyncAt, updated_at AS updatedAt
      FROM psit_erp_connection WHERE id = 1`).get()
    const snapshots = {
      attendance: this.database.db.prepare('SELECT captured_at AS capturedAt, data_json AS dataJson FROM psit_erp_attendance_snapshots ORDER BY id DESC LIMIT 1').get(),
      timetable: this.database.db.prepare('SELECT captured_at AS capturedAt, data_json AS dataJson FROM psit_erp_timetable_snapshots ORDER BY id DESC LIMIT 1').get(),
      academic: this.database.db.prepare(`SELECT updated_at AS updatedAt, data_json AS dataJson
        FROM psit_erp_academic_records WHERE record_type IN ('academic', 'exam-calendar', 'marks')
        ORDER BY updated_at`).all(),
      activity: this.database.db.prepare(`SELECT record_type AS recordType, updated_at AS updatedAt, data_json AS dataJson
        FROM psit_erp_academic_records WHERE record_type LIKE 'activity-%' ORDER BY updated_at`).all(),
      notices: this.database.db.prepare('SELECT published_at AS publishedAt, data_json AS dataJson FROM psit_erp_notices ORDER BY id DESC LIMIT 10').all(),
    }
    const history = this.database.db.prepare(`SELECT id, status, started_at AS startedAt,
      completed_at AS completedAt, message FROM psit_erp_sync_history ORDER BY id DESC LIMIT 20`).all()
    const attendanceReports = this.database.db.prepare(`SELECT report_date AS reportDate,
      report_slot AS reportSlot, status, attempts, last_error AS lastError, delivered_at AS deliveredAt
      FROM psit_erp_attendance_reports ORDER BY report_date DESC, report_slot DESC LIMIT 6`).all()
    const credentialsStored = Boolean(this.getCredentialRecord()?.credentialCiphertext)
    const environment = this.readEnvironmentCredentials()
    const environmentManaged = environment.configured || connection?.credentialSource === 'environment'
    const credentialsAvailable = environmentManaged ? environment.complete : credentialsStored
    const connected = credentialsAvailable && Boolean(this.session) && connection?.status === 'connected'
    const scheduler = this.database.db.prepare(`SELECT next_sync_at AS nextSyncAt,
      last_successful_sync_at AS lastSuccessfulSyncAt, status AS schedulerStatus,
      failure_category AS failureCategory, paused, last_error AS lastError
      FROM psit_erp_scheduler_state WHERE id = 1`).get()
    const rawRecentChanges = this.database.db.prepare(`SELECT source, action, summary,
      source_timestamp AS sourceTimestamp, detected_at AS detectedAt, delivered_at AS deliveredAt,
      record_id AS recordId, previous_status AS previousStatus, current_status AS currentStatus,
      details_json AS detailsJson, pending.delivery_status AS deliveryStatus,
      pending.last_error AS deliveryError
      FROM psit_erp_detected_changes
      LEFT JOIN psit_erp_pending_notifications AS pending USING(fingerprint)
      ORDER BY id DESC LIMIT 100`).all()
    const groupedChanges = new Map()
    for (const change of rawRecentChanges) {
      const key = [change.source, change.action, change.recordId, change.previousStatus, change.currentStatus, change.summary].join('|')
      if (groupedChanges.has(key)) {
        groupedChanges.get(key).duplicateCount += 1
        continue
      }
      const { detailsJson, ...publicChange } = change
      groupedChanges.set(key, {
        ...publicChange,
        details: JSON.parse(detailsJson || '{}'),
        duplicateCount: 1,
      })
    }
    const recentChanges = [...groupedChanges.values()].slice(0, 20)
    const timetable = snapshots.timetable ? JSON.parse(snapshots.timetable.dataJson) : null
    const academic = snapshots.academic.reduce((result, snapshot) => (
      Object.assign(result, JSON.parse(snapshot.dataJson))
    ), {})
    const activity = Object.fromEntries(snapshots.activity.map((snapshot) => {
      const page = JSON.parse(snapshot.dataJson)
      const latestRow = page.rows.at(-1)
      return [snapshot.recordType.slice('activity-'.length), {
        rowCount: page.rows.length,
        updatedAt: snapshot.updatedAt,
        latestLabel: latestRow?.label || '',
        latestStatus: latestRow?.status || '',
      }]
    }))
    const noticesData = snapshots.notices.map((notice) => JSON.parse(notice.dataJson))
    const noticeCount = this.database.db.prepare('SELECT COUNT(*) AS count FROM psit_erp_notices').get().count
    const retrievedRecordCount = activityRowsCount(snapshots.activity)
      + (snapshots.attendance ? 1 : 0)
      + (timetable?.days || []).reduce((count, day) => count + (day.periods || []).length, 0)
      + (academic?.marks?.semesters || []).length
      + (academic?.marks?.assessments || []).reduce((count, assessment) => count + Math.max(assessment.subjects?.length || 0, 1), 0)
      + (academic?.examCalendar?.exams || []).length
      + noticeCount
    const availability = {
      attendance: Boolean(snapshots.attendance),
      timetable: Boolean(timetable),
      marks: Boolean(academic?.marks),
      examCalendar: Boolean(academic?.examCalendar),
      notices: noticesData.length > 0,
      library: Boolean(academic?.library),
      attendanceRequests: Boolean(activity['attendance-request']),
      onlineTraining: Boolean(activity['online-training']),
      odRequests: Boolean(activity['od-request']),
    }
    return {
      connected,
      credentialsStored,
      credentialsAvailable,
      environmentConfigured: environment.complete,
      environmentCredentialsPresent: environment.configured,
      credentialSource: environmentManaged ? 'environment' : credentialsStored ? 'dashboard' : 'none',
      status: environmentManaged && !environment.complete
        ? 'configuration_error'
        : connection?.status === 'connected' && !this.session ? 'reauthentication_pending' : connection?.status || 'disconnected',
      userIdMasked: environmentManaged ? '' : connection?.userIdMasked || '',
      connectedAt: connection?.connectedAt || null,
      lastSyncAt: connection?.lastSyncAt || null,
      lastSuccessfulSyncAt: scheduler?.lastSuccessfulSyncAt || '',
      lastSyncError: scheduler?.lastError || '',
      retrievedRecordCount,
      nextScheduledSyncAt: scheduler?.nextSyncAt || '',
      schedulerStatus: scheduler?.schedulerStatus || 'idle',
      failureCategory: scheduler?.failureCategory || '',
      syncPaused: Boolean(scheduler?.paused),
      automaticSyncEnabled: credentialsAvailable && !scheduler?.paused,
      sessionStatus: this.session ? 'authenticated_in_memory' : credentialsAvailable ? 'authentication_required' : 'not_configured',
      monitoringIntervalMinutes: this.monitoringIntervalMinutes,
      encryptionConfigured: environment.complete || this.hasEncryptionKey(),
      dataRetrievalAvailable: availability.attendance || availability.timetable
        || availability.marks || availability.examCalendar || availability.notices
        || availability.attendanceRequests || availability.onlineTraining || availability.odRequests,
      availability,
      data: {
        attendance: snapshots.attendance ? JSON.parse(snapshots.attendance.dataJson) : null,
        attendanceUpdatedAt: snapshots.attendance?.capturedAt || null,
        timetable,
        timetableUpdatedAt: snapshots.timetable?.capturedAt || null,
        academic: Object.keys(academic).length ? academic : null,
        academicUpdatedAt: snapshots.academic.at(-1)?.updatedAt || null,
        activity,
        notices: noticesData,
      },
      history,
      recentChanges,
      attendanceReports,
      notificationRetentionDays: this.notificationRetentionDays,
      monitoredModules: ['attendance requests', 'online training', 'OD requests', 'attendance', 'timetable', 'marks', 'notices', 'exam calendar'],
      limitation: 'Overall attendance, semester and test marks, timetable, academic notices, and the exam calendar are retrieved from authenticated PSIT pages. Attendance requests, online training results, and OD requests are monitored when authenticated pages expose recognizable records. Subject-wise attendance and current library dues are not available from the mapped pages.',
    }
  }

  hasEncryptionKey() {
    try {
      getErpEncryptionKey(this.encryptionKey)
      return true
    } catch {
      return false
    }
  }

  getCredentialRecord() {
    return this.database.db.prepare('SELECT credential_ciphertext AS credentialCiphertext FROM psit_erp_connection WHERE id = 1').get()
  }

  readEnvironmentCredentials() {
    const userId = String(process.env.PSIT_ERP_USER_ID || '').trim()
    const password = String(process.env.PSIT_ERP_PASSWORD || '')
    const configured = Boolean(userId || password)
    return { configured, complete: Boolean(userId && password), userId, password }
  }

  resolveCredentials() {
    const environment = this.readEnvironmentCredentials()
    if (environment.configured) {
      return environment.complete
        ? { source: 'environment', credentials: { userId: environment.userId, password: environment.password } }
        : { status: 'configuration_error', source: 'environment' }
    }
    const connection = this.database.db.prepare('SELECT credential_source AS credentialSource FROM psit_erp_connection WHERE id = 1').get()
    if (connection?.credentialSource === 'environment') return { status: 'configuration_error', source: 'environment' }
    const record = this.getCredentialRecord()
    if (!record?.credentialCiphertext) return { status: 'disconnected' }
    try {
      return { source: 'dashboard', credentials: decryptErpCredentials(record.credentialCiphertext, this.encryptionKey) }
    } catch {
      return { status: 'credential_decryption_error' }
    }
  }

  updateAuthenticationState(status, source, credentials, connectedAt = null) {
    const stored = this.getCredentialRecord()?.credentialCiphertext || null
    this.updateConnection({
      status,
      userIdMasked: source === 'environment' ? '' : maskErpUserId(credentials.userId),
      credentialCiphertext: stored,
      connectedAt,
      credentialSource: source,
    })
  }

  credentialFingerprint(credentials) {
    return createHash('sha256').update(`${credentials.userId}\0${credentials.password}`).digest('hex')
  }

  async authenticateSession(credentials, source, force = false) {
    const fingerprint = this.credentialFingerprint(credentials)
    if (!force && this.session?.credentialFingerprint === fingerprint) {
      const verified = await fetchStudentPage('/Student/', this.session.cookies, this.fetchImpl, this.onDiagnostic)
      if (verified.status === 'connected') {
        this.session.studentHtml = verified.html
        return { status: 'connected', ...this.session, reused: true }
      }
      if (verified.status === 'network_error' || verified.status === 'unknown_response') return verified
    }

    this.session = null
    const result = await authenticate(credentials, this.fetchImpl, this.onDiagnostic)
    if (result.status !== 'connected') return result
    this.session = {
      cookies: result.cookies,
      studentHtml: result.studentHtml,
      credentialFingerprint: fingerprint,
    }
    this.updateAuthenticationState('connected', source, credentials, new Date().toISOString())
    return { status: 'connected', ...this.session, reused: false }
  }

  async fetchAuthenticatedPage(path, credentials, source, requestOptions = {}) {
    if (!this.session) {
      const auth = await this.authenticateSession(credentials, source)
      if (auth.status !== 'connected') return { status: auth.status, sessionLost: true }
    }
    let page = await fetchStudentPage(path, this.session.cookies, this.fetchImpl, this.onDiagnostic, requestOptions)
    if (page.status !== 'session_expired') return page

    const auth = await this.authenticateSession(credentials, source, true)
    if (auth.status !== 'connected') return { status: auth.status, sessionLost: true }
    page = await fetchStudentPage(path, this.session.cookies, this.fetchImpl, this.onDiagnostic, requestOptions)
    return page
  }

  finishSyncFailure(status, source, credentials, message = authenticationMessage(status, true)) {
    this.session = null
    this.updateAuthenticationState(status, source, credentials)
    this.recordSync(status, message)
    return { status, message, retryable: status === 'network_error' }
  }

  updateConnection({ status, userIdMasked = '', credentialCiphertext = null, connectedAt = null, credentialSource = 'dashboard' }) {
    const now = new Date().toISOString()
    this.database.db.prepare(`INSERT INTO psit_erp_connection(
      id, user_id_masked, credential_ciphertext, credential_source, status, connected_at, updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET user_id_masked = excluded.user_id_masked,
      credential_ciphertext = excluded.credential_ciphertext, status = excluded.status,
      credential_source = excluded.credential_source,
      connected_at = COALESCE(excluded.connected_at, psit_erp_connection.connected_at),
      updated_at = excluded.updated_at`).run(
      userIdMasked, credentialCiphertext, credentialSource, status, connectedAt, now,
    )
  }

  recordSync(status, message) {
    const now = new Date().toISOString()
    this.database.db.prepare(`INSERT INTO psit_erp_sync_history(status, started_at, completed_at, message)
      VALUES (?, ?, ?, ?)`).run(status, now, now, message)
    this.database.db.prepare('UPDATE psit_erp_connection SET updated_at = ? WHERE id = 1').run(now)
  }

  queueDetectedChange({ source, action, label, status = '', sourceTimestamp = '' }, capturedAt) {
    const fingerprint = createHash('sha256')
      .update(`${source}\n${action}\n${label}\n${status}\n${sourceTimestamp}\n${capturedAt}`)
      .digest('hex')
    const inserted = this.database.db.prepare(`INSERT OR IGNORE INTO psit_erp_pending_notifications(
      fingerprint, payload_json, created_at
    ) VALUES (?, ?, ?)`).run(fingerprint, JSON.stringify({
      page: source,
      action,
      label,
      status,
      sourceTimestamp,
    }), capturedAt)
    if (!inserted.changes) return false
    this.database.db.prepare(`INSERT OR IGNORE INTO psit_erp_detected_changes(
      fingerprint, source, action, summary, source_timestamp, detected_at
    ) VALUES (?, ?, ?, ?, ?, ?)`).run(
      fingerprint,
      source,
      action,
      [label, status].filter(Boolean).join(' · ').slice(0, 240),
      sourceTimestamp,
      capturedAt,
    )
    return true
  }

  async persistActivityPages(pages, capturedAt) {
    const database = this.database.db
    const queuedChanges = []
    for (const { type, data } of pages) {
      if (!data) continue
      const recordType = `activity-${type}`
      const baseline = database.prepare(`SELECT 1 FROM psit_erp_monitoring_baseline WHERE module = ?`).get(type)
      withSqliteTransaction(database, () => {
        for (const row of data.rows) {
          const recordId = String(row.requestId || '').trim()
          if (!recordId) continue
          const previousRow = database.prepare(`SELECT state_fingerprint AS stateFingerprint,
            state_json AS stateJson, revision FROM psit_erp_request_state
            WHERE module = ? AND record_id = ?`).get(type, recordId)
          const previous = previousRow ? JSON.parse(previousRow.stateJson) : null
          const next = {
            requestId: recordId,
            requestType: row.requestType || '',
            submittedAt: row.submittedAt || '',
            examDate: row.examDate || '',
            testName: row.testName || '',
            score: row.score || '',
            percentage: row.percentage || '',
            purpose: row.purpose || '',
            requestedDates: row.requestedDates || [],
            status: row.status || 'Unknown',
            statusStages: row.statusStages || [],
            remarks: row.remarks || '',
            updatedAt: row.updatedAt || '',
            approver: row.approver || '',
            presence: 'listed',
          }
          if (previous && next.status === 'Unknown' && previous.status !== 'Unknown') {
            next.status = previous.status
            next.statusStages = previous.statusStages
          }
          const stateFingerprint = fingerprintRequestState(next)
          if (previousRow?.stateFingerprint === stateFingerprint) {
            if (JSON.stringify(previous) !== JSON.stringify(next)) {
              database.prepare(`UPDATE psit_erp_request_state SET state_json = ?, updated_at = ?
                WHERE module = ? AND record_id = ?`).run(JSON.stringify(next), capturedAt, type, recordId)
            }
            continue
          }
          const revision = (previousRow?.revision || 0) + 1
          database.prepare(`INSERT INTO psit_erp_request_state(
            module, record_id, state_fingerprint, state_json, revision, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(module, record_id) DO UPDATE SET state_fingerprint = excluded.state_fingerprint,
            state_json = excluded.state_json, revision = excluded.revision, updated_at = excluded.updated_at`)
            .run(type, recordId, stateFingerprint, JSON.stringify(next), revision, capturedAt)

          let action = ''
          let previousStatus = previous?.status || ''
          if (!previous && baseline && next.status === 'Pending') action = 'new'
          else if (previous && previous.status !== 'Unknown'
            && previous.status !== next.status && next.status !== 'Unknown') action = 'updated'
          if (!action) continue

          const fingerprint = createHash('sha256')
            .update(`${type}\n${recordId}\n${revision}\n${previousStatus}\n${next.status}\n${stateFingerprint}`)
            .digest('hex')
          const details = {
            requestId: recordId,
            requestType: next.requestType,
            submittedAt: next.submittedAt,
            examDate: next.examDate,
            testName: next.testName,
            score: next.score,
            percentage: next.percentage,
            purpose: next.purpose,
            requestedDates: next.requestedDates,
            remarks: next.remarks,
            updatedAt: next.updatedAt,
            approver: next.approver,
            statusStages: next.statusStages,
          }
          const notification = {
            fingerprint,
            page: type,
            action,
            requestId: recordId,
            previousStatus,
            currentStatus: next.status,
            status: next.statusStages.map(({ stage, raw }) => `${stage}: ${raw}`).join('; ') || next.status,
            label: row.label || '',
            sourceTimestamp: next.updatedAt || next.submittedAt,
            details,
          }
          database.prepare(`INSERT OR IGNORE INTO psit_erp_pending_notifications(
            fingerprint, payload_json, created_at, delivery_status
          ) VALUES (?, ?, ?, 'pending')`).run(fingerprint, JSON.stringify(notification), capturedAt)
          database.prepare(`INSERT OR IGNORE INTO psit_erp_detected_changes(
            fingerprint, source, action, summary, source_timestamp, detected_at, record_id,
            previous_status, current_status, details_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            fingerprint,
            type,
            action,
            `${recordId}: ${previousStatus || 'New'} → ${next.status}${next.purpose ? ` · ${next.purpose}` : ''}`.slice(0, 400),
            notification.sourceTimestamp,
            capturedAt,
            recordId,
            previousStatus,
            next.status,
            JSON.stringify(details),
          )
          queuedChanges.push(notification)
        }
        if (baseline && data.complete) {
          const listedIds = new Set(data.rows.map((row) => String(row.requestId || '').trim()).filter(Boolean))
          const knownRecords = database.prepare(`SELECT record_id AS recordId, state_json AS stateJson,
            revision FROM psit_erp_request_state WHERE module = ?`).all(type)
          for (const known of knownRecords) {
            if (listedIds.has(known.recordId)) continue
            const previous = JSON.parse(known.stateJson)
            if (previous.presence === 'not_listed') continue
            const next = { ...previous, presence: 'not_listed' }
            const revision = known.revision + 1
            const stateFingerprint = fingerprintRequestState(next)
            database.prepare(`UPDATE psit_erp_request_state SET state_fingerprint = ?, state_json = ?,
              revision = ?, updated_at = ? WHERE module = ? AND record_id = ?`).run(
              stateFingerprint, JSON.stringify(next), revision, capturedAt, type, known.recordId,
            )
            const fingerprint = createHash('sha256')
              .update(`${type}\n${known.recordId}\n${revision}\nnot-listed\n${stateFingerprint}`)
              .digest('hex')
            const notification = {
              fingerprint,
              page: type,
              action: 'deleted',
              requestId: known.recordId,
              previousStatus: previous.status || 'Unknown',
              currentStatus: previous.status || 'Unknown',
              status: 'No longer listed in the complete ERP record list',
              label: `Request #${known.recordId}`,
              sourceTimestamp: previous.updatedAt || previous.submittedAt || '',
              details: {
                requestId: known.recordId,
                requestType: previous.requestType || '',
                purpose: previous.purpose || '',
                requestedDates: previous.requestedDates || [],
                remarks: previous.remarks || '',
              },
            }
            database.prepare(`INSERT OR IGNORE INTO psit_erp_pending_notifications(
              fingerprint, payload_json, created_at, delivery_status
            ) VALUES (?, ?, ?, 'pending')`).run(fingerprint, JSON.stringify(notification), capturedAt)
            database.prepare(`INSERT OR IGNORE INTO psit_erp_detected_changes(
              fingerprint, source, action, summary, source_timestamp, detected_at, record_id,
              previous_status, current_status, details_json
            ) VALUES (?, ?, 'deleted', ?, ?, ?, ?, ?, ?, ?)`).run(
              fingerprint,
              type,
              `${known.recordId}: no longer listed in complete ERP results`,
              notification.sourceTimestamp,
              capturedAt,
              known.recordId,
              notification.previousStatus,
              notification.currentStatus,
              JSON.stringify(notification.details),
            )
            queuedChanges.push(notification)
          }
        }
        database.prepare(`INSERT OR IGNORE INTO psit_erp_monitoring_baseline(module, established_at)
          VALUES (?, ?)`).run(type, capturedAt)
        database.prepare(`INSERT INTO psit_erp_academic_records(record_type, source_id, data_json, updated_at)
          VALUES (?, 'student', ?, ?)
          ON CONFLICT(record_type, source_id) DO UPDATE SET data_json = excluded.data_json,
            updated_at = excluded.updated_at`).run(recordType, JSON.stringify(data), capturedAt)
      })
    }
    await this.deliverPendingNotifications(capturedAt)
    return queuedChanges
  }

  async deliverPendingNotifications(capturedAt) {
    const database = this.database.db
    const staleSendingBefore = new Date(Date.parse(capturedAt) - 5 * 60000).toISOString()
    database.prepare(`UPDATE psit_erp_pending_notifications SET delivery_status = 'uncertain',
      last_error = 'Previous delivery ended without a recorded Telegram response.'
      WHERE delivery_status = 'sending' AND last_attempt_at < ?`).run(staleSendingBefore)
    const pending = database.prepare(`SELECT fingerprint, payload_json AS payloadJson,
      attempts, last_attempt_at AS lastAttemptAt
      FROM psit_erp_pending_notifications WHERE delivery_status = 'pending'
      ORDER BY created_at LIMIT 10`).all()
    if (!pending.length) return []
    const retryReady = pending.filter((row) => {
      if (!row.lastAttemptAt) return true
      const delay = Math.min(60, 2 ** Math.max(0, row.attempts - 1)) * 60000
      return Date.parse(capturedAt) - Date.parse(row.lastAttemptAt) >= delay
    })
    const notifications = retryReady.map((row) => ({
      fingerprint: row.fingerprint,
      ...JSON.parse(row.payloadJson),
    }))
    const delivered = []
    for (const notification of notifications) {
      const claimed = database.prepare(`UPDATE psit_erp_pending_notifications SET
        delivery_status = 'sending', attempts = attempts + 1, last_attempt_at = ?, last_error = ''
        WHERE fingerprint = ? AND delivery_status = 'pending'`).run(capturedAt, notification.fingerprint).changes
      if (!claimed) continue
      const { fingerprint, ...payload } = notification
      try {
        if (!await this.notifyChanges([payload])) {
          database.prepare(`UPDATE psit_erp_pending_notifications SET delivery_status = 'pending',
            last_error = 'Telegram is not configured.' WHERE fingerprint = ?`).run(fingerprint)
          continue
        }
      } catch (error) {
        const uncertain = Boolean(error.deliveryUncertain)
        database.prepare(`UPDATE psit_erp_pending_notifications SET delivery_status = ?,
          last_error = ? WHERE fingerprint = ?`).run(
          uncertain ? 'uncertain' : 'pending',
          String(error.message || 'Telegram delivery failed').slice(0, 240),
          fingerprint,
        )
        if (uncertain) database.prepare(`UPDATE psit_erp_detected_changes SET
          summary = summary || ' · delivery outcome uncertain' WHERE fingerprint = ?`).run(fingerprint)
        continue
      }
      const insert = database.prepare(`INSERT OR IGNORE INTO psit_erp_notification_fingerprints(
        fingerprint, notification_type, created_at
      ) VALUES (?, ?, ?)`)
      const deletePending = database.prepare('DELETE FROM psit_erp_pending_notifications WHERE fingerprint = ?')
      const markDelivered = database.prepare('UPDATE psit_erp_detected_changes SET delivered_at = ? WHERE fingerprint = ?')
      insert.run(fingerprint, `erp-${payload.page}`, capturedAt)
      deletePending.run(fingerprint)
      markDelivered.run(capturedAt, fingerprint)
      delivered.push(payload)
    }
    return delivered
  }

  cleanupHistory(now = new Date()) {
    const cutoff = new Date(now.getTime() - this.notificationRetentionDays * 86400000).toISOString()
    const database = this.database.db
    withSqliteTransaction(database, () => {
      database.prepare(`DELETE FROM psit_erp_detected_changes
        WHERE delivered_at != '' AND delivered_at < ?`).run(cutoff)
      database.prepare(`DELETE FROM psit_erp_notification_fingerprints
        WHERE created_at < ? AND fingerprint NOT IN (
          SELECT fingerprint FROM psit_erp_pending_notifications
        )`).run(cutoff)
      database.prepare(`DELETE FROM psit_erp_sync_history
        WHERE completed_at < ? AND id NOT IN (
          SELECT id FROM psit_erp_sync_history ORDER BY id DESC LIMIT 100
        )`).run(cutoff)
      database.prepare(`DELETE FROM psit_erp_notices WHERE id NOT IN (
        SELECT id FROM psit_erp_notices ORDER BY id DESC LIMIT 500
      )`).run()
      database.prepare(`DELETE FROM psit_erp_attendance_reports
        WHERE status = 'delivered' AND report_date < ?`).run(cutoff.slice(0, 10))
    })
  }

  async connect(userId, password) {
    if (this.readEnvironmentCredentials().configured) {
      const error = new Error('PSIT credentials are managed by backend environment variables; update those variables to change the account.')
      error.status = 409
      throw error
    }
    const key = getErpEncryptionKey(this.encryptionKey)
    if (typeof userId !== 'string' || !userId.trim() || userId.trim().length > 120
      || typeof password !== 'string' || !password || password.length > 1024
      || /[\0\r\n]/.test(userId) || /[\0\r\n]/.test(password)) {
      const error = new Error('Enter a valid ERP user ID and password.')
      error.status = 400
      throw error
    }
    const credentials = { userId: userId.trim(), password }
    const result = await authenticate(credentials, this.fetchImpl, this.onDiagnostic)
    if (result.status !== 'connected') {
      const message = authenticationMessage(result.status)
      this.updateConnection({ status: result.status, userIdMasked: maskErpUserId(credentials.userId) })
      this.recordSync(result.status, message)
      return { status: result.status, message }
    }
    this.session = {
      cookies: result.cookies,
      studentHtml: result.studentHtml,
      credentialFingerprint: this.credentialFingerprint(credentials),
    }
    this.updateConnection({
      status: 'connected',
      userIdMasked: maskErpUserId(credentials.userId),
      credentialCiphertext: encryptErpCredentials(credentials, key),
      connectedAt: new Date().toISOString(),
    })
    return {
      status: 'connected',
      message: authenticationMessage('connected'),
    }
  }

  sync(options = {}) {
    if (this.syncPromise) return this.syncPromise
    this.syncPromise = this.performSync(options).finally(() => { this.syncPromise = null })
    return this.syncPromise
  }

  hasCachedSession() {
    return Boolean(this.session)
  }

  async performSync({ monitorOnly = false } = {}) {
    const resolved = this.resolveCredentials()
    if (!resolved.credentials) {
      if (resolved.status === 'disconnected') {
        const error = new Error('Configure PSIT ERP credentials in the backend environment or connect an account from the dashboard.')
        error.status = 409
        throw error
      }
      const messages = {
        configuration_error: 'Set both PSIT_ERP_USER_ID and PSIT_ERP_PASSWORD in the backend environment.',
        credential_decryption_error: 'Stored PSIT credentials could not be decrypted. Reconnect the account with the configured encryption key.',
        disconnected: 'Configure PSIT ERP credentials in the backend environment or connect an account from the dashboard.',
      }
      const status = resolved.status || 'disconnected'
      const message = messages[status] || messages.disconnected
      this.updateConnection({
        status,
        userIdMasked: '',
        credentialCiphertext: this.getCredentialRecord()?.credentialCiphertext || null,
        credentialSource: resolved.source || 'dashboard',
      })
      this.recordSync(status, message)
      return { status, message, retryable: false }
    }
    const { credentials, source } = resolved
    const result = await this.authenticateSession(credentials, source)
    if (result.status !== 'connected') {
      return this.finishSyncFailure(result.status, source, credentials)
    }
    const capturedAt = new Date().toISOString()
    this.cleanupHistory(new Date(capturedAt))
    const activityDefinitions = [
      { type: 'attendance-request', path: '/Student/StudentAttRequest' },
      { type: 'online-training', path: '/Student/OnlineTraining' },
      { type: 'od-request', path: '/Student/ODRequest' },
    ]
    const activityPages = []
    const activityFailures = []
    let retryableFailure = false
    for (const definition of activityDefinitions) {
      const page = await this.fetchAuthenticatedPage(definition.path, credentials, source)
      if (page.sessionLost) return this.finishSyncFailure(page.status, source, credentials)
      if (page.status === 'network_error') retryableFailure = true
      if (page.status !== 'connected') {
        activityFailures.push(`${definition.type} (${page.status})`)
        continue
      }
      const data = parseActivityPage(page.html, definition.type)
      if (data) activityPages.push({ type: definition.type, data })
      else activityFailures.push(`${definition.type} (content not recognized)`)
      if (data && definition.type !== 'online-training' && data.unrecognizedStatusCount) {
        if (!this.statusParserWarnings.has(definition.type)) {
          console.warn(`[PSIT ERP parser] Could not normalize status for ${definition.type}; preserving any previously verified status.`)
          this.statusParserWarnings.add(definition.type)
        }
      } else if (data) {
        this.statusParserWarnings.delete(definition.type)
      }
    }
    const activityChanges = await this.persistActivityPages(activityPages, capturedAt)
    if (monitorOnly) {
      const message = activityFailures.length
        ? `Checked PSIT activity pages; could not read ${activityFailures.join(', ')}.`
        : 'Checked PSIT attendance requests, online training results, and OD requests.'
      this.updateAuthenticationState('connected', source, credentials)
      this.database.db.prepare('UPDATE psit_erp_connection SET last_sync_at = ? WHERE id = 1').run(capturedAt)
      this.recordSync(activityFailures.length ? 'partial' : 'completed', message)
      return { status: activityFailures.length ? 'partial' : 'completed', message, changes: activityChanges, retryable: retryableFailure }
    }
    const notices = parseNotices(result.studentHtml, capturedAt)
    const attendancePage = await this.fetchAuthenticatedPage('/Student/MyAttendanceDetail', credentials, source)
    if (attendancePage.sessionLost) return this.finishSyncFailure(attendancePage.status, source, credentials)
    if (attendancePage.status === 'network_error') retryableFailure = true
    const attendance = attendancePage.status === 'connected' ? parseAttendance(attendancePage.html) : null

    const timetablePage = await this.fetchAuthenticatedPage('/Student/MyTimeTable', credentials, source)
    if (timetablePage.sessionLost) return this.finishSyncFailure(timetablePage.status, source, credentials)
    if (timetablePage.status === 'network_error') retryableFailure = true
    const timetable = timetablePage.status === 'connected' ? parseTimetable(timetablePage.html) : null

    const marksPage = await this.fetchAuthenticatedPage('/Student/TestSubjectMarksReport', credentials, source)
    if (marksPage.sessionLost) return this.finishSyncFailure(marksPage.status, source, credentials)
    if (marksPage.status === 'network_error') retryableFailure = true
    let marks = null
    let failedMarkReports = 0
    let missingMarkRows = 0
    let skippedMarkReports = 0
    if (marksPage.status === 'connected') {
      const parsedMarks = parseMarks(marksPage.html, credentials.userId)
      const assessments = []
      skippedMarkReports = Math.max(0, parsedMarks.testOptions.length - 20)
      for (const option of parsedMarks.testOptions.slice(0, 20)) {
        const reportPage = await this.fetchAuthenticatedPage(
          '/Student/TestSubjectMarksReport',
          credentials,
          source,
          {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ cTest: option.value }).toString(),
          },
        )
        if (reportPage.sessionLost) return this.finishSyncFailure(reportPage.status, source, credentials)
        if (reportPage.status === 'network_error') retryableFailure = true
        if (reportPage.status !== 'connected') {
          failedMarkReports += 1
          continue
        }
        const assessment = parseTestMarks(reportPage.html, option.label, credentials.userId)
        if (assessment) assessments.push(assessment)
        else missingMarkRows += 1
      }
      if (parsedMarks.semesters.length || assessments.length) {
        marks = { semesters: parsedMarks.semesters, assessments }
      }
    }
    let examCalendar = null
    const examHref = findAnchorByText(result.studentHtml, /^Exam Calendar$/i)
    if (examHref) {
      let examUrl
      try {
        examUrl = new URL(examHref, PSIT_ERP_URL)
      } catch {
        examUrl = null
      }
      if (examUrl?.origin === new URL(PSIT_ERP_URL).origin
        && /^\/student\/examcalender\/[^/]+\/?$/i.test(examUrl.pathname)) {
        const calendarPage = await this.fetchAuthenticatedPage(examUrl.href, credentials, source)
        if (calendarPage.sessionLost) return this.finishSyncFailure(calendarPage.status, source, credentials)
        if (calendarPage.status === 'network_error') retryableFailure = true
        if (calendarPage.status === 'connected') examCalendar = parseExamCalendar(calendarPage.html)
      }
    }

    const database = this.database.db
    if (attendance) {
      const overallPercent = attendance.percentageWithPf ?? attendance.percentageWithoutPf
      const current = database.prepare(`SELECT id FROM psit_erp_attendance_snapshots
        ORDER BY id DESC LIMIT 1`).get()
      if (current) {
        database.prepare(`UPDATE psit_erp_attendance_snapshots SET captured_at = ?,
          overall_percent = ?, data_json = ? WHERE id = ?`).run(
          capturedAt, overallPercent, JSON.stringify(attendance), current.id,
        )
        database.prepare('DELETE FROM psit_erp_attendance_snapshots WHERE id != ?').run(current.id)
      } else {
        database.prepare(`INSERT INTO psit_erp_attendance_snapshots(captured_at, overall_percent, data_json)
          VALUES (?, ?, ?)`).run(capturedAt, overallPercent, JSON.stringify(attendance))
      }
    }
    if (timetable) {
      const current = database.prepare(`SELECT id, data_json AS dataJson FROM psit_erp_timetable_snapshots
        ORDER BY id DESC LIMIT 1`).get()
      const previousTimetable = current ? JSON.parse(current.dataJson) : null
      if (previousTimetable && JSON.stringify(previousTimetable) !== JSON.stringify(timetable)) {
        this.queueDetectedChange({
          source: 'timetable',
          action: 'updated',
          label: summarizeTimetableChange(previousTimetable, timetable),
          sourceTimestamp: capturedAt,
        }, capturedAt)
      }
      if (current) {
        database.prepare(`UPDATE psit_erp_timetable_snapshots SET captured_at = ?,
          week_of = '', data_json = ? WHERE id = ?`).run(capturedAt, JSON.stringify(timetable), current.id)
        database.prepare('DELETE FROM psit_erp_timetable_snapshots WHERE id != ?').run(current.id)
      } else {
        database.prepare(`INSERT INTO psit_erp_timetable_snapshots(captured_at, week_of, data_json)
          VALUES (?, '', ?)`).run(capturedAt, JSON.stringify(timetable))
      }
    }
    const academicRecords = [
      examCalendar ? ['exam-calendar', { examCalendar }] : null,
      marks ? ['marks', { marks }] : null,
    ].filter(Boolean)
    for (const [recordType, academic] of academicRecords) {
      const previous = database.prepare(`SELECT data_json AS dataJson FROM psit_erp_academic_records
        WHERE record_type = ? AND source_id = 'student'`).get(recordType)
      const previousAcademic = previous ? JSON.parse(previous.dataJson) : null
      if (previousAcademic && JSON.stringify(previousAcademic) !== JSON.stringify(academic)) {
        this.queueDetectedChange({
          source: recordType === 'marks' ? 'marks' : 'exam-calendar',
          action: 'updated',
          label: recordType === 'marks'
            ? summarizeMarksChange(previousAcademic, academic)
            : `Exam calendar changed: ${(academic.examCalendar.exams || []).slice(0, 3).map((exam) => exam.Examination).filter(Boolean).join(', ') || 'review schedule'}`,
          sourceTimestamp: capturedAt,
        }, capturedAt)
      }
      database.prepare(`INSERT INTO psit_erp_academic_records(record_type, source_id, data_json, updated_at)
        VALUES (?, 'student', ?, ?)
        ON CONFLICT(record_type, source_id) DO UPDATE SET data_json = excluded.data_json,
          updated_at = excluded.updated_at`).run(recordType, JSON.stringify(academic), capturedAt)
    }
    const insertNotice = database.prepare(`INSERT OR IGNORE INTO psit_erp_notices(
      fingerprint, title, published_at, data_json
    ) VALUES (?, ?, ?, ?)`)
    const hadNoticeBaseline = database.prepare('SELECT 1 FROM psit_erp_notices LIMIT 1').get()
    for (const notice of [...notices].reverse()) {
      const inserted = insertNotice.run(notice.fingerprint, notice.title, notice.publishedAt, JSON.stringify(notice))
      if (hadNoticeBaseline && inserted.changes) {
        this.queueDetectedChange({
          source: 'notices',
          action: 'new',
          label: notice.title,
          sourceTimestamp: notice.publishedAt || notice.capturedAt,
        }, capturedAt)
      }
    }
    database.prepare(`DELETE FROM psit_erp_notices WHERE id NOT IN (
      SELECT id FROM psit_erp_notices ORDER BY id DESC LIMIT 500
    )`).run()
    const academicChanges = await this.deliverPendingNotifications(capturedAt)

    const sources = [
      activityPages.length ? `${activityPages.length} activity pages` : null,
      attendance ? 'attendance summary' : null,
      timetable ? 'weekly timetable' : null,
      marks?.semesters.length ? 'semester marks' : null,
      marks?.assessments.length ? `${marks.assessments.length} test/assignment mark reports` : null,
      examCalendar ? 'exam calendar' : null,
      notices.length ? `${notices.length} notices` : null,
    ].filter(Boolean)
    if (!sources.length) {
      const message = `Login was verified, but no mapped academic data was recognized. ${activityFailures.length ? `Could not read ${activityFailures.join(', ')}.` : ''}`
      this.updateAuthenticationState('connected', source, credentials)
      this.recordSync('data-source-pending', message)
      return { status: 'data-source-pending', message, retryable: retryableFailure, changes: academicChanges }
    }
    const unavailablePages = [
      attendance ? null : `attendance summary (${attendancePage.status === 'connected' ? 'content not recognized' : attendancePage.status})`,
      timetable ? null : `timetable (${timetablePage.status === 'connected' ? 'content not recognized' : timetablePage.status})`,
      marks ? null : `marks (${marksPage.status === 'connected' ? 'content not recognized' : marksPage.status})`,
    ].filter(Boolean)
    const details = [
      activityFailures.length ? `Could not read activity pages: ${activityFailures.join(', ')}` : null,
      failedMarkReports ? `${failedMarkReports} selected mark reports could not be fetched` : null,
      missingMarkRows ? `${missingMarkRows} selected mark reports had no verified row for this account` : null,
      skippedMarkReports ? `${skippedMarkReports} additional mark reports were skipped at the safety limit` : null,
      unavailablePages.length ? `Could not map ${unavailablePages.join(', ')}` : null,
      'subject-wise attendance and current library dues remain unavailable',
    ].filter(Boolean)
    const message = `Synced ${sources.join(', ')}. ${details.join('; ')}.`
    this.updateAuthenticationState('connected', source, credentials)
    database.prepare('UPDATE psit_erp_connection SET last_sync_at = ? WHERE id = 1').run(capturedAt)
    this.recordSync('partial', message)
    return { status: 'partial', message, changes: [...activityChanges, ...academicChanges], retryable: retryableFailure }
  }

  disconnect() {
    if (this.readEnvironmentCredentials().configured) {
      const error = new Error('Remove PSIT_ERP_USER_ID and PSIT_ERP_PASSWORD from the backend environment before disconnecting this managed account.')
      error.status = 409
      throw error
    }
    this.session = null
    this.database.db.prepare('DELETE FROM psit_erp_connection WHERE id = 1').run()
    this.database.db.exec(`DELETE FROM psit_erp_attendance_snapshots;
      DELETE FROM psit_erp_timetable_snapshots;
      DELETE FROM psit_erp_academic_records;
      DELETE FROM psit_erp_notices;
      DELETE FROM psit_erp_request_state;
      DELETE FROM psit_erp_monitoring_baseline;
      DELETE FROM psit_erp_attendance_reports;
      DELETE FROM psit_erp_notification_fingerprints;
      DELETE FROM psit_erp_pending_notifications;
      DELETE FROM psit_erp_detected_changes;`)
    this.database.db.prepare(`UPDATE psit_erp_scheduler_state SET next_sync_at = '',
      last_successful_sync_at = '', status = 'idle', failure_count = 0,
      failure_category = '', paused = 0, last_error = '', updated_at = ? WHERE id = 1`).run(new Date().toISOString())
    return { disconnected: true }
  }
}

export function formatErpChangeNotification(change) {
  const sources = {
    'attendance-request': 'Attendance request',
    'online-training': 'Online training result',
    'od-request': 'On-duty (OD) request',
    attendance: 'Attendance',
    timetable: 'Timetable',
    marks: 'Academic marks',
    'exam-calendar': 'Exam calendar',
    notices: 'Academic notice',
  }
  const source = sources[change.page] || 'Student record'
  if (change.action === 'deleted') {
    const details = change.details || {}
    const dateValues = (details.requestedDates || []).map(({ value }) => value).filter(Boolean)
    return [
      `${source.toUpperCase()} NO LONGER LISTED`,
      `Request ID: #${change.requestId || details.requestId || 'Not shown'}`,
      `Last verified status: ${change.currentStatus || 'Unknown'}`,
      details.purpose && `Purpose: ${details.purpose}`,
      dateValues.length && `Requested Date${dateValues.length > 1 ? 's' : ''}: ${dateValues.join(' to ')}`,
      'It was absent from a complete ERP listing; withdrawal is not confirmed.',
    ].filter(Boolean).join('\n')
  }
  if (['attendance-request', 'od-request', 'online-training'].includes(change.page) && change.currentStatus) {
    const details = change.details || {}
    const heading = change.page === 'od-request' ? 'OD REQUEST UPDATE'
      : change.page === 'attendance-request' ? 'ATTENDANCE REQUEST UPDATE' : 'ONLINE TRAINING UPDATE'
    const dateValues = (details.requestedDates || []).map(({ value }) => value).filter(Boolean)
    const stages = (details.statusStages || [])
      .filter(({ raw }) => raw)
      .map(({ stage, raw }) => `${stage}: ${raw}`)
    const lines = [
      heading,
      `Request ID: #${change.requestId || details.requestId || 'Not shown'}`,
      `Previous Status: ${change.previousStatus || 'Not previously listed'}`,
      `Current Status: ${change.currentStatus}`,
      details.requestType && `Request Type: ${details.requestType}`,
      details.testName && `Test: ${details.testName}`,
      details.examDate && `Exam Date: ${details.examDate}`,
      details.score && `Score: ${details.score}`,
      details.percentage && `Percentage: ${details.percentage}`,
      details.submittedAt && `Submitted: ${details.submittedAt}`,
      dateValues.length && `Requested Date${dateValues.length > 1 ? 's' : ''}: ${dateValues.join(' to ')}`,
      details.purpose && `Purpose: ${details.purpose}`,
      details.remarks && `${change.currentStatus === 'Rejected' ? 'Rejection remarks' : 'Remarks'}: ${details.remarks}`,
      stages.length > 0 && `Approval steps: ${stages.join('; ')}`,
      details.approver && `Assigned/approver: ${details.approver}`,
      details.updatedAt && `Updated At: ${details.updatedAt}`,
    ].filter(Boolean)
    const requestLabel = change.page === 'od-request' ? 'OD request'
      : change.page === 'attendance-request' ? 'attendance request' : 'online training record'
    if (change.currentStatus === 'Accepted') lines.push(`Your ${requestLabel} has been accepted.`)
    else if (change.currentStatus === 'Rejected') lines.push(`Your ${requestLabel} has been rejected.`)
    else if (change.currentStatus === 'Pending' && change.action === 'new') lines.push(`Your new ${requestLabel} is pending review.`)
    return lines.join('\n')
  }
  if (['attendance-request', 'od-request', 'online-training'].includes(change.page)) {
    return `• ${source}: ERP status could not be verified; no status notification was generated.`
  }
  const action = change.action === 'new'
    ? 'New record'
    : change.action === 'deleted' ? 'No longer listed in the complete ERP record list' : 'Record updated'
  const timestamp = change.sourceTimestamp ? ` · ${change.sourceTimestamp}` : ''
  return `• ${source}: ${action}${change.label ? ` — ${change.label}` : ''}${change.status ? ` (${change.status})` : ''}${timestamp}`
}

export function getDueAttendanceReportWindows(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now).map(({ type, value }) => [type, value]))
  const minutesToday = Number(parts.hour) * 60 + Number(parts.minute)
  return [
    { reportDate: `${parts.year}-${parts.month}-${parts.day}`, reportSlot: '09:00', minuteOfDay: 540 },
    { reportDate: `${parts.year}-${parts.month}-${parts.day}`, reportSlot: '20:00', minuteOfDay: 1200 },
  ].filter(({ minuteOfDay }) => minutesToday >= minuteOfDay)
    .map(({ reportDate, reportSlot }) => ({ reportDate, reportSlot }))
}

export function formatAttendanceReport(attendance, reportSlot, previousAttendance = null, attendanceUpdatedAt = '') {
  const percentWithPf = attendance?.percentageWithPf
  const percentWithoutPf = attendance?.percentageWithoutPf
  const overall = typeof percentWithPf === 'number'
    ? `${percentWithPf}% (with PF)`
    : typeof percentWithoutPf === 'number' ? `${percentWithoutPf}%` : 'Not available'
  const lines = [`PSIT attendance check-in · ${reportSlot} IST`, `Overall attendance: ${overall}`]
  if (attendanceUpdatedAt) lines.push(`Data last fetched: ${attendanceUpdatedAt}`)
  if (typeof percentWithPf === 'number' && typeof percentWithoutPf === 'number') {
    lines.push(`Without PF: ${percentWithoutPf}%`)
  }
  if (attendance.totalLectures !== null && attendance.totalLectures !== undefined) {
    lines.push(`Classes conducted: ${attendance.totalLectures}`)
  }
  if (attendance.totalAbsentPlusOaa !== null && attendance.totalAbsentPlusOaa !== undefined) {
    lines.push(`Absent + OAA: ${attendance.totalAbsentPlusOaa}`)
  }
  if (attendance.subjectWise?.length) {
    lines.push(`Subject-wise attendance: ${attendance.subjectWise.map((subject) => `${subject.subject} ${subject.percentage}%`).join('; ')}`)
  } else {
    lines.push('Subject-wise attendance is not available in the mapped ERP data.')
  }
  const previousPercent = previousAttendance?.percentageWithPf ?? previousAttendance?.percentageWithoutPf
  const currentPercent = percentWithPf ?? percentWithoutPf
  if (typeof previousPercent === 'number' && typeof currentPercent === 'number' && previousPercent !== currentPercent) {
    const difference = Number((currentPercent - previousPercent).toFixed(2))
    lines.push(`Since the previous report: ${difference > 0 ? '+' : ''}${difference} percentage points.`)
  }
  return lines.join('\n')
}

export async function deliverAttendanceReport({
  database,
  reportDate,
  reportSlot,
  attendance,
  attendanceUpdatedAt = '',
  send,
  now = new Date(),
}) {
  const db = database.db
  const previous = db.prepare(`SELECT payload_json AS payloadJson FROM psit_erp_attendance_reports
    WHERE status = 'delivered' ORDER BY report_date DESC, report_slot DESC LIMIT 1`).get()
  db.prepare(`INSERT OR IGNORE INTO psit_erp_attendance_reports(
    report_date, report_slot, status, payload_json
  ) VALUES (?, ?, 'pending', ?)`).run(reportDate, reportSlot, JSON.stringify({
    attendance,
    attendanceUpdatedAt,
    previousAttendance: previous ? JSON.parse(previous.payloadJson).attendance : null,
  }))
  let report = db.prepare(`SELECT status, payload_json AS payloadJson, attempts,
    last_attempt_at AS lastAttemptAt FROM psit_erp_attendance_reports
    WHERE report_date = ? AND report_slot = ?`).get(reportDate, reportSlot)
  const nowIso = now.toISOString()
  if (report.status === 'sending') {
    const staleAt = Date.parse(report.lastAttemptAt || '')
    if (Number.isFinite(staleAt) && now.getTime() - staleAt >= 5 * 60000) {
      db.prepare(`UPDATE psit_erp_attendance_reports SET status = 'uncertain',
        last_error = 'Previous delivery ended without a recorded Telegram response.'
        WHERE report_date = ? AND report_slot = ? AND status = 'sending'`).run(reportDate, reportSlot)
      return { status: 'uncertain' }
    }
    return { status: 'sending' }
  }
  if (report.status !== 'pending') return { status: report.status }
  const retryDelay = Math.min(60, 2 ** Math.max(0, report.attempts - 1)) * 60000
  if (report.lastAttemptAt && now.getTime() - Date.parse(report.lastAttemptAt) < retryDelay) {
    return { status: 'retry_wait' }
  }
  const claimed = db.prepare(`UPDATE psit_erp_attendance_reports SET status = 'sending',
    attempts = attempts + 1, last_attempt_at = ?, last_error = ''
    WHERE report_date = ? AND report_slot = ? AND status = 'pending'`).run(nowIso, reportDate, reportSlot).changes
  if (!claimed) return { status: 'sending' }
  const payload = JSON.parse(report.payloadJson)
  try {
    await send(formatAttendanceReport(
      payload.attendance,
      reportSlot,
      payload.previousAttendance,
      payload.attendanceUpdatedAt,
    ))
    db.prepare(`UPDATE psit_erp_attendance_reports SET status = 'delivered',
      delivered_at = ?, last_error = '' WHERE report_date = ? AND report_slot = ?`).run(
      nowIso, reportDate, reportSlot,
    )
    return { status: 'delivered' }
  } catch (error) {
    const status = error.deliveryUncertain ? 'uncertain' : 'pending'
    db.prepare(`UPDATE psit_erp_attendance_reports SET status = ?, last_error = ?
      WHERE report_date = ? AND report_slot = ?`).run(
      status,
      String(error.message || 'Telegram delivery failed').slice(0, 240),
      reportDate,
      reportSlot,
    )
    return { status }
  }
}

export function formatErpAnswer(operation, state) {
  const label = {
    status: 'connection status',
    attendance: 'attendance',
    'timetable-today': "today's timetable",
    'timetable-tomorrow': "tomorrow's timetable",
    'timetable-week': 'weekly timetable',
    'next-lecture': 'next lecture',
    marks: 'marks and academic results',
    notices: 'academic notices',
    'academic-summary': 'academic summary',
    'student-services': 'student-service information',
    'attendance-requests': 'attendance request status',
    'online-training': 'online training results',
    'od-requests': 'OD request status',
  }[validateErpOperation(operation)]
  if (!label) return null
  if (operation === 'status') {
    return state.connected
      ? `PSIT ERP is connected for ${state.userIdMasked}. ${state.lastSyncAt ? `Last data sync: ${state.lastSyncAt}.` : 'No data sync has completed.'} Verified sources: ${['attendance', 'timetable', 'marks', 'notices', 'examCalendar'].filter((source) => state.availability?.[source]).join(', ') || 'none synced'}.`
      : 'PSIT ERP is not connected. Connect it from the dashboard’s PSIT ERP section; never send ERP credentials in Telegram.'
  }
  const unavailable = () => `I can’t provide ${label} yet: that information has not been verified from the authenticated ERP pages. No data for this section has been retrieved or fabricated.`
  const timeTable = state.data?.timetable
  const examCalendar = state.data?.academic?.examCalendar
  const marks = state.data?.academic?.marks
  const attendance = state.data?.attendance
  const notices = state.data?.notices || []
  const activity = state.data?.activity || {}
  const formatAttendance = () => {
    if (!attendance) return ''
    const percent = (value) => typeof value === 'number' ? `${value}%` : null
    const count = (value) => typeof value === 'number' ? String(value) : null
    const values = [
      percent(attendance.percentageWithoutPf) && `without PF: ${percent(attendance.percentageWithoutPf)}`,
      percent(attendance.percentageWithPf) && `with PF: ${percent(attendance.percentageWithPf)}`,
      count(attendance.totalLectures) && `total lectures: ${count(attendance.totalLectures)}`,
      count(attendance.totalAbsentPlusOaa) && `absent + OAA: ${count(attendance.totalAbsentPlusOaa)}`,
      count(attendance.oaAttendance) && `O.A. attendance: ${count(attendance.oaAttendance)}`,
    ].filter(Boolean)
    return values.length
      ? `Verified PSIT attendance summary: ${values.join('; ')}. Subject-wise attendance is not available.`
      : ''
  }
  const formatMarks = () => {
    if (!marks) return ''
    const semesters = (marks.semesters || []).map((semester) => {
      const hasMarks = semester.marks !== null && typeof semester.marks !== 'undefined'
      const hasPercentage = semester.percentage !== null && typeof semester.percentage !== 'undefined'
      return `• ${semester.semester}: ${hasMarks ? `${semester.marks} marks` : 'marks not listed'}${hasPercentage ? ` (${semester.percentage}%)` : ''}`
    })
    const assessments = (marks.assessments || []).map((assessment) => (
      `• ${assessment.test}: ${assessment.subjects.map((subject) => `${subject.subject} ${subject.score}`).join(', ')}`
    ))
    const lines = [...semesters, ...assessments]
    return lines.length ? `Verified PSIT marks:\n${lines.join('\n')}` : ''
  }
  const weekday = (offset = 0) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date())
    const part = (type) => Number(parts.find((item) => item.type === type)?.value)
    const date = new Date(Date.UTC(part('year'), part('month') - 1, part('day') + offset))
    return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(date)
  }
  const formatDay = (dayName) => {
    const day = timeTable?.days?.find((item) => item.day.toLowerCase().startsWith(dayName.toLowerCase()))
    if (!day) return `No verified timetable entry for ${dayName}.`
    if (!day.periods.length) return `${day.day}: no scheduled lectures were listed.`
    return `${day.day}:\n${day.periods.map((period) => {
      const details = [period.subject, period.faculty, period.room].filter(Boolean).join(' · ')
      return `${period.startTime}-${period.endTime}: ${details}`
    }).join('\n')}`
  }
  const minutesAfterMidnight = (value) => {
    const match = String(value || '').match(/^(\d{2}):(\d{2})$/)
    return match ? Number(match[1]) * 60 + Number(match[2]) : Number.POSITIVE_INFINITY
  }
  const formatNotices = () => notices.length
    ? `Recent verified notices:\n${notices.slice(0, 8).map((notice) => `• ${notice.title}`).join('\n')}`
    : unavailable()

  if (operation === 'attendance') return formatAttendance() || unavailable()
  if (operation === 'marks') return formatMarks() || unavailable()
  if (operation === 'student-services') return unavailable()
  const formatActivity = (type, label) => {
    const data = activity[type]
    return data
      ? `Verified PSIT ${label}: ${data.rowCount} records found.${data.latestLabel ? ` Listed entry: ${data.latestLabel}.` : ''}${data.latestStatus ? ` Status: ${data.latestStatus}.` : ''}`
      : unavailable()
  }
  if (operation === 'attendance-requests') return formatActivity('attendance-request', 'attendance requests')
  if (operation === 'online-training') return formatActivity('online-training', 'online training results')
  if (operation === 'od-requests') return formatActivity('od-request', 'OD requests')
  if (operation === 'notices') return formatNotices()
  if (operation === 'timetable-today') return timeTable ? formatDay(weekday()) : unavailable()
  if (operation === 'timetable-tomorrow') return timeTable ? formatDay(weekday(1)) : unavailable()
  if (operation === 'timetable-week') {
    return timeTable
      ? timeTable.days.map((day) => formatDay(day.day)).join('\n\n')
      : unavailable()
  }
  if (operation === 'next-lecture') {
    if (!timeTable) return unavailable()
    const nowParts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date())
    const now = Number(nowParts.find((part) => part.type === 'hour')?.value) * 60
      + Number(nowParts.find((part) => part.type === 'minute')?.value)
    for (let offset = 0; offset < 7; offset += 1) {
      const dayName = weekday(offset)
      const day = timeTable.days.find((item) => item.day.toLowerCase().startsWith(dayName.toLowerCase()))
      const lecture = day?.periods.find((period) => offset > 0 || minutesAfterMidnight(period.startTime) > now)
      if (lecture) return `Next lecture: ${day.day}, ${lecture.startTime}-${lecture.endTime}: ${[lecture.subject, lecture.faculty, lecture.room].filter(Boolean).join(' · ')}.`
    }
    return 'No upcoming lecture was listed in the verified weekly timetable.'
  }
  if (operation === 'academic-summary') {
    const sections = []
    if (formatAttendance()) sections.push(formatAttendance())
    if (timeTable) sections.push(formatDay(weekday()))
    if (formatMarks()) sections.push(formatMarks())
    if (examCalendar?.exams?.length) {
      sections.push(`Verified exam calendar:\n${examCalendar.exams.map((exam) => Object.entries(exam).map(([name, value]) => `${name}: ${value}`).join(' · ')).join('\n')}`)
    }
    if (notices.length) sections.push(formatNotices())
    if (!sections.length) return unavailable()
    if (!attendance) sections.push('Attendance is not available from the mapped pages.')
    if (!marks) sections.push('Marks are not available from the mapped pages.')
    return sections.join('\n\n')
  }
  return null
}
