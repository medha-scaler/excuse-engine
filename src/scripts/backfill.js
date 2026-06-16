/**
 * backfill.js — one-time script to import full channel history into SQLite.
 *
 * Run once: node src/scripts/backfill.js
 *
 * What it does:
 *   1. Pages through the full conversations.history of SLACK_CHANNEL_ID
 *   2. Filters messages that contain attendance keywords
 *   3. Resolves user display names via users.info (cached to avoid rate limits)
 *   4. Runs each message through the existing ETL pipeline
 *   5. Skips duplicates (same user + same timestamp)
 */

import 'dotenv/config';
import { WebClient } from '@slack/web-api';
import { initSchema } from '../storage/db.js';
import { isAttendanceMessage, classifyKeywordOnly } from '../processing/classifier.js';
import { extract, load } from '../processing/pipeline.js';
import { db } from '../storage/db.js';

const client = new WebClient(process.env.SLACK_BOT_TOKEN);
const channelId = process.env.SLACK_CHANNEL_ID;

if (!channelId) {
  console.error('SLACK_CHANNEL_ID is not set in .env');
  process.exit(1);
}

initSchema();

// ── Duplicate guard ───────────────────────────────────────────────────────────

const existingStmt = db.prepare(
  'SELECT 1 FROM attendance_events WHERE user_id = ? AND timestamp = ? LIMIT 1'
);

function isDuplicate(userId, timestamp) {
  return !!existingStmt.get(userId, timestamp);
}

// ── User name cache ───────────────────────────────────────────────────────────

const userCache = {};

async function resolveUserName(userId) {
  if (userCache[userId]) return userCache[userId];
  try {
    const res = await client.users.info({ user: userId });
    const name =
      res.user?.profile?.display_name ||
      res.user?.profile?.real_name ||
      res.user?.name ||
      userId;
    userCache[userId] = name;
    return name;
  } catch {
    userCache[userId] = userId;
    return userId;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function backfill() {
  console.log(`[backfill] Starting for channel ${channelId}`);

  let cursor;
  let totalScanned = 0;
  let totalIngested = 0;
  let totalSkipped = 0;
  let totalDuplicates = 0;

  do {
    const res = await client.conversations.history({
      channel: channelId,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });

    const messages = res.messages ?? [];
    totalScanned += messages.length;

    for (const msg of messages) {
      // Skip bot messages, subtypes (edits, joins, etc.)
      if (msg.subtype || msg.bot_id || !msg.user) continue;

      const text = msg.text ?? '';
      if (!isAttendanceMessage(text)) {
        totalSkipped++;
        continue;
      }

      const userName = await resolveUserName(msg.user);
      const enrichedMsg = { ...msg, user_name: userName, channel: channelId };

      const raw = extract(enrichedMsg);

      if (isDuplicate(raw.user_id, raw.timestamp)) {
        totalDuplicates++;
        continue;
      }

      // Use keyword-only classification — no Gemini calls during backfill
      const { event_type, reason, sentiment } = classifyKeywordOnly(raw.message_text);
      const transformed = {
        ...raw,
        user_name: userName,
        is_attendance: true,
        event_type,
        reason,
        sentiment,
      };

      load(transformed);
      totalIngested++;

      console.log(
        `[backfill] ✓ ${userName} — ${transformed.event_type}${transformed.reason ? ` (${transformed.reason})` : ''} @ ${new Date(raw.timestamp).toLocaleDateString()}`
      );

      // Small delay to avoid Slack rate limits on users.info
      await new Promise((r) => setTimeout(r, 50));
    }

    cursor = res.response_metadata?.next_cursor;
    if (cursor) {
      console.log(`[backfill] Fetching next page...`);
    }
  } while (cursor);

  console.log('\n[backfill] Done.');
  console.log(`  Scanned  : ${totalScanned} messages`);
  console.log(`  Ingested : ${totalIngested} attendance events`);
  console.log(`  Skipped  : ${totalSkipped} non-attendance messages`);
  console.log(`  Duplicates skipped: ${totalDuplicates}`);
}

backfill().catch((err) => {
  console.error('[backfill] Fatal error:', err.message);
  process.exit(1);
});
