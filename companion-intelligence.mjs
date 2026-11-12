export const DEFAULT_COMPANION_SETTINGS = {
  timezone: 'Asia/Kolkata',
  personalName: 'Jay',
  greetingTimes: {
    morning: '08:00',
    afternoon: '13:00',
    evening: '18:00',
    night: '22:00',
  },
  greetings: {
    morning: true,
    afternoon: true,
    evening: true,
    night: true,
  },
  quietStart: '22:30',
  quietEnd: '07:00',
  festivalRegion: 'Uttar Pradesh',
  festivalEnabled: true,
  reminderIntervalMinutes: 15,
  paused: false,
  notificationChatId: '',
}

const greetingVariants = {
  morning: [
    'Good morning, Jay! ☀️',
    'Good morning, Jay! Wishing you a calm and productive start to the day.',
    'Good morning, Jay! Hope today feels smooth and full of momentum.',
  ],
  afternoon: [
    'Good afternoon, Jay! Hope your day is going well.',
    'Good afternoon, Jay! Hope you are finding a good rhythm today.',
    'Good afternoon, Jay! Hope the day has been kind to you so far.',
  ],
  evening: [
    'Good evening, Jay!',
    'Good evening, Jay! Hope you had a meaningful day.',
    'Good evening, Jay! Take a moment to unwind after the day.',
  ],
  night: [
    'Good night, Jay! Have a peaceful sleep.',
    'Good night, Jay! Rest well and recharge for tomorrow.',
    'Good night, Jay! Hope you get the rest you need tonight.',
  ],
}

export function normalizeCompanionSettings(input = {}, current = DEFAULT_COMPANION_SETTINGS) {
  const fallback = { ...DEFAULT_COMPANION_SETTINGS, ...current }
  const greetingTimes = { ...DEFAULT_COMPANION_SETTINGS.greetingTimes, ...(current.greetingTimes || {}), ...(input.greetingTimes || {}) }
  const greetings = { ...DEFAULT_COMPANION_SETTINGS.greetings, ...(current.greetings || {}), ...(input.greetings || {}) }
  const personalName = typeof input.personalName === 'string' && input.personalName.trim() ? input.personalName.trim().slice(0, 80) : (typeof current.personalName === 'string' ? current.personalName : fallback.personalName)
  const notificationChatId = typeof input.notificationChatId === 'string' && /^-?\d{1,20}$/.test(input.notificationChatId.trim()) ? input.notificationChatId.trim() : (typeof current.notificationChatId === 'string' ? current.notificationChatId : fallback.notificationChatId)
  let timezone = input.timezone || current.timezone || fallback.timezone
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone })
  } catch {
    timezone = fallback.timezone
  }
  return {
    timezone,
    personalName,
    greetingTimes: {
      morning: normalizeClockTime(greetingTimes.morning, DEFAULT_COMPANION_SETTINGS.greetingTimes.morning),
      afternoon: normalizeClockTime(greetingTimes.afternoon, DEFAULT_COMPANION_SETTINGS.greetingTimes.afternoon),
      evening: normalizeClockTime(greetingTimes.evening, DEFAULT_COMPANION_SETTINGS.greetingTimes.evening),
      night: normalizeClockTime(greetingTimes.night, DEFAULT_COMPANION_SETTINGS.greetingTimes.night),
    },
    greetings: {
      morning: Boolean(greetings.morning ?? true),
      afternoon: Boolean(greetings.afternoon ?? true),
      evening: Boolean(greetings.evening ?? true),
      night: Boolean(greetings.night ?? true),
    },
    quietStart: normalizeClockTime(input.quietStart || current.quietStart || fallback.quietStart, DEFAULT_COMPANION_SETTINGS.quietStart),
    quietEnd: normalizeClockTime(input.quietEnd || current.quietEnd || fallback.quietEnd, DEFAULT_COMPANION_SETTINGS.quietEnd),
    festivalRegion: typeof input.festivalRegion === 'string' && input.festivalRegion.trim() ? input.festivalRegion.trim().slice(0, 120) : (current.festivalRegion || fallback.festivalRegion),
    festivalEnabled: input.festivalEnabled !== undefined ? Boolean(input.festivalEnabled) : Boolean(current.festivalEnabled ?? fallback.festivalEnabled),
    reminderIntervalMinutes: Number.isInteger(input.reminderIntervalMinutes) ? Math.max(5, Math.min(input.reminderIntervalMinutes, 180)) : (Number.isInteger(current.reminderIntervalMinutes) ? Math.max(5, Math.min(current.reminderIntervalMinutes, 180)) : fallback.reminderIntervalMinutes),
    paused: input.paused !== undefined ? Boolean(input.paused) : Boolean(current.paused ?? fallback.paused),
    notificationChatId,
  }
}

