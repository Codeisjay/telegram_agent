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
  conservative prompt-token budget and per-page text limit.
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
  `TELEGRAM_BOT_TOKEN`.

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
