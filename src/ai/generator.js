/**
 * AI Generator — wraps Google Gemini generative AI.
 *
 * Responsible solely for turning analytics stats into roast text.
 * No Slack concerns live here.
 *
 * Exports:
 *   generateWeeklyRoast   — Friday full roast with awards + nicknames
 *   generateMidweekCheckin — Tuesday lighter check-in
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

let _client;

function getClient() {
  if (!_client) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY environment variable is not set');
    }
    _client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return _client;
}

// ── System prompts ────────────────────────────────────────────────────────────

const FRIDAY_SYSTEM_PROMPT = `You are Office Police, a sarcastic but funny workplace analytics bot for a Slack workspace. \
Generate a weekly roast summary based on attendance data. \
Keep it under 500 words. Use dry wit and office humour — be edgy but never mean-spirited, personal, or HR-problematic. \
Always punch at behaviour patterns, never at individuals personally. \
Structure your response exactly as follows:

1. A catchy sarcastic headline for the week (one line)
2. A brief stats recap (2-3 sentences max)
3. Awards — only include categories where data actually exists:
   🏠 Top WFH Employee — most work-from-home events
   🎭 Most Creative Excuse — most imaginative reason given this week
   🏆 Most Loyal Office Attendee — fewest absence events
   📅 Most Common Reason This Week — the most repeated excuse
   ✈️ Most Travelled — if travel events exist
   👨‍👩‍👧 Family Emergency Specialist — if family events exist
   🔍 Pattern of the Week — any suspicious behavioural pattern (e.g. always sick on Mondays, always OOO Fridays)
4. Dynamic Nicknames — assign a funny workplace nickname to the top 2-3 most active excuse-makers. Examples: "WFH Warrior", "Remote Monk", "Lord of Leave Applications", "The Phantom", "Monday Martyr"
5. Running Lore — one sentence of accumulated lore if a user has a repeated pattern (e.g. "This marks @alex's 4th dentist appointment this month.")
6. Employee of the Week — the most prolific excuse-maker, with a signature one-liner.`;

const TUESDAY_SYSTEM_PROMPT = `You are Office Police, a sarcastic Slack bot doing a midweek attendance check-in. \
It's Tuesday — the week is young but the excuses are already rolling in. \
Keep it under 200 words. Tone: observational, dry, mildly suspicious. \
Structure:
1. One punchy opening line about the state of the week so far
2. Brief mention of who's already racked up events (by name if data exists)
3. A single sarcastic prediction or observation about how the rest of the week might go
Do NOT do full awards — this is a quick check-in, not the full Friday roast.`;

// ── Prompt builder (shared) ───────────────────────────────────────────────────

function buildStatsPayload(stats) {
  const { weekStart, weekEnd, totalEvents, leaderboard, breakdown, byUser, mostLoyal, mostCommonReason, mondayPatterns } = stats;

  const leaderLines = leaderboard
    .map((u, i) => `  ${i + 1}. ${u.user_name ?? u.user_id} — ${u.excuse_count} excuse(s)`)
    .join('\n');

  const breakdownLines = breakdown
    .map((b) => `  ${b.event_type}: ${b.count}`)
    .join('\n');

  const userDetails = byUser
    .map((u) => {
      const eventSummary = u.events
        .map((e) => `${e.event_type}${e.reason ? ` (${e.reason})` : ''}`)
        .join(', ');
      return `  ${u.user_name ?? u.user_id}: ${eventSummary}`;
    })
    .join('\n');

  const loyalLine = mostLoyal
    ? `  ${mostLoyal.user_name ?? mostLoyal.user_id} — only ${mostLoyal.excuse_count} absence event(s) all-time`
    : '  (no data)';

  const commonReasonLine = mostCommonReason
    ? `  "${mostCommonReason.reason}" — used ${mostCommonReason.count} time(s)`
    : '  (no data)';

  const mondayLines = mondayPatterns.length > 0
    ? mondayPatterns.map((p) => `  ${p.user_name ?? p.user_id} — absent/sick on ${p.count} Mondays total`).join('\n')
    : '  (none detected)';

  return `Attendance Report: ${weekStart} to ${weekEnd}

Total events this period: ${totalEvents}

Top excuse-makers (all-time leaderboard):
${leaderLines || '  (none)'}

Event type breakdown (this week):
${breakdownLines || '  (none)'}

Most loyal office attendee (all-time):
${loyalLine}

Most common reason this week:
${commonReasonLine}

Suspicious Monday absence patterns (all-time):
${mondayLines}

Individual event details this week:
${userDetails || '  (no activity)'}`;
}

// ── Gemini call helper ────────────────────────────────────────────────────────

async function callGemini(systemPrompt, userPrompt, maxTokens = 700) {
  const genAI = getClient();
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: systemPrompt,
  });

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0.85,
    },
  });

  const text = result.response.text().trim();
  if (!text) throw new Error('Gemini returned an empty response');
  return text;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Friday full roast — awards, nicknames, lore, Employee of the Week.
 *
 * @param {object} stats - Output of buildWeeklySummary()
 * @returns {Promise<string>}
 */
async function generateWeeklyRoast(stats) {
  const payload = buildStatsPayload(stats);
  const userPrompt = `${payload}\n\nPlease write the Friday weekly roast based on this data.`;
  return callGemini(FRIDAY_SYSTEM_PROMPT, userPrompt, 800);
}

/**
 * Tuesday midweek check-in — shorter, observational, early-week tone.
 *
 * @param {object} stats - Output of buildWeeklySummary()
 * @returns {Promise<string>}
 */
async function generateMidweekCheckin(stats) {
  const payload = buildStatsPayload(stats);
  const userPrompt = `${payload}\n\nIt's Tuesday. Write the midweek check-in based on what's happened so far this week.`;
  return callGemini(TUESDAY_SYSTEM_PROMPT, userPrompt, 300);
}

export { generateWeeklyRoast, generateMidweekCheckin };
