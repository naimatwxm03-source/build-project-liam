/**
 * Inbound webhook proxy — Telegram → Cloudflare → n8n
 *
 * WHY THIS EXISTS
 * Telegram cannot reliably reach the Timeweb VPS. getWebhookInfo reports:
 *   "last_error_message": "Connection timed out"
 *   "ip_address": "5.42.99.81"     ← Telegram is dialling the Russian IP directly
 * Registration succeeds, delivery does not. Messages queue in
 * pending_update_count and arrive minutes late or never.
 *
 * This Worker gives Telegram a Cloudflare address to POST to instead. The
 * edge is reachable from Telegram's network, and Cloudflare's path to the
 * origin does not suffer the same throttling.
 *
 *   Telegram → tg-in.<subdomain>.workers.dev/webhook/<id>/webhook
 *            → https://n8n.n-enterprise.ru/webhook/<id>/webhook
 *
 * This is the mirror of cloudflare-worker-telegram-proxy.js, which fixes the
 * outbound direction (n8n → Telegram). Both are needed: the throttling is
 * symmetric.
 *
 * SETUP
 *   1. Deploy as a Worker named tg-in
 *   2. On the VPS, in docker-compose.yml:
 *        WEBHOOK_URL=https://tg-in.<subdomain>.workers.dev/
 *      then: docker compose up -d
 *   3. In n8n: Unpublish the workflow, wait, Publish again.
 *      n8n now registers the Worker URL with Telegram instead of the VPS.
 *
 * NOTE
 * WEBHOOK_URL is global to n8n, so every workflow's webhooks route through
 * here — which is what you want, since they all share the same problem.
 */

const ORIGIN = 'https://n8n.n-enterprise.ru';

// Connection-scoped and Cloudflare-injected headers. Forwarding them to the
// origin confuses n8n's proxy-hop handling.
const STRIP = ['host', 'cf-ray', 'cf-visitor', 'cf-worker', 'cf-ipcountry'];

export default {
  async fetch(request) {
    const incoming = new URL(request.url);

    // Only proxy webhook paths. Everything else gets 404 rather than exposing
    // the whole n8n editor through a public workers.dev URL.
    const allowed = ['/webhook/', '/webhook-test/', '/webhook-waiting/'];
    if (!allowed.some((p) => incoming.pathname.startsWith(p))) {
      return new Response('Not found', { status: 404 });
    }

    const target = new URL(incoming.pathname + incoming.search, ORIGIN);

    const headers = new Headers(request.headers);
    for (const h of STRIP) headers.delete(h);
    // Preserve the caller's IP for n8n's logs; N8N_PROXY_HOPS accounts for it.
    headers.set('x-forwarded-for', request.headers.get('cf-connecting-ip') || '');
    headers.set('x-forwarded-proto', 'https');

    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';

    try {
      const upstream = await fetch(target, {
        method: request.method,
        headers,
        body: hasBody ? request.body : undefined,
        redirect: 'manual', // n8n should not be redirecting a webhook POST
      });

      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: upstream.headers,
      });
    } catch (err) {
      // Telegram retries on non-2xx, so surfacing 502 is correct — the update
      // is not lost, it is redelivered once the origin recovers.
      return new Response(`Origin unreachable: ${err.message}`, { status: 502 });
    }
  },
};
