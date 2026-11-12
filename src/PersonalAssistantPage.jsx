import { useCallback, useEffect, useState } from 'react'
import { Activity, Bell, CalendarDays, Check, Clock3, RefreshCw, Send, Trash2 } from 'lucide-react'
import { readApiResponse } from './api.js'
import './PersonalAssistantPage.css'

const emptyEvent = {
  title: '',
  description: '',
  category: 'Personal milestone',
  eventDate: '',
  eventTime: '',
  timezone: 'Asia/Kolkata',
  recurrence: 'None',
  reminderMinutes: [10080, 1440, 0],
  importance: 'Medium',
  active: true,
}

const greetingLabels = [
  ['morning', 'Good morning'],
  ['afternoon', 'Good afternoon'],
  ['evening', 'Good evening'],
  ['night', 'Good night'],
]

const schedulerLabels = {
  greetings: 'Daily greetings',
  festivals: 'Indian festivals',
  events: 'Event reminders',
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { timeZone: 'Asia/Kolkata' })
}

export default function PersonalAssistantPage({ onToast }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [eventDraft, setEventDraft] = useState(emptyEvent)
  const [editingId, setEditingId] = useState(null)
  const [customReminder, setCustomReminder] = useState('')

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/companion')
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.error || 'Could not load Personal Assistant settings.')
      setData(result)
    } catch (error) {
      onToast(error.message || 'Could not load Personal Assistant settings.')
    } finally {
      setLoading(false)
    }
  }, [onToast])

  useEffect(() => {
    load()
    const timer = window.setInterval(load, 30000)
    return () => window.clearInterval(timer)
  }, [load])

  const updateSettings = (patch) => setData((current) => ({
    ...current,
    settings: { ...current.settings, ...patch },
  }))

  const saveSettings = async () => {
    setSaving(true)
    try {
      const response = await fetch('/api/companion/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data.settings),
      })
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.error || 'Could not save companion settings.')
      setData((current) => ({ ...current, settings: result.settings }))
      onToast('Personal Assistant settings saved.')
    } catch (error) {
      onToast(error.message || 'Could not save companion settings.')
    } finally {
      setSaving(false)
    }
  }

  const saveEvent = async (event) => {
    event.preventDefault()
    const reminders = [...new Set(eventDraft.reminderMinutes.map(Number).filter((value) => Number.isInteger(value) && value >= 0))]
    if (customReminder && Number.isInteger(Number(customReminder)) && Number(customReminder) > 0) {
      reminders.push(Number(customReminder))
    }
    if (!reminders.length) reminders.push(0)
    const editing = editingId !== null
    try {
      const response = await fetch(editing ? `/api/events/${editingId}` : '/api/events', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...eventDraft, reminderMinutes: [...new Set(reminders)] }),
      })
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.error || 'Could not save event.')
      setEventDraft(emptyEvent)
      setCustomReminder('')
      setEditingId(null)
      onToast(editing ? 'Event updated.' : 'Event saved. Automatic reminders are enabled.')
      await load()
    } catch (error) {
      onToast(error.message || 'Could not save event.')
    }
  }

  const editEvent = (event) => {
    setEventDraft({
      ...event,
      reminderMinutes: event.reminderMinutes || [0],
    })
    setCustomReminder('')
    setEditingId(event.id)
  }

  const deleteEvent = async (event) => {
    try {
      const response = await fetch(`/api/events/${event.id}`, { method: 'DELETE' })
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.error || 'Could not delete event.')
      onToast(`Deleted “${event.title}”.`)
      await load()
    } catch (error) {
      onToast(error.message || 'Could not delete event.')
    }
  }

  const toggleReminder = (minutes) => setEventDraft((current) => ({
    ...current,
    reminderMinutes: current.reminderMinutes.includes(minutes)
      ? current.reminderMinutes.filter((value) => value !== minutes)
      : [...current.reminderMinutes, minutes],
  }))

  if (loading && !data) return <div className="personal-assistant-page"><section className="panel pa-panel"><p>Loading Personal Assistant…</p></section></div>
  if (!data) return <div className="personal-assistant-page"><section className="panel pa-panel"><p>Personal Assistant settings are unavailable.</p><button className="outline-button" onClick={load}>Try again</button></section></div>

  const settings = data.settings
  const runs = data.scheduler?.lastRuns || []
  const history = data.notifications || []

  return <div className="personal-assistant-page">
    <div className="pa-heading">
      <div>
        <span className="eyebrow">PERSONAL COMPANION</span>
        <h2>Personal Assistant</h2>
        <p>Save your preferences and important dates once. AgentFlow will monitor them and send reminders to Telegram.</p>
      </div>
      <button className="primary-button" disabled={saving} onClick={saveSettings}>
        {saving ? <RefreshCw className="spin" size={14} /> : <Check size={15} />}
        {saving ? 'Saving…' : 'Save settings'}
      </button>
    </div>

    <section className="panel pa-panel">
      <div className="pa-panel-heading"><div><Bell size={17} /><div><h3>Daily greetings</h3><p>Warm greetings are sent once per local day at each enabled time.</p></div></div><label className="pa-pause"><input type="checkbox" checked={settings.paused} onChange={(event) => updateSettings({ paused: event.target.checked })} />Pause all companion messages</label></div>
      <label className="pa-inline-field">Name to use<input value={settings.personalName} maxLength="80" onChange={(event) => updateSettings({ personalName: event.target.value })} /></label>
      <div className="pa-greetings">
        {greetingLabels.map(([key, label]) => <div className="pa-greeting-row" key={key}>
          <label><input type="checkbox" checked={Boolean(settings.greetings?.[key])} onChange={(event) => updateSettings({ greetings: { ...settings.greetings, [key]: event.target.checked } })} />{label}</label>
          <input type="time" aria-label={`${label} time`} value={settings.greetingTimes?.[key] || '08:00'} onChange={(event) => updateSettings({ greetingTimes: { ...settings.greetingTimes, [key]: event.target.value } })} />
        </div>)}
      </div>
      <div className="pa-settings-grid">
        <label>Telegram chat ID<input inputMode="numeric" placeholder="Set after /start or enter your chat ID" value={settings.notificationChatId || ''} onChange={(event) => updateSettings({ notificationChatId: event.target.value })} /></label>
        <label>Reminder check interval (minutes)<input type="number" min="5" max="180" value={settings.reminderIntervalMinutes || 15} onChange={(event) => updateSettings({ reminderIntervalMinutes: Math.max(5, Math.min(180, Number(event.target.value) || 15)) })} /></label>
      </div>
    </section>

    <section className="panel pa-panel">
      <div className="pa-panel-heading"><div><div className="pa-calendar-icon"><CalendarDays size={17} /></div><div><h3>Indian festival wishes</h3><p>Dates are fetched from Calendarific and are never inferred from memory.</p></div></div><span className={`pa-status ${data.calendarConfigured ? 'pa-status-ok' : 'pa-status-warning'}`}>{data.calendarConfigured ? 'CALENDAR CONNECTED' : 'API KEY REQUIRED'}</span></div>
      <div className="pa-settings-grid">
        <label className="pa-check-field"><input type="checkbox" checked={Boolean(settings.festivalEnabled)} onChange={(event) => updateSettings({ festivalEnabled: event.target.checked })} />Send festival wishes</label>
        <label>Region<select value={settings.festivalRegion || 'Uttar Pradesh'} onChange={(event) => updateSettings({ festivalRegion: event.target.value })}>
          {['Uttar Pradesh', 'North India', 'Delhi', 'Punjab', 'Haryana', 'Uttarakhand', 'Bihar', 'Rajasthan', 'Madhya Pradesh', 'Himachal Pradesh', 'Jammu and Kashmir'].map((region) => <option key={region}>{region}</option>)}
        </select></label>
      </div>
      <p className="pa-note">Calendarific’s India holiday calendar supplies verified national, local, and religious dates. Configure <code>CALENDARIFIC_API_KEY</code> in Render to enable this feature.</p>
    </section>

    <section className="panel pa-panel">
      <div className="pa-panel-heading"><div><Clock3 size={17} /><div><h3>{editingId ? 'Edit event' : 'Add an event'}</h3><p>Events are stored persistently and checked automatically—no manual reminder trigger is needed.</p></div></div></div>
      <form className="pa-event-form" onSubmit={saveEvent}>
        <label>Event title<input required maxLength="150" value={eventDraft.title} placeholder="Interview, birthday, exam…" onChange={(event) => setEventDraft({ ...eventDraft, title: event.target.value })} /></label>
        <label>Category<input maxLength="80" value={eventDraft.category} onChange={(event) => setEventDraft({ ...eventDraft, category: event.target.value })} /></label>
        <label>Date<input required type="date" value={eventDraft.eventDate} onChange={(event) => setEventDraft({ ...eventDraft, eventDate: event.target.value })} /></label>
        <label>Time (optional)<input type="time" value={eventDraft.eventTime || ''} onChange={(event) => setEventDraft({ ...eventDraft, eventTime: event.target.value })} /></label>
        <label>Repeat<select value={eventDraft.recurrence} onChange={(event) => setEventDraft({ ...eventDraft, recurrence: event.target.value })}>{['None', 'Daily', 'Weekly', 'Monthly', 'Yearly'].map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Importance<select value={eventDraft.importance} onChange={(event) => setEventDraft({ ...eventDraft, importance: event.target.value })}>{['Low', 'Medium', 'High'].map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="pa-event-description">Notes<input maxLength="500" value={eventDraft.description} onChange={(event) => setEventDraft({ ...eventDraft, description: event.target.value })} /></label>
        <fieldset className="pa-reminders"><legend>Remind me</legend>
          {[[10080, 'One week before'], [1440, 'One day before'], [0, 'On the event date']].map(([minutes, label]) => <label key={minutes}><input type="checkbox" checked={eventDraft.reminderMinutes.includes(minutes)} onChange={() => toggleReminder(minutes)} />{label}</label>)}
          <label className="pa-custom-reminder">Custom<input type="number" min="1" max="525600" placeholder="Minutes before" value={customReminder} onChange={(event) => setCustomReminder(event.target.value)} /></label>
        </fieldset>
        <div className="pa-form-actions">
          {editingId !== null && <button type="button" className="outline-button" onClick={() => { setEditingId(null); setEventDraft(emptyEvent); setCustomReminder('') }}>Cancel edit</button>}
          <button type="submit" className="primary-button"><Check size={14} />{editingId !== null ? 'Update event' : 'Save event'}</button>
        </div>
      </form>
      <div className="pa-event-list">
        {!data.events.length && <p className="pa-empty">No saved events yet.</p>}
        {data.events.map((event) => <div className="pa-event-row" key={event.id}>
          <div className="pa-event-main"><strong>{event.title}</strong><span>{event.eventDate}{event.eventTime ? ` · ${event.eventTime}` : ''} · {event.recurrence} · {event.reminderMinutes.join(', ')} min before</span>{event.description && <small>{event.description}</small>}</div>
          <div className="pa-event-actions"><button type="button" className="outline-button small-button" onClick={() => editEvent(event)}>Edit</button><button type="button" className="pa-delete" aria-label={`Delete ${event.title}`} onClick={() => deleteEvent(event)}><Trash2 size={15} /></button></div>
        </div>)}
      </div>
    </section>

    <section className="panel pa-panel">
      <div className="pa-panel-heading"><div><Activity size={17} /><div><h3>Scheduler status</h3><p>External cron and the optional in-process tick use the same persistent idempotency records.</p></div></div><span className={`pa-status ${data.persistentStorage ? 'pa-status-ok' : 'pa-status-warning'}`}>{data.persistentStorage ? 'POSTGRESQL' : 'LOCAL SQLITE'}</span></div>
      {!data.persistentStorage && <p className="pa-warning">For Render Free, configure <code>DATABASE_URL</code> with persistent PostgreSQL. SQLite on the instance filesystem can be lost when the service restarts or redeploys.</p>}
      <div className="pa-scheduler-grid">{Object.entries(schedulerLabels).map(([key, label]) => {
        const run = data.scheduler?.schedulers?.[key]
        return <div className="pa-scheduler-card" key={key}><strong>{label}</strong><span>{run?.status || 'Waiting for first run'}</span><small>{run?.startedAt ? formatDate(run.startedAt) : 'Not run yet'}</small><small>{run?.deliveredCount || 0} notifications delivered</small></div>
      })}</div>
      <div className="pa-history-heading"><h3>Recent notification history</h3><span>{history.length} records</span></div>
      {history.slice(0, 12).map((notification) => <div className="pa-history-row" key={notification.idempotencyKey}><span><Send size={13} />{notification.title}</span><span className={`pa-history-status ${notification.status}`}>{notification.status}</span><small>{formatDate(notification.deliveredAt || notification.createdAt)} · {notification.attempts} attempt(s){notification.error ? ` · ${notification.error}` : ''}</small></div>)}
      {!history.length && <p className="pa-empty">No companion notifications have been sent yet.</p>}
      <div className="pa-run-history">{runs.slice(0, 5).map((run) => <div key={run.id}><span>{schedulerLabels[run.schedulerName] || run.schedulerName} · {run.trigger} · {run.status}</span><small>{formatDate(run.startedAt)}{run.error ? ` · ${run.error}` : ''}</small></div>)}</div>
    </section>
  </div>
}
