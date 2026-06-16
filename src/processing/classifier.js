/**
 * Classifier — NLP-powered via Gemini.
 *
 * Every message is sent to Gemini with a structured prompt that returns:
 *   { is_attendance, event_type, reason, sentiment }
 *
 * Falls back to a fast keyword pre-filter only as a first-pass cost guard:
 * if a message contains zero plausible attendance signals it is skipped
 * without an API call. Gemini makes the final call on anything ambiguous.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

let _client;
let _model;

function getModel() {
  if (!_model) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not set');
    }
    _client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    _model = _client.getGenerativeModel({
      model: 'gemini-2.0-flash',
      systemInstruction: `You are an attendance classifier for a workplace Slack channel.
Your job: decide if a message is someone communicating about their attendance or work location.

Attendance includes ANY of:
- Working from home / remote
- Out of office / absent / taking the day
- Running late or delayed
- Leaving early
- Sick / unwell / doctor / hospital
- Travelling / outstation / out of town
- Family event / emergency / function
- Any informal equivalent: "not coming in", "won't make it today", "at home", "taking a half day", "stepping out", "on leave", "holiday"
- Emoji-only messages that imply absence (e.g. 🤒, 🏠, ✈️, 😷)
- Vague messages in a workplace attendance channel context (e.g. "plumber at home", "stuck", "won't be around")

event_type must be exactly one of: wfh, ooo, sick, late, early_leave, travel, family, unknown
- unknown = clearly attendance-related but doesn't fit the above

sentiment: positive, neutral, or negative — based on tone of the message

reason: a short phrase for WHY (e.g. "plumber visit", "fever", "metro delayed"). null if not mentioned.

is_attendance: true if this is an attendance-related message, false otherwise.
Return false for: general chat, greetings, questions, project discussions, announcements unrelated to someone's physical presence.

Respond ONLY with valid JSON. No markdown, no explanation.
Example output:
{"is_attendance": true, "event_type": "wfh", "reason": "plumber coming", "sentiment": "neutral"}
{"is_attendance": false, "event_type": null, "reason": null, "sentiment": null}`,
    });
  }
  return _model;
}

// ── Cheap pre-filter ──────────────────────────────────────────────────────────
// Skips obviously non-attendance messages (greetings, links, code snippets)
// without spending an API call. Intentionally broad — false positives are fine,
// false negatives are not.

const PRE_FILTER_SIGNALS = [
  // explicit keywords
  'wfh', 'ooo', 'sick', 'late', 'leave', 'remote', 'home', 'office',
  'travel', 'flight', 'hospital', 'doctor', 'fever', 'unwell', 'ill',
  'delay', 'traffic', 'metro', 'cab', 'uber', 'bus', 'train',
  'family', 'wedding', 'funeral', 'relative', 'uncle', 'aunt',
  'not coming', 'won\'t be', 'wont be', 'not in', 'out today',
  'half day', 'taking the day', 'on leave', 'holiday', 'vacation',
  'working from', 'from home', 'stepping out', 'heading out',
  'stuck', 'running late', 'be late', 'early', 'leaving',
  'absent', 'away', 'outstation', 'out of town',
  // emojis that signal attendance
  '🏠', '🤒', '😷', '✈️', '🚗', '🏥', '🛏️', '🌡️',
];

function passesCheapFilter(text) {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase();
  return PRE_FILTER_SIGNALS.some((s) => lower.includes(s));
}

// ── NLP classifier ────────────────────────────────────────────────────────────

/**
 * Classify a message using Gemini NLP.
 *
 * @param {string} text
 * @returns {Promise<{ is_attendance: boolean, event_type: string|null, reason: string|null, sentiment: string|null }>}
 */
