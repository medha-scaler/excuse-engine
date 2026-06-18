/**
 * ETL Pipeline — handles multi-date messages.
 * A single message like "leave on 18th and 19th June" creates two rows, one per date.
 */

import { classify } from './classifier.js';
import { insertEvent, isDuplicate } from '../storage/db.js';
import { getUserName } from '../slack/poster.js';

export function extract(event, channelId) {
  return {
    user_id: event.user ?? null,
    user_name: event.user_name ?? null,
    channel_id: event.channel ?? channelId ?? null,
    message_text: event.text ?? '',
    timestamp: event.ts ? Math.round(parseFloat(event.ts) * 1000) : Date.now(),
    slack_ts: event.ts ?? null,
  };
}

export async function runPipeline(event, db, anthropicApiKey, channelId, alertFn = null, botToken = null) {
  const raw = extract(event, channelId);

  if (!raw.user_name && raw.user_id && botToken) {
    raw.user_name = await getUserName(raw.user_id, botToken) ?? raw.user_id;
  }

  const classifications = await classify(raw.message_text, anthropicApiKey, alertFn);

  // Filter to only attendance events
  const attendanceEvents = classifications.filter(c => c.is_attendance);
  if (attendanceEvents.length === 0) return null;

  const inserted = [];
  for (const classification of attendanceEvents) {
    // Dedup key: user_id + leave_date if we have a date, else user_id + message timestamp
    const dedupKey = classification.leave_date
      ? `${raw.user_id}:${classification.leave_date}`
      : null;

    if (dedupKey) {
      // Check for duplicate by leave_date
      const exists = await db.prepare(
        'SELECT 1 FROM attendance_events WHERE user_id = ? AND leave_date = ? LIMIT 1'
      ).bind(raw.user_id, classification.leave_date).first();
      if (exists) continue;
    } else {
      if (await isDuplicate(db, raw.user_id, raw.timestamp)) continue;
    }

    const record = {
      ...raw,
      event_type: classification.event_type,
      reason: classification.reason,
      sentiment: classification.sentiment,
      leave_date: classification.leave_date,
      days: classification.days,
    };

    const result = await insertEvent(db, record);
    inserted.push({ raw, transformed: record, result });
  }

  // Return the first inserted event for snarky comment (represents the whole message)
  return inserted.length > 0 ? inserted[0] : null;
}
