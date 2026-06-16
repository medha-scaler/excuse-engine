/**
 * ETL Pipeline — Workers version. All functions are async, accept env/db as args.
 */

import { classify } from './classifier.js';
import { insertEvent, isDuplicate } from '../storage/db.js';

export function extract(event, channelId) {
  return {
    user_id: event.user ?? null,
    user_name: event.user_name ?? null,
    channel_id: event.channel ?? channelId ?? null,
    message_text: event.text ?? '',
    timestamp: event.ts ? Math.round(parseFloat(event.ts) * 1000) : Date.now(),
  };
}

export async function runPipeline(event, db, geminiApiKey, channelId, alertFn = null) {
  const raw = extract(event, channelId);

  const { is_attendance, event_type, reason, sentiment } = await classify(raw.message_text, geminiApiKey, alertFn);
  if (!is_attendance) return null;

  const transformed = { ...raw, is_attendance, event_type, reason, sentiment };

  // Skip duplicates (important for backfill safety)
  if (await isDuplicate(db, raw.user_id, raw.timestamp)) return null;

  const result = await insertEvent(db, transformed);
  return { raw, transformed, result };
}
