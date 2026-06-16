CREATE TABLE IF NOT EXISTS attendance_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  user_name   TEXT,
  channel_id  TEXT,
  message_text TEXT,
  event_type  TEXT,
  reason      TEXT,
  sentiment   TEXT,
  timestamp   INTEGER,
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ae_user_id    ON attendance_events (user_id);
CREATE INDEX IF NOT EXISTS idx_ae_event_type ON attendance_events (event_type);
CREATE INDEX IF NOT EXISTS idx_ae_timestamp  ON attendance_events (timestamp);

CREATE TABLE IF NOT EXISTS weekly_roasts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start TEXT,
  week_end   TEXT,
  roast_text TEXT,
  channel_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
