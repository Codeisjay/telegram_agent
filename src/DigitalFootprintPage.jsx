import { useEffect, useState } from 'react'
import { Activity, Clock3, ExternalLink, Github, RefreshCw, ShieldCheck, Youtube } from 'lucide-react'
import { readApiResponse } from './api.js'
import './DigitalFootprintPage.css'

function formatDate(value) {
  if (!value) return 'Unavailable'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function formatNumber(value, digits = 0) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'Unavailable'
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits })
}

function ActivityList({ source, activities }) {
  const label = source === 'github' ? 'GitHub' : 'YouTube'
  const Icon = source === 'github' ? Github : Youtube
  const items = activities.filter((activity) => activity.source === source)
  return <section className="panel footprint-feed">
    <div className="panel-heading">
      <div>
        <div className={`panel-title-icon footprint-${source}-icon`}><Icon size={16} /></div>
        <div><h2>{label} activity</h2><p>Latest activity from the configured public account</p></div>
      </div>
      <span className="badge badge-subtle">{items.length} ITEMS</span>
    </div>
    {items.length ? <div className="footprint-activity-list">{items.map((item) => (
      <article className="footprint-activity" key={`${item.source}-${item.externalId}`}>
        <div className="footprint-activity-content">
          <a href={item.url} target="_blank" rel="noreferrer">{item.title}<ExternalLink size={12} /></a>
          {item.summary && <p>{item.summary}</p>}
          <span><Clock3 size={12} />{formatDate(item.publishedAt)}</span>
        </div>
      </article>
    ))}</div> : <div className="footprint-empty">No activity collected yet. Enable monitoring to start a baseline scan.</div>}
  </section>
}

function MetricCard({ label, value, detail }) {
  return <div className="footprint-metric-card">
    <span>{label}</span>
    <strong>{value}</strong>
    {detail && <small>{detail}</small>}
  </div>
}

function LineChart({ title, data, metric, suffix = '', color = '#ff777d' }) {
  const usable = data.map((item) => ({ date: item.date, value: metric(item) }))
    .filter((point) => point.value !== null && point.value !== undefined && Number.isFinite(Number(point.value)))
  if (!usable.length) return <section className="footprint-chart">
    <h3>{title}</h3><div className="footprint-chart-empty">No data available yet.</div>
  </section>
  const values = usable.map((point) => Number(point.value))
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const points = usable.map((point, index) => {
    const x = usable.length === 1 ? 50 : (index / (usable.length - 1)) * 100
    const y = 6 + (1 - (Number(point.value) - min) / span) * 78
    return `${x},${y}`
  }).join(' ')
  return <section className="footprint-chart">
    <div className="footprint-chart-header">
      <h3>{title}</h3><span>{formatNumber(values[values.length - 1], 1)}{suffix}</span>
    </div>
    <svg viewBox="0 0 100 90" preserveAspectRatio="none" role="img" aria-label={`${title} trend`}>
      <path d="M0 84 H100 M0 45 H100 M0 6 H100" className="footprint-chart-guides" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
    </svg>
    <div className="footprint-chart-range"><span>{usable[0].date}</span><span>{usable[usable.length - 1].date}</span></div>
  </section>
}

function ReportPanel({ title, report, dimension, metric = 'views', label = (row) => row[dimension] }) {
  const rows = report?.rows || []
  return <section className="footprint-report">
    <h3>{title}</h3>
    {report?.status === 'unavailable'
      ? <p className="footprint-report-note">Unavailable: {report.error || 'YouTube did not return this report.'}</p>
      : rows.length
        ? <div className="footprint-report-list">{rows.slice(0, 8).map((row, index) => (
          <div className="footprint-report-row" key={`${label(row)}-${index}`}>
            <span>{label(row) || 'Other'}</span><strong>{formatNumber(row[metric], 1)}</strong>
          </div>
        ))}</div>
        : <p className="footprint-report-note">No rows returned for this date range.</p>}
  </section>
}

