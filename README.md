# AgentFlow AI Control Center

## Agent features

AgentFlow combines a local web dashboard with a Telegram research bot:

- **Live dashboard:** View agent status and recent Telegram/search events, inspect
  logs, filter log entries, and pause or clear the displayed stream.
- **Provider selection:** Use Gemini with Google Search grounding, Groq
  `openai/gpt-oss-120b` with Tavily web search, or OpenRouter's Perplexity Sonar
  route. OpenRouter is the default provider for Telegram and job research.
- **Web research:** Configure Tavily result count for Groq searches. Groq answers
  are instructed to rely on retrieved results, report when claims cannot be
  verified, and cite source links returned by search. If there are no usable
  results, the agent does not generate a speculative answer.
- **Job extraction:** Google/Microsoft and other configured employer searches
  clean and process each official job page independently, with bounded prompts
  and isolated retries. Optional `AGENTFLOW_JOB_PROMPT_TOKEN_BUDGET` and
  `AGENTFLOW_JOB_DESCRIPTION_MAX_CHARS` environment variables tune the
  conservative prompt-token budget and per-page text limit. Job intelligence
  uses the same AI provider selected in LLM & Web Search settings.
  Extraction retries provider rate limits using the provider's requested wait
  time when available, with a bounded number of retries.
  OpenRouter extraction retries transient in-flight credit reservation errors
  with backoff and reserves up to 1,200 completion tokens per page. If OpenRouter
  reports a lower affordable completion-token limit, extraction retries using
  that limit. Persistent credit errors still require the account's in-flight
  requests to settle or sufficient available credits; the app does not add
  credits or switch models/providers automatically.
- **Telegram interaction:** Use `/start`, `/search <question>`, and
  `/summary <question>` or send a plain-text question. Long replies are split
  into Telegram-sized messages.
- **Access and rate controls:** Public access is the default; anyone who finds
  the bot can use it and consume provider quota. You can switch to whitelist
  only, add Telegram user/chat IDs, and configure a per-user requests per-minute
  limit.
- **Prompt and response rules:** Edit the system prompt, use its template
  variables, add/reorder/enable response rules that are passed to the model, and
  configure response formatting options such as a footer and timestamp.
- **Bot configuration:** Store and verify provider credentials and the Telegram
  bot token, configure bot commands, and start or stop local Telegram polling.
- **Local test query:** Send a real request to the selected AI provider from the
  dashboard without sending the query through Telegram.
- **Telegram-friendly output:** Groq Markdown tables are converted to readable
  bullets; model-generated source URLs are replaced with links from retrieved
  search results.

The bot does not maintain conversation history between messages. The `/clear`
command currently confirms that the conversation is cleared, but there is no
stored conversation state to reset.

## PSIT Student ERP foundation

The **PSIT ERP** dashboard section accepts account credentials only through its
server-backed form. The backend submits them to the official
`https://erp.psit.ac.in/Erp/` login form, stores them only after a verified
login, and encrypts them with AES-256-GCM. Configure
`PSIT_ERP_CREDENTIAL_ENCRYPTION_KEY` as a stable, private 32-byte hex value
before connecting. Generate one with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

The encryption key must remain in the server environment and must not be added
to SQLite, source control, frontend configuration, or Telegram. Disconnecting
deletes encrypted credentials and cached academic rows. ERP intent detection and
the `/erp`, `/attendance`, `/timetable`, `/tomorrow`, `/marks`, `/notices`, and
`/academic_summary` shortcuts are routed locally; ERP credentials are not sent
to Gemini, Groq, or another model. Credential-like text is rejected from the
general AI request path.

After a secure dashboard connection, the backend automatically checks the
attendance-request, online-training, and OD-request pages every 15 minutes by
default (configurable with `PSIT_ERP_SYNC_INTERVAL_MINUTES`, minimum 15). It
uses the saved AES-256-GCM-encrypted credentials and sends deduplicated
change alerts to the configured Telegram chat. The first successful scan
establishes a baseline; only later additions or row updates trigger alerts.
Never put the ERP user ID or password in environment variables; only the
encryption key and optional polling interval belong there.

