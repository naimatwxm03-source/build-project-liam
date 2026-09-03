/**
 * Telegram Bot API proxy — Cloudflare Worker
 *
 * WHY THIS EXISTS
 * The Timeweb VPS cannot reach api.telegram.org directly. n8n hangs on the
 * outbound call, Cloudflare times out waiting for n8n, and the browser sees
 * "Request failed with status code 504" when publishing a workflow. Nothing
 * is wrong with the workflow — the request never leaves the box.
 *
 * This Worker forwards every request verbatim to api.telegram.org and returns
 * the response unchanged. Cloudflare's edge reaches Telegram fine.
 *
 * HOW n8n USES IT
 * n8n builds requests as {baseUrl}/bot{token}/{method}, and downloads files
 * from {baseUrl}/file/bot{token}/{file_path}. Because this Worker forwards
 * the whole path untouched, both work with no special handling — which
 * matters for the receipt bot, since every photo arrives via /file/.
 *
 * SETUP
 *   1. Deploy this as a Worker (e.g. edrus-telegram)
 *   2. In n8n → Credentials → your Telegram credential → Base URL:
 *        https://<worker-name>.<subdomain>.workers.dev
 *      No trailing slash, no /bot suffix — n8n appends that itself.
 *   3. Save. The credential test hits /getMe through the Worker.
 *
 * NOTE ON ABUSE
 * A public workers.dev URL is reachable by anyone, but every Telegram call
 * still requires a valid bot token, so this cannot be used to control your
 * bot. The realistic risk is someone burning your Worker request quota. If
 * that matters, add a custom domain with a WAF rule, or check a shared
 * secret header here and set it in n8n's credential.
 */

const UPSTREAM = 'https://api.telegram.org';

// Headers Cloudflare adds or that are connection-scoped. Forwarding them
// upstream is at best noise and at worst causes Telegram to reject the call.
const STRIP = [
  'host',
  'cf-connecting-ip',
  'cf-ipcountry',
  'cf-ray',
  'cf-visitor',
  'cf-worker',
  'x-forwarded-for',
  'x-forwarded-proto',
  'x-real-ip',
];

export default {
  async fetch(request) {
    const incoming = new URL(request.url);

    // Path and query pass through untouched: /bot<token>/sendMessage,
    // /file/bot<token>/photos/file_1.jpg, etc.
    const target = new URL(incoming.pathname + incoming.search, UPSTREAM);

    const headers = new Headers(request.headers);
    for (const h of STRIP) headers.delete(h);

    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';

    let upstream;
    try {
      upstream = await fetch(target, {
        method: request.method,
        headers,
        // Streaming the body preserves multipart/form-data uploads (sendPhoto,
        // sendDocument) without buffering the whole file in the Worker.
        body: hasBody ? request.body : undefined,
        redirect: 'follow',
      });
    } catch (err) {
      // Shape the failure like a Telegram error so n8n surfaces something
      // readable instead of an opaque parse failure.
      return new Response(
        JSON.stringify({
          ok: false,
          error_code: 502,
          description: `Proxy could not reach Telegram: ${err.message}`,
        }),
        { status: 502, headers: { 'content-type': 'application/json' } },
      );
    }

    // Return the response as-is. Streaming the body matters for file
    // downloads — receipt photos are binary and must not be re-encoded.
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: upstream.headers,
    });
  },
};
