/**
 * Snarky Job — Gemini-generated comment after every attendance event.
 * Passes the user's full history to Gemini so comments feel earned and specific.
 * Falls back to a small set of neutral templates only on rate limit / API failure.
 */

import { getRecentUserEvents, getLeaderboard, getUserWeekdayCount, getUserReasons } from '../storage/db.js';
import { postMessage } from '../slack/poster.js';

const FIRE_PROBABILITY = 0.3;

// ── Build rich user context for Gemini ───────────────────────────────────────

async function buildUserContext(userId, db) {
  const recentEvents = await getRecentUserEvents(db, userId, 20);
  const leaderboard  = await getLeaderboard(db, 10);
  const reasons      = await getUserReasons(db, userId);
  const mondayCount  = (await getUserWeekdayCount(db, userId, 1)).count;
  const fridayCount  = (await getUserWeekdayCount(db, userId, 5)).count;

  const rank = leaderboard.findIndex((u) => u.user_id === userId) + 1;
  const totalEvents = leaderboard.find((u) => u.user_id === userId)?.excuse_count ?? recentEvents.length;

  const eventSummary = recentEvents
    .slice(0, 10)
    .map((e) => `${e.event_type}${e.reason ? ` (${e.reason})` : ''} on ${new Date(e.timestamp).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`)
    .join(', ');

  const topReasons = reasons.slice(0, 3).map((r) => `"${r.reason}" x${r.count}`).join(', ');

  return {
    totalEvents,
    rank: rank > 0 ? rank : null,
    leaderboardSize: leaderboard.length,
    eventSummary: eventSummary || 'no prior events',
    topReasons: topReasons || 'none',
    mondayCount,
    fridayCount,
  };
}

// ── Gemini comment generation ─────────────────────────────────────────────────

async function generateGeminiComment(event, context, geminiApiKey) {
  if (!geminiApiKey) return null;

  const { user_id, user_name, event_type, reason } = event;
  const name = user_name ?? `<@${user_id}>`;

  const systemInstruction = `You are Office Police, a sharp and witty workplace Slack bot.
You just detected an attendance event and want to drop a sarcastic one-liner in the channel.

Rules:
- One or two sentences MAX. Under 30 words total.
- Always mention the user as <@${user_id}>
- Be specific — reference their actual history, reasons, or patterns if interesting
- Dry wit, never cruel. Punch at the behaviour, not the person.
- Vary your style: sometimes deadpan, sometimes faux-concerned, sometimes bureaucratic, sometimes conspiratorial
- Do NOT start with "Ah," or "Well," — be more creative
- Output ONLY the comment. Nothing else.`;

  const userPrompt = `
User: <@${user_id}> (${name})
Today's event: ${event_type}${reason ? ` — reason: "${reason}"` : ' — no reason given'}

Their history:
- Total attendance events logged: ${context.totalEvents}
- Leaderboard rank: ${context.rank ? `#${context.rank} out of ${context.leaderboardSize}` : 'not ranked yet'}
- Recent events: ${context.eventSummary}
- Most repeated reasons: ${context.topReasons}
- Times absent on a Monday: ${context.mondayCount}
- Times absent on a Friday: ${context.fridayCount}

Write one snarky Office Police comment reacting to this.`.trim();

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: { maxOutputTokens: 80, temperature: 1.0 },
        }),
      }
    );

    const data = await response.json();
    if (!response.ok || data.error) {
      console.log(`[snarkyJob] Gemini unavailable (${data.error?.code ?? response.status}), using fallback`);
      return null;
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return text || null;
  } catch (err) {
    console.log(`[snarkyJob] Gemini fetch failed: ${err.message.slice(0, 80)}`);
    return null;
  }
}

// ── Minimal fallback templates — only used on API failure ─────────────────────
// Intentionally generic so they don't feel fake or patterned.

const FALLBACK_TEMPLATES = [
  (u) => `<@${u}> — logged. Office Police never forgets.`,
  (u) => `Attendance event filed for <@${u}>. The record grows.`,
  (u) => `<@${u}> has been noted. That's all.`,
  (u) => `<@${u}> — duly recorded. See you in the Friday report.`,
  (u) => `Office Police acknowledges <@${u}>. Eyes remain open.`,
  (u) => `<@${u}> — present in spirit, absent in person.`,
  (u) => `<@${u}>'s file has been updated. Carry on.`,
];

// ── Main export ───────────────────────────────────────────────────────────────

export async function maybeSnarky(event, channelId, db, botToken, geminiApiKey) {
  if (!channelId) return;
  if (Math.random() > FIRE_PROBABILITY) return;

  const context = await buildUserContext(event.user_id, db);
  const comment = await generateGeminiComment(event, context, geminiApiKey)
    ?? FALLBACK_TEMPLATES[Math.floor(Math.random() * FALLBACK_TEMPLATES.length)](event.user_id);

  try {
    await postMessage(channelId, comment, botToken);
    console.log(`[snarkyJob] Posted for <@${event.user_id}>`);
  } catch (err) {
    console.error('[snarkyJob] Post failed:', err.message);
  }
}
