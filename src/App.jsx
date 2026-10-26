import { useEffect, useMemo, useState } from 'react'
import {
  Activity, AlertTriangle, ArrowDown, ArrowRight, ArrowUpRight, BarChart3,
  Bot, BriefcaseBusiness, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, CircleHelp,
  Clock3, Command, Copy, Cpu, ExternalLink, Eye, EyeOff, FileText, Filter, FlaskConical,
  Globe2, KeyRound, LayoutDashboard, LockKeyhole, Menu, MessageCircle,
  MoreHorizontal, Pause, Play, Plus, Radio, RefreshCw, Search, Send, Settings2,
  Shield, SlidersHorizontal, Sparkles, Terminal, Trash2, TrendingUp, Webhook,
  X, Zap,
} from 'lucide-react'
import JobsPage from './JobsPage.jsx'
import { readApiResponse } from './api.js'

const initialLogs = []

const navItems = [
  { id: 'overview', label: 'Overview & Logs', icon: LayoutDashboard },
  { id: 'jobs', label: 'Job intelligence', icon: BriefcaseBusiness },
  { id: 'rules', label: 'Prompt & Rules', icon: SlidersHorizontal },
  { id: 'models', label: 'LLM & Web Search', icon: Cpu },
  { id: 'telegram', label: 'Telegram Settings', icon: Send },
]

const defaults = {
  prompt: 'You are AgentFlow, a helpful Telegram research assistant.\n\nAnswer the user’s request with concise, accurate information grounded in reliable web sources. Cite sources as numbered markdown links.\n\nUser request: {{user_query}}\nCurrent date: {{current_date}}\nSearch results: {{search_results}}',
  preset: 'Custom prompt',
  rules: [
    { name: 'Financial queries', condition: 'query CONTAINS "/price"', action: 'Use financial search engine', enabled: true },
    { name: 'Concise summaries', condition: 'query STARTS WITH "/summary"', action: 'Limit response to 5 bullet points', enabled: true },
    { name: 'Handle greetings', condition: 'query EQUALS "/start"', action: 'Send welcome message', enabled: false },
  ],
  format: { footer: false, links: true, timestamp: false, maxChars: true },
  provider: 'openrouter',
  maxResults: 5,
  depth: 'Balanced',
  rateLimit: 30,
  webhook: 'https://api.agentflow.ai/v1/telegram/webhook',
  secret: '',
  access: 'public',
  whitelist: ['1207882899'],
  commands: [
    { command: '/start', description: 'Start the agent and see welcome message' },
    { command: '/search', description: 'Search the web for a topic' },
    { command: '/summary', description: 'Summarize a link or topic' },
    { command: '/rules', description: 'View active response rules' },
    { command: '/clear', description: 'Clear the current conversation' },
  ],
}

function readSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem('agentflow-config') || '{}')
    delete saved.keys
    if (!localStorage.getItem('agentflow-public-access-migrated')) {
      saved.access = 'public'
      localStorage.setItem('agentflow-public-access-migrated', 'true')
    }
    if (!localStorage.getItem('agentflow-openrouter-primary-migrated')) {
      saved.provider = 'openrouter'
      localStorage.setItem('agentflow-openrouter-primary-migrated', 'true')
    }
    return {
      ...defaults,
      ...saved,
      whitelist: [...new Set([
        '1207882899',
        ...(Array.isArray(saved.whitelist) ? saved.whitelist.filter((id) => typeof id === 'string') : []),
      ])],
    }
  } catch {
    return defaults
  }
}

function IconButton({ label, onClick, children, className = '' }) {
  return <button className={`icon-button ${className}`} type="button" aria-label={label} title={label} onClick={onClick}>{children}</button>
}

function Badge({ children, tone = 'green', className = '' }) {
  return <span className={`badge badge-${tone} ${className}`}>{children}</span>
}

function Switch({ checked, onChange, label }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`switch ${checked ? 'is-on' : ''}`} onClick={() => onChange(!checked)}><span /></button>
}