The public PSIT login page includes a portal-wide password-expiry notice; that
generic text is not treated as an account-specific password-change requirement.
The connector reports success only for a verified student dashboard response
and logs sanitized HTTP status, redirect, page type, and authentication-state
diagnostics. Manual sync reads the authenticated attendance summary, weekly
timetable, semester and test/assignment marks, notice links, and exam calendar.
Attendance percentages come directly from the portal summary; subject-wise
attendance and current library dues remain unavailable because their values
cannot be reliably mapped. The activity pages are polled on the configured
interval; other academic pages are refreshed by manual sync. ERP questions
return only cached verified sources and explicitly report unavailable data
rather than guessing. No additional paid service or library is used.

## Autonomous personalized news

The **News interests** dashboard configures an autonomous Telegram news agent.
Once monitoring is enabled and a Telegram chat ID is saved, the service scans
every 3 hours by default without requiring `/news_now`.

- **Persistent schedule:** the interval (1–24 hours), next scan, last successful
  search, and monitoring state are stored in SQLite. Missed/interrupted scans
  are recovered after restart. Times and quiet hours are displayed in
  Asia/Kolkata.
- **Personalization:** add up to 25 custom topics, enable/disable each, set high,
  medium, or low priority, and reorder equal-priority topics. Only enabled
  interests are searched. A recipient chat ID is configured separately from
  the dashboard login or Telegram user whitelist; the recipient must have
  started a conversation with the bot once.
- **Low-credit discovery:** Tavily performs up to three grouped news searches
  per scan, with at most five recent results per query. SQLite history filters
  duplicates before summarization. Relevance and source/date prioritization use
  local rules, not Groq.
- **Groq summaries:** there are zero Groq calls when there are no new relevant
  stories. New articles are summarized in one batched call, bounded by the
  configured input/output token budgets. Requests are not retried; HTTP 429
  starts a persistent cooldown and the agent can use search snippets meanwhile.
- **Delivery and controls:** one concise Telegram briefing contains its headlines,
  summaries, impact, matching interests, publication times, and original links.
  Quiet hours, maximum articles per briefing, and daily briefing limit are
  configurable. No briefing is sent when there is nothing new to report.
  Dashboard history and Tavily/Groq request/token usage are shown for monitoring.
- **Optional commands:** `/news`, `/news_on`, `/news_off`, `/news_now`,
  `/news_settings`, and `/news_history` remain available to authorized users;
  none is needed for routine scans.
- **External scheduler:** `POST /api/cron/news` is a separate optional trigger.
  Set `AGENTFLOW_NEWS_CRON_SECRET` and send it as a Bearer token. If unset, the
  production dashboard's Basic Auth credentials can authorize this endpoint.
  Internal scheduled scans do not require external cron.

## Personal Companion & Intelligent Reminders

The **Personal Assistant** dashboard lets you configure four daily greetings,
festival preferences, a Telegram recipient, and persistent personal events.
Greeting and reminder text is generated deterministically; routine notifications
do not call Groq or another AI provider.
The default Telegram recipient is `1207882899`; set a different chat ID in the
dashboard to override it.

- **Greetings:** Good morning, afternoon, evening, and night notifications use
  the configured local times, Jay as the default name, Asia/Kolkata, quiet
  hours, and a database-backed once-per-day key.
- **Festivals:** dates and names come from Calendarific's India holidays API,
  filtered to national, local, and religious holidays for the selected region.
  The service refreshes its calendar cache daily and sends only dates returned by
  that provider. Configure `CALENDARIFIC_API_KEY`; without it, festival wishes
  remain disabled rather than guessed. Calendarific requires an API account/key.
- **Events:** create, edit, and delete events in the dashboard, or send messages
  such as “my interview is on 12 March at 10 am, one day before” or
  “remember my birthday on 12 March every year” to the authorized Telegram bot.
  “List my events” shows saved events; “reschedule interview to 14 March” and
  “delete my interview” edit or remove a uniquely matched event. Supported
  recurrence is none, daily, weekly, monthly, or yearly. Reminders include one
  week before, one day before, on the date, and custom minute offsets.
