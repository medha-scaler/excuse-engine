/**
 * Classifier — Gemini NLP. Same logic as src/processing/classifier.js
 * but uses env bindings instead of process.env.
 */

const PRE_FILTER_SIGNALS = [
  'wfh', 'ooo', 'sick', 'late', 'leave', 'remote', 'home', 'office',
  'travel', 'flight', 'hospital', 'doctor', 'fever', 'unwell', 'ill',
  'delay', 'traffic', 'metro', 'cab', 'uber', 'bus', 'train',
  'family', 'wedding', 'funeral', 'relative', 'uncle', 'aunt',
  'not coming', "won't be", 'wont be', 'not in', 'out today',
  'half day', 'taking the day', 'on leave', 'holiday', 'vacation',
  'working from', 'from home', 'stepping out', 'heading out',
  'stuck', 'running late', 'be late', 'early', 'leaving',
  'absent', 'away', 'outstation', 'out of town',
  '🏠', '🤒', '😷', '✈️', '🚗', '🏥', '🛏️', '🌡️',
];

export function passesCheapFilter(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return PRE_FILTER_SIGNALS.some((s) => lower.includes(s));
}

const SYSTEM_INSTRUCTION = `You are an attendance classifier for a workplace Slack channel.
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
sentiment: positive, neutral, or negative
reason: short phrase for WHY. null if not mentioned.
is_attendance: true if attendance-related, false otherwise.

Respond ONLY with valid JSON. No markdown, no explanation.
Example: {"is_attendance": true, "event_type": "wfh", "reason": "plumber coming", "sentiment": "neutral"}`;

export async function classify(text, geminiApiKey, alertFn = null) {
  if (!text || !text.trim()) {
    return { is_attendance: false, event_type: null, reason: null, sentiment: null };
  }

  if (!passesCheapFilter(text)) {
    return { is_attendance: false, event_type: null, reason: null, sentiment: null };
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          contents: [{ role: 'user', parts: [{ text: `Classify this Slack message:\n"${text}"` }] }],
          generationConfig: { maxOutputTokens: 100, temperature: 0 },
        }),
      }
    );

    const data = await response.json();

    // Detect rate limit specifically
    if (data.error) {
      const isRateLimit = data.error.code === 429 || data.error.message?.includes('Quota');
      const alertType = isRateLimit ? 'GEMINI_RATE_LIMIT' : 'GEMINI_ERROR';
      console.error(`[classifier] ${alertType}: ${data.error.message}`);
      if (alertFn) await alertFn(alertType, data.error.message);
      return { is_attendance: true, event_type: 'unknown', reason: null, sentiment: 'neutral' };
    }

    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
    const clean = raw.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(clean);

    return {
      is_attendance: Boolean(parsed.is_attendance),
      event_type: parsed.event_type ?? 'unknown',
      reason: parsed.reason ?? null,
      sentiment: parsed.sentiment ?? 'neutral',
    };
  } catch (err) {
    console.error('[classifier] Gemini error:', err.message);
    if (alertFn) await alertFn('GEMINI_ERROR', err.message);
    return { is_attendance: true, event_type: 'unknown', reason: null, sentiment: 'neutral' };
  }
}
