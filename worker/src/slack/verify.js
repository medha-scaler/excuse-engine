/**
 * Slack request signature verification — replaces @slack/bolt's built-in check.
 * Uses the Web Crypto API available in Cloudflare Workers.
 */

/**
 * Verify a Slack request signature given the raw body string (already read).
 * Accepts rawBody so the caller can reuse it for JSON parsing.
 */
export async function verifySlackSignature(request, signingSecret, rawBody) {
  const timestamp = request.headers.get('x-slack-request-timestamp');
  const signature = request.headers.get('x-slack-signature');

  if (!timestamp || !signature) return false;

  // Reject requests older than 5 minutes (replay attack prevention)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 300) return false;

  const sigBaseString = `v0:${timestamp}:${rawBody}`;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(sigBaseString));
  const hex = Array.from(new Uint8Array(signatureBytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const computedSig = `v0=${hex}`;
  return computedSig === signature;
}
