ALTER TABLE job_settings
  ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT NOT NULL DEFAULT '';

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS source_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS application_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS employer_identity TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS max_backlogs INTEGER,
  ADD COLUMN IF NOT EXISTS backlog_requirement TEXT NOT NULL DEFAULT '';

ALTER TABLE job_sources
  ADD COLUMN IF NOT EXISTS application_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS employer_identity TEXT NOT NULL DEFAULT '';

UPDATE jobs SET source_url = official_url WHERE source_url = '';
UPDATE jobs SET application_url = official_url WHERE application_url = '';
