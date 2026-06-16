/**
 * server.js — Entry point.
 *
 * Responsibilities:
 *   1. Load environment variables
 *   2. Initialise the SQLite schema
 *   3. Create and configure the Slack Bolt app
 *   4. Wire up message event listeners (with attendance pre-filter)
 *   5. Initialise the Slack poster
 *   6. Start the weekly roast cron job
 *   7. Start the HTTP server (or socket mode, depending on env)
 */

import 'dotenv/config';
import pkg from '@slack/bolt';
const { App, LogLevel } = pkg;

import { initSchema } from './storage/db.js';
import { isAttendanceMessage } from './processing/classifier.js';
import { runPipeline } from './processing/pipeline.js';
import { init as initPoster } from './slack/poster.js';
import { scheduleRoastJob } from './jobs/roastJob.js';
import { maybeSnarky } from './jobs/snarkyJob.js';

// ── Schema ───────────────────────────────────────────────────────────────────

initSchema();
console.log('[server] SQLite schema initialised');

// ── Validate required env vars ───────────────────────────────────────────────

const REQUIRED = ['SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET'];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[server] Missing required environment variables: ${missing.join(', ')}`);
  console.error('[server] Copy .env.example to .env and fill in your credentials.');
  process.exit(1);
}

// ── Bolt app configuration ───────────────────────────────────────────────────

const useSocketMode = Boolean(process.env.SLACK_APP_TOKEN);

const appConfig = {
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  logLevel: process.env.NODE_ENV === 'development' ? LogLevel.DEBUG : LogLevel.INFO,
};

if (useSocketMode) {
  appConfig.socketMode = true;
  appConfig.appToken = process.env.SLACK_APP_TOKEN;
} else {
  // HTTP mode — Bolt manages its own Express receiver by default
  appConfig.port = parseInt(process.env.PORT ?? '3000', 10);
}

const app = new App(appConfig);

// ── Initialise dependent modules ─────────────────────────────────────────────

initPoster(app);

// ── Event listeners ───────────────────────────────────────────────────────────

/**
 * Listen to all incoming messages.
 *
 * Pre-filter: only run the ETL pipeline when the text contains at least one
 * attendance-related keyword. This avoids polluting the DB with unrelated chat.
 */
app.message(async ({ message, say }) => {
  // Ignore bot messages, message edits/deletions, and sub-types
  if (message.subtype) return;
  if (message.bot_id) return;

  const text = message.text ?? '';

  // Cheap pre-filter — avoids Gemini calls for obvious non-attendance messages
  if (!isAttendanceMessage(text)) return;

  try {
    const pipelineResult = await runPipeline(message);

    // Gemini said not attendance-related — discard silently
    if (!pipelineResult) return;

    const { transformed, result } = pipelineResult;
    console.log(
      `[server] Ingested — user: ${transformed.user_id}, type: ${transformed.event_type}, reason: ${transformed.reason ?? 'none'}, id: ${result.lastInsertRowid}`
    );
    maybeSnarky(transformed, process.env.SLACK_CHANNEL_ID).catch(() => {});
  } catch (err) {
    console.error('[server] Pipeline error:', err.message);
  }
});

// ── Cron jobs ─────────────────────────────────────────────────────────────────

scheduleRoastJob();

// ── Start ─────────────────────────────────────────────────────────────────────

(async () => {
  const port = parseInt(process.env.PORT ?? '3000', 10);

  if (useSocketMode) {
    await app.start();
    console.log(`[server] Slack Bolt app running in Socket Mode`);
  } else {
    await app.start(port);
    console.log(`[server] Slack Bolt app running on port ${port}`);
  }

  console.log('[server] Office Police is on duty');
})();
