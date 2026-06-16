/**
 * ETL Pipeline — extract → transform → load
 *
 * transform() is now async — it calls Gemini NLP for classification.
 */

import { classify } from './classifier.js';
import { insertEvent } from '../storage/db.js';

function extract(event) {
  return {
    user_id: event.user ?? event.user_id ?? null,
    user_name: event.username ?? event.user_name ?? null,
    channel_id: event.channel ?? event.channel_id ?? null,
    message_text: event.text ?? '',
    timestamp: event.ts ? Math.round(parseFloat(event.ts) * 1000) : Date.now(),
  };
}

async function transform(raw) {
  const { is_attendance, event_type, reason, sentiment } = await classify(raw.message_text);

  return {
    user_id: raw.user_id,
    user_name: raw.user_name,
    channel_id: raw.channel_id,
    message_text: raw.message_text,
    is_attendance,
    event_type,
    reason,
    sentiment,
    timestamp: raw.timestamp,
  };
}

function load(transformed) {
  return insertEvent(transformed);
}

/**
 * Run the full ETL pipeline. Returns null if Gemini says not attendance-related.
 *
 * @param {object} event - Raw Slack event payload
 * @returns {Promise<{ raw, transformed, result } | null>}
 */
async function runPipeline(event) {
  const raw = extract(event);
  const transformed = await transform(raw);

  if (!transformed.is_attendance) return null;

  const result = load(transformed);
  return { raw, transformed, result };
}

export { extract, transform, load, runPipeline };
