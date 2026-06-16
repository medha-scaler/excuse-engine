/**
 * Alerts — posts system alerts to a Slack channel.
 * Used to surface rate limits, DB errors, and cron failures without
 * needing an external monitoring service.
 */

const ALERT_TYPES = {
  GEMINI_RATE_LIMIT:  { emoji: '⚠️', label: 'Gemini Rate Limit Hit' },
  GEMINI_ERROR:       { emoji: '🔴', label: 'Gemini API Error' },
  DB_ERROR:           { emoji: '🗄️', label: 'Database Error' },
  CRON_FAILURE:       { emoji: '⏰', label: 'Cron Job Failed' },
  PIPELINE_ERROR:     { emoji: '🔧', label: 'Pipeline Error' },
  SLACK_POST_ERROR:   { emoji: '📢', label: 'Slack Post Failed' },
};

/**
 * Post an alert to Slack.
 *
 * @param {string} type        - Key from ALERT_TYPES
 * @param {string} message     - What went wrong
 * @param {string} botToken
 * @param {string} channelId
 * @param {object} [extra]     - Optional extra context (e.g. { user_id, event_type })
 */
export async function sendAlert(type, message, botToken, channelId, extra = {}) {
  if (!botToken || !channelId) return;

  const alert = ALERT_TYPES[type] ?? { emoji: '🔔', label: type };

  const extraLines = Object.entries(extra)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `• *${k}:* ${v}`)
    .join('\n');

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${alert.emoji} *Office Police Alert — ${alert.label}*\n\`\`\`${message}\`\`\`${extraLines ? `\n${extraLines}` : ''}`,
      },
    },
    {
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: `_${new Date().toISOString()} · Office Police System_`,
      }],
    },
  ];

  try {
    await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${botToken}`,
      },
      body: JSON.stringify({
        channel: channelId,
        text: `${alert.emoji} ${alert.label}: ${message}`,
        blocks,
      }),
    });
  } catch {
    // If the alert itself fails, log to console — don't create an infinite loop
    console.error(`[alerts] Failed to post alert: ${type} — ${message}`);
  }
}

/**
 * Wrap an async function and alert on any thrown error.
 *
 * @param {Function} fn          - Async function to run
 * @param {string}   alertType   - ALERT_TYPES key to use on failure
 * @param {string}   botToken
 * @param {string}   channelId
 * @param {object}   [extra]     - Extra context to include in the alert
 */
export async function withAlert(fn, alertType, botToken, channelId, extra = {}) {
  try {
    return await fn();
  } catch (err) {
    await sendAlert(alertType, err.message, botToken, channelId, extra);
    throw err;
  }
}