- **Scheduling and retries:** greetings, festivals, and event reminders have
  separate execution histories. The default check interval is 15 minutes.
  Both the in-process timer and the authenticated `POST /api/cron/companion`
  endpoint use the same persistent delivery keys. Failed Telegram sends are
  recorded and retried with bounded exponential delay; overdue reminders are
  recovered for up to seven days.

### Render Free setup

Render Free instances have ephemeral local filesystems and can sleep. For
durable companion settings, events, calendar cache, notification history, and
scheduler history, configure `DATABASE_URL` to a PostgreSQL database and keep
that database available for the lifetime of the service. Companion records use
PostgreSQL when `DATABASE_URL` is set and retain SQLite as the local-development
fallback. The existing job/news runtime remains on SQLite; its persistence
behavior is unchanged.

Set these Render environment variables:

- `DATABASE_URL`: PostgreSQL connection string for the persistent companion
  store. The companion tables are initialized on service startup; the optional
  `npm run db:migrate` command also applies the checked-in PostgreSQL migrations.
- `AGENTFLOW_COMPANION_CRON_SECRET`: a long random secret, sent as
  `Authorization: Bearer <secret>`. Do not put this value in the dashboard or
  commit it to source control.
- `CALENDARIFIC_API_KEY`: API key from
  [Calendarific](https://calendarific.com/register). It is only read by the
  backend and is never returned by dashboard APIs.
- `TELEGRAM_BOT_TOKEN` if not already saved in Telegram Settings, and the
  dashboard `AGENTFLOW_USERNAME` / `AGENTFLOW_PASSWORD`.

Configure an external HTTPS cron service to wake the Render web service and
`POST` to `https://<your-service>.onrender.com/api/cron/companion` every
15 minutes with the Bearer header above and no request body. This endpoint
processes greetings, festivals, and events without requiring Telegram polling
or an AI provider call. Ensure the Telegram recipient has opened the bot and
sent `/start` once. The endpoint can deliver only while the Render service and
PostgreSQL database are reachable; Render Free does not guarantee real-time
delivery while the service is waking.

Render Free instances can sleep and have ephemeral storage. Periodic health
requests may wake the service, but scans and Telegram polling cannot run while
it is asleep, and SQLite settings/history can be lost when its filesystem is
replaced. For reliable continuous monitoring and durable deduplication, use an
always-on service with a persistent disk. A secured external scheduler can
trigger the authenticated endpoint after waking a free instance, but cannot
guarantee uninterrupted availability or durable data.

## Run locally

```sh
npm install
npm run dev
```

The Vite dashboard and local Node service both start with `npm run dev`.
The service is bound to `127.0.0.1`. If its default port `3001` is already
occupied, the launcher automatically chooses an available local port and
configures the dashboard proxy to match. Vite also selects another available
port if `5173` is already occupied; use the URL printed in the terminal.
`npm run build` creates the frontend production bundle.
Run `npm test` to exercise the local API, credential precedence, Telegram
message handling, and response formatting.

## Deploy with Docker Compose

The included deployment runs the built dashboard and API in one Node service,
stores SQLite and dashboard-saved credentials on a persistent Docker volume,
and uses Caddy to terminate HTTPS. Production mode requires dashboard Basic
Auth credentials; every dashboard and API route is protected except the
credential-free `/api/health` liveness endpoint. Do not expose port 3001
directly to the internet or run the production service without HTTPS.

Requirements: a Linux server with Docker Compose, a DNS name whose A/AAAA
records point to that server, and inbound TCP ports 80 and 443 (UDP 443 is
optional for HTTP/3).

1. Copy the project to the server, then create its private deployment
   environment file from the template:

   ```sh
   cp .env.example .env
   ```

2. Edit `.env`: set `AGENTFLOW_DOMAIN`, choose a dashboard username and a
   unique random password of at least 16 characters, and enter only the
   provider/Telegram keys you need. Keep this file private; it is excluded
   from the Docker build context and source control.
3. Start the single app instance and HTTPS proxy:

   ```sh
   docker compose up -d --build
   docker compose ps
   docker compose logs -f app caddy
   ```

4. Open `https://<AGENTFLOW_DOMAIN>` and authenticate with the dashboard
   username/password. The app's Settings can manage credentials after login.
   Verify `/api/health` reports `{"ok":true,"service":"agentflow-api"}`.

The compose file deliberately publishes only Caddy's HTTP(S) ports. The
`agentflow-data` volume contains the SQLite database and credentials saved
through the dashboard. Back it up regularly, store an off-host copy, and test
restoration. For an online-consistent SQLite backup, create a uniquely named
file in the persistent volume, then copy it off the server:

```sh
backup="jobs-$(date +%Y%m%d-%H%M%S).sqlite"
docker compose exec app node backup.mjs "/data/$backup"
docker compose cp "app:/data/$backup" ./backups/
```

The backup command refuses to overwrite an existing file. To stop without
deleting data, use `docker compose down`; **do not** use `docker compose down
-v` unless you intend to delete the database, saved credentials, and Caddy
certificates.

Run exactly one AgentFlow app instance against this SQLite database. Telegram
long polling and the in-process daily scheduler are not distributed; scaling
to multiple replicas can cause duplicate polling and research runs. The
container restarts automatically, and overdue scheduled work is recovered
from persisted scheduler state after restart. This does not provide an
availability guarantee, automatic database backups, or exactly-once Telegram
delivery. Monitor container health/logs and keep a tested backup.

The `/api/health` endpoint is intentionally unauthenticated for container and
proxy liveness checks and returns no credential or agent details. Production
dashboard/API access uses HTTP Basic Auth, so only access it through the
provided HTTPS proxy or another trusted TLS-terminating reverse proxy. If you
deploy behind a different platform, set `NODE_ENV=production`,
`AGENTFLOW_USERNAME`, `AGENTFLOW_PASSWORD` (16+ characters),
`AGENTFLOW_HOST=0.0.0.0`, and a persistent `AGENTFLOW_DATA_DIR`. The service
uses `AGENTFLOW_PORT` when set, otherwise it uses the platform-provided `PORT`
and falls back to `3001` for local use.

## Deploy on Render

Create a **Web Service** from this repository and use its Dockerfile (do not
deploy it as a Static Site). In the service's Environment settings, add:

- `AGENTFLOW_USERNAME`: dashboard login name; do not include a colon.
- `AGENTFLOW_PASSWORD`: a unique random password of at least 16 characters.
- `AGENTFLOW_DATA_DIR`: `/data`.
- Any provider or Telegram credentials you want available, such as
  `GEMINI_API_KEY`, `GROQ_API_KEY`, `TAVILY_SEARCH_KEY`, or
  `TELEGRAM_BOT_TOKEN`. Digital Footprint uses optional `GITHUB_TOKEN` and
  `YOUTUBE_API_KEY` values set only in this server environment. Configure
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` for
  YouTube Analytics OAuth. Legacy `GOOGLE_OAUTH_CLIENT_ID`,
  `GOOGLE_OAUTH_CLIENT_SECRET`, and `YOUTUBE_OAUTH_REDIRECT_URI` are also
  supported.
- `AGENTFLOW_NEWS_CRON_SECRET`: optional long random secret for an external
  news scan trigger; keep it private and send as `Authorization: Bearer ...`.
- `AGENTFLOW_FOOTPRINT_CRON_SECRET`: optional long random secret for the
  external Digital Footprint scheduler; keep it private and send as
  `Authorization: Bearer ...`.

Render supplies `PORT`; leave `AGENTFLOW_PORT` unset so the app listens on
Render's assigned port. Configure Render's health check path as `/api/health`.
To reduce idle spin-downs, configure cron-job.org to send a lightweight request
to that health endpoint:

- **URL:** `https://<your-render-service>.onrender.com/api/health`
- **Method:** `GET`
- **Authentication/headers:** none
- **Body:** none
- **Schedule:** every 5 minutes

The health endpoint returns HTTP 200 with `{"ok":true,"service":"agentflow-api"}`
and does not run a job search. Do not ping `/` (dashboard Basic Auth protects it)
or `/api/cron/jobs` (that is an authenticated job-search trigger).

Separately, `POST /api/cron/jobs` can trigger the daily search if desired. It uses
the same HTTP Basic credentials as the dashboard, shares a persistent daily
idempotency record with the in-process scheduler, and replays the recorded result
for same-day retries instead of repeating searches. It requires no request body.
Configure that separate daily task only if daily execution is wanted:

- **URL:** `https://<your-render-service>.onrender.com/api/cron/jobs`
- **Method:** `POST`
- **Authentication:** HTTP Basic using `AGENTFLOW_USERNAME` and
  `AGENTFLOW_PASSWORD`.
- **Body:** none
- **Schedule:** once daily at 09:00 Asia/Kolkata (03:30 UTC)

The job endpoint returns HTTP 200 with the recorded run ID, outcome, and counts
on success; a duplicate same-day request returns that result with
`replayed: true`. It returns 401 for missing/invalid Basic credentials, 409 while
the daily run is already in progress, and a useful error status if the run
fails.

For autonomous news scans, the in-process scheduler is sufficient while the
service remains online. If an external scheduler is also desired, configure a
separate request:

- **URL:** `https://<your-render-service>.onrender.com/api/cron/news`
- **Method:** `POST`
- **Authentication:** `Authorization: Bearer <AGENTFLOW_NEWS_CRON_SECRET>`
- **Body:** none
- **Schedule:** use the same interval selected in News interests, or leave this
  endpoint unused to avoid extra searches.

### Digital Footprint Intelligence

The dashboard's **Digital Footprint** page monitors a configured GitHub username
through GitHub's official public Events API and a YouTube channel ID through
YouTube Data API v3. It runs independently of job research, Personal Assistant,
news monitoring, and Telegram command handling. Its settings, activity, and run
history use dedicated `digital_footprint_*` tables in the existing SQLite
database. The first successful scan establishes a baseline; later new activity
is delivered as a Telegram notification when the bot and notification chat are
configured. Configure `GITHUB_TOKEN` and `YOUTUBE_API_KEY` only in the server's
environment (or the existing private server-side `.env` store); the dashboard
only receives configured/not-configured status.

The GitHub token is optional for public activity and helps avoid the public API's
lower unauthenticated rate limit. YouTube Data API v3 requires a Google API key;
the module uses its standard free quota and does not call paid APIs. Create and
restrict the key to YouTube Data API v3.

On Render Free, the in-process hourly poller cannot run while the service sleeps.
An external scheduler such as cron-job.org can call the authenticated endpoint:

- **URL:** `https://<your-render-service>.onrender.com/api/cron/digital-footprint`
- **Method:** `POST`
- **Authentication:** `Authorization: Bearer <AGENTFLOW_FOOTPRINT_CRON_SECRET>`
- **Body:** none
- **Schedule:** hourly

Set `AGENTFLOW_FOOTPRINT_CRON_SECRET` in Render before configuring the scheduler.
The module skips polling while disabled. Render's filesystem is still ephemeral
on the free tier, so SQLite activity history and settings may be lost on restart.
This optional external scheduler does not ensure continuous uptime or persistent
storage.

LinkedIn is not scraped or accessed by this module. For LinkedIn notifications,
use only its official permitted channels or email notifications.

#### YouTube Analytics OAuth setup

The existing YouTube Data API key integration remains unchanged. OAuth is a
separate connection used only to retrieve private analytics for the Google
account's own channel. Enable **YouTube Analytics API** in the Google Cloud
project and create an OAuth client with application type **Web application**.
Set these server-side environment variables (never add them to React or a
browser bundle):

- `GOOGLE_CLIENT_ID`: Google OAuth Web client ID.
- `GOOGLE_CLIENT_SECRET`: Google OAuth Web client secret.
- `GOOGLE_REDIRECT_URI`: exact registered callback URL. The legacy names
  `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and
  `YOUTUBE_OAUTH_REDIRECT_URI` remain supported.
- `YOUTUBE_OAUTH_TOKEN_ENCRYPTION_KEY`: optional 64-character hexadecimal
  32-byte key. Generate with
  `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
  If omitted, the backend generates one in its private server-side secrets file.
  Set it explicitly in Render if the service's filesystem may be replaced; the
  key must be retained with the SQLite database to decrypt saved OAuth tokens.

Register this exact local callback URI in Google Cloud for local development:

```text
http://localhost:3001/api/digital-footprint/youtube/oauth/callback
```

The local callback returns to the Vite dashboard at
`http://localhost:5173/#digital-footprint` by default.

For the deployed Render service, register this exact callback URI:

```text
https://telegram-agent-c1rm.onrender.com/api/digital-footprint/youtube/oauth/callback
```

Set `GOOGLE_REDIRECT_URI` in Render to that same complete URL. The backend can
also derive it from Render's `RENDER_EXTERNAL_HOSTNAME` when the variable is
unset. The callback path is
`/api/digital-footprint/youtube/oauth/callback`; production callbacks require
HTTPS. Google requires an exact match between the registered and configured
redirect URI.

The authorization asks only for these read-only YouTube scopes:

- `https://www.googleapis.com/auth/youtube.readonly`
- `https://www.googleapis.com/auth/yt-analytics.readonly`

Google's current Reports query reference requires `youtube.readonly` and also
documents `yt-analytics.readonly` for channel analytics. No upload, edit,
monetization, or content-owner scopes are requested. The authorization flow
uses state and PKCE; OAuth credentials and tokens never go to the dashboard.
The backend automatically refreshes access tokens server-side.

In the dashboard, open **Digital Footprint**, choose **Connect Google**, and
approve access. The backend calls `channels.list(mine=true)` and uses the
authorized channel ID as its identity. It prefers a unique exact match for
“Caash Aminati,” auto-selects when the account exposes one channel, and asks you
to select by ID if several channels are available. It does not treat the
display name as a unique identifier.

The separate YouTube Analytics switch is independent of the existing Digital
Footprint, job, companion, and scheduler settings. Enabling it performs a first
sync and then syncs every six hours. It indexes the channel's uploads,
retrieves available channel history from the channel creation date through
YouTube's latest available reporting date, and records daily snapshots. The
dashboard includes channel views, public subscriber/video counts, daily and
monthly trends, subscriber gain/loss, watch time, average view duration and
percentage, likes/comments/shares, per-video performance, 7-day momentum,
retention, upload-month comparisons, geography, demographics, devices, and
traffic sources. Per-video reports are paginated with a safety cap; the UI
identifies when that API result limit is reached.

YouTube can omit rows or metrics because of privacy thresholds, channel
settings, account eligibility, or API/report limits. The dashboard represents
those as unavailable rather than zero. Current subscriber counts from the Data
API may be rounded or hidden. Shorts and long-form uploads are both included
in the upload and analytics reports; the Data API does not expose a reliable
per-video Shorts classification through these endpoints.

Thumbnail impressions and impression click-through rate are intentionally
unavailable: Google's documentation provides those in channel Reach reports
through the YouTube Reporting API, not the Analytics API query reports used
here. No Reporting API, paid analytics service, or paid AI provider is used.
The weekly summary is computed locally from the returned metrics and is
descriptive rather than AI-generated.

Daily and weekly Telegram reports use Asia/Kolkata time and can be configured
independently in the dashboard. Important alerts are deduplicated in the
module's notification-history table. Delivery requires the existing Telegram
bot and notification chat to be configured. In the Google OAuth consent
screen's Testing mode, add the authorizing account as a test user. Google may
require app verification before general users can authorize the sensitive
YouTube read scopes.

The new data is isolated in `digital_footprint_youtube_*` SQLite tables. On
Render Free, SQLite and a generated encryption key are ephemeral; after a
restart/deploy, data and OAuth tokens may need to be recreated unless the
deployment supplies durable storage and a stable encryption-key environment
variable. The existing external scheduler endpoint remains available for
sleeping services; it does not make ephemeral storage persistent or guarantee
continuous uptime.

When a Telegram bot token is configured, polling starts automatically at
service startup. Render Free web services spin down after 15 minutes without
inbound traffic and may take about a minute to wake. A successful request every
5 minutes should normally count as inbound activity and avoid idle spin-down, but
it is not a guarantee of uninterrupted uptime: the external schedule can fail,
Render can restart or suspend a free service, and free instances have monthly
usage limits. If requests stop long enough for the service to sleep, the next
ping wakes it; the in-process scheduler and Telegram polling are unavailable
until startup completes. Free Render services also have ephemeral filesystems,
so SQLite data and credentials saved through the dashboard can be lost on
restart, spin-down, or deploy. Persistent disks require a paid Render service.
For continuously available Telegram polling and durable SQLite, use one always-on
paid web service with a persistent disk mounted at `/data`; this existing
single-process architecture does not need a separate worker. A Render Cron Job
is not a drop-in replacement: it costs at least $1/month, cannot use a persistent
disk, and the current server entry point starts the web server rather than a
run-and-exit job. An external scheduler can be free, but cannot eliminate
Render's restarts or free-tier availability/data limits.

After deployment, open the service URL and sign in using the configured
dashboard credentials.

## Credentials

Enter provider credentials under **LLM & Web Search** and the Telegram bot
token under **Telegram Settings**. The service reads project `.env` values for
local development and stores dashboard-entered credentials in
`%LOCALAPPDATA%\AgentFlow\.env` on Windows; app-data values take precedence.
The dashboard only receives whether each credential is set. Both files use
plaintext secrets, so prefer the app-data file and avoid storing real keys in
a OneDrive-synced folder. `.env.example` contains blank variable names only.

Rotate credentials immediately if they have been shared in chat, logs, or
other places that are not intended for secrets. Enter only replacement keys
in the dashboard.

## Test the live agent

1. Under **LLM & Web Search**, save an OpenRouter key (the default provider),
   a Gemini key, or Groq and Tavily keys if you choose Groq.
2. Under **Telegram Settings**, save a Telegram bot token and click **Verify
   bot token**.
3. Add your Telegram numeric user ID to the whitelist. If your ID is not
   whitelisted, the bot replies with your ID so you can add it.
4. The service starts Telegram long polling automatically when the bot token
   is configured. No **Start live agent** click is needed. A public webhook
   URL/tunnel is not needed. **Stop live agent** disables automatic restart
   until you start it again. Do not run another polling client for the same
   bot; an existing Telegram webhook must be removed first. Temporary polling
   connection failures are retried with backoff.
   Public access is enabled by default; anyone who finds the bot can send
   requests and use your configured provider quota.
5. Message the bot with `/start`, `/search question`, `/summary question`, or a
   plain-text question. The bot sends replies using the selected live provider.
   **Test query** also makes a real provider request but does not message
   Telegram.

Keep the hosting service running while using the bot. Long polling only receives
messages while that service is online. Use **Stop live agent** when you want it
to stop; this remains stopped across service restarts.
Groq replies are constrained to retrieved Tavily results; when Tavily returns
no usable sources, the agent reports that it could not verify the answer rather
than generating an ungrounded response. Telegram replies use plain-text bullets
instead of Markdown tables, and source links come from the retrieved results.

## Job-search intelligence

The **Job intelligence** workspace adds a persistent candidate profile and a
separate job-research workflow. Profile fields start blank and are never
pre-filled with assumed personal information. Eligibility labels distinguish
verified eligibility from likely matches, manual checks, ineligibility, and
insufficient evidence.

To configure it:

1. Save a Tavily key and a key for the selected Gemini, Groq, or OpenRouter
   provider under the existing credential settings. Credentials remain on the
   server and are never sent back to the browser.
2. Open **Job intelligence**, fill in the candidate profile, and save it.
   The search target graduation year defaults to 2027; this is a search
   preference, not a claim about the candidate's graduation year.
3. Add each company with its official careers-site domain. Research is limited
   to these explicitly configured domains; social networks and generic job
   aggregators are not treated as authoritative openings.
4. Optionally configure a numeric Telegram notification chat ID. Scheduled
   notifications use the existing bot token. Telegram profile and schedule
   administration commands require the caller's ID or chat ID in the dashboard
   whitelist, even if general bot access is public.
5. Run **Run research now** to populate and verify listings. Review the quoted
   evidence, official application links, eligibility reason, and saved run
   history before applying.

If the employer's official vacancy page links to a third-party applicant
tracking system (ATS), add that ATS hostname in **Linked ATS domain(s)**. An
ATS application link is used only when the exact URL is present in the fetched
employer page text and its hostname is allowlisted. Generic career landing
pages, search snippets, and inaccessible pages are not accepted as proof of an
open vacancy. The employer source URL and the application URL are stored
separately.

The local SQLite database is stored at
`%LOCALAPPDATA%\AgentFlow\jobs.sqlite` on Windows. Set `AGENTFLOW_DB_PATH` to
use another path. The database initializes its schema on startup and records schema migrations
through version 3. It stores the candidate profile, company/provider settings,
jobs, source evidence, six-hour fetched-page cache, cached AI analyses, per
company search coverage, provider operation/latency/token usage (when returned
by a provider), notifications, scheduler state, and application history.
Database backups use Node's SQLite backup API; backup and reopen/restore are
covered by tests.

Eligibility checks use explicit job-page evidence for graduation year, degree,
branch, CGPA, backlog limits, experience, and employment type. A location
preference mismatch is reported as a preference note, not an invented
eligibility rejection. Blank or ambiguous candidate data remains unknown.

The Telegram bot adds `/today`, `/eligible`, `/deadlines`, `/saved`, `/applied`,
`/company <name>`, `/profile`, `/pause`, `/resume`, and `/last_run`. Profile
updates accept semicolon-separated key/value pairs, for example:
`/profile set graduationYear=2027; degree=BTech; branch=Computer Science`.
Use commas for list fields such as `skills`, `preferredRoles`, and `locations`.
Inline job actions support opening the official application, saving a listing,
marking an application submitted, and requesting an on-demand AI eligibility
analysis. That analysis sends the saved candidate profile and vacancy evidence
to the selected AI provider; credentials remain server-side.

Daily research is scheduled for 09:00 Asia/Kolkata by the running Node service.
Schedule state and runs persist in SQLite; interrupted runs are marked on
startup, overdue work is recovered once, and an interrupted prior run triggers
recovery even if its stored next-run timestamp was advanced. Failed scheduled
research has a bounded retry policy and records failures. Telegram
notifications use a persistent claim lease and retry definite failures; a
network timeout is treated as ambiguous and is not resent immediately to avoid
duplicate messages. Exactly-once Telegram delivery cannot be guaranteed if
the process stops after Telegram accepts a message but before SQLite records
the acknowledgement. This is an **in-process** scheduler,
not an OS service: the computer and Node process must remain running for the
scheduled time. When deploying, use a supervised, single-instance service,
persistent storage for the SQLite database, and backups. Do not run multiple
instances against the same database; the scheduler is not a distributed
multi-process lock.

Job availability is only marked verified when fetched official-page content
explicitly supports an open status. Results with inaccessible or weak evidence
remain unverified. An open verification older than 24 hours is presented as
unverified until a fresh official-page check succeeds; failed rechecks preserve
historical evidence but remove the current-open claim. Search coverage depends
on configured companies/domains, Tavily access, and provider limits; the system
does not guarantee exhaustive coverage of all Indian internships or fresher
vacancies. A completed search with zero discovered vacancies is recorded as a
successful search with zero results—not as evidence that the employer has no
openings. The dashboard reports configured employers/domains, last successful
search, failures, newly discovered jobs, verified-open job count, and unresolved
verification failures separately.

## PostgreSQL migration tooling (preparatory)

Versioned PostgreSQL schema files are in `migrations/postgres/`. The migration
command applies unapplied versions transactionally:

```sh
npm run db:migrate
```

To copy an existing, current-schema SQLite database into an **empty** PostgreSQL
database, first create and retain a SQLite backup using `backup.mjs`, set
`DATABASE_URL` in the private server-side environment, apply the migrations,
then run:

```sh
npm run db:import-sqlite -- "path/to/jobs.sqlite"
```

The importer opens SQLite read-only, refuses to overwrite destination records,
imports records in foreign-key order inside one PostgreSQL transaction, adjusts
generated ID sequences, and verifies row counts before committing. On failure
the PostgreSQL import is rolled back. It does not modify the SQLite database,
move `.env` credentials, or automatically import credentials; configure secrets
separately through private environment settings.

**This is migration preparation only.** The current application still starts
its existing SQLite-backed server and has not yet been converted to use
PostgreSQL or Vercel Functions. Do not treat this project as ready for a
Vercel-only backend deployment until that runtime migration is complete.
