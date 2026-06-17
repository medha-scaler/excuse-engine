/**
 * Aggregator — builds stats payloads for weekly and monthly reports.
 * All queries use alias-merged identities so names are consistent.
 */

import { getLeaderboardWithBreakdown, getWeeklyStats, getMostCommonReason } from '../storage/db.js';

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

// Called on last day of month — covers the current month start to today
export function currentMonthWindow() {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    monthStart: firstOfMonth.toISOString().slice(0, 10),
    monthEnd: now.toISOString().slice(0, 10),
    monthLabel: now.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
  };
}

// Builds the weekly stats payload — uses alias-merged leaderboard for this week only
export async function buildWeeklySummary(db, weekStart, weekEnd) {
  const events = await getWeeklyStats(db, weekStart, weekEnd);

  // Group this week's events by merged identity
  const byName = {};
  for (const e of events) {
    const key = e.user_name?.toLowerCase() ?? e.user_id;
    if (!byName[key]) byName[key] = { user_name: e.user_name ?? e.user_id, events: [] };
    byName[key].events.push({ event_type: e.event_type, reason: e.reason });
  }

  // All-time merged leaderboard for context (top 5)
  const allTimeTop = await getLeaderboardWithBreakdown(db, 5);

  const mostCommonReason =
    (await getMostCommonReason(db, 'wfh')) ||
    (await getMostCommonReason(db, 'sick')) ||
    (await getMostCommonReason(db, 'ooo'));

  // Detect Monday sick patterns (all-time)
  const mondayAbusers = allTimeTop
    .filter(u => {
      // proxy: high sick count relative to total
      return u.sick >= 3;
    })
    .map(u => ({ user_name: u.user_name, sick: u.sick }));

  return {
    weekStart,
    weekEnd,
    totalEvents: events.length,
    byUser: Object.values(byName),
    allTimeTop,
    mostCommonReason,
    mondayAbusers,
  };
}

// Builds monthly stats — full ranked list with breakdowns, trends, repeat offenders
export async function buildMonthlySummary(db, monthStart, monthEnd, monthLabel) {
  const events = await getWeeklyStats(db, monthStart, monthEnd);

  // Group by merged identity
  const byName = {};
  for (const e of events) {
    const key = e.user_name?.toLowerCase() ?? e.user_id;
    if (!byName[key]) {
      byName[key] = {
        user_name: e.user_name ?? e.user_id,
        total: 0, wfh: 0, sick: 0, ooo: 0, travel: 0, late: 0, early_leave: 0, family: 0,
        reasons: [],
      };
    }
    const u = byName[key];
    u.total++;
    if (e.event_type in u) u[e.event_type]++;
    if (e.reason) u.reasons.push(e.reason);
  }

  const ranked = Object.values(byName).sort((a, b) => b.total - a.total);

  // All-time leaderboard for comparison context
  const allTime = await getLeaderboardWithBreakdown(db, 999);

  // Repeat offenders = top 5 this month
  const repeatOffenders = ranked.slice(0, 5);

  // Most improved = people in bottom half all-time but not in top 5 this month
  // (proxy: appeared this month with only 1 event)
  const lightUsers = ranked.filter(u => u.total === 1).map(u => u.user_name);

  // Type breakdown for the month
  const breakdown = { wfh: 0, sick: 0, ooo: 0, travel: 0, late: 0, early_leave: 0, family: 0 };
  for (const u of ranked) {
    for (const k of Object.keys(breakdown)) breakdown[k] += u[k] ?? 0;
  }

  return {
    monthLabel,
    monthStart,
    monthEnd,
    totalEvents: events.length,
    totalPeople: ranked.length,
    ranked,
    repeatOffenders,
    lightUsers,
    breakdown,
    allTimeTop5: allTime.slice(0, 5),
  };
}
