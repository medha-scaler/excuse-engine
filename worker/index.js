/**
 * Office Police — Cloudflare Workers entry point.
 *
 * Handles two execution contexts:
 *   1. fetch()   — HTTP requests from Slack (Events API webhooks)
 *   2. scheduled() — Cron triggers (Tuesday 10:00, Friday 17:00 UTC)
 */

import { verifySlackSignature } from './src/slack/verify.js';
import { runPipeline } from './src/processing/pipeline.js';
import { maybeSnarky } from './src/jobs/snarkyJob.js';
import { buildWeeklySummary, currentWeekWindow } from './src/analytics/aggregator.js';
import { generateWeeklyRoast, generateMidweekCheckin } from './src/ai/generator.js';
import { postRoast } from './src/slack/poster.js';
import { insertRoast, initSchema, seedAliases } from './src/storage/db.js';
import { passesCheapFilter } from './src/processing/classifier.js';
import { sendAlert } from './src/slack/alerts.js';
import { handleLeaderboard, handleLeaderboardFull, handleMyStats } from './src/slack/commands.js';

export default {
  // ── HTTP handler — Slack Events API ────────────────────────────────────────
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('Office Police is on duty.', { status: 200 });
    }

    // Read raw body once — reuse for both signature verification and JSON parsing
    const rawBody = await request.text();
    const isValid = await verifySlackSignature(request, env.SLACK_SIGNING_SECRET, rawBody);
    if (!isValid) {
      return new Response('Unauthorized', { status: 401 });
    }

    // ── Slash commands — must check before JSON.parse (body is url-encoded) ────
    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const params  = new URLSearchParams(rawBody);
      const command = params.get('command');
      const userId  = params.get('user_id');
      const userName = params.get('user_name');

      const responseUrl = params.get('response_url');

      if (command === '/leaderboard') {
        ctx.waitUntil(
          handleLeaderboard(env.DB).then(payload =>
            fetch(responseUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...payload, replace_original: true }),
            })
          )
        );
        return new Response(JSON.stringify({ response_type: 'in_channel', text: '📊 Loading leaderboard...' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (command === '/full-leaderboard') {
        ctx.waitUntil(
          handleLeaderboardFull(env.DB).then(payload =>
            fetch(responseUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...payload, replace_original: true }),
            })
          )
        );
        return new Response(JSON.stringify({ response_type: 'in_channel', text: '📊 Loading full leaderboard...' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (command === '/my-stats') {
        ctx.waitUntil(
          handleMyStats(env.DB, userId, userName).then(payload =>
            fetch(responseUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...payload, replace_original: true }),
            })
          )
        );
        return new Response(JSON.stringify({ response_type: 'ephemeral', text: '🔍 Fetching your stats...' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Unknown command', { status: 400 });
    }

    const body = JSON.parse(rawBody);

    // Slack URL verification challenge (one-time setup)
    if (body.type === 'url_verification') {
      return new Response(JSON.stringify({ challenge: body.challenge }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Handle message events
    if (body.event?.type === 'message') {
      const event = body.event;

      // Ignore bots and subtypes (edits, joins, etc.)
      if (event.subtype || event.bot_id || !event.user) {
        return new Response('ok');
      }

      const text = event.text ?? '';
      if (!passesCheapFilter(text)) {
        return new Response('ok');
      }

      // Slack requires a 200 response within 3 seconds.
      // Use waitUntil to process async without blocking the response.
      // Build a bound alert function so subsystems don't need to carry env around
      const alert = (type, message, extra) =>
        sendAlert(type, message, env.SLACK_BOT_TOKEN, env.SLACK_CHANNEL_ID, extra, env.SLACK_ALERT_USER_ID);

      ctx.waitUntil(
        (async () => {
          try {
            await initSchema(env.DB);
            const result = await runPipeline(event, env.DB, env.ANTHROPIC_API_KEY, env.SLACK_CHANNEL_ID, alert, env.SLACK_BOT_TOKEN);
            if (result) {
              console.log(`[worker] Ingested — user: ${result.transformed.user_id}, type: ${result.transformed.event_type}`);
              const p = parseFloat(env.SNARKY_PROBABILITY ?? '0.3');
              await maybeSnarky(result.transformed, env.SLACK_CHANNEL_ID, env.DB, env.SLACK_BOT_TOKEN, env.ANTHROPIC_API_KEY, isNaN(p) ? 0.3 : p);
            }
          } catch (err) {
            console.error('[worker] Pipeline error:', err.message);
            await alert('PIPELINE_ERROR', err.message);
          }
        })()
      );
    }

    return new Response('ok');
  },

  // ── Cron handler — Tuesday + Friday ────────────────────────────────────────
  async scheduled(event, env) {
    const cronExpr = event.cron;
    console.log(`[worker] Cron triggered: ${cronExpr}`);

    await initSchema(env.DB);

    const { weekStart, weekEnd } = currentWeekWindow();
    const channelId = env.SLACK_CHANNEL_ID;

    const alert = (type, message, extra) =>
      sendAlert(type, message, env.SLACK_BOT_TOKEN, channelId, extra);

    try {
      const stats = await buildWeeklySummary(env.DB, weekStart, weekEnd);

      // Tuesday 10:00 — midweek check-in
      if (cronExpr === '0 10 * * 2') {
        if (stats.totalEvents === 0) {
          await postRoast(channelId, "It's Tuesday. Zero attendance events so far. Either everyone is working, or they've gotten better at hiding. Office Police is watching either way.", env.SLACK_BOT_TOKEN, 'tuesday');
          return;
        }
        const text = await generateMidweekCheckin(stats, env.ANTHROPIC_API_KEY);
        await insertRoast(env.DB, { week_start: weekStart, week_end: weekEnd, roast_text: text, channel_id: channelId });
        await postRoast(channelId, text, env.SLACK_BOT_TOKEN, 'tuesday');
        console.log('[worker] Tuesday check-in posted');
      }

      // Friday 17:00 — full weekly roast
      if (cronExpr === '0 17 * * 5') {
        if (stats.totalEvents === 0) {
          await postRoast(channelId, "Week's over. Zero documented excuses. Office Police is filing this under 'suspicious'. See you Monday — if you show up.", env.SLACK_BOT_TOKEN, 'friday');
          return;
        }
        const text = await generateWeeklyRoast(stats, env.ANTHROPIC_API_KEY);
        await insertRoast(env.DB, { week_start: weekStart, week_end: weekEnd, roast_text: text, channel_id: channelId });
        await postRoast(channelId, text, env.SLACK_BOT_TOKEN, 'friday');
        console.log('[worker] Friday roast posted');
      }
    } catch (err) {
      console.error('[worker] Cron job error:', err.message);
      await alert('CRON_FAILURE', err.message, { cron: cronExpr });
    }
  },
};
