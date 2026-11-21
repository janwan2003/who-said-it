-- Whosaid: daily "who wrote this?" game for groups. No accounts; a member is a nickname + secret token.
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tz TEXT NOT NULL DEFAULT 'UTC',
  created_at INTEGER NOT NULL,
  active_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  left_at INTEGER
);
CREATE INDEX IF NOT EXISTS members_group ON members(group_id);
-- One round per group per local calendar day. state: answer -> guess -> reveal.
CREATE TABLE IF NOT EXISTS rounds (
  group_id TEXT NOT NULL,
  day TEXT NOT NULL,
  prompt INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'answer',
  locked_at INTEGER,
  revealed_at INTEGER,
  PRIMARY KEY (group_id, day)
);
-- aid is a random public id so answers can be shown without their author before the reveal.
CREATE TABLE IF NOT EXISTS answers (
  aid TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  day TEXT NOT NULL,
  member_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (group_id, day, member_id)
);
CREATE INDEX IF NOT EXISTS answers_round ON answers(group_id, day);
CREATE TABLE IF NOT EXISTS guesses (
  group_id TEXT NOT NULL,
  day TEXT NOT NULL,
  guesser_id INTEGER NOT NULL,
  aid TEXT NOT NULL,
  guessed_id INTEGER NOT NULL,
  PRIMARY KEY (group_id, day, guesser_id, aid)
);
CREATE TABLE IF NOT EXISTS rate (
  k TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