export default function DigitalFootprintPage({ onToast }) {
  const [state, setState] = useState(null)
  const [draft, setDraft] = useState({ githubUsername: '', youtubeChannelId: '', enabled: false })
  const [youtubeDraft, setYoutubeDraft] = useState(null)
  const [channelChoice, setChannelChoice] = useState('')
  const [visibleVideos, setVisibleVideos] = useState(100)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [polling, setPolling] = useState(false)

  const load = async () => {
    try {
      const response = await fetch('/api/digital-footprint')
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.error || 'Could not load digital footprint activity.')
      setState(result)
      setDraft(result.settings)
      setYoutubeDraft(result.youtubeIntelligence.monitoring)
      setChannelChoice(result.youtubeIntelligence.channelCandidates?.[0]?.channelId || '')
    } catch (error) {
      onToast(error.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const oauthResult = new URLSearchParams(window.location.search).get('digitalFootprintOAuth')
    if (oauthResult === 'connected') onToast('Google YouTube Analytics connected')
    if (oauthResult === 'failed') onToast('Google authorization failed or was cancelled')
    if (oauthResult) window.history.replaceState({}, '', `${window.location.pathname}#digital-footprint`)
    load()
  }, [])

  const save = async (enabled = draft.enabled) => {
    setSaving(true)
    try {
      const response = await fetch('/api/digital-footprint/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...draft, enabled }),
      })
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.error || 'Could not save monitoring settings.')
      setDraft(result.settings)
      onToast(enabled ? 'Digital footprint monitoring enabled' : 'Digital footprint settings saved')
      await load()
    } catch (error) {
      onToast(error.message)
    } finally {
      setSaving(false)
    }
  }

  const saveYoutube = async (changes = {}) => {
    setSaving(true)
    try {
      const response = await fetch('/api/digital-footprint/youtube/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...youtubeDraft, ...changes }),
      })
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.error || 'Could not save YouTube monitoring settings.')
      setYoutubeDraft(result.settings)
      onToast(result.settings.enabled ? 'YouTube analytics monitoring enabled' : 'YouTube analytics monitoring disabled')
      await load()
    } catch (error) {
      onToast(error.message)
    } finally {
      setSaving(false)
    }
  }

  const runNow = async () => {
    setPolling(true)
    try {
      const response = await fetch('/api/digital-footprint/run', { method: 'POST' })
      const result = await readApiResponse(response)
      if (result.state) setState(result.state)
      if (!response.ok) throw new Error(result.errors?.join(' ') || result.error || 'The activity check failed.')
      if (result.status === 'disabled') onToast('Enable monitoring before running an activity check')
      else if (result.errors?.length) onToast(`Activity check partially completed: ${result.errors.join(' ')}`)
      else onToast('Activity check completed')
      await load()
    } catch (error) {
      onToast(error.message)
      await load()
    } finally {
      setPolling(false)
    }
  }

  const connectYoutube = async () => {
    try {
      const response = await fetch('/api/digital-footprint/youtube/oauth/connect', { method: 'POST' })
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.error || 'Could not start Google authorization.')
      window.location.assign(result.authorizationUrl)
    } catch (error) {
      onToast(error.message)
    }
  }

  const selectYoutubeChannel = async () => {
    setSaving(true)
    try {
      const response = await fetch('/api/digital-footprint/youtube/channel/select', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channelId: channelChoice }),
      })
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.error || 'Could not select the authorized channel.')
      onToast(`Connected channel: ${result.state.channel.title}`)
      await load()
    } catch (error) {
      onToast(error.message)
    } finally {
      setSaving(false)
    }
  }

  const refreshAnalytics = async () => {
    setPolling(true)
    try {
      const response = await fetch('/api/digital-footprint/youtube/analytics/refresh', { method: 'POST' })
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.error || 'Could not retrieve YouTube Analytics.')
      if (result.youtubeSync?.status === 'channel-selection-required') {
        onToast('Choose the YouTube channel returned by your Google account.')
      } else if (result.youtubeSync?.errors?.length) {
        onToast(`Analytics partially refreshed: ${result.youtubeSync.errors.join(' ')}`)
      } else {
        onToast('YouTube Analytics refreshed')
      }
      await load()
    } catch (error) {
      onToast(error.message)
    } finally {
      setPolling(false)
    }
  }

  if (loading && !state) return <section className="panel footprint-empty-page">Loading Digital Footprint Intelligence…</section>
  if (!state) return <section className="panel footprint-empty-page">Digital Footprint Intelligence is unavailable. Try reloading this page.</section>

  const latestRun = state.runs[0]
  const youtube = state.youtubeIntelligence
  const channel = youtube.channel
  const summary = youtube.reports.channel_summary_28d?.rows?.[0] || {}
  const videoList = [...youtube.videos].sort((a, b) => (b.analytics?.views ?? -1) - (a.analytics?.views ?? -1))
  const charts = youtube.dailyStats.slice(-90)
  const netGrowth = (row) => row.subscribersGained == null || row.subscribersLost == null
    ? null : Number(row.subscribersGained) - Number(row.subscribersLost)
  const reportState = (name) => youtube.reports[name]

  return <div className="digital-footprint-page">
    <section className="panel footprint-settings">
      <div className="panel-heading">
        <div>
          <div className="panel-title-icon footprint-main-icon"><Activity size={16} /></div>
          <div><h2>Independent monitoring</h2><p>Public GitHub events and recent YouTube uploads · checks hourly</p></div>
        </div>
        <button type="button" className={`switch ${draft.enabled ? 'is-on' : ''}`} role="switch" aria-checked={draft.enabled}
          aria-label="Enable digital footprint monitoring" disabled={saving}
          onClick={() => save(!draft.enabled)}><span /></button>
      </div>
      <div className="footprint-settings-body">
        <label className="footprint-field">
          <span>GitHub username <small>Optional · public activity</small></span>
          <input value={draft.githubUsername || ''} maxLength={39} autoComplete="off" placeholder="e.g. octocat"
            onChange={(event) => setDraft((current) => ({ ...current, githubUsername: event.target.value }))} />
        </label>
        <label className="footprint-field">
          <span>YouTube channel ID <small>Optional · public activity feed only</small></span>
          <input value={draft.youtubeChannelId || ''} maxLength={64} autoComplete="off" placeholder="e.g. UCxxxxxxxxxxxxxxxxxxxxxx"
            onChange={(event) => setDraft((current) => ({ ...current, youtubeChannelId: event.target.value }))} />
        </label>
        <div className="footprint-actions">
          <button type="button" className="outline-button" disabled={saving} onClick={() => save()}>{saving ? 'Saving…' : 'Save settings'}</button>
          <button type="button" className="primary-button" disabled={polling || (!draft.enabled && !youtubeDraft?.enabled)} onClick={runNow}>
            <RefreshCw size={14} className={polling ? 'spin' : ''} />{polling ? 'Checking…' : 'Check now'}
          </button>
          <span className={`badge ${draft.enabled || youtubeDraft?.enabled ? 'badge-green' : 'badge-subtle'}`}>
            {draft.enabled || youtubeDraft?.enabled ? 'MONITORING ON' : 'MONITORING OFF'}
          </span>
        </div>
        <div className="footprint-credentials">
          <span><ShieldCheck size={14} /> GitHub token: {state.sources.githubTokenConfigured ? 'configured' : 'optional (public API)'}</span>
          <span><ShieldCheck size={14} /> YouTube API key: {state.sources.youtubeApiKeyConfigured ? 'configured' : 'set YOUTUBE_API_KEY on the server'}</span>
          <span><ShieldCheck size={14} /> Telegram: {state.sources.telegramConfigured ? 'ready' : 'configure the bot and notification chat'}</span>
        </div>
        <div className="footprint-oauth-panel">
          <div className="footprint-oauth-copy">
            <strong>YouTube Analytics · {state.youtubeOAuth.connected ? 'Connected' : 'Not connected'}</strong>
            <span>OAuth tokens remain encrypted on the server. Analytics uses the authorized channel ID.</span>
            {state.youtubeOAuth.redirectUri && <code>Redirect URI: {state.youtubeOAuth.redirectUri}</code>}
            {!state.youtubeOAuth.configured && state.youtubeOAuth.setupError && <small>{state.youtubeOAuth.setupError}</small>}
            {channel && <span>Authorized channel: <b>{channel.title}</b> · {channel.channelId}</span>}
            {state.youtubeOAuth.connected && !channel && youtube.channelCandidates.length > 0 && <span>Select the channel returned by this Google account:</span>}
          </div>
          <div className="footprint-oauth-actions">
            {state.youtubeOAuth.connected
              ? <button type="button" className="primary-button" disabled={polling} onClick={refreshAnalytics}>
                <RefreshCw size={14} className={polling ? 'spin' : ''} />{polling ? 'Syncing…' : 'Sync analytics now'}
              </button>
              : <button type="button" className="primary-button" disabled={!state.youtubeOAuth.configured} onClick={connectYoutube}>
                <ShieldCheck size={14} />Connect Google
              </button>}
          </div>
        </div>
        {state.youtubeOAuth.connected && youtube.channelCandidates.length > 0 && !channel && <div className="footprint-channel-select">
          <select value={channelChoice} onChange={(event) => setChannelChoice(event.target.value)} aria-label="Authorized YouTube channel">
            {youtube.channelCandidates.map((candidate) => (
              <option key={candidate.channelId} value={candidate.channelId}>{candidate.title} · {candidate.channelId}</option>
            ))}
          </select>
          <button type="button" className="outline-button" disabled={saving || !channelChoice} onClick={selectYoutubeChannel}>Use this channel</button>
        </div>}
        {state.youtubeOAuth.connected && <div className="footprint-youtube-monitoring">
          <div className="footprint-monitor-row">
            <div><strong>YouTube Analytics monitoring</strong><small>Independent from the existing GitHub/public activity switch · syncs every 6 hours</small></div>
            <button type="button" className={`switch ${youtubeDraft?.enabled ? 'is-on' : ''}`} role="switch"
              aria-checked={Boolean(youtubeDraft?.enabled)} aria-label="Enable YouTube Analytics monitoring"
              disabled={saving || !channel} onClick={() => saveYoutube({ enabled: !youtubeDraft?.enabled })}><span /></button>
          </div>
          <div className="footprint-schedule-grid">
            <label><input type="checkbox" checked={Boolean(youtubeDraft?.alertsEnabled)} disabled={saving}
              onChange={(event) => setYoutubeDraft((current) => ({ ...current, alertsEnabled: event.target.checked }))} /> Important alerts</label>
            <label><input type="checkbox" checked={Boolean(youtubeDraft?.dailyReportEnabled)} disabled={saving}
              onChange={(event) => setYoutubeDraft((current) => ({ ...current, dailyReportEnabled: event.target.checked }))} /> Daily report</label>
            <label><input type="checkbox" checked={Boolean(youtubeDraft?.weeklyReportEnabled)} disabled={saving}
              onChange={(event) => setYoutubeDraft((current) => ({ ...current, weeklyReportEnabled: event.target.checked }))} /> Weekly report</label>
            <label>Daily hour (IST)
              <select value={youtubeDraft?.dailyReportHour ?? 9} disabled={saving}
                onChange={(event) => setYoutubeDraft((current) => ({ ...current, dailyReportHour: Number(event.target.value) }))}>
                {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}
              </select>
            </label>
            <label>Weekly day
              <select value={youtubeDraft?.weeklyReportDay ?? 1} disabled={saving}
                onChange={(event) => setYoutubeDraft((current) => ({ ...current, weeklyReportDay: Number(event.target.value) }))}>
                {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day, index) => (
                  <option key={day} value={index}>{day}</option>
                ))}
              </select>
            </label>
            <label>Weekly hour (IST)
              <select value={youtubeDraft?.weeklyReportHour ?? 9} disabled={saving}
                onChange={(event) => setYoutubeDraft((current) => ({ ...current, weeklyReportHour: Number(event.target.value) }))}>
                {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}
              </select>
            </label>
            <button type="button" className="outline-button" disabled={saving} onClick={() => saveYoutube()}>
              {saving ? 'Saving…' : 'Save report schedule'}
            </button>
          </div>
        </div>}
        <p className="footprint-privacy-note">LinkedIn is not scraped or accessed; use only its official permitted channels or email notifications. Thumbnail impressions and CTR require YouTube Reporting API reach reports and are unavailable here.</p>
        {latestRun && <p className="footprint-last-run">Last check: {formatDate(latestRun.completedAt || latestRun.startedAt)} · {latestRun.status}{latestRun.error ? ` · ${latestRun.error}` : ''}</p>}
      </div>
    </section>

    {channel && <section className="panel footprint-analytics">
      <div className="footprint-analytics-heading">
        <div><h2>{channel.title} · YouTube Analytics</h2><span>Channel ID {channel.channelId} · last sync {formatDate(channel.lastSyncedAt)}</span></div>
        <span>{reportState('channel_summary_28d')?.status === 'available'
          ? `${reportState('channel_summary_28d').rangeStart} – ${reportState('channel_summary_28d').rangeEnd}`
          : 'Reports not available yet'}</span>
      </div>
      <div className="footprint-metric-grid footprint-channel-metrics">
        <MetricCard label="Total channel views" value={formatNumber(channel.views)} detail="Public lifetime total" />
        <MetricCard label="Current subscribers" value={channel.subscribers === null ? 'Unavailable' : formatNumber(channel.subscribers)}
          detail={channel.hiddenSubscriberCount ? 'Hidden by channel owner' : 'Data API value may be rounded'} />
        <MetricCard label="Public video count" value={formatNumber(channel.publicVideoCount)} />
        <MetricCard label="Views · last 28 days" value={formatNumber(summary.views)} />
        <MetricCard label="Watch time · last 28 days" value={summary.estimatedMinutesWatched == null
          ? 'Unavailable' : `${formatNumber(Number(summary.estimatedMinutesWatched) / 60, 1)} h`} />
        <MetricCard label="Subscribers gained / lost · last 28 days"
          value={`${formatNumber(summary.subscribersGained)} / ${formatNumber(summary.subscribersLost)}`}
          detail={summary.subscribersGained == null || summary.subscribersLost == null
            ? 'Unavailable' : `Net ${formatNumber(Number(summary.subscribersGained) - Number(summary.subscribersLost))}`} />
        <MetricCard label="Average view duration" value={summary.averageViewDuration == null
          ? 'Unavailable' : `${formatNumber(summary.averageViewDuration, 1)} sec`} />
        <MetricCard label="Average view percentage" value={summary.averageViewPercentage == null
          ? 'Unavailable' : `${formatNumber(summary.averageViewPercentage, 1)}%`} />
        <MetricCard label="Thumbnail impressions / CTR" value="Unavailable"
          detail="Requires YouTube Reporting API reach reports" />
      </div>

      <div className="footprint-chart-grid">
        <LineChart title="Daily views" data={charts} metric={(row) => row.views} />
        <LineChart title="Daily subscriber net growth" data={charts} metric={netGrowth} color="#7cd4b1" />
        <LineChart title="Daily watch time" data={charts}
          metric={(row) => row.estimatedMinutesWatched == null ? null : Number(row.estimatedMinutesWatched) / 60}
          suffix=" h" color="#9d92ff" />
        <LineChart title="Monthly views" data={youtube.monthlyStats} metric={(row) => row.views} color="#64b5f6" />
      </div>
      <p className="footprint-report-note">Daily history starts at the channel creation date returned by YouTube and is limited to data Google makes available. Charts show unavailable metrics as gaps, not zeros.</p>

      <div className="footprint-video-highlights">
        <ReportPanel title="Top videos · last 28 days" report={{ status: 'available', rows: youtube.topVideos.map((video) => ({
          title: video.title, views: video.analytics?.views,
        })) }}
          dimension="title" label={(row) => row.title} />
        <ReportPanel title="Fastest view growth · last 7 days" report={{ status: 'available', rows: youtube.fastestGrowingVideos.map((video) => ({
          title: video.title, views: video.analytics.viewsChange7Days,
        })) }} dimension="title" label={(row) => row.title} />
        <ReportPanel title="Losing momentum · last 7 days" report={{ status: 'available', rows: youtube.losingMomentumVideos.map((video) => ({
          title: video.title, views: video.analytics.viewsChange7Days,
        })) }} dimension="title" label={(row) => row.title} />
        <ReportPanel title="Strong retention · last 28 days" report={{ status: 'available', rows: youtube.highRetentionVideos.map((video) => ({
          title: video.title, views: video.analytics.averageViewPercentage,
        })) }} dimension="title" metric="views" label={(row) => row.title} />
      </div>

      <section className="footprint-video-section">
        <div className="footprint-section-title"><div><h3>Video performance</h3><span>Per-video Analytics rows for the latest 28-day range · {formatNumber(youtube.videoCount)} indexed · showing up to {youtube.videos.length}</span></div>
          {reportState('video_performance_28d')?.truncated && <span className="badge badge-subtle">API RESULT LIMIT REACHED</span>}
        </div>
        {youtube.videos.length ? <div className="footprint-table-wrap">
          <table className="footprint-video-table">
            <thead><tr>
              <th>Video</th><th>Uploaded</th><th>Views · 28d</th><th>Views change · 7d</th>
              <th>Watch time</th><th>Avg duration</th><th>Avg viewed</th><th>Subs + / −</th>
              <th>Likes / comments / shares</th><th>Impressions / CTR</th>
            </tr></thead>
            <tbody>{videoList.slice(0, visibleVideos).map((video) => (
              <tr key={video.videoId}>
                <td><a href={video.url} target="_blank" rel="noreferrer">{video.title}<ExternalLink size={11} /></a></td>
                <td>{video.publishedAt ? new Date(video.publishedAt).toLocaleDateString() : 'Unavailable'}</td>
                <td>{formatNumber(video.analytics?.views)}</td>
                <td>{formatNumber(video.analytics?.viewsChange7Days)}</td>
                <td>{video.analytics?.estimatedMinutesWatched == null ? 'Unavailable' : `${formatNumber(Number(video.analytics.estimatedMinutesWatched) / 60, 1)} h`}</td>
                <td>{video.analytics?.averageViewDuration == null ? 'Unavailable' : `${formatNumber(video.analytics.averageViewDuration, 1)} s`}</td>
                <td>{video.analytics?.averageViewPercentage == null ? 'Unavailable' : `${formatNumber(video.analytics.averageViewPercentage, 1)}%`}</td>
                <td>{formatNumber(video.analytics?.subscribersGained)} / {formatNumber(video.analytics?.subscribersLost)}</td>
                <td>{formatNumber(video.analytics?.likes)} / {formatNumber(video.analytics?.comments)} / {formatNumber(video.analytics?.shares)}</td>
                <td>Unavailable</td>
              </tr>
            ))}</tbody>
          </table>
          {visibleVideos < youtube.videos.length && <button type="button" className="outline-button footprint-load-more"
            onClick={() => setVisibleVideos((count) => count + 100)}>Show more videos</button>}
        </div> : <div className="footprint-empty">No videos have been indexed yet. Sync the authorized channel to start.</div>}
      </section>

      <div className="footprint-report-grid">
        <ReportPanel title="Traffic sources" report={reportState('traffic_sources')} dimension="insightTrafficSourceType" />
        <ReportPanel title="Audience geography" report={reportState('geography')} dimension="country" />
        <ReportPanel title="Device types" report={reportState('devices')} dimension="deviceType" />
        <ReportPanel title="Audience demographics" report={reportState('demographics')} dimension="ageGroup"
          metric="viewerPercentage" label={(row) => `${row.ageGroup || 'Age unavailable'} · ${row.gender || 'Gender unavailable'}`} />
      </div>
      <section className="footprint-upload-periods">
        <div className="footprint-section-title"><div><h3>Best-performing upload periods</h3><span>Average recent views grouped by upload month; descriptive, not causal</span></div></div>
        {youtube.bestUploadPeriods.length
          ? <div className="footprint-period-list">{youtube.bestUploadPeriods.map((period) => (
            <span key={period.period}>{period.period}: {formatNumber(period.averageViews, 1)} average views · {period.videos} videos</span>
          ))}</div>
          : <p className="footprint-report-note">Not enough video analytics history to calculate upload periods.</p>}
      </section>
      <section className="footprint-upload-periods">
        <div className="footprint-section-title"><div><h3>Telegram notification history</h3><span>Delivery status and duplicate prevention are stored separately</span></div></div>
        {youtube.notifications.length
          ? <div className="footprint-notification-list">{youtube.notifications.slice(0, 8).map((item, index) => (
            <article key={`${item.type}-${item.createdAt}-${index}`}>
              <span className={`badge ${item.status === 'delivered' ? 'badge-green' : 'badge-subtle'}`}>{item.status}</span>
              <div><strong>{item.type}</strong><p>{item.message}</p><small>{formatDate(item.deliveredAt || item.createdAt)}{item.error ? ` · ${item.error}` : ''}</small></div>
            </article>
          ))}</div>
          : <p className="footprint-report-note">No YouTube notifications have been queued.</p>}
      </section>
    </section>}

    <div className="footprint-feed-grid">
      <ActivityList source="github" activities={state.activities} />
      <ActivityList source="youtube" activities={state.activities} />
    </div>
  </div>
}
