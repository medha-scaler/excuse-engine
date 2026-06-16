/**
 * ETL Pipeline — Workers version.
 * Resolves user display names from Slack API before storing.
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
  };
}

export async function runPipeline(event, db, geminiApiKey, channelId, alertFn = null, botToken = null) {
  const raw = extract(event, channelId);

  // Resolve display name from Slack API if not already present
  if (!raw.user_name && raw.user_id && botToken) {
    raw.user_name = await getUserName(raw.user_id, botToken) ?? raw.user_id;
  }

  const { is_attendance, event_type, reason, sentiment } = await classify(raw.message_text, geminiApiKey, alertFn);
  if (!is_attendance) return null;

  const transformed = { ...raw, is_attendance, event_type, reason, sentiment };

  if (await isDuplicate(db, raw.user_id, raw.timestamp)) return null;

  const result = await insertEvent(db, transformed);
  return { raw, transformed, result };
}
