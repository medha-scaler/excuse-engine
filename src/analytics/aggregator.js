/**
 * Aggregator — behavioral analytics over stored attendance events.
 *
 * All functions are thin wrappers around the DB query layer.
 * No business logic lives here beyond formatting and aggregation shape.
 */

import {
  getLeaderboard as dbLeaderboard,
  getEventTypeBreakdown as dbBreakdown,
  getWeeklyStats as dbWeekly,
  getUserStreak as dbStreak,
  getMostLoyalUser as dbMostLoyal,
  getMostCommonReason as dbMostCommonReason,
  getUserWeekdayCount,
} from '../storage/db.js';

/**
 * Top excuse-makers by total event count.
 *
 * @param {number} [limit=5] - How many users to return
 * @returns {Array<{ user_id, user_name, excuse_count }>}
 */
function getLeaderboard(limit = 5) {
  return dbLeaderboard(limit);
}

/**
 * Count of events grouped by event_type.
 *
 * @returns {Array<{ event_type, count }>}
 */
function getEventTypeBreakdown() {
  return dbBreakdown();
}

/**
 * All events that occurred within a calendar week window.
 *
 * @param {string} weekStart - ISO date string for the start of the week (Monday)
 * @param {string} weekEnd   - ISO date string for the end of the week (Sunday)
 * @returns {Array<object>} Raw attendance_events rows
 */
function getWeeklyStats(weekStart, weekEnd) {
  return dbWeekly(weekStart, weekEnd);
}

/**
 * Number of consecutive days a user has posted an attendance event (streak).
 *
 * @param {string} userId - Slack user ID
 * @returns {number} Current streak length in days
 */
function getUserStreak(userId) {
  return dbStreak(userId);
}

/**
 * Build a rich stats object suitable for passing to the AI roast generator.
 *
 * @param {string} weekStart
 * @param {string} weekEnd
 * @returns {object} Aggregated stats bundle
 */
function buildWeeklySummary(weekStart, weekEnd) {
  const events = getWeeklyStats(weekStart, weekEnd);
  const leaderboard = getLeaderboard(5);
  const breakdown = getEventTypeBreakdown();

  // Per-user event list for narrative richness
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

  // Detect Monday sick pattern across all users
  const mondayPatterns = [];
  for (const user of Object.values(byUser)) {
    const { count } = getUserWeekdayCount(user.user_id, 1);
    if (count >= 3) {
      mondayPatterns.push({ user_id: user.user_id, user_name: user.user_name, count });
    }
  }

  return {
    weekStart,
    weekEnd,
    totalEvents: events.length,
    leaderboard,
    breakdown,
    byUser: Object.values(byUser),
    mostLoyal: dbMostLoyal(),
    mostCommonReason: dbMostCommonReason('wfh') || dbMostCommonReason('sick') || dbMostCommonReason('late'),
    mondayPatterns,
  };
}

export { getLeaderboard, getEventTypeBreakdown, getWeeklyStats, getUserStreak, buildWeeklySummary };
