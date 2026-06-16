/**
 * Roast Job — two periodic syncs per week.
 *
 * Tuesday 10:00 — midweek check-in: early patterns, who's already racking up excuses
 * Friday  17:00 — full weekly roast: awards, leaderboard, nicknames, lore
 */

import cron from 'node-cron';
import { buildWeeklySummary } from '../analytics/aggregator.js';
import { generateWeeklyRoast, generateMidweekCheckin } from '../ai/generator.js';
import { postRoast } from '../slack/poster.js';
import { insertRoast } from '../storage/db.js';

/**
 * ISO date strings for Monday→Sunday of the current calendar week.
 */
function currentWeekWindow() {
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

/**
 * Tuesday midweek check-in — shorter, more observational.
 * "It's only Tuesday and @alex has already filed 2 events. Pace yourself."
 */
async function executeMidweekCheckin() {
  const channelId = process.env.SLACK_CHANNEL_ID;
  if (!channelId) return;

  const { weekStart, weekEnd } = currentWeekWindow();
  console.log(`[roastJob] Generating midweek check-in for ${weekStart}`);

  try {
    const stats = buildWeeklySummary(weekStart, weekEnd);

    if (stats.totalEvents === 0) {
      await postRoast(
        channelId,
        "It's Tuesday. Zero attendance events so far this week. Either everyone is actually working, or they've gotten better at hiding. Office Police is watching either way."
      );
      return;
    }

    const checkinText = await generateMidweekCheckin(stats);
    insertRoast({ week_start: weekStart, week_end: weekEnd, roast_text: checkinText, channel_id: channelId });
    await postRoast(channelId, checkinText, 'tuesday');
    console.log('[roastJob] Midweek check-in posted');
  } catch (err) {
    console.error('[roastJob] Midweek check-in failed:', err.message);
  }
}

/**
 * Friday full roast — awards, leaderboard, nicknames, lore, Employee of the Week.
 */
async function executeWeeklyRoast() {
  const channelId = process.env.SLACK_CHANNEL_ID;
  if (!channelId) {
    console.error('[roastJob] SLACK_CHANNEL_ID is not set — skipping roast');
    return;
  }

  const { weekStart, weekEnd } = currentWeekWindow();
  console.log(`[roastJob] Generating Friday roast for week ${weekStart} → ${weekEnd}`);

  try {
    const stats = buildWeeklySummary(weekStart, weekEnd);

    if (stats.totalEvents === 0) {
      await postRoast(
        channelId,
        "Week's over. Zero documented excuses. Office Police is filing this under 'suspicious'. See you Monday — if you show up."
      );
      return;
    }

    const roastText = await generateWeeklyRoast(stats);
    insertRoast({ week_start: weekStart, week_end: weekEnd, roast_text: roastText, channel_id: channelId });
    await postRoast(channelId, roastText);
    console.log('[roastJob] Friday roast posted successfully');
  } catch (err) {
    console.error('[roastJob] Friday roast failed:', err.message);
  }
}

/**
 * Register both cron jobs.
 */
function scheduleRoastJob() {
  // Tuesday at 10:00
  cron.schedule('0 10 * * 2', async () => {
    console.log('[roastJob] Tuesday check-in triggered');
    await executeMidweekCheckin();
  });

  // Friday at 17:00
  cron.schedule('0 17 * * 5', async () => {
    console.log('[roastJob] Friday roast triggered');
    await executeWeeklyRoast();
  });

  console.log('[roastJob] Scheduled — Tuesday 10:00 (midweek check-in) + Friday 17:00 (weekly roast)');
}

export { scheduleRoastJob, executeWeeklyRoast, executeMidweekCheckin, currentWeekWindow };
