/**
 * Aggregator — Workers version. All async, accepts db binding.
 */

import {
  getLeaderboard,
  getEventTypeBreakdown,
  getWeeklyStats,
  getMostLoyalUser,
  getMostCommonReason,
  getUserWeekdayCount,
} from '../storage/db.js';

export function currentWeekWindow() {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  const monday = new Date(now);
  monday.setDate(now.getDate() - diffToMonday);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return {
    weekStart: monday.toISOString().slice(0, 10),
    weekEnd: sunday.toISOString().slice(0, 10),
  };
}

export async function buildWeeklySummary(db, weekStart, weekEnd) {
  const events = await getWeeklyStats(db, weekStart, weekEnd);
  const leaderboard = await getLeaderboard(db, 5);
  const breakdown = await getEventTypeBreakdown(db);
  const mostLoyal = await getMostLoyalUser(db);
  const mostCommonReason =
    (await getMostCommonReason(db, 'wfh')) ||
    (await getMostCommonReason(db, 'sick')) ||
    (await getMostCommonReason(db, 'late'));

  const byUser = {};
  for (const event of events) {
    if (!byUser[event.user_id]) {
      byUser[event.user_id] = {
        user_id: event.user_id,
        user_name: event.user_name ?? event.user_id,
        events: [],
      };
    }
    byUser[event.user_id].events.push({
      event_type: event.event_type,
      reason: event.reason,
      sentiment: event.sentiment,
    });
  }

  // Monday sick patterns
  const mondayPatterns = [];
  for (const user of Object.values(byUser)) {
    const row = await getUserWeekdayCount(db, user.user_id, 1);
    if (row.count >= 3) {
      mondayPatterns.push({ user_id: user.user_id, user_name: user.user_name, count: row.count });
    }
  }

  return {
    weekStart,
    weekEnd,
    totalEvents: events.length,
    leaderboard,
    breakdown,
    byUser: Object.values(byUser),
    mostLoyal,
    mostCommonReason,
    mondayPatterns,
  };
}
