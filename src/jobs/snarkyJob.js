/**
 * Snarky Job — fires randomly after an attendance event is ingested.
 *
 * 30% chance of posting a sarcastic one-liner to the channel.
 * Tries Gemini first for a personalised comment, falls back to hardcoded
 * templates if Gemini is rate-limited or unavailable.
 */

import {
  getUserWeekdayCount,
  getUserReasons,
  getLeaderboard,
  getUserStreak,
} from '../storage/db.js';
import { postMessage } from '../slack/poster.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const FIRE_PROBABILITY = 0.3;

// ── Gemini snarky comment ─────────────────────────────────────────────────────

async function generateGeminiComment(event, patternContext) {
  if (!process.env.GEMINI_API_KEY) return null;

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      systemInstruction: `You are Office Police, a sarcastic workplace Slack bot.
Generate a single short snarky comment (1-2 sentences max) reacting to someone's attendance update.
Rules:
- Address the user by their Slack mention format: <@USER_ID>
- Be dry, witty, and observational — never mean-spirited or offensive
- Reference their specific reason or pattern if provided
- Keep it under 25 words
- No hashtags, no emojis unless they add punch
- Output ONLY the comment, nothing else`,
    });

    const prompt = `User <@${event.user_id}> (${event.user_name ?? 'someone'}) just posted an attendance update.
Event type: ${event.event_type}
Reason given: ${event.reason ?? 'none'}
${patternContext ? `Known pattern: ${patternContext}` : ''}
Write one snarky Office Police comment.`;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 60, temperature: 0.95 },
    });

    const text = result.response.text().trim();
    return text || null;
  } catch (err) {
    // Rate limit or any API error — fall through to templates
    console.log(`[snarkyJob] Gemini unavailable, using template: ${err.message.slice(0, 60)}`);
    return null;
  }
}

// ── Pattern detection (builds context for Gemini + template fallback) ─────────

function buildPatternContext(userId) {
  const mondayCount = getUserWeekdayCount(userId, 1).count;
  const fridayCount = getUserWeekdayCount(userId, 5).count;
  const reasons = getUserReasons(userId);
  const streak = getUserStreak(userId);
  const leaderboard = getLeaderboard(1);
  const isLeader = leaderboard.length > 0 && leaderboard[0].user_id === userId;

  if (mondayCount >= 3) return `absent on ${mondayCount} Mondays total`;
  if (fridayCount >= 3) return `absent on ${fridayCount} Fridays total`;
  if (reasons.length > 0 && reasons[0].count >= 3) return `repeated "${reasons[0].reason}" ${reasons[0].count} times`;
  if (streak >= 3) return `${streak} consecutive days of attendance events`;
  if (isLeader && leaderboard[0].excuse_count >= 5) return `leads the leaderboard with ${leaderboard[0].excuse_count} events`;
  return null;
}

// ── Hardcoded fallback templates — large variety ──────────────────────────────

const FALLBACK_TEMPLATES = [
  // Generic observational
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
  // WFH specific
  (u) => `<@${u}> working from home. The commute to the kitchen must be brutal.`,
  (u) => `<@${u}>'s home office productivity is unverified but assumed optimistic.`,
  (u) => `<@${u}> is WFH. Office Police has dispatched a remote surveillance drone.`,
  // Sick specific
  (u) => `<@${u}> is unwell. Get well soon — the leaderboard misses you.`,
  (u) => `<@${u}> sick again. Office Police wishes a speedy recovery and demands a doctor's note.`,
  // Late specific
  (u) => `<@${u}> running late. The office clocked in without them.`,
  (u) => `<@${u}> is delayed. Punctuality remains elusive.`,
  // Pattern specific
  (u, ctx) => ctx ? `<@${u}> — ${ctx}. Office Police has noticed.` : `<@${u}> — the pattern is becoming a lifestyle.`,
  (u) => `<@${u}> discovers new reasons to be elsewhere. Impressive range.`,
  (u) => `<@${u}>'s relationship with the office is best described as 'it's complicated'.`,
  (u) => `<@${u}> — absence makes the heart grow fonder, apparently.`,
  (u) => `Office Police logs <@${u}> and moves on. For now.`,
];

// ── Main export ───────────────────────────────────────────────────────────────

async function maybeSnarky(event, channelId) {
  if (!channelId) return;
  if (Math.random() > FIRE_PROBABILITY) return;

  const { user_id } = event;
  const patternContext = buildPatternContext(user_id);

  // Try Gemini first
  let comment = await generateGeminiComment(event, patternContext);

  // Fall back to templates
  if (!comment) {
    const templates = FALLBACK_TEMPLATES.filter((t) => t.length === 2 ? patternContext : true);
    const pick = FALLBACK_TEMPLATES[Math.floor(Math.random() * FALLBACK_TEMPLATES.length)];
    comment = pick(user_id, patternContext);
  }

  try {
    await postMessage(channelId, comment);
    console.log(`[snarkyJob] Posted comment for <@${user_id}>`);
  } catch (err) {
    console.error('[snarkyJob] Failed to post comment:', err.message);
  }
}

export { maybeSnarky };