export function normalizeClockTime(value, fallback = '08:00') {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (!/^\d{1,2}:\d{2}$/.test(trimmed)) return fallback
  const [hoursText, minutesText] = trimmed.split(':')
  const hours = Number(hoursText)
  const minutes = Number(minutesText)
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return fallback
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function getLocalDateParts(date = new Date(), timeZone = 'Asia/Kolkata') {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts = formatter.formatToParts(date)
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  const year = Number(values.year)
  const month = Number(values.month)
  const day = Number(values.day)
  const hour = Number(values.hour)
  const minute = Number(values.minute)
  const second = Number(values.second)
  return { year, month, day, hour, minute, second }
}

export function toMinutesOfDay(value) {
  if (typeof value !== 'string' || !/^\d{1,2}:\d{2}$/.test(value)) return null
  const [hoursText, minutesText] = value.split(':')
  const hours = Number(hoursText)
  const minutes = Number(minutesText)
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return hours * 60 + minutes
}

export function isQuietHours(settings = DEFAULT_COMPANION_SETTINGS, now = new Date()) {
  const { quietStart, quietEnd, timezone } = normalizeCompanionSettings(settings)
  const { hour, minute } = getLocalDateParts(now, timezone)
  const startMinutes = toMinutesOfDay(quietStart)
  const endMinutes = toMinutesOfDay(quietEnd)
  const currentMinutes = hour * 60 + minute
  if (startMinutes === null || endMinutes === null) return false
  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes
  }
  return currentMinutes >= startMinutes || currentMinutes < endMinutes
}

export function getGreetingVariant(kind, settings = DEFAULT_COMPANION_SETTINGS, dayKey = '') {
  const variants = greetingVariants[kind] || greetingVariants.morning
  const personalName = (normalizeCompanionSettings(settings).personalName || 'Jay').trim() || 'Jay'
  return variants[(Math.abs(hashString(`${kind}:${personalName}:${dayKey}`)) % variants.length)]
    .replace(/Jay/g, personalName)
}

function hashString(value) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash
}

export function getDueGreeting(settings = DEFAULT_COMPANION_SETTINGS, now = new Date()) {
  const normalized = normalizeCompanionSettings(settings)
  if (normalized.paused || typeof normalized.greetings !== 'object') return null
  const { hour, minute, year, month, day } = getLocalDateParts(now, normalized.timezone)
  const schedule = Object.fromEntries(Object.entries(normalized.greetingTimes).map(([kind, time]) => [kind, toMinutesOfDay(time)]))
  const currentMinutes = hour * 60 + minute
  for (const kind of ['morning', 'afternoon', 'evening', 'night']) {
    if (!normalized.greetings[kind]) continue
    const target = schedule[kind]
    if (target == null) continue
    const minutesSinceTarget = currentMinutes - target
    const dayKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    if (minutesSinceTarget >= 0 && minutesSinceTarget <= 30 && !isQuietHours(normalized, now)) {
      const targetTime = `${String(Math.floor(target / 60)).padStart(2, '0')}:${String(target % 60).padStart(2, '0')}`
      return { kind, message: getGreetingVariant(kind, normalized, dayKey), dueAt: zonedDateTimeToDate(dayKey, targetTime, normalized.timezone), dayKey }
    }
  }
  return null
}

