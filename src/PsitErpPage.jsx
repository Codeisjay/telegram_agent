import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, BookOpen, CalendarDays, Check, ExternalLink, GraduationCap, LockKeyhole, RefreshCw, Shield, Trash2 } from 'lucide-react'
import { readApiResponse } from './api.js'
import './PsitErpPage.css'

const portalUrl = 'https://erp.psit.ac.in/Erp/'
const passwordResetUrl = 'https://erp.psit.ac.in/Erp/ForgetPassword'

function formatDate(value) {
  if (!value) return 'Not available'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function formatStatus(value) {
  return String(value || '').replace(/[-_]/g, ' ')
}

export default function PsitErpPage({ onToast }) {
  const [state, setState] = useState(null)
  const [userId, setUserId] = useState('')
  const [password, setPassword] = useState('')
  const [working, setWorking] = useState(false)

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/psit-erp')
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.error || 'Could not load PSIT ERP status.')
      setState(result)
    } catch (error) {
      onToast(error.message || 'Could not load PSIT ERP status.')
    }
  }, [onToast])

  useEffect(() => {
    load()
    const timer = window.setInterval(load, 30000)
    return () => window.clearInterval(timer)
  }, [load])

  const submit = async (event) => {
    event.preventDefault()
    setWorking(true)
    try {
      const response = await fetch('/api/psit-erp/connect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId, password }),
      })
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.error || 'Could not connect to PSIT ERP.')
      setPassword('')
      onToast(result.message)
      await load()
    } catch (error) {
      setPassword('')
      onToast(error.message || 'Could not connect to PSIT ERP.')
    } finally {
      setWorking(false)
    }
  }

  const sync = async () => {
    setWorking(true)
    try {
      const response = await fetch('/api/psit-erp/sync', { method: 'POST' })
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.error || 'Could not sync verified PSIT ERP data.')
      onToast(result.message)
      await load()
    } catch (error) {
      onToast(error.message || 'Could not sync verified PSIT ERP data.')
    } finally {
      setWorking(false)
    }
  }

  const disconnect = async () => {
    if (!window.confirm('Disconnect PSIT ERP and delete saved credentials and cached academic data?')) return
    setWorking(true)
    try {
      const response = await fetch('/api/psit-erp/connection', { method: 'DELETE' })
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.error || 'Could not disconnect PSIT ERP.')
      onToast('PSIT ERP disconnected; saved credentials and cached academic data were deleted.')
      await load()
    } catch (error) {
      onToast(error.message || 'Could not disconnect PSIT ERP.')
    } finally {
      setWorking(false)
    }
  }

  if (!state) return <div className="psit-page"><section className="panel psit-panel"><p>Loading PSIT ERP status…</p></section></div>
  const hasVerifiedData = state.dataRetrievalAvailable

  return <div className="psit-page">
    <div className="psit-heading">
      <div>
        <span className="eyebrow">PERSONAL ACADEMIC DATA</span>
        <h2>PSIT Student ERP</h2>
        <p>Credentials are sent only to this backend and the official PSIT portal. They are never provided to an AI model.</p>
      </div>
      <a className="outline-button" href={portalUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} />Official portal</a>
    </div>

    <section className="panel psit-panel">
      <div className="psit-panel-heading">
        <div className="psit-title-icon"><Shield size={17} /><div><h3>Secure connection</h3><p>PSIT portal login is verified before credentials are saved.</p></div></div>
        <span className={`pa-status ${state.connected ? 'pa-status-ok' : 'pa-status-warning'}`}>{state.connected ? 'CONNECTED' : formatStatus(state.status).toUpperCase()}</span>
      </div>
      {!state.encryptionConfigured && <div className="psit-warning"><AlertTriangle size={15} />Server encryption is not configured. Set <code>PSIT_ERP_CREDENTIAL_ENCRYPTION_KEY</code> on the backend before connecting.</div>}
      {state.status === 'password_change_required' && <div className="psit-warning"><AlertTriangle size={15} />PSIT explicitly requires a password change for this account. Update it on the official portal, then reconnect here.</div>}
      {state.status === 'manual_auth_required' && <div className="psit-warning"><AlertTriangle size={15} />PSIT requires a manual security challenge. Complete it on the official portal; AgentFlow will not bypass CAPTCHA or MFA.</div>}
      <form className="psit-connection-form" onSubmit={submit}>
        <label>ERP User ID / Roll Number<input required autoComplete="username" maxLength="120" value={userId} onChange={(event) => setUserId(event.target.value)} /></label>
        <label>ERP password<input required autoComplete="current-password" type="password" maxLength="1024" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <div className="psit-form-actions">
          <button className="primary-button" type="submit" disabled={working || !state.encryptionConfigured}>
            {working ? <RefreshCw className="spin" size={14} /> : <LockKeyhole size={14} />}
            {working ? 'Connecting…' : state.credentialsStored ? 'Reconnect account' : 'Connect account'}
          </button>
          {state.status === 'password_change_required' && <a className="psit-inline-link" href={passwordResetUrl} target="_blank" rel="noreferrer">Change password on PSIT</a>}
        </div>
      </form>
      <div className="psit-security-note"><LockKeyhole size={14} /><span>Stored credentials use AES-256-GCM. The encryption key is server environment configuration, not SQLite. Do not send your ERP password in Telegram.</span></div>
      {state.credentialsStored && <div className="psit-actions">
        <button className="outline-button" type="button" disabled={working} onClick={sync}><RefreshCw size={14} className={working ? 'spin' : ''} />Sync verified academic data</button>
        <button className="psit-disconnect" type="button" disabled={working} onClick={disconnect}><Trash2 size={14} />Disconnect &amp; delete data</button>
      </div>}
    </section>

    <div className="psit-status-grid">
      <section className="panel psit-panel psit-status-card"><span>Connection</span><strong>{formatStatus(state.status)}</strong><small>Account: {state.userIdMasked || 'Not connected'}</small></section>
      <section className="panel psit-panel psit-status-card"><span>Last data sync</span><strong>{formatDate(state.lastSyncAt)}</strong><small>Login validation alone does not count as a data sync.</small></section>
    </div>

    <section className="panel psit-panel psit-limitation">
      <div className="psit-panel-heading"><div className="psit-title-icon"><AlertTriangle size={17} /><div><h3>{hasVerifiedData ? 'Verified ERP data' : 'Data retrieval not active yet'}</h3><p>{hasVerifiedData ? 'Only data parsed from authenticated PSIT pages is shown.' : 'Run a manual sync to retrieve data from mapped authenticated pages.'}</p></div></div></div>
      <p>{state.limitation}</p>
      <p>Attendance percentages, subject-wise attendance, internal marks, and library account details remain unavailable until their values can be reliably mapped. No values are inferred for those sections.</p>
      <div className="psit-data-preview">
        <div><GraduationCap size={15} /><span>Attendance</span><strong>{state.availability.attendance ? 'Cached' : 'Not mapped'}</strong></div>
        <div><CalendarDays size={15} /><span>Timetable</span><strong>{state.availability.timetable ? 'Cached' : 'Not synced'}</strong></div>
        <div><BookOpen size={15} /><span>Marks &amp; notices</span><strong>{state.availability.marks ? 'Marks cached' : state.availability.notices ? 'Notices cached' : 'Not mapped'}</strong></div>
      </div>
    </section>

    {state.data.timetable?.days?.length > 0 && <section className="panel psit-panel">
      <div className="psit-panel-heading"><div className="psit-title-icon"><CalendarDays size={17} /><div><h3>Weekly timetable</h3><p>Retrieved from the authenticated student timetable page.</p></div></div></div>
      {state.data.timetable.days.map((day) => day.periods.map((period) => <div className="psit-history-row" key={`${day.day}-${period.period}`}>
        <strong>{day.day} · {period.startTime}-{period.endTime}</strong>
        <span>{[period.subject, period.faculty, period.room].filter(Boolean).join(' · ')}</span>
      </div>))}
    </section>}

    {state.data.academic?.examCalendar?.exams?.length > 0 && <section className="panel psit-panel">
      <div className="psit-panel-heading"><div className="psit-title-icon"><BookOpen size={17} /><div><h3>Examination calendar</h3><p>Verified calendar entries from PSIT.</p></div></div></div>
      {state.data.academic.examCalendar.exams.map((exam, index) => <div className="psit-history-row" key={`exam-${index}`}>
        <strong>{exam.Examination || 'Exam'}</strong>
        <span>{Object.entries(exam).filter(([key]) => key !== 'Examination').map(([key, value]) => `${key}: ${value}`).join(' · ')}</span>
      </div>)}
    </section>}

    {state.data.notices.length > 0 && <section className="panel psit-panel">
      <div className="psit-panel-heading"><div className="psit-title-icon"><AlertTriangle size={17} /><div><h3>Academic notices</h3><p>Notice titles and links found on the authenticated student dashboard.</p></div></div></div>
      {state.data.notices.map((notice) => <div className="psit-history-row" key={notice.fingerprint}>
        <a href={notice.url} target="_blank" rel="noreferrer">{notice.title}</a>
        <small>{formatDate(notice.capturedAt)}</small>
      </div>)}
    </section>}

    <section className="panel psit-panel">
      <div className="psit-panel-heading"><div className="psit-title-icon"><Check size={17} /><div><h3>Synchronization history</h3><p>Recent connection and sync checks.</p></div></div></div>
      {state.history.length
        ? state.history.map((item) => <div className="psit-history-row" key={item.id}><strong>{formatStatus(item.status)}</strong><span>{item.message}</span><small>{formatDate(item.completedAt)}</small></div>)
        : <p className="psit-empty">No synchronization attempts recorded yet.</p>}
    </section>
  </div>
}
