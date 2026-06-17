/**
 * Alerts — DMed to admin user (SLACK_ALERT_USER_ID), falls back to channel.
 */

const ALERT_TYPES = {
  CLAUDE_ERROR:       { emoji: '🔴', label: 'Claude API Error' },
  DB_ERROR:           { emoji: '🗄️', label: 'Database Error' },
  CRON_FAILURE:       { emoji: '⏰', label: 'Cron Job Failed' },
  PIPELINE_ERROR:     { emoji: '🔧', label: 'Pipeline Error' },
  SLACK_POST_ERROR:   { emoji: '📢', label: 'Slack Post Failed' },
};

export async function sendAlert(type, message, botToken, channelId, extra = {}, alertUserId = null) {
  if (!botToken) return;

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
      elements: [{ type: 'mrkdwn', text: `_${new Date().toISOString()} · Office Police System_` }],
    },
  ];

  // DM the admin directly; fall back to channel if not configured
  const target = alertUserId ?? channelId;

  try {
    await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${botToken}` },
      body: JSON.stringify({ channel: target, text: `${alert.emoji} ${alert.label}: ${message}`, blocks }),
    });
  } catch {
    console.error(`[alerts] Failed to post alert: ${type} — ${message}`);
  }
}

export async function withAlert(fn, alertType, botToken, channelId, extra = {}) {
  try {
    return await fn();
  } catch (err) {
    await sendAlert(alertType, err.message, botToken, channelId, extra);
    throw err;
  }
}