export function parseNaturalLanguageEvent(text, now = new Date()) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return null
  const lower = normalized.toLowerCase()
  const category = lower.includes('birthday') ? 'Birthday'
    : lower.includes('anniversary') ? 'Anniversary'
      : lower.includes('exam') || lower.includes('examination') ? 'Examination'
        : lower.includes('interview') ? 'Interview'
          : lower.includes('submission') || lower.includes('project submission') ? 'Project submission'
            : lower.includes('assignment') ? 'Assignment deadline'
              : lower.includes('meeting') ? 'Meeting'
                : lower.includes('internship') ? 'Internship'
                  : lower.includes('job application') ? 'Job application deadline'
                    : lower.includes('milestone') ? 'Personal milestone'
                      : lower.includes('festival') || lower.includes('diwali') || lower.includes('holi') ? 'Festival'
                        : lower.includes('travel') ? 'Travel'
                          : 'Custom event'

  const recurrence = /every year|yearly|annually/i.test(lower) ? 'Yearly'
    : /every month|monthly/i.test(lower) ? 'Monthly'
      : /every week|weekly/i.test(lower) ? 'Weekly'
        : /every day|daily/i.test(lower) ? 'Daily'
          : 'None'

  const parsedDate = parseEventDate(normalized, now)
  if (!parsedDate) return null

  const timeMatch = normalized.match(/\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i)
    || normalized.match(/\b(?:at\s*)?([01]?\d|2[0-3]):([0-5]\d)\b/i)
  let eventTime = ''
  if (timeMatch) {
    let hour = Number(timeMatch[1] || timeMatch[4])
    const minute = Number(timeMatch[2] || timeMatch[5] || '0')
    const meridian = timeMatch[3]?.toLowerCase()
    if (meridian && (hour < 1 || hour > 12 || minute > 59)) return null
    if (meridian === 'am' && hour === 12) hour = 0
    if (meridian === 'pm' && hour !== 12) hour += 12
    eventTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  }

  const title = extractEventTitle(normalized, parsedDate)
  if (!title) return null
  const reminderMinutes = parseReminderIntervals(lower)
  const description = normalized.slice(0, 500)
  return {
    title: title.slice(0, 150),
    description: description.slice(0, 500) || `${category} reminder`,
    category,
    recurrence: recurrence === 'None' && ['Birthday', 'Anniversary'].includes(category) ? 'Yearly' : recurrence,
    eventDate: parsedDate,
    eventTime,
    reminderMinutes,
    importance: /important|critical|high priority|key event/i.test(lower) ? 'High'
      : /low priority|not important/i.test(lower) ? 'Low'
        : 'Medium',
    timezone: 'Asia/Kolkata',
  }
}

