import { useEffect, useState } from 'react'
import { Activity, AlertTriangle, BriefcaseBusiness, Check, ExternalLink, Globe2, Plus, RefreshCw, Search, X } from 'lucide-react'
import './jobs.css'
import { readApiResponse } from './api.js'

function Badge({ children, tone = 'green' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

export default function JobsPage({ state, loading, setLoading, onRefresh, onToast }) {
  const [profile, setProfile] = useState(null)
  const [settings, setSettings] = useState(null)
  const [companyName, setCompanyName] = useState('')
  const [companyDomains, setCompanyDomains] = useState('')
  const [applicationDomains, setApplicationDomains] = useState('')
  const [filter, setFilter] = useState('all')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!state) return
    setProfile(state.profile)
    setSettings(state.settings)
  }, [state])

  const persistProfile = async () => {
    try {
      const response = await fetch('/api/jobs/profile', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(profile),
      })
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.error || 'Could not save candidate profile.')
      onToast('Candidate profile saved')
      await onRefresh()
    } catch (saveError) {
      setError(saveError.message)
    }
  }

  const persistSettings = async (next = settings) => {
    try {
      const response = await fetch('/api/jobs/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      })
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.error || 'Could not save job settings.')
      setSettings(result.settings)
      onToast('Job research settings saved')
      await onRefresh()
    } catch (saveError) {
      setError(saveError.message)
    }
  }

  const addCompany = () => {
    const name = companyName.trim()
    const officialDomains = companyDomains.split(',').map((domain) => domain.trim()).filter(Boolean)
    if (!name || !officialDomains.length) {
      setError('Enter a company name and its official career-site domain.')
      return
    }
    const next = {
      ...settings,
      companies: [...settings.companies, {
        name,
        officialDomains,
        applicationDomains: applicationDomains.split(',').map((domain) => domain.trim()).filter(Boolean),
      }],
    }
    setCompanyName('')
    setCompanyDomains('')
    setApplicationDomains('')
    persistSettings(next)
  }

  const runResearch = async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/jobs/run', { method: 'POST' })
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.error || 'Job research failed.')
      onToast(`Research finished: ${result.newJobsCount} new jobs found`)
      await onRefresh()
    } catch (runError) {
      setError(runError.message)
    } finally {
      setLoading(false)
    }
  }

  const updateJob = async (job, action) => {
    try {
      const response = await fetch(`/api/jobs/${job.id}/${action}`, { method: 'POST' })
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.error || 'Could not update listing.')
      await onRefresh()
    } catch (updateError) {
      setError(updateError.message)
    }
  }

  if (!state || !profile || !settings) {
    return <section className="panel job-empty"><RefreshCw className={loading ? 'spin' : ''} size={18} /> Loading persistent job-search data…</section>
  }

  const visibleJobs = state.jobs.filter((job) =>
    filter === 'all' || (filter === 'eligible' && ['Eligible', 'Likely eligible'].includes(job.eligibilityStatus))
    || (filter === 'saved' && job.saved) || (filter === 'applied' && job.applicationStatus === 'applied'))
  const runs = state.runs || []

  return <div className="job-workspace">
    {error && <div className="job-error"><AlertTriangle size={15} />{error}<button onClick={() => setError('')}>Dismiss</button></div>}
    <section className="job-summary-grid">
      <div className="panel job-summary"><span>Verified openings</span><strong>{state.jobs.filter((job) => job.verifiedOpen).length}</strong><small>Official career pages checked</small></div>
      <div className="panel job-summary"><span>Eligible matches</span><strong>{state.jobs.filter((job) => job.eligibilityStatus === 'Eligible').length}</strong><small>Based on saved profile</small></div>
      <div className="panel job-summary"><span>Next research run</span><strong>{state.scheduler?.paused ? 'Paused' : state.scheduler?.next_run_at ? new Date(state.scheduler.next_run_at).toLocaleString() : 'Not scheduled'}</strong><small>Daily at 09:00 Asia/Kolkata</small></div>
    </section>

    <section className="panel settings-panel coverage-panel">
      <div className="panel-heading"><div><div className="panel-title-icon search-config-icon"><Activity size={16} /></div><div><h2>Search coverage</h2><p>Coverage reflects configured employer domains checked; zero results do not prove that no openings exist.</p></div></div></div>
      <div className="coverage-overview">
        <span>{state.coverage?.configuredCompanies || 0} configured companies</span>
        <span>{state.coverage?.checkedDomains || 0} official domains checked</span>
        <span>{(state.coverage?.companies || []).reduce((count, company) => count + company.failedSearches, 0)} failed searches</span>
        <span>{state.providerUsage?.length || 0} provider operations recorded</span>
      </div>
      <div className="coverage-list">{(state.coverage?.companies || []).map((company) => <article className="coverage-row" key={company.name}>
        <div><strong>{company.name}</strong><code>{company.domains.join(', ')}</code>{company.applicationDomains.length > 0 && <small>ATS domains: {company.applicationDomains.join(', ')}</small>}</div>
        <span>Last success: {company.lastSuccessfulSearch ? new Date(company.lastSuccessfulSearch).toLocaleString() : 'Not yet searched'}</span>
        <span>{company.failedSearches} failed · {company.verifiedOpenVacancies} verified open · {company.newlyDiscoveredVacancies} new on latest success</span>
        <span className={company.unresolvedVerificationFailures ? 'coverage-warning' : ''}>{company.unresolvedVerificationFailures} unresolved verification failures</span>
      </article>)}
      {!state.coverage?.companies?.length && <div className="job-empty">Add an employer career domain to begin measuring search coverage.</div>}</div>
      <div className="usage-list">{(state.providerUsage || []).slice(0, 8).map((usage, index) => <div className="usage-row" key={`${usage.createdAt}-${index}`}>
        <span>{usage.provider} · {usage.operation}</span><Badge tone={usage.status === 'delivered' || usage.status === '200' ? 'green' : 'amber'}>{usage.status}</Badge>
        <span>{usage.inputTokens == null ? 'tokens n/a' : `${usage.inputTokens} in · ${usage.outputTokens ?? 0} out`}</span>
        <span>{usage.durationMs} ms</span>
      </div>)}</div>
      <small className="coverage-footnote">Search, page-extraction, AI-analysis, and notification operations are logged. Token counts appear only when a provider returns usage metadata; API keys and request content are not stored in usage logs.</small>
    </section>

    <section className="panel settings-panel candidate-panel">
      <div className="panel-heading"><div><div className="panel-title-icon key-title-icon"><BriefcaseBusiness size={16} /></div><div><h2>Candidate profile</h2><p>Blank fields stay unknown; eligibility is never inferred from missing data.</p></div></div><button className="primary-button" onClick={persistProfile}><Check size={14} /> Save profile</button></div>
      <div className="candidate-fields">
        {[['graduationYear', 'Graduation year'], ['degree', 'Degree'], ['branch', 'Branch'], ['college', 'College'], ['academicEligibility', 'Academic eligibility / CGPA'], ['backlogStatus', 'Active backlog status'], ['experience', 'Experience'], ['workMode', 'Preferred work mode'], ['salaryPreference', 'Salary preference']].map(([key, label]) => <label className="candidate-field" key={key}><span>{label}</span><input value={profile[key] || ''} placeholder="Not set" onChange={(event) => setProfile({ ...profile, [key]: event.target.value })} /></label>)}
        {[['skills', 'Skills'], ['preferredRoles', 'Preferred roles'], ['locations', 'Preferred locations'], ['employmentTypes', 'Acceptable employment types']].map(([key, label]) => <label className="candidate-field" key={key}><span>{label} <small>(comma-separated)</small></span><input value={(profile[key] || []).join(', ')} placeholder="Not set" onChange={(event) => setProfile({ ...profile, [key]: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} /></label>)}
      </div>
    </section>

    <section className="panel settings-panel company-panel">
      <div className="panel-heading"><div><div className="panel-title-icon search-config-icon"><Globe2 size={16} /></div><div><h2>Official company career sites</h2><p>Research is restricted to these configured official domains.</p></div></div><button className="outline-button small-button" disabled={loading || state.runInProgress} onClick={runResearch}><Search size={14} />{loading || state.runInProgress ? 'Research running…' : 'Run research now'}</button></div>
      <div className="company-list">{settings.companies.map((company, index) => <div className="company-row" key={`${company.name}-${index}`}><strong>{company.name}</strong><div><code>{company.officialDomains.join(', ')}</code>{company.applicationDomains?.length > 0 && <small>ATS: {company.applicationDomains.join(', ')}</small>}</div><button className="icon-button" aria-label={`Remove ${company.name}`} onClick={() => persistSettings({ ...settings, companies: settings.companies.filter((_, item) => item !== index) })}><X size={14} /></button></div>)}{!settings.companies.length && <div className="job-empty">No companies configured. Add companies with their official career domains; no companies or personal details are assumed.</div>}</div>
      <div className="company-add-row"><input aria-label="Company name" placeholder="Company name" value={companyName} onChange={(event) => setCompanyName(event.target.value)} /><input aria-label="Official domains" placeholder="Employer career domain(s)" value={companyDomains} onChange={(event) => setCompanyDomains(event.target.value)} /><input aria-label="Employer-linked application domains" placeholder="Linked ATS domain(s), optional" value={applicationDomains} onChange={(event) => setApplicationDomains(event.target.value)} /><button className="outline-button small-button" onClick={addCompany}><Plus size={14} /> Add company</button></div>
      <div className="job-preferences-row"><label>Search target graduation year <input type="number" min="2020" max="2040" value={settings.targetGraduationYear} onChange={(event) => setSettings({ ...settings, targetGraduationYear: Number(event.target.value) })} /></label><label>AI provider <select value={settings.provider} onChange={(event) => setSettings({ ...settings, provider: event.target.value })}><option value="gemini">Gemini</option><option value="groq">Groq</option><option value="openrouter">OpenRouter</option></select></label><label>Telegram notification chat ID <input value={settings.telegramChatId || ''} placeholder="Numeric chat ID" onChange={(event) => setSettings({ ...settings, telegramChatId: event.target.value })} /></label><button className="outline-button small-button" onClick={() => persistSettings()}>Save research settings</button></div>
    </section>

    <section className="panel settings-panel jobs-list-panel">
      <div className="panel-heading"><div><div className="panel-title-icon model-title-icon"><BriefcaseBusiness size={16} /></div><div><h2>Tracked vacancies</h2><p>Official evidence is retained across subsequent research runs.</p></div></div><div className="job-filter-tabs">{[['all','All'],['eligible','Eligible'],['saved','Saved'],['applied','Applied']].map(([id,label]) => <button key={id} className={filter === id ? 'selected' : ''} onClick={() => setFilter(id)}>{label}</button>)}</div></div>
      <div className="tracked-jobs">{visibleJobs.map((job) => <article className="tracked-job" key={job.id}>
        <div className="tracked-job-main"><div><strong>{job.title}</strong><span>{job.company} · {job.location || 'Location not stated'}</span></div><Badge tone={job.verifiedOpen ? 'green' : 'amber'}>{job.verifiedOpen ? 'VERIFIED OPEN' : 'UNVERIFIED'}</Badge></div>
        <p>{job.eligibilityStatus}: {job.eligibilityReason}</p>
        <div className="tracked-job-meta"><span>{job.deadline ? `Deadline: ${job.deadline}` : 'No published deadline'}</span><span>{job.confidence} confidence</span><span>{job.applicationStatus.replace('_', ' ')}</span><span>{job.sources.length} retained source(s)</span></div>
        <div className="tracked-job-actions">{job.applicationUrl && <a href={job.applicationUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Application</a>}{job.sourceUrl && job.sourceUrl !== job.applicationUrl && <a href={job.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Employer source</a>}<button onClick={() => updateJob(job, job.saved ? 'unsave' : 'save')}>{job.saved ? 'Unsave' : 'Save job'}</button><button onClick={() => updateJob(job, 'applied')}>{job.applicationStatus === 'applied' ? 'Applied' : 'Mark applied'}</button></div>
      </article>)}{!visibleJobs.length && <div className="job-empty">No listings in this view. Configure companies, then run research.</div>}</div>
    </section>

    <section className="panel settings-panel run-history-panel">
      <div className="panel-heading"><div><div className="panel-title-icon terminal-title-icon"><Activity size={16} /></div><div><h2>Research run history</h2><p>Persistent run state, partial failures, and recovery information.</p></div></div><button className="outline-button small-button" onClick={() => persistSettings({ ...settings, paused: !settings.paused })}>{settings.paused ? 'Resume daily schedule' : 'Pause daily schedule'}</button></div>
      <div className="run-history">{runs.map((run) => <div className="run-history-row" key={run.id}><Badge tone={run.status === 'completed' ? 'green' : run.status === 'partial' ? 'amber' : 'subtle'}>{run.status}</Badge><span>{run.trigger}</span><span>{run.started_at}</span><span>{run.new_jobs_count} new · {run.results_count} results</span>{run.error && <small>{run.error}</small>}</div>)}{!runs.length && <div className="job-empty">No research runs recorded yet.</div>}</div>
    </section>
  </div>
}
