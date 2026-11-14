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
      if (!response.ok) throw new Error(result.error || 'Could not check the PSIT ERP connection.')
      onToast(result.message)
      await load()
    } catch (error) {
      onToast(error.message || 'Could not check the PSIT ERP connection.')
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
        <span className={`pa-status ${state.connected ? 'pa-status-ok' : 'pa-status-warning'}`}>{state.connected ? 'CONNECTED' : state.status.replaceAll('-', ' ').toUpperCase()}</span>
      </div>
      {!state.encryptionConfigured && <div className="psit-warning"><AlertTriangle size={15} />Server encryption is not configured. Set <code>PSIT_ERP_CREDENTIAL_ENCRYPTION_KEY</code> on the backend before connecting.</div>}
      {state.status === 'password-change-required' && <div className="psit-warning"><AlertTriangle size={15} />PSIT requires a password change. Update it on the official portal, then reconnect here.</div>}
      {state.status === 'manual-auth-required' && <div className="psit-warning"><AlertTriangle size={15} />PSIT requires a manual security challenge. Complete it on the official portal; AgentFlow will not bypass CAPTCHA or MFA.</div>}
      <form className="psit-connection-form" onSubmit={submit}>
        <label>ERP User ID / Roll Number<input required autoComplete="username" maxLength="120" value={userId} onChange={(event) => setUserId(event.target.value)} /></label>
        <label>ERP password<input required autoComplete="current-password" type="password" maxLength="1024" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <div className="psit-form-actions">
          <button className="primary-button" type="submit" disabled={working || !state.encryptionConfigured}>
            {working ? <RefreshCw className="spin" size={14} /> : <LockKeyhole size={14} />}
            {working ? 'Connecting…' : state.credentialsStored ? 'Reconnect account' : 'Connect account'}
          </button>
          {state.status === 'password-change-required' && <a className="psit-inline-link" href={passwordResetUrl} target="_blank" rel="noreferrer">Change password on PSIT</a>}
        </div>
      </form>
      <div className="psit-security-note"><LockKeyhole size={14} /><span>Stored credentials use AES-256-GCM. The encryption key is server environment configuration, not SQLite. Do not send your ERP password in Telegram.</span></div>
      {state.credentialsStored && <div className="psit-actions">
        <button className="outline-button" type="button" disabled={working} onClick={sync}><RefreshCw size={14} className={working ? 'spin' : ''} />Check login &amp; sync status</button>
        <button className="psit-disconnect" type="button" disabled={working} onClick={disconnect}><Trash2 size={14} />Disconnect &amp; delete data</button>
      </div>}
    </section>

    <div className="psit-status-grid">
      <section className="panel psit-panel psit-status-card"><span>Connection</span><strong>{state.status.replaceAll('-', ' ')}</strong><small>Account: {state.userIdMasked || 'Not connected'}</small></section>
      <section className="panel psit-panel psit-status-card"><span>Last successful data sync</span><strong>{formatDate(state.lastSyncAt)}</strong><small>Login validation does not count as a data sync.</small></section>
    </div>

    <section className="panel psit-panel psit-limitation">
      <div className="psit-panel-heading"><div className="psit-title-icon"><AlertTriangle size={17} /><div><h3>Data retrieval is not active yet</h3><p>Honest status: no academic data has been accessed or inferred.</p></div></div></div>
      <p>{state.limitation}</p>
      <p>The public PSIT sign-in page currently announces that all user passwords have expired. Change your password using the official portal first. After authenticated pages are available for inspection, attendance, timetable, marks, notices, and safe scheduled synchronization can be mapped to verified sources.</p>
      <div className="psit-data-preview">
        <div><GraduationCap size={15} /><span>Attendance</span><strong>{state.data.attendance ? 'Cached' : 'No verified data'}</strong></div>
        <div><CalendarDays size={15} /><span>Timetable</span><strong>{state.data.timetable ? 'Cached' : 'No verified data'}</strong></div>
        <div><BookOpen size={15} /><span>Marks &amp; notices</span><strong>{state.data.academic || state.data.notices.length ? 'Cached' : 'No verified data'}</strong></div>
      </div>
    </section>

    <section className="panel psit-panel">
      <div className="psit-panel-heading"><div className="psit-title-icon"><Check size={17} /><div><h3>Synchronization history</h3><p>Recent connection and sync checks.</p></div></div></div>
      {state.history.length
        ? state.history.map((item) => <div className="psit-history-row" key={item.id}><strong>{item.status.replaceAll('-', ' ')}</strong><span>{item.message}</span><small>{formatDate(item.completedAt)}</small></div>)
        : <p className="psit-empty">No synchronization attempts recorded yet.</p>}
    </section>
  </div>
}
