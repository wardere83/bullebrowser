-- BulleBrowser feedback. Safe to run again: every statement is idempotent.
CREATE TABLE IF NOT EXISTS feedback (
  item TEXT PRIMARY KEY,          -- a one-way hash the app makes for the rated reply or playbook
  kind TEXT NOT NULL,             -- 'reply' or 'strategy'
  rating TEXT NOT NULL,           -- 'up' or 'down'
  comment TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL,
  platform TEXT NOT NULL,         -- 'darwin', 'win32' or 'linux'
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS feedback_updated ON feedback (updated_at);

-- Daily request counters for abuse limits. Addresses are stored only as a
-- salted hash that changes every day.
CREATE TABLE IF NOT EXISTS limits (
  bucket TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  count INTEGER NOT NULL
);
