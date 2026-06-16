/**
 * AI Generator — Workers version. Uses fetch() directly (no SDK needed).
 */

const FRIDAY_SYSTEM_PROMPT = `You are Office Police, a sarcastic but funny workplace analytics bot for a Slack workspace.
Generate a weekly roast summary based on attendance data.
Keep it under 500 words. Use dry wit and office humour — be edgy but never mean-spirited, personal, or HR-problematic.
Always punch at behaviour patterns, never at individuals personally.
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
   🔍 Pattern of the Week — any suspicious behavioural pattern
4. Dynamic Nicknames — assign a funny workplace nickname to the top 2-3 most active excuse-makers
5. Running Lore — one sentence of accumulated lore if a user has a repeated pattern
6. Employee of the Week — most prolific excuse-maker with a signature one-liner`;

const TUESDAY_SYSTEM_PROMPT = `You are Office Police, a sarcastic Slack bot doing a midweek attendance check-in.
It's Tuesday — the week is young but the excuses are already rolling in.
Keep it under 200 words. Tone: observational, dry, mildly suspicious.
Structure:
1. One punchy opening line about the state of the week so far
2. Brief mention of who's already racked up events (by name if data exists)
3. A single sarcastic prediction or observation about how the rest of the week might go
Do NOT do full awards — this is a quick check-in, not the full Friday roast.`;

function buildStatsPayload(stats) {
  const { weekStart, weekEnd, totalEvents, leaderboard, breakdown, byUser, mostLoyal, mostCommonReason, mondayPatterns } = stats;

  const leaderLines = leaderboard.map((u, i) =>
    `  ${i + 1}. ${u.user_name ?? u.user_id} — ${u.excuse_count} excuse(s)`).join('\n');

  const breakdownLines = breakdown.map((b) => `  ${b.event_type}: ${b.count}`).join('\n');

  const userDetails = byUser.map((u) => {
    const summary = u.events.map((e) => `${e.event_type}${e.reason ? ` (${e.reason})` : ''}`).join(', ');
    return `  ${u.user_name ?? u.user_id}: ${summary}`;
  }).join('\n');

  const loyalLine = mostLoyal
    ? `  ${mostLoyal.user_name ?? mostLoyal.user_id} — only ${mostLoyal.excuse_count} absence event(s) all-time`
    : '  (no data)';

  const commonReasonLine = mostCommonReason
    ? `  "${mostCommonReason.reason}" — used ${mostCommonReason.count} time(s)`
    : '  (no data)';

  const mondayLines = mondayPatterns.length > 0
    ? mondayPatterns.map((p) => `  ${p.user_name ?? p.user_id} — absent on ${p.count} Mondays total`).join('\n')
    : '  (none detected)';

  return `Attendance Report: ${weekStart} to ${weekEnd}
Total events this period: ${totalEvents}
Top excuse-makers: ${leaderLines || '(none)'}
Event type breakdown: ${breakdownLines || '(none)'}
Most loyal attendee: ${loyalLine}
Most common reason: ${commonReasonLine}
Monday patterns: ${mondayLines}
Individual details: ${userDetails || '(no activity)'}`;
}

async function callGemini(systemPrompt, userPrompt, geminiApiKey, maxTokens = 800) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.85 },
      }),
    }
  );

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error('Gemini returned empty response');
  return text;
}

export async function generateWeeklyRoast(stats, geminiApiKey) {
  const payload = buildStatsPayload(stats);
  return callGemini(FRIDAY_SYSTEM_PROMPT, `${payload}\n\nWrite the Friday weekly roast.`, geminiApiKey, 800);
}

export async function generateMidweekCheckin(stats, geminiApiKey) {
  const payload = buildStatsPayload(stats);
  return callGemini(TUESDAY_SYSTEM_PROMPT, `${payload}\n\nIt's Tuesday. Write the midweek check-in.`, geminiApiKey, 300);
}