function parseEventDate(text, now) {
  const dateParts = getLocalDateParts(now, 'Asia/Kolkata')
  const today = new Date(Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day))
  const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
  let match = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/)
  if (match) return validDate(Number(match[1]), Number(match[2]), Number(match[3]))
  match = text.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](20\d{2}))?\b/)
  if (match) {
    const date = validDate(Number(match[3] || dateParts.year), Number(match[2]), Number(match[1]))
    return date
  }
  match = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(20\d{2}))?\b/i)
    || text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))?\b/i)
  if (match) {
    const monthFirst = /^[a-z]/i.test(match[1])
    const day = Number(monthFirst ? match[2] : match[1])
    const monthName = monthFirst ? match[1] : match[2]
    const year = Number(monthFirst ? match[3] || dateParts.year : match[3] || dateParts.year)
    let result = validDate(year, monthNames.indexOf(monthName.toLowerCase()) + 1, day)
    if (!result) return null
    if (!match[3] && result < today && /birthday|anniversary|yearly|annually|every year/i.test(text)) {
      result = validDate(year + 1, monthNames.indexOf(monthName.toLowerCase()) + 1, day)
    }
    return result
  }
  if (/\btoday\b/i.test(text)) return formatDateParts(today)
  if (/\btomorrow\b/i.test(text)) return formatDateParts(new Date(today.getTime() + 86400000))
  const relative = text.match(/\bin\s+(\d+)\s+(days?|weeks?|months?|years?)\b/i)
  if (relative) {
    const amount = Math.min(3650, Number(relative[1]))
    const unit = relative[2].toLowerCase()
    if (unit.startsWith('day')) return formatDateParts(new Date(today.getTime() + amount * 86400000))
    if (unit.startsWith('week')) return formatDateParts(new Date(today.getTime() + amount * 7 * 86400000))
    const targetYear = dateParts.year + (unit.startsWith('year') ? amount : 0)
    const targetMonth = dateParts.month + (unit.startsWith('month') ? amount : 0)
    const normalized = new Date(Date.UTC(targetYear, targetMonth - 1, 1))
    const lastDay = new Date(Date.UTC(normalized.getUTCFullYear(), normalized.getUTCMonth() + 1, 0)).getUTCDate()
    return formatDateParts(new Date(Date.UTC(normalized.getUTCFullYear(), normalized.getUTCMonth(), Math.min(dateParts.day, lastDay))))
  }
  if (/\bnext month\b/i.test(text)) {
    const nextMonth = new Date(Date.UTC(dateParts.year, dateParts.month, 1))
    const lastDay = new Date(Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth() + 1, 0)).getUTCDate()
    return formatDateParts(new Date(Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth(), Math.min(dateParts.day, lastDay))))
  }
  const weekday = text.match(/\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i)
  if (weekday) {
    const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const offset = (weekdays.indexOf(weekday[1].toLowerCase()) - today.getUTCDay() + 7) % 7 || 7
    return formatDateParts(new Date(today.getTime() + offset * 86400000))
  }
  return null
}

function validDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? formatDateParts(date)
    : null
}

function formatDateParts(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

function extractEventTitle(text, eventDate) {
  let title = text
    .replace(/^(?:hey\s+)?(?:please\s+)?(?:remember|remind me(?: to| about| of)?|add|save|schedule)\s+/i, '')
    .replace(/\b(?:on|at)\s+(?:20\d{2}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}(?:[/-]20\d{2})?|\d{1,2}(?:st|nd|rd|th)?\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?|today|tomorrow|next\s+\w+)\b/ig, ' ')
    .replace(/\b(?:at\s*)?\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/ig, ' ')
    .replace(/\b(?:at\s*)?(?:[01]?\d|2[0-3]):[0-5]\d\b/ig, ' ')
    .replace(/\b(?:today|tomorrow|next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/ig, ' ')
    .replace(/\b(?:every year|yearly|annually|every month|monthly|every week|weekly|every day|daily|one week before|a week before|week before|one day before|a day before|day before|on the day|at the event|important|critical|high priority|low priority|not important|key event|remind me|reminder|please|for me|my)\b/ig, ' ')
    .replace(/\b(?:wish(?:ing)?(?:\s+them)?|send\s+(?:a\s+)?(?:wish|greeting)s?)\b.*$/i, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.:;'-]+|[\s,.:;'-]+$/g, '')
  title = title.replace(/(?:\s+|\b)(?:is|will be|happens|falls)\s*$/i, '').replace(/[.?!]+$/g, '').trim()
  return title || (eventDate ? text.replace(/\b(?:on|at)\b.*$/i, '').trim() : '')
}

function parseReminderIntervals(text) {
  const reminders = new Set([0])
  if (/\b(?:one week|a week|week)\s+before\b/.test(text)) reminders.add(10080)
  if (/\b(?:one day|a day|day)\s+before\b/.test(text)) reminders.add(1440)
  for (const match of text.matchAll(/\b(\d+)\s*(minutes?|hours?|days?)\s+before\b/g)) {
    const amount = Number(match[1])
    const unit = match[2].toLowerCase()
    const minutes = amount * (unit.startsWith('day') ? 1440 : unit.startsWith('hour') ? 60 : 1)
    if (minutes > 0 && minutes <= 525600) reminders.add(minutes)
  }
  return [...reminders].sort((a, b) => b - a).slice(0, 8)
}

