import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = process.env.DATABASE_PATH || './data/excuse-engine.db';
const resolvedPath = path.resolve(DB_PATH);

// Ensure the data directory exists before opening the database
const dir = path.dirname(resolvedPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

const db = new Database(resolvedPath);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Initialize all tables. Safe to call multiple times — uses CREATE IF NOT EXISTS.
 */
function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS attendance_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     TEXT    NOT NULL,
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
  `);
}

// ── Prepared statements (created lazily after schema init) ─────────────────

let _insertEvent;
let _insertRoast;

function insertEvent(record) {
  if (!_insertEvent) {
    _insertEvent = db.prepare(`
      INSERT INTO attendance_events
        (user_id, user_name, channel_id, message_text, event_type, reason, sentiment, timestamp)
      VALUES
        (@user_id, @user_name, @channel_id, @message_text, @event_type, @reason, @sentiment, @timestamp)
    `);
  }
  return _insertEvent.run(record);
}

function insertRoast(record) {
  if (!_insertRoast) {
    _insertRoast = db.prepare(`
      INSERT INTO weekly_roasts (week_start, week_end, roast_text, channel_id)
      VALUES (@week_start, @week_end, @roast_text, @channel_id)
    `);
  }
  return _insertRoast.run(record);
}

function getLeaderboard(limit = 5) {
  return db
    .prepare(`
      SELECT user_id, user_name, COUNT(*) AS excuse_count
      FROM attendance_events
      GROUP BY user_id
      ORDER BY excuse_count DESC
      LIMIT ?
    `)
    .all(limit);
}

function getEventTypeBreakdown() {
  return db
    .prepare(`
      SELECT event_type, COUNT(*) AS count
      FROM attendance_events
      GROUP BY event_type
      ORDER BY count DESC
    `)
    .all();
}

function getWeeklyStats(weekStart, weekEnd) {
  const startTs = new Date(weekStart).getTime();
  const endTs = new Date(weekEnd).getTime();
  return db
    .prepare(`
      SELECT *
      FROM attendance_events
      WHERE timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp ASC
    `)
    .all(startTs, endTs);
}

function getUserStreak(userId) {
  const rows = db
    .prepare(`
      SELECT DISTINCT date(timestamp / 1000, 'unixepoch') AS day
      FROM attendance_events
      WHERE user_id = ?
      ORDER BY day DESC
    `)
    .all(userId);

  if (rows.length === 0) return 0;

  let streak = 1;
  for (let i = 1; i < rows.length; i++) {
    const prev = new Date(rows[i - 1].day);
    const curr = new Date(rows[i].day);
    const diffDays = (prev - curr) / (1000 * 60 * 60 * 24);
    if (diffDays === 1) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

function getRecentRoast() {
  return db
    .prepare(`SELECT * FROM weekly_roasts ORDER BY created_at DESC LIMIT 1`)
    .get();
}

// How many times a user has posted on a specific weekday (0=Sun,1=Mon,...,6=Sat)
function getUserWeekdayCount(userId, weekday) {
  return db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM attendance_events
      WHERE user_id = ?
        AND strftime('%w', datetime(timestamp / 1000, 'unixepoch')) = ?
    `)
    .get(userId, String(weekday));
}

// Most frequently repeated reason across all events (for a given event type)
function getMostCommonReason(eventType) {
  return db
    .prepare(`
      SELECT reason, COUNT(*) AS count
      FROM attendance_events
      WHERE event_type = ? AND reason IS NOT NULL AND reason != ''
      GROUP BY reason
      ORDER BY count DESC
      LIMIT 1
    `)
    .get(eventType);
}

// All events for a user, most recent first, limited to last N
function getRecentUserEvents(userId, limit = 10) {
  return db
    .prepare(`
      SELECT * FROM attendance_events
      WHERE user_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `)
    .all(userId, limit);
}

// User with the fewest attendance events (most loyal office attendee)
function getMostLoyalUser() {
  return db
    .prepare(`
      SELECT user_id, user_name, COUNT(*) AS excuse_count
      FROM attendance_events
      GROUP BY user_id
      ORDER BY excuse_count ASC
      LIMIT 1
    `)
    .get();
}

// All distinct reasons for a user
function getUserReasons(userId) {
  return db
    .prepare(`
      SELECT reason, COUNT(*) AS count
      FROM attendance_events
      WHERE user_id = ? AND reason IS NOT NULL AND reason != ''
      GROUP BY reason
      ORDER BY count DESC
    `)
    .all(userId);
}

export {
  db,
  initSchema,
  insertEvent,
  insertRoast,
  getLeaderboard,
  getEventTypeBreakdown,
  getWeeklyStats,
  getUserStreak,
  getRecentRoast,
  getUserWeekdayCount,
  getMostCommonReason,
  getRecentUserEvents,
  getMostLoyalUser,
  getUserReasons,
};
