/**
 * DB layer — Cloudflare D1 (SQLite-compatible).
 * All functions receive the D1 binding as first argument.
 */

export async function initSchema(db) {
  await db.exec(`
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
  `);
}

export async function insertEvent(db, record) {
  return db.prepare(`
    INSERT INTO attendance_events
      (user_id, user_name, channel_id, message_text, event_type, reason, sentiment, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    record.user_id, record.user_name, record.channel_id, record.message_text,
    record.event_type, record.reason, record.sentiment, record.timestamp
  ).run();
}

export async function insertRoast(db, record) {
  return db.prepare(`
    INSERT INTO weekly_roasts (week_start, week_end, roast_text, channel_id)
    VALUES (?, ?, ?, ?)
  `).bind(record.week_start, record.week_end, record.roast_text, record.channel_id).run();
}

export async function isDuplicate(db, userId, timestamp) {
  const row = await db.prepare(
    'SELECT 1 FROM attendance_events WHERE user_id = ? AND timestamp = ? LIMIT 1'
  ).bind(userId, timestamp).first();
  return !!row;
}

export async function getLeaderboard(db, limit = 5) {
  const { results } = await db.prepare(`
    SELECT user_id, user_name, COUNT(*) AS excuse_count
    FROM attendance_events
    GROUP BY user_id
    ORDER BY excuse_count DESC
    LIMIT ?
  `).bind(limit).all();
  return results;
}

export async function getEventTypeBreakdown(db) {
  const { results } = await db.prepare(`
    SELECT event_type, COUNT(*) AS count
    FROM attendance_events
    GROUP BY event_type
    ORDER BY count DESC
  `).all();
  return results;
}

export async function getWeeklyStats(db, weekStart, weekEnd) {
  const startTs = new Date(weekStart).getTime();
  const endTs = new Date(weekEnd).getTime();
  const { results } = await db.prepare(`
    SELECT * FROM attendance_events
    WHERE timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp ASC
  `).bind(startTs, endTs).all();
  return results;
}

export async function getUserWeekdayCount(db, userId, weekday) {
  const row = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM attendance_events
    WHERE user_id = ?
      AND strftime('%w', datetime(timestamp / 1000, 'unixepoch')) = ?
  `).bind(userId, String(weekday)).first();
  return row ?? { count: 0 };
}

export async function getMostCommonReason(db, eventType) {
  return db.prepare(`
    SELECT reason, COUNT(*) AS count
    FROM attendance_events
    WHERE event_type = ? AND reason IS NOT NULL AND reason != ''
    GROUP BY reason
    ORDER BY count DESC
    LIMIT 1
  `).bind(eventType).first();
}

export async function getRecentUserEvents(db, userId, limit = 10) {
  const { results } = await db.prepare(`
    SELECT * FROM attendance_events
    WHERE user_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).bind(userId, limit).all();
  return results;
}

export async function getMostLoyalUser(db) {
  return db.prepare(`
    SELECT user_id, user_name, COUNT(*) AS excuse_count
    FROM attendance_events
    GROUP BY user_id
    ORDER BY excuse_count ASC
    LIMIT 1
  `).first();
}

export async function getUserReasons(db, userId) {
  const { results } = await db.prepare(`
    SELECT reason, COUNT(*) AS count
    FROM attendance_events
    WHERE user_id = ? AND reason IS NOT NULL AND reason != ''
    GROUP BY reason
    ORDER BY count DESC
  `).bind(userId).all();
  return results;
}

export async function getUserStreak(db, userId) {
  const { results } = await db.prepare(`
    SELECT DISTINCT date(timestamp / 1000, 'unixepoch') AS day
    FROM attendance_events
    WHERE user_id = ?
    ORDER BY day DESC
  `).bind(userId).all();

  if (results.length === 0) return 0;

  let streak = 1;
  for (let i = 1; i < results.length; i++) {
    const prev = new Date(results[i - 1].day);
    const curr = new Date(results[i].day);
    const diffDays = (prev - curr) / (1000 * 60 * 60 * 24);
    if (diffDays === 1) streak++;
    else break;
  }
  return streak;
}