export function zonedDateTimeToDate(dateValue, timeValue = '00:00', timeZone = 'Asia/Kolkata') {
  const dateMatch = String(dateValue).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const timeMatch = String(timeValue).match(/^(\d{1,2}):(\d{2})$/)
  if (!dateMatch || !timeMatch) return new Date(Number.NaN)
  const [year, month, day] = dateMatch.slice(1).map(Number)
  const [hour, minute] = timeMatch.slice(1).map(Number)
  if (!validDate(year, month, day) || hour > 23 || minute > 59) return new Date(Number.NaN)
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute)
  const local = getLocalDateParts(new Date(utcGuess), timeZone)
  const represented = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute)
  return new Date(utcGuess - (represented - utcGuess))
}

export function nextOccurrenceDate(dateValue, recurrence) {
  const match = String(dateValue).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const [year, month, day] = match.slice(1).map(Number)
  if (recurrence === 'Daily') return formatDateParts(new Date(Date.UTC(year, month - 1, day + 1)))
  if (recurrence === 'Weekly') return formatDateParts(new Date(Date.UTC(year, month - 1, day + 7)))
  if (!['Monthly', 'Yearly'].includes(recurrence)) return null
  const targetYear = recurrence === 'Yearly' ? year + 1 : year
  const targetMonth = recurrence === 'Monthly' ? month + 1 : month
  const normalized = new Date(Date.UTC(targetYear, targetMonth - 1, 1))
  const lastDay = new Date(Date.UTC(normalized.getUTCFullYear(), normalized.getUTCMonth() + 1, 0)).getUTCDate()
  return formatDateParts(new Date(Date.UTC(normalized.getUTCFullYear(), normalized.getUTCMonth(), Math.min(day, lastDay))))
}

export function getDueEventReminders(event, now = new Date(), recoveryWindowMs = 7 * 86400000) {
  const occurrenceDate = event.nextOccurrence || event.eventDate
  const occurrence = zonedDateTimeToDate(occurrenceDate, event.eventTime || '00:00', event.timezone || 'Asia/Kolkata')
  if (!Number.isFinite(occurrence.getTime())) return []
  return (event.reminderMinutes || [0]).map(Number).filter((minutes) => Number.isFinite(minutes) && minutes >= 0)
    .map((reminderMinutes) => {
      const dueAt = new Date(occurrence.getTime() - reminderMinutes * 60000)
      return {
        ...event,
        reminderMinutes,
        notificationKey: `${event.id}:${occurrenceDate}:${reminderMinutes}`,
        dueAt: dueAt.toISOString(),
      }
    })
    .filter((reminder) => {
      const elapsed = now.getTime() - Date.parse(reminder.dueAt)
      return elapsed >= 0 && elapsed <= recoveryWindowMs
    })
}

export function buildEventReminderMessage(event, occurrenceDate = new Date()) {
  const eventName = String(event.title || 'Event').trim() || 'Event'
  const eventTime = event.eventTime ? ` at ${event.eventTime}` : ''
  const reminderLabel = Number(event.reminderMinutes || 0) > 0 ? `Reminder: ${event.reminderMinutes} minutes before` : 'Reminder due now'
  return `${eventName}${eventTime} — ${reminderLabel}. ${event.description || 'Please check in on this item.'}`
}

export function getFestivalWishTemplate(festivalName, region = 'Uttar Pradesh') {
  const templates = [
    `Wishing you and your loved ones a peaceful, joyful ${festivalName}.`,
    `Warm ${festivalName} wishes to you and your family. May the day bring peace and togetherness.`,
    `Happy ${festivalName}! Wishing you a meaningful celebration filled with joy and goodwill.`,
  ]
  return templates[Math.abs(hashString(`${festivalName}:${region}`)) % templates.length]
}
