/**
 * Classifier — Claude Haiku 4.5.
 * Returns an array of events (one per date mentioned) so a message like
 * "half day on 18th and full day on 19th" creates two separate rows.
 */

const PRE_FILTER_SIGNALS = [
  'wfh', 'ooo', 'sick', 'late', 'leave', 'remote', 'home', 'office',
  'travel', 'flight', 'hospital', 'doctor', 'fever', 'unwell', 'ill',
  'delay', 'traffic', 'metro', 'cab', 'uber', 'bus', 'train',
  'family', 'wedding', 'funeral', 'relative', 'uncle', 'aunt',
  'not coming', "won't be", 'wont be', 'not in', 'out today',
  'half day', 'taking the day', 'on leave', 'holiday', 'vacation',
  'working from', 'from home', 'stepping out', 'heading out',
  'stuck', 'running late', 'be late', 'early', 'leaving early', 'leave early',
  'absent', 'away', 'outstation', 'out of town',
  'personal reason', 'personal work', 'personal emergency', 'personal commitment',
  'continue working', 'continue my work', 'will work', 'working remotely',
  'go somewhere', 'going somewhere', 'have to go', 'need to go',
  'not at office', 'not in office', 'outside', 'not available',
  'unavailable', 'signing off', 'logging off', 'drop off', 'wrap up early',
  "won't be available", 'wont be available', 'stepping away', 'heading home',
  '🏠', '🤒', '😷', '✈️', '🚗', '🏥', '🛏️', '🌡️',
];

export function passesCheapFilter(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return PRE_FILTER_SIGNALS.some((s) => lower.includes(s));
}

const SYSTEM_INSTRUCTION = `You are an attendance classifier for a workplace Slack channel.
Classify a message and extract every individual leave date mentioned.

Rules:
- is_attendance: true for ANY message where someone is not coming to office, working remotely, leaving early, coming late, or away for any reason — even if phrased indirectly like "have to go somewhere but will continue working" or "personal reason, working remotely"
- If someone says they will "continue working" or "work from somewhere else" — that is WFH (is_attendance: true, event_type: wfh)
- If someone says they are leaving early, signing off early, heading home early, or won't be available after a certain time — that is early_leave
- If someone says they are running late, will be late, or delayed coming in — that is late
- Only set is_attendance: false for messages that are clearly NOT about attendance (announcements, questions, greetings, admin messages)
- If no specific dates are mentioned, return a single event with leave_date: null (assume today)
- If multiple dates are mentioned, return one object per date
- days: 0.5 for half day, 1.0 for full day (default 1.0)
- event_type: wfh, ooo, sick, late, early_leave, travel, family, unknown
- reason: short phrase for WHY (null if not mentioned)
- For leave_date, use YYYY-MM-DD format. The current year is 2026 unless stated otherwise.
- If a date range is mentioned (e.g. "18th to 22nd June"), expand it into individual dates (skip weekends)

Respond ONLY with valid JSON array. No markdown, no explanation.
Example for "half day on 18th June and full day on 19th June":
[
  {"is_attendance": true, "event_type": "ooo", "reason": "leave", "sentiment": "neutral", "leave_date": "2026-06-18", "days": 0.5},
  {"is_attendance": true, "event_type": "ooo", "reason": "leave", "sentiment": "neutral", "leave_date": "2026-06-19", "days": 1.0}
]
Example for "due to personal reason I have to go somewhere, will continue my work":
[{"is_attendance": true, "event_type": "wfh", "reason": "personal reason", "sentiment": "neutral", "leave_date": null, "days": 1.0}]
Example for a simple same-day message with no date:
[{"is_attendance": true, "event_type": "wfh", "reason": "fever", "sentiment": "neutral", "leave_date": null, "days": 1.0}]
Example for non-attendance message:
[{"is_attendance": false, "event_type": null, "reason": null, "sentiment": null, "leave_date": null, "days": null}]`;

export async function classify(text, anthropicApiKey, alertFn = null) {
  if (!text || !text.trim()) {
    return [{ is_attendance: false, event_type: null, reason: null, sentiment: null, leave_date: null, days: null }];
  }

  if (!passesCheapFilter(text)) {
    return [{ is_attendance: false, event_type: null, reason: null, sentiment: null, leave_date: null, days: null }];
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        temperature: 0,
        system: SYSTEM_INSTRUCTION,
        messages: [{ role: 'user', content: `Classify this Slack message:\n"${text}"` }],
      }),
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      const msg = data.error?.message ?? `HTTP ${response.status}`;
      console.error(`[classifier] Claude error: ${msg}`);
      if (alertFn) await alertFn('CLAUDE_ERROR', msg);
      return [{ is_attendance: true, event_type: 'unknown', reason: null, sentiment: 'neutral', leave_date: null, days: 1.0 }];
    }

    const raw = data.content?.[0]?.text?.trim() ?? '';
    const clean = raw.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(clean);
    const arr = Array.isArray(parsed) ? parsed : [parsed];

    return arr.map(p => ({
      is_attendance: Boolean(p.is_attendance),
      event_type: p.event_type ?? 'unknown',
      reason: p.reason ?? null,
      sentiment: p.sentiment ?? 'neutral',
      leave_date: p.leave_date ?? null,
      days: p.days ?? 1.0,
    }));
  } catch (err) {
    console.error('[classifier] Claude error:', err.message);
    if (alertFn) await alertFn('CLAUDE_ERROR', err.message);
    return [{ is_attendance: true, event_type: 'unknown', reason: null, sentiment: 'neutral', leave_date: null, days: 1.0 }];
  }
}
