/**
 * AI Generator — Claude Haiku 4.5.
 * Three report types: Tuesday check-in, Friday roast, Monthly report.
 */

async function callClaude(systemPrompt, userPrompt, anthropicApiKey, maxTokens = 800) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      temperature: 1.0,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(`Claude API error: ${data.error?.message ?? response.status}`);
  }
  const text = data.content?.[0]?.text?.trim();
  if (!text) throw new Error('Claude returned empty response');
  return text;
}

// ── Tuesday midweek check-in ──────────────────────────────────────────────────

const TUESDAY_SYSTEM = `You are Office Police, a sarcastic Slack bot doing a midweek attendance check-in.
It's Tuesday — the week is young but the excuses are already rolling in.
Keep it under 200 words. Tone: observational, dry, mildly suspicious.

Structure (no headers, just flow):
1. One punchy opening line about how the week is going so far
2. Name who's already logged events this week and what they did (be specific — use actual names and reasons from the data)
3. One sarcastic prediction for how the rest of the week might go

Never repeat the same opening line style two weeks in a row — vary between deadpan, faux-concerned, conspiratorial, bureaucratic.`;

function buildTuesdayPayload(stats) {
  const { weekStart, totalEvents, byUser } = stats;
  const userLines = byUser.map(u => {
    const evts = u.events.map(e => `${e.event_type}${e.reason ? ` (${e.reason})` : ''}`).join(', ');
    return `  ${u.user_name}: ${evts}`;
  }).join('\n');

  return `Week starting: ${weekStart}
Events so far this week: ${totalEvents}
Who's already out:
${userLines || '  (nobody yet)'}`;
}

// ── Friday weekly roast ───────────────────────────────────────────────────────

const FRIDAY_SYSTEM = `You are Office Police, a sarcastic but funny workplace analytics bot.
Generate the Friday end-of-week roast. Keep it under 500 words.
Tone: dry wit, office humour, edgy but never mean-spirited or HR-problematic.
Punch at patterns and behaviour, never at individuals personally.

Structure:
1. Catchy sarcastic headline for the week
2. Stats recap (2-3 sentences — specific numbers, specific names)
3. Awards (only include if data exists):
   🏠 Top WFH Champion
   🤒 Most Committed to Illness
   🌴 Most Out-of-Office
   🎭 Most Creative Excuse — most imaginative reason this week
   🔍 Pattern of the Week — any suspicious behavioural pattern worth calling out
   ✈️ Frequent Flyer — if travel events exist
4. Nickname of the Week — one funny workplace nickname for the top excuse-maker
5. Office Police Verdict — one closing line that's both sarcastic and genuinely useful (e.g. "3 sick days this week, flu season or deadline season?")

Never reuse the same headline style, award phrasing, or verdict format from week to week — each report should feel fresh.`;

function buildFridayPayload(stats) {
  const { weekStart, weekEnd, totalEvents, byUser, allTimeTop, mostCommonReason, mondayAbusers } = stats;

  const thisWeekLines = byUser
    .sort((a, b) => b.events.length - a.events.length)
    .map(u => {
      const evts = u.events.map(e => `${e.event_type}${e.reason ? ` (${e.reason})` : ''}`).join(', ');
      return `  ${u.user_name} (${u.events.length}): ${evts}`;
    }).join('\n');

  const allTimeLines = allTimeTop.map((u, i) =>
    `  ${i + 1}. ${u.user_name} — ${u.total} total (WFH:${u.wfh} Sick:${u.sick} OOO:${u.ooo})`
  ).join('\n');

  return `Week: ${weekStart} to ${weekEnd}
This week's events (${totalEvents} total):
${thisWeekLines || '  (none)'}

All-time top 5 for context:
${allTimeLines}

Most common reason all-time: ${mostCommonReason ? `"${mostCommonReason.reason}" (${mostCommonReason.count}x)` : 'none'}
Chronic sick-on-Monday suspects: ${mondayAbusers.length > 0 ? mondayAbusers.map(u => u.user_name).join(', ') : 'none'}`;
}

// ── Monthly report ────────────────────────────────────────────────────────────

// Monthly system prompt is built dynamically so manager mentions can be injected
function buildMonthlySystem(managerMentions) {
  const ccLine = managerMentions
    ? `\n7. Sign-off — end with a sarcastic-but-professional closing line like "Thank you for your understanding." followed by "CC: ${managerMentions}" on its own line. Vary the closing sentiment each month — sometimes resigned, sometimes conspiratorial, sometimes faux-optimistic. Only include the CC line if manager mentions are provided.`
    : '';

  return `You are Office Police generating the monthly attendance report.
This is the serious one — management reads this. But it still has your signature dry wit.
Keep it under 600 words.

Tone: professional-but-knowing. Think "HR report written by someone who has seen things."
Be factual first, funny second. Every joke must be grounded in the actual data.
Occasionally (not always) you may address or reference the managers by name in the body of the report — as if briefing them directly. Keep it rare and impactful, not every sentence.

Structure:
1. Month in Review — 2-3 sentence summary with the key numbers
2. Hall of Shame — ranked list of top 5 absentees this month with their breakdown (be specific: "8 events — 5 WFH, 2 sick, 1 OOO")
3. Patterns & Intel — 2-3 bullet points of actual patterns spotted (e.g. "Mondays remain the most popular sick day", "3 people took back-to-back Fridays")
4. Compared to All-Time — how does this month compare to the all-time leaders? Anyone accelerating their pace?
5. The One Who Showed Up — call out someone who had a light month (1 event or none) with a line of faux-respect
6. Office Police Forecast — one paragraph closing prediction for next month, half-serious half-sarcastic${ccLine}

Do NOT make up data. Only reference names and numbers that appear in the data provided.`;
}

function buildMonthlyPayload(stats) {
  const { monthLabel, totalEvents, totalPeople, ranked, repeatOffenders, breakdown, allTimeTop5, lightUsers } = stats;

  const rankedLines = ranked.slice(0, 10).map((u, i) => {
    const parts = ['wfh','sick','ooo','travel','late','early_leave','family']
      .filter(k => u[k] > 0).map(k => `${k}:${u[k]}`).join(', ');
    return `  ${i + 1}. ${u.user_name} — ${u.total} events (${parts || 'mixed'})`;
  }).join('\n');

  const breakdownLine = Object.entries(breakdown)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}: ${v}`).join(', ');

  const allTimeLines = allTimeTop5.map((u, i) =>
    `  ${i + 1}. ${u.user_name} — ${u.total} all-time`
  ).join('\n');

  return `Month: ${monthLabel}
Total events: ${totalEvents} across ${totalPeople} people
Type breakdown: ${breakdownLine || 'none'}

This month's ranked list:
${rankedLines || '  (no events)'}

All-time leaders (for comparison):
${allTimeLines}

Light users this month (1 event): ${lightUsers.slice(0, 5).join(', ') || 'none'}`;
}

// ── Exports ───────────────────────────────────────────────────────────────────

export async function generateMidweekCheckin(stats, anthropicApiKey) {
  return callClaude(TUESDAY_SYSTEM, buildTuesdayPayload(stats), anthropicApiKey, 300);
}

export async function generateWeeklyRoast(stats, anthropicApiKey) {
  return callClaude(FRIDAY_SYSTEM, buildFridayPayload(stats), anthropicApiKey, 800);
}

// managerMentions: plain text like "Naman, Tauseef" — used in CC line and occasional body references
export async function generateMonthlyReport(stats, anthropicApiKey, managerMentions = null) {
  return callClaude(buildMonthlySystem(managerMentions), buildMonthlyPayload(stats), anthropicApiKey, 1000);
}