async function classify(text) {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return { is_attendance: false, event_type: null, reason: null, sentiment: null };
  }

  // Skip obvious non-attendance messages without an API call
  if (!passesCheapFilter(text)) {
    return { is_attendance: false, event_type: null, reason: null, sentiment: null };
  }

  try {
    const model = getModel();
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: `Classify this Slack message:\n"${text}"` }] }],
      generationConfig: { maxOutputTokens: 100, temperature: 0 },
    });

    const raw = result.response.text().trim();
    // Strip markdown code fences if Gemini wraps in ```json
    const clean = raw.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(clean);

    return {
      is_attendance: Boolean(parsed.is_attendance),
      event_type: parsed.event_type ?? 'unknown',
      reason: parsed.reason ?? null,
      sentiment: parsed.sentiment ?? 'neutral',
    };
  } catch (err) {
    console.error('[classifier] Gemini error, falling back to unknown:', err.message);
    // On API failure, store as unknown so nothing is silently dropped
    return { is_attendance: true, event_type: 'unknown', reason: null, sentiment: 'neutral' };
  }
}

/**
 * Quick synchronous pre-check — used by the backfill script to avoid
 * sending every single historical message to Gemini.
 * The live pipeline always calls classify() which does the real NLP.
 */
function isAttendanceMessage(text) {
  return passesCheapFilter(text);
}

/**
 * Keyword-only classification — no API calls. Used by the backfill script.
 * Less accurate than Gemini but costs nothing and handles structured messages well.
 */
const KEYWORD_RULES = [
  { type: 'wfh',         keywords: ['wfh', 'work from home', 'working from home', 'remote today', 'working remotely', 'from home'] },
  { type: 'ooo',         keywords: ['ooo', 'out of office', 'not in today', 'taking the day', 'day off', 'on leave', 'holiday', 'vacation'] },
  { type: 'sick',        keywords: ['sick', 'not feeling well', 'unwell', 'under the weather', 'doctor', 'hospital', 'fever', 'migraine', 'ill '] },
  { type: 'late',        keywords: ['running late', 'will be late', 'be late', 'late today', 'delayed', 'stuck in traffic', 'metro', 'cab late', 'bus delay', 'train delay'] },
  { type: 'early_leave', keywords: ['leaving early', 'early day', 'heading out early', 'leave early', 'cut out early'] },
  { type: 'travel',      keywords: ['travel', 'travelling', 'traveling', 'flight', 'out of town', 'outstation', 'airport'] },
  { type: 'family',      keywords: ['family function', 'family emergency', 'relative', 'wedding', 'funeral', 'family event', 'uncle', 'aunt', 'cousin'] },
];

const REASON_TRIGGERS = ['because', 'due to', 'got a', 'have a', 'had a', 'after', 'since', 'cause'];
const POSITIVE_WORDS = ['great', 'love', 'excited', 'happy', 'good', 'amazing', 'fantastic'];
const NEGATIVE_WORDS = ['terrible', 'awful', 'stuck', 'hate', 'worst', 'bad', 'horrible', 'exhausted'];

export function classifyKeywordOnly(text) {
  if (!text) return { event_type: 'unknown', reason: null, sentiment: 'neutral' };
  const norm = text.toLowerCase().replace(/\s+/g, ' ').trim();

  let event_type = 'unknown';
  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.some((kw) => norm.includes(kw))) {
      event_type = rule.type;
      break;
    }
  }

  let reason = null;
  for (const trigger of REASON_TRIGGERS) {
    const idx = norm.indexOf(trigger);
    if (idx !== -1) {
      const fragment = norm.slice(idx + trigger.length).trim();
      const cutAt = fragment.search(/[.!?,;]/);
      const candidate = cutAt !== -1 ? fragment.slice(0, cutAt).trim() : fragment.slice(0, 80).trim();
      if (candidate.length > 1) { reason = candidate; break; }
    }
  }

  const hasPositive = POSITIVE_WORDS.some((w) => norm.includes(w));
  const hasNegative = NEGATIVE_WORDS.some((w) => norm.includes(w));
  const sentiment = hasPositive && !hasNegative ? 'positive' : hasNegative && !hasPositive ? 'negative' : 'neutral';

  return { event_type, reason, sentiment };
}

export { classify, isAttendanceMessage };
