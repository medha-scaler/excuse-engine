/**
 * Snarky Job — Workers version.
 * Tries Gemini first, falls back to hardcoded templates on rate limit/error.
 */

import {
  getUserWeekdayCount,
  getUserReasons,
  getLeaderboard,
  getUserStreak,
} from '../storage/db.js';
import { postMessage } from '../slack/poster.js';

const FIRE_PROBABILITY = 0.3;

// ── Gemini snarky comment ─────────────────────────────────────────────────────

async function generateGeminiComment(event, patternContext, geminiApiKey) {
  if (!geminiApiKey) return null;

  const systemInstruction = `You are Office Police, a sarcastic workplace Slack bot.
Generate a single short snarky comment (1-2 sentences max) reacting to someone's attendance update.
Rules:
- Address the user by their Slack mention format: <@USER_ID>
- Be dry, witty, and observational — never mean-spirited or offensive
- Reference their specific reason or pattern if provided
- Keep it under 25 words
- No hashtags, no emojis unless they add punch
- Output ONLY the comment, nothing else`;

  const userPrompt = `User <@${event.user_id}> (${event.user_name ?? 'someone'}) just posted an attendance update.
Event type: ${event.event_type}
Reason given: ${event.reason ?? 'none'}
${patternContext ? `Known pattern: ${patternContext}` : ''}
Write one snarky Office Police comment.`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: { maxOutputTokens: 60, temperature: 0.95 },
        }),
      }
    );

    const data = await response.json();

    // Rate limit or quota error — fall through silently
    if (!response.ok || data.error) {
      console.log(`[snarkyJob] Gemini unavailable: ${data.error?.message?.slice(0, 60) ?? response.status}`);
      return null;
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return text || null;
  } catch (err) {
    console.log(`[snarkyJob] Gemini fetch failed: ${err.message.slice(0, 60)}`);
    return null;
  }
}

// ── Pattern detection ─────────────────────────────────────────────────────────

async function buildPatternContext(userId, db) {
  const mondayRow = await getUserWeekdayCount(db, userId, 1);
  if (mondayRow.count >= 3) return `absent on ${mondayRow.count} Mondays total`;

  const fridayRow = await getUserWeekdayCount(db, userId, 5);
  if (fridayRow.count >= 3) return `absent on ${fridayRow.count} Fridays total`;

  const reasons = await getUserReasons(db, userId);
  if (reasons.length > 0 && reasons[0].count >= 3) return `repeated "${reasons[0].reason}" ${reasons[0].count} times`;

  const streak = await getUserStreak(db, userId);
  if (streak >= 3) return `${streak} consecutive days of attendance events`;

  const leaderboard = await getLeaderboard(db, 1);
  if (leaderboard.length > 0 && leaderboard[0].user_id === userId && leaderboard[0].excuse_count >= 5) {
    return `leads the leaderboard with ${leaderboard[0].excuse_count} events`;
  }

  return null;
}

// ── Hardcoded fallback templates ──────────────────────────────────────────────

const FALLBACK_TEMPLATES = [
  (u) => `<@${u}> checking in. Attendance noted. Eyebrow raised.`,
  (u) => `Office Police has logged <@${u}>'s latest update. The file grows thicker.`,
  (u) => `<@${u}>'s excuse has been catalogued for the weekly review. Sleep well.`,
  (u) => `Another entry for <@${u}>. The spreadsheet never forgets.`,
  (u) => `<@${u}> — bold move. Let's see how this ages by Friday.`,
  (u) => `Attendance this week is starting to resemble a post-apocalyptic movie. <@${u}> just confirmed their role.`,
  (u) => `<@${u}> has filed their report. Office Police is watching. Always watching.`,
  (u) => `<@${u}> remains committed to the bit.`,
  (u) => `Noted, <@${u}>. The dossier thickens.`,
  (u) => `<@${u}> and the office remain in a complicated relationship.`,
  (u) => `<@${u}> — consistency is a virtue. So is showing up, but here we are.`,
  (u) => `Office Police acknowledges <@${u}>'s contribution to this week's statistics.`,
  (u) => `<@${u}> has once again demonstrated creative work-life balance.`,
  (u) => `Adding <@${u}> to today's incident report.`,
  (u) => `<@${u}> — the office chair remains cold.`,
  (u) => `<@${u}> working from home. The commute to the kitchen must be brutal.`,
  (u) => `<@${u}>'s home office productivity is unverified but assumed optimistic.`,
  (u) => `<@${u}> is WFH. Office Police has dispatched a remote surveillance drone.`,
  (u) => `<@${u}> sick again. Office Police wishes a speedy recovery and demands a doctor's note.`,
  (u) => `<@${u}> running late. The office clocked in without them.`,
  (u) => `<@${u}> discovers new reasons to be elsewhere. Impressive range.`,
  (u) => `<@${u}>'s relationship with the office is best described as 'it's complicated'.`,
  (u) => `<@${u}> — absence makes the heart grow fonder, apparently.`,
  (u) => `Office Police logs <@${u}> and moves on. For now.`,
  (u) => `<@${u}> — the pattern is becoming a lifestyle.`,
];

// ── Main export ───────────────────────────────────────────────────────────────

export async function maybeSnarky(event, channelId, db, botToken, geminiApiKey) {
  if (!channelId) return;
  if (Math.random() > FIRE_PROBABILITY) return;

  const { user_id } = event;
  const patternContext = await buildPatternContext(user_id, db);

  // Try Gemini first
  let comment = await generateGeminiComment(event, patternContext, geminiApiKey);

  // Fall back to templates
  if (!comment) {
    const pick = FALLBACK_TEMPLATES[Math.floor(Math.random() * FALLBACK_TEMPLATES.length)];
    comment = pick(user_id);
  }

  try {
    await postMessage(channelId, comment, botToken);
    console.log(`[snarkyJob] Posted comment for <@${user_id}>`);
  } catch (err) {
    console.error('[snarkyJob] Failed to post comment:', err.message);
  }
}
