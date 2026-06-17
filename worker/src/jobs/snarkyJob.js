/**
 * Snarky Job — Claude Haiku-generated comment after every attendance event.
 * Fire probability is controlled by SNARKY_PROBABILITY env var (0.0–1.0, default 0.3).
 * Falls back to event-type-aware templates on API failure.
 */

import { getMyStats } from '../storage/db.js';
import { postMessage } from '../slack/poster.js';

async function generateClaudeComment(event, context, anthropicApiKey) {
  if (!anthropicApiKey) return null;

  const { user_id, user_name, event_type, reason } = event;
  const name = user_name ?? `<@${user_id}>`;

  const system = `You are Office Police, a sharp and witty workplace Slack bot.
You just detected an attendance event and want to drop a sarcastic one-liner in the channel.

Rules:
- One or two sentences MAX. Under 30 words total.
- Always mention the user as <@${user_id}>
- Be specific — reference their actual history, reasons, or patterns if interesting
- Dry wit, never cruel. Punch at the behaviour, not the person.
- Vary your style: sometimes deadpan, sometimes faux-concerned, sometimes bureaucratic, sometimes conspiratorial
- Do NOT start with "Ah," or "Well," — be more creative
- Match the tone to the event: WFH gets couch-potato energy, sick gets faux-sympathy, OOO gets FOMO vibes, late gets mild suspicion, travel gets wanderlust sarcasm, family gets wholesome-but-suspicious
- Output ONLY the comment. Nothing else.`;

  const userPrompt = `User: <@${user_id}> (${name})
Today's event: ${event_type}${reason ? ` — reason: "${reason}"` : ' — no reason given'}

Their history:
- Total attendance events logged: ${context.total}
- Leaderboard rank: ${context.rank ? `#${context.rank} out of ${context.totalPeople}` : 'not ranked yet'}
- Longest streak: ${context.streak} consecutive leave day(s)
- Times absent on a Monday: ${context.mondayCount}
- Times absent on a Friday: ${context.fridayCount}
- Top reasons: ${context.topReasons}

Write one snarky Office Police comment reacting to this.`;

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

function getFallback(userId, eventType) {
  const pool = FALLBACK_TEMPLATES[eventType] ?? DEFAULT_FALLBACKS;
  return pool[Math.floor(Math.random() * pool.length)](userId);
}

export async function maybeSnarky(event, channelId, db, botToken, anthropicApiKey, fireProbability = 0.3) {
  if (!channelId) return;
  if (Math.random() > fireProbability) return;

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

  const comment = await generateClaudeComment(event, context, anthropicApiKey)
    ?? getFallback(event.user_id, event.event_type);

  try {
    await postMessage(channelId, comment, botToken);
    console.log(`[snarkyJob] Posted for <@${event.user_id}>`);
  } catch (err) {
    console.error('[snarkyJob] Post failed:', err.message);
  }
}