function App() {
  const [config, setConfig] = useState(readSaved)
  const [active, setActive] = useState('overview')
  const [collapsed, setCollapsed] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [paused, setPaused] = useState(false)
  const [logs, setLogs] = useState(initialLogs)
  const [logTab, setLogTab] = useState('all')
  const [logFilter, setLogFilter] = useState('')
  const [toast, setToast] = useState('')
  const [queryOpen, setQueryOpen] = useState(false)
  const [testQuery, setTestQuery] = useState('')
  const [testResult, setTestResult] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [dark, setDark] = useState(true)
  const [secretStatus, setSecretStatus] = useState({})
  const [secretDrafts, setSecretDrafts] = useState({})
  const [secretServiceReady, setSecretServiceReady] = useState(false)
  const [agentStatus, setAgentStatus] = useState({ running: false, status: 'stopped', message: 'Agent is stopped.' })
  const [testLoading, setTestLoading] = useState(false)
  const [jobState, setJobState] = useState(null)
  const [jobLoading, setJobLoading] = useState(false)

  const refreshJobState = async () => {
    const response = await fetch('/api/jobs/state')
    const result = await readApiResponse(response)
    if (!response.ok) throw new Error(result.error || 'Could not load job intelligence data.')
    setJobState(result)
  }

  useEffect(() => {
    if (active !== 'jobs') return undefined
    let mounted = true
    const load = async () => {
      try {
        const response = await fetch('/api/jobs/state')
        const result = await readApiResponse(response)
        if (!response.ok) throw new Error(result.error || 'Could not load job intelligence data.')
        if (mounted) setJobState(result)
      } catch (error) {
        if (mounted) setToast(error.message)
      }
    }
    load()
    const timer = window.setInterval(load, 30000)
    return () => { mounted = false; window.clearInterval(timer) }
  }, [active])

  useEffect(() => {
    localStorage.setItem('agentflow-config', JSON.stringify(config))
  }, [config])

  useEffect(() => {
    fetch('/api/secrets')
      .then(async (response) => {
        if (!response.ok) throw new Error('Credential service is unavailable.')
        return readApiResponse(response)
      })
      .then(({ configured }) => {
        setSecretStatus(configured)
        setSecretServiceReady(true)
      })
      .catch(() => {
        setSecretServiceReady(false)
        setToast('AgentFlow API is missing from this deployment. Deploy the backend before using dashboard features.')
      })
  }, [])

  useEffect(() => {
    if (!secretServiceReady) return undefined
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch('/api/agent/settings', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(config),
        })
        const result = await readApiResponse(response)
        if (!response.ok) throw new Error(result.error || 'Could not save agent settings.')
      } catch (error) {
        setToast(error.message || 'Could not save agent settings.')
      }
    }, 500)
    return () => window.clearTimeout(timeout)
  }, [config, secretServiceReady])

  useEffect(() => {
    let active = true
    let timer
    const refresh = async () => {
      try {
        const response = await fetch('/api/agent/status')
        if (response.status === 404) {
          if (!active) return
          setSecretServiceReady(false)
          setAgentStatus({
            running: false,
            status: 'error',
            message: 'Backend API is not deployed.',
          })
          setToast('This Vercel deployment serves the dashboard only; its backend API routes are not deployed.')
          window.clearInterval(timer)
          return
        }
        if (!response.ok) return
        const result = await readApiResponse(response)
        if (!active) return
        setAgentStatus(result)
        if (result.events) setLogs(result.events)
      } catch {
        if (active) setSecretServiceReady(false)
      }
    }
    refresh()
    timer = window.setInterval(refresh, 2500)
    return () => { active = false; window.clearInterval(timer) }
  }, [])

  useEffect(() => {
    if (!toast) return undefined
    const timeout = window.setTimeout(() => setToast(''), 2800)
    return () => window.clearTimeout(timeout)
  }, [toast])

  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen((value) => !value)
      }
      if (event.key === 'Escape') { setSearchOpen(false); setQueryOpen(false); setProfileOpen(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const update = (key, value) => setConfig((current) => ({ ...current, [key]: value }))
  const saveSecret = async (name, value) => {
    try {
      const response = await fetch('/api/secrets', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, value }),
      })
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.error || 'Could not save credential.')
      setSecretStatus((current) => ({ ...current, [name]: result.configured }))
      setSecretDrafts((current) => ({ ...current, [name]: '' }))
      setToast(result.configured ? 'Credential saved to the local server' : 'Credential removed from the local server')
    } catch (error) {
      setToast(error.message || 'Could not save credential.')
    }
  }
  const testSecret = async (name, value) => {
    try {
      const response = await fetch('/api/secrets/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(value === undefined ? { name } : { name, value }),
      })
      const result = await readApiResponse(response)
      setToast(result.message || (response.ok ? 'Credential verified' : 'Credential check failed'))
    } catch (error) {
      setToast(error.message || 'Could not reach the AgentFlow API.')
    }
  }
  const toggleAgent = async () => {
    try {
      const response = await fetch(agentStatus.running ? '/api/agent/stop' : '/api/agent/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: agentStatus.running ? '{}' : JSON.stringify(config),
      })
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.error || 'Could not change agent status.')
      setAgentStatus((current) => ({ ...current, running: result.running, status: result.running ? 'starting' : 'stopped', message: result.message }))
      setToast(result.message)
    } catch (error) {
      setAgentStatus((current) => ({ ...current, status: 'error', message: error.message }))
      setToast(error.message || 'Could not change agent status.')
    }
  }
  const activeProvider = config.provider === 'groq' ? 'Groq GPT-OSS 120B' : config.provider === 'openrouter' ? 'OpenRouter' : 'Gemini 3.8 Flash'

  const runTest = async () => {
    const cleaned = testQuery.trim()
    if (!cleaned) { setToast('Enter a message to test'); return }
    setTestLoading(true)
    setTestResult(null)
    try {
      const response = await fetch('/api/agent/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: cleaned.replace(/^\/(search|summary)\s*/, ''),
          settings: config,
        }),
      })
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.error || 'Agent request failed.')
      setTestResult(result)
    } catch (error) {
      setTestResult({ error: error.message || 'Could not reach the local agent service.' })
    } finally {
      setTestLoading(false)
    }
  }

  const nav = <div className="nav-content">
    <div className="nav-label">WORKSPACE</div>
    {navItems.map(({ id, label, icon: Icon }) => (
      <button key={id} className={`nav-item ${active === id ? 'active' : ''}`} onClick={() => { setActive(id); setMobileNav(false) }}>
        <Icon size={17} strokeWidth={1.8} /><span className="nav-text">{label}</span>{id === 'overview' && <span className="nav-live-dot" />}
      </button>
    ))}
    <div className="nav-label nav-label-spaced">QUICK ACTIONS</div>
    <button className="nav-item quick-action" onClick={() => { setQueryOpen(true); setTestResult(null) }}><FlaskConical size={17} /><span className="nav-text">Test live query</span></button>
    <button className="nav-item quick-action" onClick={toggleAgent}>
      {agentStatus.running ? <Pause size={17} /> : <Play size={17} />}<span className="nav-text">{agentStatus.running ? 'Stop live agent' : 'Start live agent'}</span>
    </button>
  </div>

  return <div className={`app-shell ${dark ? '' : 'light-theme'}`}>
    <header className="topbar">
      <button className="brand" onClick={() => setActive('overview')} aria-label="AgentFlow home">
        <span className="brand-mark"><Bot size={21} strokeWidth={2.3} /></span>
        <span className="brand-copy"><strong>agentflow<span>.ai</span></strong><small>TELEGRAM AGENT <i>•</i> V2.5</small></span>
      </button>
      <button className="mobile-menu icon-button" aria-label="Open navigation" onClick={() => setMobileNav(!mobileNav)}><Menu size={19} /></button>
      <div className="top-status"><Badge tone={agentStatus.running ? 'green' : agentStatus.status === 'error' ? 'amber' : 'subtle'}><span className="status-dot" />{agentStatus.running ? 'Bot Live' : agentStatus.status === 'error' ? 'Bot Error' : 'Bot Offline'}</Badge><span className="bot-handle">{agentStatus.message}</span></div>
      <div className="top-spacer" />
      <div className="system-indicators">
        <div className="system-chip"><span className="telegram-glyph"><Send size={12} fill="currentColor" /></span><span>Telegram</span><b className={agentStatus.running ? 'text-green' : ''}>{agentStatus.running ? <><Check size={13} /> Polling</> : 'Not polling'}</b></div>
        <div className="system-chip"><Cpu size={15} className="text-violet" /><span>Engine</span><b>{activeProvider}</b></div>
        <div className="system-chip health-chip"><Zap size={14} className="text-amber" /><span>Health</span><b className="text-green">99.8%</b></div>
      </div>
      <button className="test-bot-button" onClick={() => { setQueryOpen(true); setTestResult(null) }}><Terminal size={15} /><span>Test agent</span></button>
      <div className="profile-wrap">
        <button className="avatar" onClick={() => setProfileOpen(!profileOpen)} aria-label="Open profile menu">AD</button>
        {profileOpen && <div className="profile-menu"><div className="profile-name">Alex Developer</div><div className="profile-email">admin@agentflow.ai</div><div className="menu-divider" /><button onClick={() => { setActive('telegram'); setProfileOpen(false) }}><Settings2 size={15} />Workspace settings</button><button onClick={() => { setDark(!dark); setProfileOpen(false) }}><Sparkles size={15} />Toggle appearance</button></div>}
      </div>
    </header>

    <aside className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''} ${mobileNav ? 'mobile-open' : ''}`}>
      <button className="collapse-button" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}</button>
      {nav}
      <div className="sidebar-bottom">
        <div className="system-normal"><span className="pulse-dot" /><div className="system-normal-copy"><strong>All systems normal</strong><small><span className="mono">34ms</span> ping <span className="uptime">99.98%</span></small></div><ChevronDown size={14} className="system-chevron" /></div>
        <div className="sidebar-meta">AGENTFLOW CLOUD <span>·</span> US-EAST-1</div>
      </div>
    </aside>
    {mobileNav && <button className="mobile-backdrop" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}

    <main className={`main-content ${collapsed ? 'main-expanded' : ''}`}>
      <div className="page-heading">
        <div><div className="breadcrumbs">Workspace <ChevronRight size={13} /> <span>{navItems.find((item) => item.id === active)?.label}</span></div><h1>{active === 'overview' ? 'Overview' : active === 'jobs' ? 'Job intelligence' : active === 'rules' ? 'Prompt & rules' : active === 'models' ? 'LLM & web search' : 'Telegram settings'}</h1><p>{active === 'overview' ? 'Monitor your agent’s performance and recent activity.' : active === 'jobs' ? 'Find verified internship and fresher openings against your candidate profile.' : active === 'rules' ? 'Shape how your agent thinks, responds, and formats results.' : active === 'models' ? 'Manage your AI providers, search behavior, and API credentials.' : 'Configure your Telegram connection, commands, and access.'}</p></div>
        <div className="heading-actions">
          <button className="search-trigger" onClick={() => setSearchOpen(true)}><Search size={15} /><span>Search anything...</span><kbd><Command size={11} /> K</kbd></button>
          <IconButton label="Toggle theme" onClick={() => setDark(!dark)}><Sparkles size={17} /></IconButton>
          <button className="outline-button heading-test" onClick={() => { setQueryOpen(true); setTestResult(null) }}><FlaskConical size={15} /> Test query</button>
        </div>
      </div>

      {active === 'overview' && <Overview logs={logs} setLogs={setLogs} paused={paused} setPaused={setPaused} logTab={logTab} setLogTab={setLogTab} logFilter={logFilter} setLogFilter={setLogFilter} onToast={setToast} onTest={() => { setQueryOpen(true); setTestResult(null) }} agentRunning={agentStatus.running} onToggleAgent={toggleAgent} activeProvider={activeProvider} />}
      {active === 'jobs' && <JobsPage state={jobState} loading={jobLoading} setLoading={setJobLoading} onRefresh={refreshJobState} onToast={setToast} />}
      {active === 'rules' && <RulesPage config={config} update={update} onToast={setToast} />}
      {active === 'models' && <ModelsPage config={config} update={update} onToast={setToast} secretStatus={secretStatus} secretDrafts={secretDrafts} setSecretDrafts={setSecretDrafts} saveSecret={saveSecret} testSecret={testSecret} secretServiceReady={secretServiceReady} />}
      {active === 'telegram' && <TelegramPage config={config} update={update} onToast={setToast} secretStatus={secretStatus} secretDrafts={secretDrafts} setSecretDrafts={setSecretDrafts} saveSecret={saveSecret} testSecret={testSecret} secretServiceReady={secretServiceReady} agentRunning={agentStatus.running} onToggleAgent={toggleAgent} />}
      <footer className="page-footer"><span>AgentFlow AI <span className="footer-sep">/</span> Control Center</span><span>All changes saved automatically <span className="save-indicator" /></span></footer>
    </main>

    {queryOpen && <QueryModal query={testQuery} setQuery={setTestQuery} result={testResult} loading={testLoading} provider={activeProvider} runTest={runTest} onClose={() => setQueryOpen(false)} />}
    {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} onNavigate={(id) => { setActive(id); setSearchOpen(false) }} />}
    {toast && <div className="toast"><span className="toast-check"><Check size={14} /></span>{toast}<button onClick={() => setToast('')} aria-label="Dismiss notification"><X size={14} /></button></div>}
  </div>
}

function Overview({ logs, setLogs, paused, setPaused, logTab, setLogTab, logFilter, setLogFilter, onToast, onTest, agentRunning, onToggleAgent, activeProvider }) {
  const shownLogs = useMemo(() => logs.filter((log) => (logTab === 'all' || log.group === logTab) && `${log.time} ${log.type} ${log.text}`.toLowerCase().includes(logFilter.toLowerCase())), [logs, logTab, logFilter])
  const completedQueries = logs.filter((log) => log.group === 'search' && log.type === '200 OK' && log.timestamp > Date.now() - 24 * 60 * 60 * 1000)
  const latencyValues = completedQueries.map((log) => Number(log.text.match(/· (\d+)ms/)?.[1])).filter(Number.isFinite)
  const averageLatency = latencyValues.length ? `${(latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length / 1000).toFixed(2)}s` : '—'
  return <>
    <div className="stat-grid">
      <StatCard label="Recent queries" value={String(completedQueries.length)} detail="LIVE DATA" detailTone="subtle" icon={MessageCircle} accent="violet" sub="From the latest agent events" />
      <StatCard label="Avg. search latency" value={averageLatency} detail={latencyValues.length ? 'LIVE' : 'NO DATA'} detailTone="subtle" icon={Zap} accent="cyan" sub={latencyValues.length ? `Across ${latencyValues.length} requests` : 'Waiting for first request'} />
      <StatCard label="Selected engine" value={activeProvider} detail="SELECTED" detailTone="violet" icon={Cpu} accent="violet" sub="Used for new requests" />
      <StatCard label="Telegram agent" value={agentRunning ? 'Listening' : 'Offline'} detail={agentRunning ? 'LIVE' : 'STOPPED'} detailTone={agentRunning ? 'green' : 'subtle'} icon={Webhook} accent={agentRunning ? 'green' : 'violet'} sub="Local long-poll connection" />
    </div>

    <div className="overview-grid">
      <section className="panel interactions-panel">
        <div className="panel-heading"><div><div className="panel-title-icon telegram-icon"><Send size={15} fill="currentColor" /></div><div><h2>Live interactions</h2><p>Recent Telegram conversations</p></div></div><Badge tone={agentRunning ? 'green' : 'subtle'}><span className={agentRunning ? 'live-dot' : ''} />{agentRunning ? 'LIVE' : 'OFFLINE'}</Badge></div>
        <div className="interaction-list">
          {logs.filter((log) => log.group === 'webhooks' || log.group === 'search').slice(0, 8).map((log, index) => <div className="interaction-entry" key={`${log.time}-${index}`}><div className={`interaction-avatar ${log.group === 'webhooks' ? 'user-avatar' : 'bot-avatar'}`}>{log.group === 'webhooks' ? <Send size={13} /> : <Bot size={15} />}</div><div className="interaction-content"><div className="interaction-meta"><strong>{log.group === 'webhooks' ? 'Telegram update' : 'AgentFlow AI'}</strong><span>{log.time}</span></div><div className={`message-bubble ${log.group === 'webhooks' ? 'incoming' : 'outgoing'}`}>{log.text}</div></div></div>)}
          {!logs.length && <div className="empty-logs interaction-empty"><MessageCircle size={19} /><strong>{agentRunning ? 'Waiting for your first message' : 'No live conversations yet'}</strong><span>{agentRunning ? 'Send /start or a question to your Telegram bot.' : 'Start the live agent, then message your Telegram bot.'}</span></div>}
        </div>
        <button className="panel-bottom-link" onClick={agentRunning ? onTest : onToggleAgent}>{agentRunning ? 'Test live agent' : 'Start Telegram agent'} <ArrowRight size={14} /></button>
      </section>

      <section className="panel traffic-panel">
        <div className="panel-heading"><div><div className="panel-title-icon chart-title-icon"><BarChart3 size={17} /></div><div><h2>Query traffic</h2><p>Real agent activity · last 24 hours</p></div></div><span className="badge badge-subtle">LIVE EVENTS</span></div>
        <div className="chart-legend"><span><i className="legend-dot violet-dot" />Queries</span><span><i className="legend-dot cyan-dot" />Latency</span><span className="legend-unit">LATENCY (MS)</span></div>
        <TrafficChart logs={logs} />
        <div className="chart-xlabels"><span>24h ago</span><span>20h</span><span>16h</span><span>12h</span><span>8h</span><span>4h</span><span>NOW</span></div>
        <div className="traffic-summary"><div><span className="summary-mark query-mark" /><span>Completed queries</span><strong>{completedQueries.length}</strong><span className="summary-change">captured</span></div><div><span className="summary-mark latency-mark" /><span>Avg. response time</span><strong>{averageLatency}</strong><span className="summary-change">{latencyValues.length ? `${latencyValues.length} requests` : 'no data yet'}</span></div></div>
      </section>
    </div>

    <section className="panel logs-panel">
      <div className="logs-header">
        <div className="logs-title"><div className="panel-title-icon terminal-title-icon"><Terminal size={16} /></div><div><h2>Agent logs</h2><p>Structured events from your agent</p></div><Badge tone="subtle">STREAMING</Badge></div>
        <div className="log-controls"><div className="log-filter"><Search size={13} /><input aria-label="Filter logs" placeholder="Filter logs..." value={logFilter} onChange={(event) => setLogFilter(event.target.value)} /><kbd>/</kbd></div><IconButton label={paused ? 'Resume log stream' : 'Pause log stream'} onClick={() => setPaused(!paused)}>{paused ? <Play size={14} /> : <Pause size={14} />}</IconButton><IconButton label="Clear logs" onClick={async () => { try { await fetch('/api/agent/events', { method: 'DELETE' }); setLogs([]); onToast('Log history cleared') } catch { onToast('Could not clear logs') } }}><Trash2 size={14} /></IconButton><IconButton label="More log options"><MoreHorizontal size={15} /></IconButton></div>
      </div>
      <div className="logs-tabs">{[['all', 'All events'], ['webhooks', 'Webhooks'], ['search', 'Search API'], ['errors', 'Errors']].map(([id, label]) => <button key={id} className={logTab === id ? 'selected' : ''} onClick={() => setLogTab(id)}>{label}{id === 'errors' && <span className="tab-count">1</span>}</button>)}</div>
      <div className="log-stream" aria-live="polite">
        {shownLogs.length ? shownLogs.map((log, index) => <div className="log-line" key={`${log.time}-${index}`}><span className="log-time">{log.time}</span><span className={`log-status ${log.type.includes('429') ? 'log-error' : log.type === 'INFO' ? 'log-info' : 'log-ok'}`}>{log.type}</span><span className="log-message">{log.text}</span></div>) : <div className="empty-logs"><Terminal size={18} /><span>{logs.length ? 'No events match your filters.' : 'No log events yet. New agent activity will appear here.'}</span></div>}
      </div>
      <div className="logs-footer"><span><span className="streaming-dot" />{paused ? 'Stream paused' : 'Receiving live events'}</span><span>{shownLogs.length} events <span className="footer-sep">·</span> Auto-scroll <span className="auto-scroll-on">ON</span></span></div>
    </section>
  </>
}

function StatCard({ label, value, detail, detailTone, icon: Icon, accent, sub, chart = [] }) {
  return <section className={`panel stat-card accent-${accent}`}><div className="stat-top"><span>{label}</span><span className={`stat-icon icon-${accent}`}><Icon size={16} /></span></div><div className="stat-main"><strong>{value}</strong><Badge tone={detailTone}>{detailTone === 'green' && <TrendingUp size={11} />}{detail}</Badge></div>{chart.length > 0 && <div className="stat-chart">{chart.map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div>}<div className="stat-sub">{sub}</div></section>
}

function TrafficChart({ logs }) {
  const now = Date.now()
  const start = now - 24 * 60 * 60 * 1000
  const bins = Array.from({ length: 12 }, () => ({ queries: 0, latencies: [] }))
  logs.forEach((log) => {
    if (!log.timestamp || log.timestamp < start || log.timestamp > now || log.group !== 'search' || log.type !== '200 OK') return
    const index = Math.min(11, Math.floor((log.timestamp - start) / (2 * 60 * 60 * 1000)))
    bins[index].queries += 1
    const latency = Number(log.text.match(/· (\d+)ms/)?.[1])
    if (Number.isFinite(latency)) bins[index].latencies.push(latency)
  })
  const queryValues = bins.map((bin) => bin.queries)
  const latencyValues = bins.map((bin) => bin.latencies.length ? bin.latencies.reduce((sum, value) => sum + value, 0) / bin.latencies.length : 0)
  const hasData = queryValues.some(Boolean)
  if (!hasData) return <div className="chart-empty"><BarChart3 size={20} /><strong>No live traffic yet</strong><span>Start the agent and send it a Telegram message to populate this chart.</span></div>

  const queryScale = Math.max(1, ...queryValues)
  const latencyScale = Math.max(1, ...latencyValues)
  const coordinates = (values, max) => values.map((value, index) => `${(583 * index / 11).toFixed(1)},${(132 - value / max * 124).toFixed(1)}`)
  const queryPoints = coordinates(queryValues, queryScale)
  const latencyPoints = coordinates(latencyValues, latencyScale)
  const queryMaximum = queryScale
  const latencyMaximum = latencyScale
  return <div className="chart-area"><div className="chart-ylabels"><span>{queryMaximum}</span><span>{Math.round(queryMaximum * .75)}</span><span>{Math.round(queryMaximum * .5)}</span><span>{Math.round(queryMaximum * .25)}</span><span>0</span></div><svg className="traffic-svg" viewBox="0 0 583 145" preserveAspectRatio="none" role="img" aria-label="Live completed queries and average latency from agent events"><defs><linearGradient id="queryFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#8278ff" stopOpacity=".2" /><stop offset="100%" stopColor="#8278ff" stopOpacity="0" /></linearGradient></defs><g className="chart-grid"><path d="M0 8H583 M0 39H583 M0 70H583 M0 101H583 M0 132H583" /><path d="M0 0V132 M106 0V132 M212 0V132 M318 0V132 M424 0V132 M530 0V132 M583 0V132" /></g><polygon points={`0,132 ${queryPoints.join(' ')} 583,132`} fill="url(#queryFill)" /><polyline points={queryPoints.join(' ')} className="query-line" />{latencyValues.some(Boolean) && <polyline points={latencyPoints.join(' ')} className="latency-line" />}{queryPoints.map((point, index) => { const [cx, cy] = point.split(','); return queryValues[index] ? <circle key={`q${index}`} cx={cx} cy={cy} r="2.4" className="query-point" /> : null })}{latencyPoints.map((point, index) => { const [cx, cy] = point.split(','); return latencyValues[index] ? <circle key={`l${index}`} cx={cx} cy={cy} r="2.4" className="latency-point" /> : null })}</svg><div className="right-ylabels"><span>{(latencyMaximum / 1000).toFixed(1)}s</span><span>{(latencyMaximum * .5 / 1000).toFixed(2)}s</span><span>0s</span></div></div>
}

function SectionHeader({ eyebrow, title, description, action }) {
  return <div className="section-heading"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{description}</p></div>{action}</div>
}

function RulesPage({ config, update, onToast }) {
  const [draggingRule, setDraggingRule] = useState(null)
  const presets = {
    'Strict bullet summaries': 'You are AgentFlow, a precise research assistant. Respond using clear, concise bullet points only. Include up to 5 bullets, prioritize verified facts, and cite every factual claim with a numbered source link.\n\nUser request: {{user_query}}\nCurrent date: {{current_date}}\nSearch results: {{search_results}}',
    'Academic citations': 'You are AgentFlow, an academic research assistant. Use a formal, objective tone. Synthesize findings from credible sources and include inline citations with publication names and dates, followed by a linked reference list. Acknowledge uncertainty.\n\nUser request: {{user_query}}\nCurrent date: {{current_date}}\nSearch results: {{search_results}}',
    'Conversational tone': 'You are AgentFlow, a friendly and thoughtful Telegram research assistant. Explain things naturally in plain language, lead with the useful answer, and keep it concise. Include links so the user can learn more.\n\nUser request: {{user_query}}\nCurrent date: {{current_date}}\nSearch results: {{search_results}}',
  }
  const setRule = (index, updates) => update('rules', config.rules.map((rule, i) => i === index ? { ...rule, ...updates } : rule))
  const setFormat = (key, value) => update('format', { ...config.format, [key]: value })
  const addRule = () => { update('rules', [...config.rules, { name: 'New custom rule', condition: 'query CONTAINS "keyword"', action: 'Add an action', enabled: true }]); onToast('New rule added') }
  const moveRule = (from, to) => {
    if (from === null || from === to) return
    const reordered = [...config.rules]
    const [moved] = reordered.splice(from, 1)
    reordered.splice(to, 0, moved)
    update('rules', reordered)
  }
  return <div className="settings-page">
    <SectionHeader eyebrow="BEHAVIOR & PERSONALITY" title="Prompt & response rules" description="Fine-tune how your AI agent interprets and responds to Telegram messages." action={<button className="primary-button" onClick={() => onToast('Prompt settings saved')}><Check size={15} /> Save changes</button>} />
    <section className="panel settings-panel prompt-panel"><div className="panel-heading"><div><div className="panel-title-icon prompt-title-icon"><FileText size={16} /></div><div><h2>System prompt</h2><p>Core instructions sent with every request</p></div></div><Badge tone="subtle"><span className="green-dot-small" /> ACTIVE</Badge></div>
      <div className="preset-row"><span>QUICK PRESETS</span>{Object.keys(presets).map((name) => <button key={name} className={config.preset === name ? 'preset-active' : ''} onClick={() => { update('prompt', presets[name]); update('preset', name) }}>{name}</button>)}</div>
      <div className="editor-wrap"><div className="editor-gutter">{config.prompt.split('\n').map((_, index) => <span key={index}>{String(index + 1).padStart(2, '0')}</span>)}</div><textarea className="prompt-editor" spellCheck="false" aria-label="System prompt editor" value={config.prompt} onChange={(event) => { update('prompt', event.target.value); update('preset', 'Custom prompt') }} /><button className="copy-prompt" onClick={() => { navigator.clipboard?.writeText(config.prompt); onToast('Prompt copied to clipboard') }} aria-label="Copy system prompt"><Copy size={14} /></button></div>
      <div className="editor-footer"><span><span className="editor-dot" /> {config.prompt.length} characters</span><span>Variables <code>{'{{user_query}}'}</code> <code>{'{{current_date}}'}</code> <code>{'{{search_results}}'}</code></span></div>
    </section>
    <section className="panel settings-panel rules-panel"><div className="panel-heading"><div><div className="panel-title-icon rules-title-icon"><SlidersHorizontal size={16} /></div><div><h2>Conditional rules</h2><p>Rules are evaluated from top to bottom</p></div></div><button className="outline-button small-button" onClick={addRule}><Plus size={14} /> Add rule</button></div>
      <div className="rule-list">{config.rules.map((rule, index) => <div className={`rule-row ${draggingRule === index ? 'rule-dragging' : ''}`} key={`${rule.name}-${index}`} draggable onDragStart={(event) => { setDraggingRule(index); event.dataTransfer.effectAllowed = 'move' }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); moveRule(draggingRule, index); setDraggingRule(null) }} onDragEnd={() => setDraggingRule(null)}><div className="drag-handle" aria-label={`Drag to reorder ${rule.name}`}>⠿</div><span className="rule-number">{String(index + 1).padStart(2, '0')}</span><div className="rule-content"><div className="rule-name">{rule.name}</div><div className="rule-logic"><span className="if-label">IF</span><code>{rule.condition}</code><ArrowRight size={13} /><span className="then-label">THEN</span><span>{rule.action}</span></div></div><Switch checked={rule.enabled} label={`Enable ${rule.name}`} onChange={(enabled) => setRule(index, { enabled })} /><IconButton label={`Remove ${rule.name}`} onClick={() => { update('rules', config.rules.filter((_, i) => i !== index)); onToast('Rule removed') }}><Trash2 size={14} /></IconButton></div>)}</div>
    </section>
    <section className="panel settings-panel format-panel"><div className="panel-heading"><div><div className="panel-title-icon format-title-icon"><FileText size={16} /></div><div><h2>Output formatting</h2><p>Keep responses consistent and Telegram-friendly</p></div></div></div><div className="format-options">{[['footer', 'Custom footer signature', 'Append a signature to the end of every response'], ['links', 'Auto-link source references', 'Turn citations into clickable markdown links'], ['timestamp', 'Include response timestamp', 'Show when the answer was generated'], ['maxChars', 'Enforce Telegram message limit', 'Split responses over Telegram’s 4,096 character limit']].map(([key, title, desc]) => <label className="format-option" key={key}><input type="checkbox" checked={config.format[key]} onChange={(event) => setFormat(key, event.target.checked)} /><span className="custom-checkbox"><Check size={12} /></span><span className="format-label"><strong>{title}</strong><small>{desc}</small></span></label>)}</div></section>
  </div>
}

function ModelsPage({ config, update, onToast, secretStatus, secretDrafts, setSecretDrafts, saveSecret, testSecret, secretServiceReady }) {
  const [revealed, setRevealed] = useState({})
  const [testing, setTesting] = useState('')
  const providers = [
    { id: 'gemini', name: 'Gemini + Google Search', model: 'Gemini 3.8 Flash', desc: 'Fast, grounded answers with Google Search built in.', tag: 'RECOMMENDED', color: 'provider-gemini', icon: <Sparkles size={18} /> },
    { id: 'groq', name: 'Groq + Tavily Search', model: 'GPT-OSS 120B', desc: 'Ultra-low latency reasoning paired with web search.', tag: 'LOW LATENCY', color: 'provider-groq', icon: <Zap size={18} /> },
    { id: 'openrouter', name: 'OpenRouter', model: 'Perplexity Sonar', desc: 'Flexible model routing with web search capabilities.', tag: 'FLEXIBLE', color: 'provider-openrouter', icon: <Globe2 size={18} /> },
  ]
  const keys = [['GEMINI_API_KEY', 'Google Gemini'], ['GROQ_API_KEY', 'Groq'], ['OPENROUTER_API_KEY', 'OpenRouter'], ['TAVILY_SEARCH_KEY', 'Tavily Search']]
  const patchKey = (key, value) => setSecretDrafts((current) => ({ ...current, [key]: value }))
  const testKey = (key) => {
    const draft = secretDrafts[key]?.trim()
    if (!draft && !secretStatus[key]) { onToast('Enter or save a credential before testing'); return }
    setTesting(key)
    testSecret(({ GEMINI_API_KEY: 'gemini', GROQ_API_KEY: 'groq', OPENROUTER_API_KEY: 'openrouter', TAVILY_SEARCH_KEY: 'tavily' })[key], draft || undefined)
      .finally(() => setTesting(''))
  }
  return <div className="settings-page">
    <SectionHeader eyebrow="INTELLIGENCE & RETRIEVAL" title="LLM & web search" description="Choose your agent’s reasoning engine and tune web search behavior." action={<button className="primary-button" onClick={() => onToast('Provider settings saved')}><Check size={15} /> Save changes</button>} />
    <section className="panel settings-panel provider-panel"><div className="panel-heading"><div><div className="panel-title-icon model-title-icon"><Cpu size={16} /></div><div><h2>Model provider</h2><p>Choose the engine powering your Telegram agent</p></div></div></div><div className="provider-grid">{providers.map((provider) => <button type="button" key={provider.id} className={`provider-card ${config.provider === provider.id ? 'provider-selected' : ''}`} onClick={() => update('provider', provider.id)}><div className="provider-card-top"><span className={`provider-logo ${provider.color}`}>{provider.icon}</span><span className="provider-tag">{provider.tag}</span><span className={`radio-indicator ${config.provider === provider.id ? 'checked' : ''}`}>{config.provider === provider.id && <i />}</span></div><strong>{provider.name}</strong><span className="provider-model">{provider.model}</span><p>{provider.desc}</p><div className="provider-footer"><span className="provider-online-dot" />{config.provider === provider.id ? 'Currently active' : 'Ready to configure'}</div></button>)}</div></section>
    <section className="panel settings-panel keys-panel"><div className="panel-heading"><div><div className="panel-title-icon key-title-icon"><KeyRound size={16} /></div><div><h2>API credentials</h2><p>Values stay on the local server and are never returned to the browser.</p></div></div><Badge tone={secretServiceReady ? 'green' : 'amber'}><LockKeyhole size={11} />{secretServiceReady ? 'LOCAL SERVER' : 'SERVER OFFLINE'}</Badge></div><div className="key-fields">{keys.map(([key, label]) => <div className="key-field" key={key}><label htmlFor={`key-${key}`}>{label}<span>{key}</span></label><div className="key-input-wrap"><input id={`key-${key}`} value={secretDrafts[key] || ''} onChange={(event) => patchKey(key, event.target.value)} type={revealed[key] ? 'text' : 'password'} placeholder={secretStatus[key] ? 'Saved · enter to replace' : `Enter your ${label} API key`} autoComplete="new-password" /><IconButton label={revealed[key] ? 'Hide key' : 'Show key'} onClick={() => setRevealed({ ...revealed, [key]: !revealed[key] })}>{revealed[key] ? <EyeOff size={15} /> : <Eye size={15} />}</IconButton><IconButton label={`Copy ${label} key`} onClick={() => { navigator.clipboard?.writeText(secretDrafts[key] || ''); onToast(secretDrafts[key] ? 'Unsaved key copied' : 'Saved credentials cannot be copied from the browser') }}><Copy size={14} /></IconButton><button className="key-test" disabled={!secretServiceReady || testing === key || (!secretStatus[key] && !secretDrafts[key]?.trim())} onClick={() => testKey(key)}>{testing === key ? <RefreshCw className="spin" size={13} /> : secretStatus[key] ? <Check size={13} /> : <CircleHelp size={13} />}<span>{testing === key ? 'Checking' : secretStatus[key] ? 'Test' : 'Not set'}</span></button><button className="key-save" disabled={!secretServiceReady || (!secretDrafts[key]?.trim() && !secretStatus[key])} onClick={() => saveSecret(key, secretDrafts[key] || '')}>{secretDrafts[key]?.trim() ? secretStatus[key] ? 'Replace' : 'Save' : 'Remove'}</button></div></div>)}</div><div className="security-note"><Shield size={14} /><span>Credentials are stored as a local .env file outside the project, so they are not synced to OneDrive or exposed to browser storage.</span></div></section>
    <section className="panel settings-panel search-config-panel"><div className="panel-heading"><div><div className="panel-title-icon search-config-icon"><Globe2 size={16} /></div><div><h2>Search behavior</h2><p>Control the depth and pace of online research</p></div></div><Badge tone="blue">WEB SEARCH</Badge></div><div className="slider-grid"><RangeSetting label="Maximum web results" detail="Sources per query" value={config.maxResults} min={1} max={10} unit="sources" onChange={(value) => update('maxResults', value)} /><div className="depth-setting"><div><label>Search depth</label><span>How thoroughly to research</span></div><div className="segmented-control">{['Fast', 'Balanced', 'Deep'].map((depth) => <button key={depth} onClick={() => update('depth', depth)} className={config.depth === depth ? 'selected' : ''}>{depth}</button>)}</div></div><RangeSetting label="Per-user rate limit" detail="Queries per minute" value={config.rateLimit} min={5} max={60} unit="qpm" onChange={(value) => update('rateLimit', value)} /></div></section>
  </div>
}

function RangeSetting({ label, detail, value, min, max, unit, onChange }) {
  return <div className="range-setting"><div className="range-heading"><div><label>{label}</label><span>{detail}</span></div><strong>{value}<small> {unit}</small></strong></div><input type="range" aria-label={label} min={min} max={max} value={value} style={{ '--range-progress': `${((value - min) / (max - min)) * 100}%` }} onChange={(event) => onChange(Number(event.target.value))} /><div className="range-limits"><span>{min}</span><span>{max}</span></div></div>
}

function TelegramPage({ config, update, onToast, secretStatus, secretDrafts, setSecretDrafts, saveSecret, testSecret, secretServiceReady, agentRunning, onToggleAgent }) {
  const [pinging, setPinging] = useState(false)
  const [botTokenShown, setBotTokenShown] = useState(false)
  const [botTesting, setBotTesting] = useState(false)
  const [commandDraft, setCommandDraft] = useState({ command: '', description: '' })
  const [tagDraft, setTagDraft] = useState('')
  const [editing, setEditing] = useState(-1)
  const patchCommand = (index, changes) => update('commands', config.commands.map((command, i) => i === index ? { ...command, ...changes } : command))
  const ping = () => {
    if (!secretStatus.TELEGRAM_BOT_TOKEN) { onToast('Save a Telegram bot token before verifying'); return }
    setPinging(true)
    testSecret('telegram').finally(() => setPinging(false))
  }
  const testBotToken = () => {
    if (!secretStatus.TELEGRAM_BOT_TOKEN) { onToast('Save a bot token before testing'); return }
    setBotTesting(true)
    testSecret('telegram').finally(() => setBotTesting(false))
  }
  const addWhitelist = (event) => { if (event.key !== 'Enter') return; event.preventDefault(); const id = tagDraft.trim().replace(/^@/, ''); if (!id || config.whitelist.includes(id)) { setTagDraft(''); return } update('whitelist', [...config.whitelist, id]); setTagDraft('') }
  const addCommand = () => { const command = commandDraft.command.trim().replace(/^\//, '').toLowerCase(); if (!command || !commandDraft.description.trim()) { onToast('Enter a command and description'); return } update('commands', [...config.commands, { command: `/${command}`, description: commandDraft.description.trim() }]); setCommandDraft({ command: '', description: '' }); onToast('Command added') }
  return <div className="settings-page">
    <SectionHeader eyebrow="CONNECTION & ACCESS" title="Telegram settings" description="Manage your Telegram connection, commands, and access." action={<button className="primary-button" onClick={onToggleAgent}>{agentRunning ? <Pause size={15} /> : <Play size={15} />}{agentRunning ? 'Stop live agent' : 'Start live agent'}</button>} />
    <section className="panel settings-panel bot-token-panel"><div className="panel-heading"><div><div className="panel-title-icon telegram-icon"><Send size={15} /></div><div><h2>Telegram bot token</h2><p>Stored only by the local server. Never paste this into frontend code.</p></div></div><Badge tone={secretStatus.TELEGRAM_BOT_TOKEN ? 'green' : 'subtle'}>{secretStatus.TELEGRAM_BOT_TOKEN ? 'SAVED' : 'NOT SET'}</Badge></div><div className="bot-token-row"><div className="secret-input-wrap"><input aria-label="Telegram bot token" autoComplete="new-password" type={botTokenShown ? 'text' : 'password'} value={secretDrafts.TELEGRAM_BOT_TOKEN || ''} onChange={(event) => setSecretDrafts((current) => ({ ...current, TELEGRAM_BOT_TOKEN: event.target.value }))} placeholder={secretStatus.TELEGRAM_BOT_TOKEN ? 'Saved · enter to replace' : 'Enter the token from @BotFather'} /><IconButton label={botTokenShown ? 'Hide bot token' : 'Show bot token'} onClick={() => setBotTokenShown(!botTokenShown)}>{botTokenShown ? <EyeOff size={15} /> : <Eye size={15} />}</IconButton></div><button className="outline-button small-button" disabled={!secretServiceReady || (!secretDrafts.TELEGRAM_BOT_TOKEN?.trim() && !secretStatus.TELEGRAM_BOT_TOKEN)} onClick={() => saveSecret('TELEGRAM_BOT_TOKEN', secretDrafts.TELEGRAM_BOT_TOKEN || '')}><Check size={13} />{secretDrafts.TELEGRAM_BOT_TOKEN?.trim() ? 'Save token' : 'Remove token'}</button><button className="outline-button small-button" disabled={!secretServiceReady || botTesting} onClick={testBotToken}>{botTesting ? <RefreshCw size={13} className="spin" /> : <Radio size={13} />}{botTesting ? 'Checking…' : 'Verify with Telegram'}</button></div></section>
    <section className="panel settings-panel webhook-panel"><div className="panel-heading"><div><div className="panel-title-icon webhook-title-icon"><Radio size={16} /></div><div><h2>Telegram polling connection</h2><p>Long polling receives messages without a public webhook URL.</p></div></div><Badge tone={agentRunning ? 'green' : 'subtle'}><span className={agentRunning ? 'status-dot' : ''} />{agentRunning ? 'LISTENING' : 'STOPPED'}</Badge></div><div className="polling-status"><div className="polling-indicator"><span className={agentRunning ? 'pulse-dot' : 'offline-dot'} /></div><div className="polling-copy"><strong>{agentRunning ? 'Your bot is listening for Telegram messages' : 'Your bot is not listening yet'}</strong><span>{agentRunning ? 'Send /start or a question to your Telegram bot. It will resume after service restarts until you stop it.' : 'Verify your bot token, then start the live agent to receive and answer messages.'}</span></div><button className="outline-button" disabled={pinging || !secretServiceReady} onClick={ping}>{pinging ? <RefreshCw size={14} className="spin" /> : <Radio size={14} />}{pinging ? 'Checking…' : 'Verify bot token'}</button></div><div className="polling-footnote"><Shield size={13} /> Keep your hosting service online and attach persistent storage to retain its settings. Only users in your whitelist can get replies while whitelist mode is enabled.</div></section>
    <section className="panel settings-panel command-panel"><div className="panel-heading"><div><div className="panel-title-icon command-title-icon"><Terminal size={16} /></div><div><h2>Bot commands</h2><p>Commands users can send to your Telegram bot</p></div></div><Badge tone="subtle">{config.commands.length} COMMANDS</Badge></div><div className="command-table"><div className="command-table-head"><span>COMMAND</span><span>DESCRIPTION</span><span>ACTIONS</span></div>{config.commands.map((command, index) => <div className="command-table-row" key={`${command.command}-${index}`}><span className="command-code">{command.command}</span>{editing === index ? <input className="inline-edit" value={commandDraft.description || command.description} onChange={(event) => setCommandDraft({ ...commandDraft, description: event.target.value })} /> : <span className="command-description">{command.description}</span>}<div className="command-actions">{editing === index ? <><IconButton label="Save command" onClick={() => { patchCommand(index, { description: commandDraft.description || command.description }); setEditing(-1); onToast('Command updated') }}><Check size={14} /></IconButton><IconButton label="Cancel editing" onClick={() => setEditing(-1)}><X size={14} /></IconButton></> : <><IconButton label={`Edit ${command.command}`} onClick={() => { setCommandDraft({ description: command.description }); setEditing(index) }}><FileText size={14} /></IconButton><IconButton label={`Delete ${command.command}`} onClick={() => { update('commands', config.commands.filter((_, i) => i !== index)); onToast('Command deleted') }}><Trash2 size={14} /></IconButton></>}</div></div>)}</div><div className="add-command-row"><span className="command-slash">/</span><input aria-label="New command name" placeholder="command" value={commandDraft.command} onChange={(event) => setCommandDraft({ ...commandDraft, command: event.target.value })} /><input aria-label="New command description" placeholder="Short description of what this command does" value={commandDraft.description} onChange={(event) => setCommandDraft({ ...commandDraft, description: event.target.value })} /><button className="outline-button small-button" onClick={addCommand}><Plus size={14} /> Add command</button></div></section>
    <section className="panel settings-panel access-panel"><div className="panel-heading"><div><div className="panel-title-icon security-title-icon"><Shield size={16} /></div><div><h2>Access & security</h2><p>Control who can interact with your bot</p></div></div><Badge tone="amber"><LockKeyhole size={11} /> ACCESS CONTROL</Badge></div><div className="access-mode-row"><div><strong>Access mode</strong><span>Choose who is allowed to use the bot</span></div><div className="access-segment"><button className={config.access === 'public' ? 'selected' : ''} onClick={() => update('access', 'public')}><Globe2 size={14} /> Public access</button><button className={config.access === 'whitelist' ? 'selected' : ''} onClick={() => update('access', 'whitelist')}><LockKeyhole size={14} /> Whitelist only</button></div></div>{config.access === 'public' && <div className="field-description">Anyone who finds your Telegram bot can use it. Their requests may consume your AI provider quota.</div>}{config.access === 'whitelist' && <div className="whitelist-section"><label className="field-label">Authorized users &amp; chats</label><div className="whitelist-input">{config.whitelist.map((id) => <span className="user-tag" key={id}>{id}<button aria-label={`Remove ${id}`} onClick={() => update('whitelist', config.whitelist.filter((entry) => entry !== id))}><X size={12} /></button></span>)}<input aria-label="Add a Telegram user or chat ID" placeholder="Add user or chat ID, press Enter…" value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} onKeyDown={addWhitelist} /></div><span className="field-description">Add Telegram user IDs or chat IDs. Only approved users can send bot commands.</span></div>}<div className="rate-note"><AlertTriangle size={14} /><span>Rate limit is set to <strong>30 queries per minute</strong> per Telegram user.</span><button onClick={() => onToast('Change rate limits in LLM & web search settings')}>Manage</button></div></section>
  </div>
}

function QueryModal({ query, setQuery, result, loading, provider, runTest, onClose }) {
  const [mode, setMode] = useState('/search')
  const displayQuery = query.replace(/^\/(search|summary)\s*/, '')
  const sourceCount = Array.isArray(result?.sources)
    ? result.sources.length
    : typeof result?.sources === 'string'
      ? result.sources.split('\n').filter(Boolean).length
      : 0
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="query-modal" role="dialog" aria-modal="true" aria-labelledby="query-modal-title"><div className="modal-header"><div className="modal-icon"><FlaskConical size={17} /></div><div><h2 id="query-modal-title">Test your live agent</h2><p>This sends a real request to your selected AI provider.</p></div><IconButton label="Close dialog" onClick={onClose}><X size={17} /></IconButton></div><div className="query-meta"><span><span className="provider-online-dot" /> LIVE PROVIDER REQUEST</span><span>{provider} <span>·</span> {provider.startsWith('Gemini') ? 'Google Search grounding' : 'web search when configured'}</span></div><label className="field-label">Message to test</label><div className="query-input-wrap"><select value={mode} onChange={(event) => { setMode(event.target.value); setQuery(`${event.target.value} ${displayQuery}`) }} aria-label="Command type"><option>/search</option><option>/summary</option></select><input autoFocus value={displayQuery} onChange={(event) => setQuery(`${mode} ${event.target.value}`)} placeholder="Ask anything…" onKeyDown={(event) => { if (event.key === 'Enter' && !loading) runTest() }} /><button className="send-query" disabled={loading} onClick={runTest} aria-label="Run live test">{loading ? <RefreshCw className="spin" size={16} /> : <ArrowRight size={16} />}</button></div><div className="modal-hint">Uses the configured provider key. The query is not sent to Telegram.</div>{result && <div className={`test-result ${result.error ? 'test-result-error' : ''}`}><div className="result-heading"><span><Bot size={14} /> {result.error ? 'Request failed' : 'Live agent response'}</span>{!result.error && <span className="result-latency"><Zap size={12} /> {(result.latencyMs / 1000).toFixed(2)}s <span>·</span> {result.tokens} tokens</span>}</div><div className="result-body">{(result.error || result.answer).split('\n').map((line, index) => <p key={index}>{line || <br />}</p>)}</div>{!result.error && <div className="result-source"><Globe2 size={13} /> {sourceCount ? `${sourceCount} web sources` : 'Provider response received'} <span>·</span> Live API call</div>}</div>}<div className="modal-footer"><span><Shield size={13} /> API keys remain on the local server</span><button className="primary-button" disabled={loading} onClick={runTest}>{loading ? <RefreshCw className="spin" size={14} /> : <Play size={14} />}{loading ? 'Calling provider…' : 'Run live test'}</button></div></section></div>
}

function SearchModal({ onClose, onNavigate }) {
  const [value, setValue] = useState('')
  const filtered = navItems.filter((item) => item.label.toLowerCase().includes(value.toLowerCase()))
  return <div className="search-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div className="command-palette" role="dialog" aria-modal="true"><div className="palette-input"><Search size={18} /><input autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder="Search pages and settings…" /><kbd>ESC</kbd></div><div className="palette-label">PAGES</div>{filtered.map(({ id, label, icon: Icon }) => <button className="palette-option" key={id} onClick={() => onNavigate(id)}><Icon size={16} /><span>{label}</span><ArrowUpRight size={14} /></button>)}{!filtered.length && <div className="palette-empty">No matching pages found.</div>}<div className="palette-footer"><span><kbd>↑</kbd><kbd>↓</kbd> to navigate</span><span><kbd>↵</kbd> to select</span></div></div></div>
}

export default App
