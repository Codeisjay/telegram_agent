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
  return {
    timezone: input.timezone || current.timezone || fallback.timezone,
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
    hour12: false,
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

export function getGreetingVariant(kind, settings = DEFAULT_COMPANION_SETTINGS) {
  const variants = greetingVariants[kind] || greetingVariants.morning
  const personalName = (normalizeCompanionSettings(settings).personalName || 'Jay').trim() || 'Jay'
  return variants[(Math.abs(hashString(`${kind}:${personalName}`)) % variants.length)]
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
  if (normalized.paused || !normalized.greetings) return null
  const { hour, minute, year, month, day } = getLocalDateParts(now, normalized.timezone)
  const schedule = Object.fromEntries(Object.entries(normalized.greetingTimes).map(([kind, time]) => [kind, toMinutesOfDay(time)]))
  const currentMinutes = hour * 60 + minute
  for (const kind of ['morning', 'afternoon', 'evening', 'night']) {
    if (!normalized.greetings[kind]) continue
    const target = schedule[kind]
    if (target == null) continue
    const minutesAway = Math.abs(currentMinutes - target)
    if (minutesAway <= 15 && !isQuietHours(normalized, now)) {
      return { kind, message: getGreetingVariant(kind, normalized), dueAt: new Date(Date.UTC(year, month - 1, day, hour, minute, 0)), dayKey: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` }
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

  const title = lower.includes('birthday') ? 'Birthday'
    : lower.includes('anniversary') ? 'Anniversary'
      : lower.includes('interview') ? 'Interview'
        : lower.includes('meeting') ? 'Meeting'
          : lower.includes('exam') || lower.includes('examination') ? 'Examination'
            : lower.includes('submission') ? 'Project submission'
              : lower.includes('internship') ? 'Internship'
                : lower.includes('travel') ? 'Travel'
                  : lower.split(/\s+(?:is|on|at|for|about|remind|my|i have|i\s*have)\s+/i).find(Boolean)?.slice(0, 48) || 'Personal event'

  let date = null
  const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
  const monthMatch = normalized.match(/\b(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/i)
  if (monthMatch) {
    const day = Number(monthMatch[1])
    const month = monthNames.indexOf(monthMatch[2].toLowerCase()) + 1
    const year = new Date(now).getFullYear()
    date = new Date(year, month - 1, day)
  } else if (/\btomorrow\b/i.test(normalized)) {
    date = new Date(now)
    date.setDate(date.getDate() + 1)
  } else if (/\bnext month\b/i.test(normalized)) {
    date = new Date(now)
    date.setMonth(date.getMonth() + 1)
  }

  const timeMatch = normalized.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i)
  let eventTime = ''
  if (timeMatch) {
    let hour = Number(timeMatch[1])
    const minute = Number(timeMatch[2] || '0')
    const meridian = timeMatch[3].toLowerCase()
    if (meridian === 'am' && hour === 12) hour = 0
    if (meridian === 'pm' && hour !== 12) hour += 12
    eventTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  }

  const description = normalized.replace(/\b(?:my|i have|i\s+have)\b/gi, '').replace(/\b(?:is|on|at|for|about)\b/gi, '').trim()
  return {
    title: title.slice(0, 150),
    description: description.slice(0, 500) || `${category} reminder`,
    category,
    recurrence,
    eventDate: date ? date.toISOString().slice(0, 10) : new Date(now).toISOString().slice(0, 10),
    eventTime,
    reminderMinutes: [0, 1440],
    importance: /important|critical|key/i.test(lower) ? 'High' : 'Medium',
    timezone: 'Asia/Kolkata',
  }
}

export function buildEventReminderMessage(event, occurrenceDate = new Date()) {
  const eventName = String(event.title || 'Event').trim() || 'Event'
  const eventTime = event.eventTime ? ` at ${event.eventTime}` : ''
  const reminderLabel = Number(event.reminderMinutes || 0) > 0 ? `Reminder: ${event.reminderMinutes} minutes before` : 'Reminder due now'
  return `${eventName}${eventTime} — ${reminderLabel}. ${event.description || 'Please check in on this item.'}`
}

export function getFestivalWishTemplate(festivalName, region = 'Uttar Pradesh') {
  const templates = [
    `Wishing you a joyful ${festivalName} celebration in ${region}! May this auspicious day bring happiness, peace, and prosperity.`,
    `Happy ${festivalName}! May this special occasion fill your home with warmth, light, and meaningful blessings.`,
    `${festivalName} greetings! May this day bring peace, happiness, and fresh strength for the journey ahead.`,
  ]
  return templates[Math.abs(hashString(`${festivalName}:${region}`)) % templates.length]
}
