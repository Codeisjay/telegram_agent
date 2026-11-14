import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

export const PSIT_ERP_URL = 'https://erp.psit.ac.in/Erp/'
export const PSIT_ERP_PASSWORD_RESET_URL = 'https://erp.psit.ac.in/Erp/ForgetPassword'

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
])

const operationCommands = new Map([
  ['/erp', 'status'],
  ['/attendance', 'attendance'],
  ['/timetable', 'timetable-today'],
  ['/tomorrow', 'timetable-tomorrow'],
  ['/marks', 'marks'],
  ['/notices', 'notices'],
  ['/academic_summary', 'academic-summary'],
])

export function validateErpOperation(operation) {
  return ERP_OPERATIONS.includes(operation) ? operation : null
}

export function resolveErpOperation(text) {
  const input = String(text || '').trim()
  const command = input.split(/\s+/)[0].split('@')[0].toLowerCase()
  if (operationCommands.has(command)) return operationCommands.get(command)

  const query = input.toLowerCase()
  if (!/\b(attendance|timetable|lecture|class|classes|marks|internal|exam|examination|notice|academic|subject|free period|assignment|fee|library|dues|profile)\b/.test(query)) return null
  if (/\b(next lecture|next class|upcoming lecture)\b/.test(query)) return 'next-lecture'
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

function readTable(html, headerPattern) {
  for (const [table] of html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi)) {
    const header = table.match(/<thead\b[^>]*>([\s\S]*?)<\/thead\s*>/i)?.[1] || ''
    const headerRow = header.match(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/i)?.[1] || ''
    const headers = [...headerRow.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th\s*>/gi)]
      .map(([, contents]) => htmlLines(contents).join(' '))
    if (!headerPattern(headers)) continue
    const body = table.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody\s*>/i)?.[1] || ''
    const rows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)].map(([, row]) => (
      [...row.matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)\s*>/gi)]
        .map(([, cell]) => htmlLines(cell))
    ))
    return { headers, rows }
  }
  return null
}

function parseTimetable(html) {
  const table = readTable(html, (headers) => /day\s*\/?\s*lecture/i.test(headers[0] || ''))
  if (!table || table.rows.length === 0) return null
  const slots = table.headers.slice(1).map((header, index) => {
    const match = header.match(/(\d+)(?:st|nd|rd|th)?\s*(\d{1,2})[.:](\d{2})-(\d{1,2})[.:](\d{2})/i)
    if (!match) return null
    let startHour = Number(match[2])
    let endHour = Number(match[4])
    if (index >= 4 && startHour < 12) startHour += 12
    if (index >= 4 && endHour < 12) endHour += 12
    const pad = (value) => String(value).padStart(2, '0')
    return {
      period: Number(match[1]),
      startTime: `${pad(startHour)}:${match[3]}`,
      endTime: `${pad(endHour)}:${match[5]}`,
    }
  })
  const days = table.rows.map((row) => {
    const day = row[0]?.join(' ').trim()
    if (!day || !/^(?:mon|tue|wed|thu|fri|sat|sun)/i.test(day)) return null
    const periods = row.slice(1).flatMap((lines, index) => {
      if (!lines.length || !slots[index]) return []
      return [{
        ...slots[index],
        subject: lines[0] || '',
        faculty: lines[1] || '',
        room: lines[2] || '',
      }]
    })
    return { day, periods }
  }).filter(Boolean)
  return days.length ? { headers: table.headers, days } : null
}

