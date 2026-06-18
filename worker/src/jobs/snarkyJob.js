/**
 * Snarky Job — Claude Haiku-generated comment after every attendance event.
 * Fire probability is controlled by SNARKY_PROBABILITY env var (0.0–1.0, default 0.3).
 * Falls back to event-type-aware templates on API failure.
 */

import { getMyStats } from '../storage/db.js';
import { postMessage } from '../slack/poster.js';

const SERIOUS_KEYWORDS = ['high fever', 'fever', 'hospitalized', 'hospital', 'surgery', 'accident',
  'emergency', 'death', 'passed away', 'funeral', 'bereavement', 'critical', 'icu', 'serious'];

function checkIsSerious(event) {
  const reasonLower = (event.reason ?? '').toLowerCase();
  const textLower = (event.message_text ?? '').toLowerCase();
  return SERIOUS_KEYWORDS.some(k => reasonLower.includes(k) || textLower.includes(k));
}

async function generateClaudeComment(event, context, anthropicApiKey, isSerious) {
  if (!anthropicApiKey) return null;

  const { user_id, user_name, event_type, reason } = event;
  const name = user_name ?? `<@${user_id}>`;

  const isFirstTimer = context.total <= 2;
  const isHabitual = context.total >= 8;

  const toneGuide = isSerious && isFirstTimer
    ? `TONE: Warm and genuinely caring. This person rarely takes leave AND is seriously unwell. Say something kind — "get well soon", wish them a quick recovery. No sarcasm at all.`
    : isSerious && isHabitual
    ? `TONE: Mildly concerned but knowing. They're unwell but they have a long history. You can be warm but allow yourself a tiny dry aside about their record — something like "get well soon... you know the drill by now." Keep it human, not cruel.`
    : isSerious
    ? `TONE: Warm and decent. Genuine illness — keep it kind. A simple "get well soon" with maybe one gentle line. No roasting.`
    : isFirstTimer
    ? `TONE: Light and welcoming. This is one of their first events — don't slam them. Mild observation, friendly tone.`
    : isHabitual
    ? `TONE: Full snarky mode. This person is a seasoned veteran of the absence game. Call out their patterns directly and humorously. They can take it.`
    : `TONE: Dry wit, balanced. Comment on their event or mild patterns if any.`;

  const system = `You are Office Police — part workplace bot, part attendance warden, part reluctant colleague.
You genuinely care about the team but you ALSO track every absence religiously.
Drop a short comment reacting to this attendance event.

${toneGuide}

Rules:
- One or two sentences MAX. Under 35 words.
- Always mention the user as <@${user_id}>
- Reference specific history if available (streak, Monday pattern, total count, repeated reasons)
- Vary style: deadpan, faux-concerned, bureaucratic, conspiratorial — never the same twice
- Do NOT start with "Ah," or "Well,"
- Output ONLY the comment. Nothing else.`;

  const userPrompt = `User: <@${user_id}> (${name})
Event: ${event_type}${reason ? ` — "${reason}"` : ''}
Total events on record: ${context.total}
Rank: ${context.rank ? `#${context.rank} of ${context.totalPeople}` : 'unranked'}
Longest streak: ${context.streak} days | Monday absences: ${context.mondayCount} | Friday absences: ${context.fridayCount}
Top reasons: ${context.topReasons}

Write the comment.`;

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
        max_tokens: 80,
        temperature: 1.0,
        system,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    const data = await response.json();
    if (!response.ok || data.error) {
      console.log(`[snarkyJob] Claude unavailable (${data.error?.message ?? response.status}), using fallback`);
      return null;
    }

    return data.content?.[0]?.text?.trim() || null;
  } catch (err) {
    console.log(`[snarkyJob] Claude fetch failed: ${err.message.slice(0, 80)}`);
    return null;
  }
}

// Fallback templates are event-type aware so even on API failure
// the response feels intentional, not generic.
const FALLBACK_TEMPLATES = {
  wfh: [
    (u) => `<@${u}> has relocated their desk to the couch. Productivity: unverified.`,
    (u) => `WFH filed for <@${u}>. Office Police notes the suspiciously fast response time.`,
    (u) => `<@${u}> working from home. The coffee there is better anyway. We get it.`,
    (u) => `<@${u}>'s commute today: bedroom to kitchen. Noted.`,
  ],
  sick: [
    (u) => `Get well soon, <@${u}>. Your attendance record, however, remains unwell.`,
    (u) => `<@${u}> is sick. Office Police is sending thoughts, prayers, and a timestamped entry.`,
    (u) => `Illness reported for <@${u}>. Suspicious timing noted. Recovery monitored.`,
    (u) => `<@${u}> down with something. The file grows thicker.`,
  ],
  ooo: [
    (u) => `<@${u}> is out. The office will somehow survive.`,
    (u) => `OOO logged for <@${u}>. Their desk misses them. Probably.`,
    (u) => `<@${u}> has left the building. Office Police has not.`,
    (u) => `<@${u}> is away today. Life goes on. The record does not forget.`,
  ],
  late: [
    (u) => `<@${u}> running late. Traffic, probably. Always traffic.`,
    (u) => `Late arrival filed for <@${u}>. The standup started without you.`,
    (u) => `<@${u}> is delayed. Office Police clocked in on time, for the record.`,
    (u) => `<@${u}> — fashionably late, bureaucratically noted.`,
  ],
  early_leave: [
    (u) => `<@${u}> is heading out early. Must be nice.`,
    (u) => `Early exit filed for <@${u}>. The 5 o'clock rule applied at an unconventional hour.`,
    (u) => `<@${u}> is leaving before the rest of us. No comment. (Comment filed.)`,
    (u) => `<@${u}> out early. Office Police remains. As always.`,
  ],
  travel: [
    (u) => `<@${u}> is travelling. Office Police does not travel. Office Police waits.`,
    (u) => `Travel logged for <@${u}>. Jetlag is not an excuse. It is a data point.`,
    (u) => `<@${u}> is outstation. The wanderlust is noted and filed.`,
    (u) => `<@${u}> on the move. Their attendance record, unfortunately, is not.`,
  ],
  family: [
    (u) => `Family commitment logged for <@${u}>. Office Police respects family. And still files the record.`,
    (u) => `<@${u}> has family obligations. Noted with a heart and a timestamp.`,
    (u) => `Family first for <@${u}> today. The spreadsheet, a close second.`,
  ],
  unknown: [
    (u) => `<@${u}> has logged something. The details are vague. The record is not.`,
    (u) => `Attendance event filed for <@${u}>. Reason: classified.`,
    (u) => `<@${u}> — present in the channel, absent from the office. Details pending.`,
  ],
};

