/**
 * Slash Commands
 *   /leaderboard       — top 10, posted to channel
 *   /leaderboard-full  — all people, posted to channel
 *   /mystats           — personal stats, ephemeral
 */

import {
  getLeaderboardWithBreakdown,
  getTopReasonsByPerson,
  getEventTypeBreakdown,
  getMyStats,
} from '../storage/db.js';

// ── Shared leaderboard builder ────────────────────────────────────────────────

async function buildLeaderboardPayload(db, limit) {
  const leaderboard  = await getLeaderboardWithBreakdown(db, limit);
  const reasonsByKey = await getTopReasonsByPerson(db, 3);
  const breakdown    = await getEventTypeBreakdown(db);

  if (leaderboard.length === 0) {
    return ephemeral('No attendance events logged yet. The office is either very dedicated or very sneaky.');
  }

  const medals = ['🥇', '🥈', '🥉'];

  const personBlocks = leaderboard.map((u, i) => {
    const medal = medals[i] ?? `${i + 1}.`;
    const name  = u.user_name ? `*${u.user_name}*` : `_(unknown)_`;

    // Type counts — skip zeros
    const typeParts = [
      u.wfh        && `${eventEmoji('wfh')} WFH ×${u.wfh}`,
      u.sick        && `${eventEmoji('sick')} Sick ×${u.sick}`,
      u.ooo         && `${eventEmoji('ooo')} OOO ×${u.ooo}`,
      u.travel      && `${eventEmoji('travel')} Travel ×${u.travel}`,
      u.late        && `${eventEmoji('late')} Late ×${u.late}`,
      u.early_leave && `${eventEmoji('early_leave')} Early leave ×${u.early_leave}`,
      u.family      && `${eventEmoji('family')} Family ×${u.family}`,
    ].filter(Boolean).join('  ·  ');

    // Top reasons for this person
    const nameKey = (u.user_name || '').toLowerCase();
    const reasons = reasonsByKey[nameKey] ?? [];
    const reasonLine = reasons.length
      ? reasons.map(r => `_"${r.reason}"_ ×${r.count}`).join('  ·  ')
      : '';

    const lines = [
      `${medal} ${name} — *${u.total}* event${u.total !== 1 ? 's' : ''}`,
      typeParts   ? `   ${typeParts}` : null,
      reasonLine  ? `   📝 ${reasonLine}` : null,
    ].filter(Boolean).join('\n');

    return { type: 'section', text: { type: 'mrkdwn', text: lines } };
  });

  const breakdownLine = breakdown
    .map(b => `${eventEmoji(b.event_type)} ${b.event_type}: ${b.count}`)
    .join('  ·  ');

  const title = limit <= 10
    ? '🚔 Office Police — Top 10 Leaderboard'
    : `🚔 Office Police — Full Leaderboard (${leaderboard.length} people)`;

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: title, emoji: true } },
    ...personBlocks,
    { type: 'divider' },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `*Team totals:*  ${breakdownLine || 'no data'}` }],
    },
  ];

  return { response_type: 'in_channel', blocks, text: title };
}

// ── /leaderboard — top 10 ─────────────────────────────────────────────────────

export async function handleLeaderboard(db) {
  return buildLeaderboardPayload(db, 10);
}

// ── /leaderboard-full — everyone ──────────────────────────────────────────────

export async function handleLeaderboardFull(db) {
  return buildLeaderboardPayload(db, 999);
}

// ── /mystats ──────────────────────────────────────────────────────────────────

export async function handleMyStats(db, userId, userName) {
  const { events, displayName, total, rank, totalPeople, streak, wfh, sick, ooo, travel, late, early_leave, family } = await getMyStats(db, userId);

  if (total === 0) {
    return ephemeral("You have zero attendance events logged. Either you're the most dedicated person here, or the bot missed something. Either way — impressive.");
  }

  // Type breakdown — same counts as leaderboard
  const typeParts = [
    wfh         && `${eventEmoji('wfh')} WFH ×${wfh}`,
    sick        && `${eventEmoji('sick')} Sick ×${sick}`,
    ooo         && `${eventEmoji('ooo')} OOO ×${ooo}`,
    travel      && `${eventEmoji('travel')} Travel ×${travel}`,
    late        && `${eventEmoji('late')} Late ×${late}`,
    early_leave && `${eventEmoji('early_leave')} Early leave ×${early_leave}`,
    family      && `${eventEmoji('family')} Family ×${family}`,
  ].filter(Boolean).join('  ·  ');

  // Top reasons from actual events
  const reasonCount = {};
  for (const e of events) {
    if (e.reason) reasonCount[e.reason] = (reasonCount[e.reason] ?? 0) + 1;
  }
  const reasonLines = Object.entries(reasonCount)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([r, c], i) => `${i + 1}. _"${r}"_ — ${c}×`)
    .join('\n') || 'No specific reasons recorded';

  const recentLines = events.slice(0, 5)
    .map(e => `• ${eventEmoji(e.event_type)} ${e.event_type}${e.reason ? ` — _${e.reason}_` : ''} on ${new Date(e.timestamp).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`)
    .join('\n');

  const mondayCount = events.filter(e => new Date(e.timestamp).getDay() === 1).length;
  const fridayCount = events.filter(e => new Date(e.timestamp).getDay() === 5).length;

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `🚔 Your Office Police File — ${displayName}`, emoji: true } },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Total events logged*\n${total}` },
        { type: 'mrkdwn', text: `*Leaderboard rank*\n${rank > 0 ? `#${rank} of ${totalPeople}` : 'Unranked'}` },
        { type: 'mrkdwn', text: `*Longest streak*\n${streak} consecutive day${streak !== 1 ? 's' : ''}` },
        { type: 'mrkdwn', text: `*Monday absences*\n${mondayCount} time${mondayCount !== 1 ? 's' : ''}` },
        { type: 'mrkdwn', text: `*Friday absences*\n${fridayCount} time${fridayCount !== 1 ? 's' : ''}` },
      ],
    },
    { type: 'divider' },
    { type: 'section', text: { type: 'mrkdwn', text: `*By type*\n${typeParts || 'no data'}` } },
    { type: 'section', text: { type: 'mrkdwn', text: `*Top reasons given*\n${reasonLines}` } },
    { type: 'section', text: { type: 'mrkdwn', text: `*Recent activity*\n${recentLines}` } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: '_Only visible to you · Office Police_' }] },
  ];

  return { response_type: 'ephemeral', blocks, text: 'Your Office Police stats' };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ephemeral(text) {
  return { response_type: 'ephemeral', text };
}

function eventEmoji(type) {
  const map = {
    wfh: '🏠', ooo: '🌴', sick: '🤒', late: '🕐',
    early_leave: '🏃', travel: '✈️', family: '👨‍👩‍👧', unknown: '❓',
  };
  return map[type] ?? '📋';
}