function parseExamCalendar(html) {
  const table = readTable(html, (headers) => /examination/i.test(headers[0] || ''))
  if (!table) return null
  const exams = table.rows.map((row) => Object.fromEntries(
    table.headers.slice(0, row.length).map((header, index) => [header, row[index].join(' ').trim()]),
  )).filter((row) => Object.values(row).some(Boolean))
  return exams.length ? { headers: table.headers, exams } : null
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
      ? 'PSIT login is valid, but authenticated student data pages have not yet been mapped. No academic data was retrieved.'
      : 'PSIT login was verified using the authenticated student dashboard, and credentials were encrypted on this server. Academic data retrieval remains pending page/API mapping.'
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

async function fetchStudentPage(path, cookies, fetchImpl, onDiagnostic) {
  const trace = []
  const result = await requestOfficial(new URL(path, PSIT_ERP_URL), {}, cookies, fetchImpl, trace)
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
    onDiagnostic = (diagnostic) => console.info(`[PSIT ERP auth] ${JSON.stringify(diagnostic)}`),
  }) {
    this.database = database
    this.encryptionKey = encryptionKey
    this.fetchImpl = fetchImpl
    this.onDiagnostic = onDiagnostic
  }

  getState() {
    const connection = this.database.db.prepare(`SELECT user_id_masked AS userIdMasked, status,
      connected_at AS connectedAt, last_sync_at AS lastSyncAt, updated_at AS updatedAt
      FROM psit_erp_connection WHERE id = 1`).get()
    const snapshots = {
      attendance: this.database.db.prepare('SELECT captured_at AS capturedAt, data_json AS dataJson FROM psit_erp_attendance_snapshots ORDER BY id DESC LIMIT 1').get(),
      timetable: this.database.db.prepare('SELECT captured_at AS capturedAt, data_json AS dataJson FROM psit_erp_timetable_snapshots ORDER BY id DESC LIMIT 1').get(),
      academic: this.database.db.prepare('SELECT updated_at AS updatedAt, data_json AS dataJson FROM psit_erp_academic_records ORDER BY id DESC LIMIT 1').get(),
      notices: this.database.db.prepare('SELECT published_at AS publishedAt, data_json AS dataJson FROM psit_erp_notices ORDER BY id DESC LIMIT 10').all(),
    }
    const history = this.database.db.prepare(`SELECT id, status, started_at AS startedAt,
      completed_at AS completedAt, message FROM psit_erp_sync_history ORDER BY id DESC LIMIT 20`).all()
    const credentialsStored = Boolean(this.getCredentialRecord()?.credentialCiphertext)
    const connected = credentialsStored && connection?.status === 'connected'
    const timetable = snapshots.timetable ? JSON.parse(snapshots.timetable.dataJson) : null
    const academic = snapshots.academic ? JSON.parse(snapshots.academic.dataJson) : null
    const noticesData = snapshots.notices.map((notice) => JSON.parse(notice.dataJson))
    const availability = {
      attendance: Boolean(snapshots.attendance),
      timetable: Boolean(timetable),
      marks: Boolean(academic?.marks),
      examCalendar: Boolean(academic?.examCalendar),
      notices: noticesData.length > 0,
      library: Boolean(academic?.library),
    }
    return {
      connected,
      credentialsStored,
      status: connection?.status || 'disconnected',
      userIdMasked: connection?.userIdMasked || '',
      connectedAt: connection?.connectedAt || null,
      lastSyncAt: connection?.lastSyncAt || null,
      encryptionConfigured: this.hasEncryptionKey(),
      dataRetrievalAvailable: availability.timetable || availability.examCalendar || availability.notices,
      availability,
      data: {
        attendance: snapshots.attendance ? JSON.parse(snapshots.attendance.dataJson) : null,
        attendanceUpdatedAt: snapshots.attendance?.capturedAt || null,
        timetable,
        timetableUpdatedAt: snapshots.timetable?.capturedAt || null,
        academic,
        academicUpdatedAt: snapshots.academic?.updatedAt || null,
        notices: noticesData,
      },
      history,
      limitation: 'Timetable, academic notices and the exam calendar can be synced from the authenticated student portal. Attendance percentages, internal marks and library account details remain unavailable because their values cannot yet be reliably mapped.',
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

  updateConnection({ status, userIdMasked = '', credentialCiphertext = null, connectedAt = null }) {
    const now = new Date().toISOString()
    this.database.db.prepare(`INSERT INTO psit_erp_connection(
      id, user_id_masked, credential_ciphertext, status, connected_at, updated_at
    ) VALUES (1, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET user_id_masked = excluded.user_id_masked,
      credential_ciphertext = excluded.credential_ciphertext, status = excluded.status,
      connected_at = COALESCE(excluded.connected_at, psit_erp_connection.connected_at),
      updated_at = excluded.updated_at`).run(
      userIdMasked, credentialCiphertext, status, connectedAt, now,
    )
  }

  recordSync(status, message) {
    const now = new Date().toISOString()
    this.database.db.prepare(`INSERT INTO psit_erp_sync_history(status, started_at, completed_at, message)
      VALUES (?, ?, ?, ?)`).run(status, now, now, message)
    this.database.db.prepare('UPDATE psit_erp_connection SET updated_at = ? WHERE id = 1').run(now)
  }

  async connect(userId, password) {
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

  async sync() {
    const key = getErpEncryptionKey(this.encryptionKey)
    const record = this.getCredentialRecord()
    if (!record?.credentialCiphertext) {
      const error = new Error('Connect your PSIT ERP account from the dashboard first.')
      error.status = 409
      throw error
    }
    let credentials
    try {
      credentials = decryptErpCredentials(record.credentialCiphertext, key)
    } catch {
      const error = new Error('Stored PSIT credentials could not be decrypted. Reconnect the account with the configured encryption key.')
      error.status = 503
      throw error
    }
    const result = await authenticate(credentials, this.fetchImpl, this.onDiagnostic)
    if (result.status !== 'connected') {
      const status = result.status
      const message = authenticationMessage(status, true)
      this.updateConnection({ status, userIdMasked: maskErpUserId(credentials.userId), credentialCiphertext: record.credentialCiphertext })
      this.recordSync(status, message)
      return { status, message }
    }
    const capturedAt = new Date().toISOString()
    const notices = parseNotices(result.studentHtml, capturedAt)
    const timetablePage = await fetchStudentPage('/Student/MyTimeTable', result.cookies, this.fetchImpl, this.onDiagnostic)
    if (timetablePage.status === 'session_expired') {
      const message = authenticationMessage('session_expired', true)
      this.updateConnection({ status: 'session_expired', userIdMasked: maskErpUserId(credentials.userId), credentialCiphertext: record.credentialCiphertext })
      this.recordSync('session_expired', message)
      return { status: 'session_expired', message }
    }
    const timetable = timetablePage.status === 'connected' ? parseTimetable(timetablePage.html) : null
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
        const calendarPage = await fetchStudentPage(examUrl.href, result.cookies, this.fetchImpl, this.onDiagnostic)
        if (calendarPage.status === 'session_expired') {
          const message = authenticationMessage('session_expired', true)
          this.updateConnection({ status: 'session_expired', userIdMasked: maskErpUserId(credentials.userId), credentialCiphertext: record.credentialCiphertext })
          this.recordSync('session_expired', message)
          return { status: 'session_expired', message }
        }
        if (calendarPage.status === 'connected') examCalendar = parseExamCalendar(calendarPage.html)
      }
    }

    const database = this.database.db
    if (timetable) {
      database.prepare(`INSERT INTO psit_erp_timetable_snapshots(captured_at, week_of, data_json)
        VALUES (?, ?, ?)`).run(capturedAt, '', JSON.stringify(timetable))
    }
    if (examCalendar) {
      database.prepare(`INSERT INTO psit_erp_academic_records(record_type, source_id, data_json, updated_at)
        VALUES ('exam-calendar', 'student', ?, ?)
        ON CONFLICT(record_type, source_id) DO UPDATE SET data_json = excluded.data_json,
          updated_at = excluded.updated_at`).run(JSON.stringify({ examCalendar }), capturedAt)
    }
    const insertNotice = database.prepare(`INSERT OR IGNORE INTO psit_erp_notices(
      fingerprint, title, published_at, data_json
    ) VALUES (?, ?, ?, ?)`)
    for (const notice of [...notices].reverse()) {
      insertNotice.run(notice.fingerprint, notice.title, notice.publishedAt, JSON.stringify(notice))
    }

    const sources = [
      timetable ? 'weekly timetable' : null,
      examCalendar ? 'exam calendar' : null,
      notices.length ? `${notices.length} notices` : null,
    ].filter(Boolean)
    if (!sources.length) {
      const message = 'Login was verified, but none of the mapped timetable, exam-calendar or notice pages returned recognizable data.'
      this.updateConnection({ status: 'connected', userIdMasked: maskErpUserId(credentials.userId), credentialCiphertext: record.credentialCiphertext })
      this.recordSync('data-source-pending', message)
      return { status: 'data-source-pending', message }
    }
    const message = `Synced ${sources.join(', ')}. Attendance percentages, internal marks and library account details remain unmapped; no values were inferred.`
    this.updateConnection({ status: 'connected', userIdMasked: maskErpUserId(credentials.userId), credentialCiphertext: record.credentialCiphertext })
    database.prepare('UPDATE psit_erp_connection SET last_sync_at = ? WHERE id = 1').run(capturedAt)
    this.recordSync('partial', message)
    return { status: 'partial', message }
  }

  disconnect() {
    this.database.db.prepare('DELETE FROM psit_erp_connection WHERE id = 1').run()
    this.database.db.exec(`DELETE FROM psit_erp_attendance_snapshots;
      DELETE FROM psit_erp_timetable_snapshots;
      DELETE FROM psit_erp_academic_records;
      DELETE FROM psit_erp_notices;
      DELETE FROM psit_erp_notification_fingerprints;`)
    return { disconnected: true }
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
  }[validateErpOperation(operation)]
  if (!label) return null
  if (operation === 'status') {
    return state.connected
      ? `PSIT ERP is connected for ${state.userIdMasked}. ${state.lastSyncAt ? `Last data sync: ${state.lastSyncAt}.` : 'No data sync has completed.'} Verified sources: ${['timetable', 'notices', 'examCalendar'].filter((source) => state.availability?.[source]).join(', ') || 'none synced'}.`
      : 'PSIT ERP is not connected. Connect it from the dashboard’s PSIT ERP section; never send ERP credentials in Telegram.'
  }
  const unavailable = () => `I can’t provide ${label} yet: that information has not been verified from the authenticated ERP pages. No academic data has been retrieved or fabricated.`
  const timeTable = state.data?.timetable
  const examCalendar = state.data?.academic?.examCalendar
  const notices = state.data?.notices || []
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

  if (operation === 'attendance') return unavailable()
  if (operation === 'marks') return unavailable()
  if (operation === 'student-services') return unavailable()
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
    if (timeTable) sections.push(formatDay(weekday()))
    if (examCalendar?.exams?.length) {
      sections.push(`Verified exam calendar:\n${examCalendar.exams.map((exam) => Object.entries(exam).map(([name, value]) => `${name}: ${value}`).join(' · ')).join('\n')}`)
    }
    if (notices.length) sections.push(formatNotices())
    if (!sections.length) return unavailable()
    sections.push('Attendance percentages and internal marks are not available from the mapped pages.')
    return sections.join('\n\n')
  }
  return null
}
