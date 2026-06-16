/**
 * DB layer — Cloudflare D1 (SQLite-compatible).
 * All functions receive the D1 binding as first argument.
 */

export async function initSchema(db) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS attendance_events (
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
    )`,
    `CREATE INDEX IF NOT EXISTS idx_ae_user_id    ON attendance_events (user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ae_event_type ON attendance_events (event_type)`,
    `CREATE INDEX IF NOT EXISTS idx_ae_timestamp  ON attendance_events (timestamp)`,
    `CREATE TABLE IF NOT EXISTS weekly_roasts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      week_start TEXT,
      week_end   TEXT,
      roast_text TEXT,
      channel_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    // Maps old user_ids (from pre-migration Slack accounts) to a canonical display name.
    // Populated once via seed; the leaderboard uses it to merge split identities.
    `CREATE TABLE IF NOT EXISTS user_aliases (
      user_id        TEXT PRIMARY KEY,
      canonical_name TEXT NOT NULL
    )`,
  ];

  for (const sql of statements) {
    await db.prepare(sql).run();
  }
}

// Seed known pre→post org-migration identity pairs.
// Safe to call repeatedly — INSERT OR IGNORE skips existing rows.
export async function seedAliases(db) {
  const aliases = [
    // Old user_id (pre-migration account) → canonical_name (matches post-migration display name)
    { user_id: 'U0A4813LS92', canonical_name: 'Ishan Jaiswal' },        // "Ishan Jaiswal" → "Ishan"
    { user_id: 'U0AV10VKP9D', canonical_name: 'Ishan Jaiswal' },
    { user_id: 'U09TU9EPFQE', canonical_name: 'Anisha Singhal' },       // "anisha.singhal" → "Anisha Singhal"
    { user_id: 'U0AU2EWF91C', canonical_name: 'Anisha Singhal' },
    { user_id: 'U0ACQBX8NUX', canonical_name: 'Gargi Kekre' },          // "gargi.kekre_1" → "Gargi Kekre"
    { user_id: 'U0AU97E5D4J', canonical_name: 'Gargi Kekre' },
    { user_id: 'U0ACDTNPM3M', canonical_name: 'Sangam Kumar' },         // "sangam.kumar" → "Sangam Kumar"
    { user_id: 'U0AUK9G9LBV', canonical_name: 'Sangam Kumar' },
    { user_id: 'U0AD7UK8CLQ', canonical_name: 'Gowtham Sai G' },        // "gowtham" → "Gowtham Sai G"
    { user_id: 'U0ATZJZ1T8V', canonical_name: 'Gowtham Sai G' },
    { user_id: 'U0AR3P8EP8C', canonical_name: 'Jashan' },               // "jashan" → "Jashan"
    { user_id: 'U0ATQD4H41M', canonical_name: 'Jashan' },
    { user_id: 'U0AR3P8LCF6', canonical_name: 'Anjali' },               // "anjali.patel" → "Anjali"
    { user_id: 'U0AU17SSPTQ', canonical_name: 'Anjali' },
    { user_id: 'U0AJA3VBYC9', canonical_name: 'Hariom Patel' },         // "hariom.patel" → "Hariom Patel"
    { user_id: 'U0ATWN9CU91', canonical_name: 'Hariom Patel' },
    { user_id: 'U0ACDR5R7D0', canonical_name: 'Rajveer Khanduja' },     // "Rajveer Khanduja" → "Rajveer Singh Khanduja"
    { user_id: 'U0ATMF4HKPH', canonical_name: 'Rajveer Khanduja' },
    { user_id: 'U0AU2TUMLNN', canonical_name: 'Anil Jangid' },          // "Anil" → "Anil Jangid"
    { user_id: 'U0A3QRTMNFP', canonical_name: 'Anil Jangid' },
    { user_id: 'U08FZHZ5JKY', canonical_name: 'Debashis Maharana' },    // "ddevMhrn" → "The Debashis Maharana"
    { user_id: 'U0AU6KMJ41J', canonical_name: 'Debashis Maharana' },
    { user_id: 'U0AEE5HHS4C', canonical_name: 'Jils Patel' },           // "jils.patel" → "atomic-jils"
    { user_id: 'U0AUFS0TZ9P', canonical_name: 'Jils Patel' },
    { user_id: 'U08FZJ3Q41L', canonical_name: 'Swayam' },               // "swayam" → "atomic-swayam"
    { user_id: 'U0AU58QT2QL', canonical_name: 'Swayam' },
    { user_id: 'U0AUEREU9CM', canonical_name: 'Mohit Kumar' },          // "atomic-mohit" → "Mohit Kumar"
    { user_id: 'U0AEQQ4GLTB', canonical_name: 'Mohit Kumar' },
    { user_id: 'U0B1CH4DZJR', canonical_name: 'Aditya Maurya' },        // "atomic-aditya" (different from Aditya Dutt)
    { user_id: 'U09PTG97H6J', canonical_name: 'Jaivardhan' },           // "Jaivardhan" → "atomic-jaivardhan"
    { user_id: 'U0ATMER168P', canonical_name: 'Jaivardhan' },
  ];

  for (const { user_id, canonical_name } of aliases) {
    await db.prepare(
      'INSERT OR IGNORE INTO user_aliases (user_id, canonical_name) VALUES (?, ?)'
    ).bind(user_id, canonical_name).run();
  }
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

export async function getLeaderboardWithBreakdown(db, limit = 15) {
  // Resolve each user_id to a canonical name via user_aliases if present,
  // otherwise fall back to lower(user_name), which catches same-name duplicate
  // user_ids (e.g. both "Amrinder Singh" accounts).
  // This handles two split-identity scenarios:
  //   1. Same name, different user_id → merged by lower(user_name)
  //   2. Different name after org migration → merged via user_aliases seed
  const { results } = await db.prepare(`
    SELECT
      LOWER(COALESCE(ua.canonical_name, NULLIF(ae.user_name,''), ae.user_id)) AS name_key,
      COALESCE(ua.canonical_name, MAX(ae.user_name))                          AS user_name,
      COUNT(*)                                                                AS total,
      SUM(CASE WHEN ae.event_type='wfh'         THEN 1 ELSE 0 END) AS wfh,
      SUM(CASE WHEN ae.event_type='sick'        THEN 1 ELSE 0 END) AS sick,
      SUM(CASE WHEN ae.event_type='ooo'         THEN 1 ELSE 0 END) AS ooo,
      SUM(CASE WHEN ae.event_type='travel'      THEN 1 ELSE 0 END) AS travel,
      SUM(CASE WHEN ae.event_type='late'        THEN 1 ELSE 0 END) AS late,
      SUM(CASE WHEN ae.event_type='early_leave' THEN 1 ELSE 0 END) AS early_leave,
      SUM(CASE WHEN ae.event_type='family'      THEN 1 ELSE 0 END) AS family,
      SUM(CASE WHEN ae.event_type='unknown'     THEN 1 ELSE 0 END) AS unknown
    FROM attendance_events ae
    LEFT JOIN user_aliases ua ON ae.user_id = ua.user_id
    GROUP BY name_key
    ORDER BY total DESC
    LIMIT ?
  `).bind(limit).all();
  return results;
}

// Returns top N reasons per canonical name_key — used by leaderboard detail view
export async function getTopReasonsByPerson(db, limit = 3) {
  const { results } = await db.prepare(`
    SELECT
      LOWER(COALESCE(ua.canonical_name, NULLIF(ae.user_name,''), ae.user_id)) AS name_key,
      ae.reason,
      COUNT(*) AS c
    FROM attendance_events ae
    LEFT JOIN user_aliases ua ON ae.user_id = ua.user_id
    WHERE ae.reason IS NOT NULL AND ae.reason != ''
    GROUP BY name_key, ae.reason
    ORDER BY name_key, c DESC
  `).all();

  // Group into map: name_key → top N reasons
  const map = {};
  for (const row of results) {
    if (!map[row.name_key]) map[row.name_key] = [];
    if (map[row.name_key].length < limit) {
      map[row.name_key].push({ reason: row.reason, count: row.c });
    }
  }
  return map;
}

// Fetches stats for a user using the exact same merged-identity logic as the leaderboard.
// Returns { events, displayName, total, rank, totalPeople, wfh, sick, ooo, travel, late, early_leave, family }
export async function getMyStats(db, userId) {
  // Run the full leaderboard query (same as getLeaderboardWithBreakdown) so counts always match.
  const { results: leaderboard } = await db.prepare(`
    SELECT
      LOWER(COALESCE(ua.canonical_name, NULLIF(ae.user_name,''), ae.user_id)) AS name_key,
      COALESCE(ua.canonical_name, MAX(ae.user_name))                          AS user_name,
      COUNT(*)                                                                AS total,
      SUM(CASE WHEN ae.event_type='wfh'         THEN 1 ELSE 0 END) AS wfh,
      SUM(CASE WHEN ae.event_type='sick'        THEN 1 ELSE 0 END) AS sick,
      SUM(CASE WHEN ae.event_type='ooo'         THEN 1 ELSE 0 END) AS ooo,
      SUM(CASE WHEN ae.event_type='travel'      THEN 1 ELSE 0 END) AS travel,
      SUM(CASE WHEN ae.event_type='late'        THEN 1 ELSE 0 END) AS late,
      SUM(CASE WHEN ae.event_type='early_leave' THEN 1 ELSE 0 END) AS early_leave,
      SUM(CASE WHEN ae.event_type='family'      THEN 1 ELSE 0 END) AS family,
      GROUP_CONCAT(DISTINCT ae.user_id)                             AS all_user_ids
    FROM attendance_events ae
    LEFT JOIN user_aliases ua ON ae.user_id = ua.user_id
    GROUP BY name_key
    ORDER BY total DESC
  `).all();

  // Find this user's row — match by any of their stored user_ids
  const myRow = leaderboard.find(r =>
    r.all_user_ids && r.all_user_ids.split(',').includes(userId)
  );

  const rank = myRow ? leaderboard.findIndex(r => r.name_key === myRow.name_key) + 1 : 0;

  // Fetch recent events across all their user_ids for the activity list
  let events = [];
  if (myRow) {
    const ids = myRow.all_user_ids.split(',');
    const placeholders = ids.map(() => '?').join(',');
    const { results } = await db.prepare(`
      SELECT * FROM attendance_events
      WHERE user_id IN (${placeholders})
      ORDER BY timestamp DESC
      LIMIT 50
    `).bind(...ids).all();
    events = results;
  }

  return {
    events,
    displayName: myRow?.user_name ?? userId,
    total: myRow?.total ?? 0,
    rank,
    totalPeople: leaderboard.length,
    wfh:         myRow?.wfh         ?? 0,
    sick:        myRow?.sick        ?? 0,
    ooo:         myRow?.ooo         ?? 0,
    travel:      myRow?.travel      ?? 0,
    late:        myRow?.late        ?? 0,
    early_leave: myRow?.early_leave ?? 0,
    family:      myRow?.family      ?? 0,
  };
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