const DEFAULT_FALLBACKS = [
  (u) => `<@${u}> — logged. Office Police never forgets.`,
  (u) => `<@${u}>'s file has been updated. Carry on.`,
  (u) => `Noted, <@${u}>. The record grows.`,
];

const ZOHO_FALLBACKS = [
  (u) => `_<@${u}> — Zoho People won't update itself. Just saying. 📋_`,
  (u) => `_Reminder: <@${u}>, mark this on Zoho People before someone asks. 📋_`,
  (u) => `_<@${u}> — Office Police files reports. Zoho needs yours. 📋_`,
  (u) => `_Don't forget Zoho People, <@${u}>. The paper trail matters. 📋_`,
  (u) => `_<@${u}> — attendance logged here, but Zoho People needs to know too. 📋_`,
];

async function generateZohoReminder(event, context, anthropicApiKey) {
  if (!anthropicApiKey) return null;
  const { user_id, event_type } = event;

  const system = `You are Office Police reminding someone to log their leave on Zoho People (the company HR system).
Write a single short italic reminder, under 20 words.
Always mention the user as <@${user_id}> and reference Zoho People by name.
Vary the tone based on their history — first-timers get a gentle nudge, repeat offenders get mild exasperation.
Be dry and brief. Wrap the whole thing in Slack italics using underscores: _reminder here_
Output ONLY the reminder. No quotes, no explanation.`;

  const userPrompt = `User: <@${user_id}>
Event type: ${event_type}
Total events logged before this: ${context.total}
This is their ${context.total === 1 ? '1st' : context.total === 2 ? '2nd' : context.total === 3 ? '3rd' : context.total + 'th'} attendance event.
Write the Zoho People reminder.`;

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
        max_tokens: 60,
        temperature: 1.0,
        system,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    const data = await response.json();
    if (!response.ok || data.error) return null;
    return data.content?.[0]?.text?.trim() || null;
  } catch {
    return null;
  }
}

function getZohoFallback(userId) {
  return ZOHO_FALLBACKS[Math.floor(Math.random() * ZOHO_FALLBACKS.length)](userId);
}

const SERIOUS_FALLBACKS = [
  (u) => `Get well soon, <@${u}>. Take care of yourself first.`,
  (u) => `<@${u}> — rest up. The office will still be here when you're back.`,
  (u) => `Hope you feel better soon, <@${u}>. Health first, always.`,
];

function getFallback(userId, eventType, serious = false) {
  if (serious) return SERIOUS_FALLBACKS[Math.floor(Math.random() * SERIOUS_FALLBACKS.length)](userId);
  const pool = FALLBACK_TEMPLATES[eventType] ?? DEFAULT_FALLBACKS;
  return pool[Math.floor(Math.random() * pool.length)](userId);
}

export async function maybeSnarky(event, channelId, db, botToken, anthropicApiKey, fireProbability = 0.3) {
  if (!channelId) return;

  const stats = await getMyStats(db, event.user_id);
  const mondayCount = stats.events.filter(e => new Date(e.timestamp).getDay() === 1).length;
  const fridayCount = stats.events.filter(e => new Date(e.timestamp).getDay() === 5).length;
  const reasonCount = {};
  for (const e of stats.events) {
    if (e.reason) reasonCount[e.reason] = (reasonCount[e.reason] ?? 0) + 1;
  }
  const topReasons = Object.entries(reasonCount)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([r, c]) => `"${r}" x${c}`)
    .join(', ') || 'none';

  const context = {
    total: stats.total,
    rank: stats.rank,
    totalPeople: stats.totalPeople,
    streak: stats.streak,
    mondayCount,
    fridayCount,
    topReasons,
  };

  // thread_ts: reply in the same thread as the original message
  const threadTs = event.thread_ts ?? event.slack_ts ?? null;
  const isSerious = checkIsSerious(event);

  try {
    // Snarky comment fires at configurable probability
    if (Math.random() <= fireProbability) {
      const comment = await generateClaudeComment(event, context, anthropicApiKey, isSerious)
        ?? getFallback(event.user_id, event.event_type, isSerious);
      await postMessage(channelId, comment, botToken, threadTs);
      console.log(`[snarkyJob] Snarky posted for <@${event.user_id}>`);
    }

    // Zoho reminder only for actual leaves (not WFH or late — no Zoho entry needed), 40% chance
    const ZOHO_EVENT_TYPES = ['ooo', 'sick', 'early_leave', 'travel', 'family'];
    if (ZOHO_EVENT_TYPES.includes(event.event_type) && Math.random() <= 0.4) {
      const zohoText = await generateZohoReminder(event, context, anthropicApiKey)
        ?? getZohoFallback(event.user_id);
      await postMessage(channelId, zohoText, botToken, threadTs);
    }
  } catch (err) {
    console.error('[snarkyJob] Post failed:', err.message);
  }
}
