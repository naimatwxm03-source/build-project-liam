# Telegram → n8n Trigger: Fix Runbook

**Target:** `n8n.n-enterprise.ru` on Timeweb VPS `5.42.99.81` (Docker + Nginx + Let's Encrypt)
**Symptom:** user sends a message to the bot → nothing happens in n8n.
**Trigger in use:** Telegram Trigger node.

Rule for this whole document: **never change two things at once, and re-run Step 1 after every change.** That single rule is what stops the loop.

---

## Step 0 — The one fact that explains 80% of these failures

The Telegram Trigger node does **not** poll. When you toggle the workflow to **Active**, n8n calls `setWebhook` on Telegram and hands it a URL that n8n builds from its own environment variables — *not* from your browser address bar.

So if `WEBHOOK_URL` is unset or wrong, n8n registers something like `http://localhost:5678/webhook/...`, Telegram accepts the call silently, and then nothing is ever delivered. The n8n UI shows no error. This is exactly the state an agent will loop on forever, because nothing in n8n looks broken.

Telegram also refuses:

- plain `http://` — HTTPS only
- self-signed certs (unless uploaded explicitly)
- any port other than **443, 80, 88, 8443** — port `5678` will never work from outside

---

## Step 1 — Diagnose (run all five, write down the answers)

### 1A. What does Telegram think it's calling?

```bash
curl -s "https://api.telegram.org/bot<YOUR_TOKEN>/getWebhookInfo" | python3 -m json.tool
```

This is your ground truth. Read `url`, `last_error_date`, `last_error_message`, `pending_update_count`.

### 1B. Is the domain behind the Cloudflare proxy?

```bash
dig +short n8n.n-enterprise.ru
```

- Returns `5.42.99.81` → **no proxy**, DNS-only (grey cloud). Go to Fix B.
- Returns `104.x.x.x` / `172.67.x.x` / `188.114.x.x` → **Cloudflare proxy is ON** (orange cloud). Go to Fix A.

Confirm:

```bash
curl -sI https://n8n.n-enterprise.ru | grep -iE "^(server|cf-ray)"
```

`server: cloudflare` = proxied.

### 1C. Is a Cloudflare Tunnel running?

```bash
systemctl status cloudflared 2>/dev/null | head -5
docker ps | grep -i cloudflared
```

If either shows something running → Fix C.

### 1D. Is there a redirect loop?

```bash
curl -sIL https://n8n.n-enterprise.ru | grep -iE "^(HTTP/|location)"
```

Two or more `301`/`302` lines pointing back at the same host = **Flexible SSL loop**. Cloudflare talks HTTP to your origin, Nginx redirects to HTTPS, Cloudflare re-enters, forever. This is the classic Cloudflare + Let's Encrypt breakage and it makes Telegram's `setWebhook` call fail.

### 1E. What does n8n think its own URL is?

```bash
docker exec n8n printenv | grep -iE "WEBHOOK_URL|N8N_HOST|N8N_PROTOCOL|N8N_PORT|N8N_EDITOR_BASE_URL"
```

If `WEBHOOK_URL` is missing → that alone is the bug, regardless of Cloudflare. Go straight to Step 2.

### Result table

| Finding in Step 1 | Go to |
|---|---|
| `url` empty, or contains `localhost` / `5.42.99.81` / `:5678` | Step 2 |
| `last_error_message` mentions SSL, or 1D shows a redirect loop | Fix A |
| `Connection timed out` / `Connection refused` | Fix A or B (port/firewall) |
| `Wrong response from the webhook: 403 Forbidden` | Fix A, bot-protection section |
| `Wrong response from the webhook: 404` | Step 2 + workflow not Active |
| Everything looks correct but still no delivery | Step 4, then Fallback |

---

## Step 2 — Fix the n8n environment (do this in every scenario)

Edit `docker-compose.yml` (or your `.env`):

```yaml
environment:
  - N8N_HOST=n8n.n-enterprise.ru
  - N8N_PROTOCOL=https
  - N8N_PORT=5678
  - N8N_LISTEN_ADDRESS=0.0.0.0
  - WEBHOOK_URL=https://n8n.n-enterprise.ru/
  - N8N_EDITOR_BASE_URL=https://n8n.n-enterprise.ru/
  - N8N_PROXY_HOPS=1
  - GENERIC_TIMEZONE=Europe/Samara
```

`N8N_PROXY_HOPS=1` matters when Nginx or Cloudflare sits in front — without it n8n mis-reads the forwarded headers.

Apply:

```bash
docker compose up -d
docker logs n8n --tail 30
```

Then **Step 4** — the env change does nothing until the workflow is re-activated.

---

## Fix A — Cloudflare proxy is ON (orange cloud)

Four settings, in this order. Check `getWebhookInfo` after each.

**A1. SSL/TLS mode → Full (strict)**
Dashboard → SSL/TLS → Overview. If it says *Flexible*, that is your redirect loop. Set **Full (strict)**. Your Let's Encrypt cert on the origin is valid, so strict will work.

**A2. Confirm the origin cert is actually alive**

```bash
curl -sI --resolve n8n.n-enterprise.ru:443:5.42.99.81 https://n8n.n-enterprise.ru | head -3
certbot certificates
```

This bypasses Cloudflare and hits your Nginx directly. If this fails, Cloudflare is not your problem — go to Fix B first.

**A3. Stop Cloudflare from blocking Telegram's requests**
Telegram's servers are not browsers. Bot Fight Mode and some managed WAF rules return **403** to them, which shows up as `Wrong response from the webhook: 403 Forbidden`.

- Security → Bots → turn **Bot Fight Mode OFF**
- Security → WAF → Custom rules → create rule:
  - Field: `URI Path` · Operator: `starts with` · Value: `/webhook`
  - Action: **Skip** → check *All remaining custom rules*, *Managed rules*, *Rate limiting*
- Second expression to add with `Or`: `URI Path starts with /webhook-test`

**A4. Bypass cache on webhooks**
Caching → Cache Rules → new rule: `URI Path starts with /webhook` → **Bypass cache**.

Port note: keep everything on **443**. Cloudflare's proxy passes 443 fine; it will never carry 5678.

---

## Fix B — Nginx + Let's Encrypt only (no Cloudflare)

Working server block for n8n. The `Upgrade` headers are required or the n8n editor UI hangs.

```nginx
server {
    listen 443 ssl http2;
    server_name n8n.n-enterprise.ru;

    ssl_certificate     /etc/letsencrypt/live/n8n.n-enterprise.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/n8n.n-enterprise.ru/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:5678;
        proxy_http_version 1.1;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        'upgrade';
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
    }
}

server {
    listen 80;
    server_name n8n.n-enterprise.ru;
    return 301 https://$host$request_uri;
}
```

```bash
nginx -t && systemctl reload nginx
ufw allow 443/tcp && ufw allow 80/tcp
ufw deny 5678/tcp
```

Port 5678 should **not** be publicly reachable — Nginx reaches it over localhost.

---

## Fix C — Cloudflare Tunnel (cloudflared)

If a tunnel is running, it replaces Nginx as the public entrance and the DNS record is a CNAME to `*.cfargotunnel.com`.

```yaml
# ~/.cloudflared/config.yml
tunnel: <TUNNEL_ID>
credentials-file: /root/.cloudflared/<TUNNEL_ID>.json
ingress:
  - hostname: n8n.n-enterprise.ru
    service: http://localhost:5678
  - service: http_status:404
```

```bash
cloudflared tunnel route dns <TUNNEL_ID> n8n.n-enterprise.ru
systemctl restart cloudflared
```

Do **not** run a tunnel and an Nginx/DNS-A-record setup at the same time for the same hostname — pick one. Running both is a common source of "it works sometimes."

---

## Step 3 — Clear the stale webhook

Telegram remembers the last URL you gave it, including the broken one.

```bash
curl -s "https://api.telegram.org/bot<YOUR_TOKEN>/deleteWebhook?drop_pending_updates=true"
```

---

## Step 4 — Re-register (the step people skip)

In n8n: open the workflow → toggle **Active** to **off** → **Save** → toggle **Active** to **on** → **Save**.

Nothing you changed in Steps 2–3 reaches Telegram until this toggle happens. If you fixed Cloudflare but never re-activated, the symptom stays identical, and that is precisely what makes an agent loop.

Verify immediately:

```bash
curl -s "https://api.telegram.org/bot<YOUR_TOKEN>/getWebhookInfo" | python3 -m json.tool
```

You want:

```json
{
  "url": "https://n8n.n-enterprise.ru/webhook/<id>/webhook",
  "has_custom_certificate": false,
  "pending_update_count": 0
}
```

with **no** `last_error_message`. Now message the bot from Telegram and check n8n → **Executions**.

Note: "Test this trigger" registers the `/webhook-test/` path and expires after one event. Production behaviour only exists when the workflow is **Active**.

---

## Fallback — polling with `getUpdates` (no inbound connection at all)

Use this when Cloudflare, DNS, or certs are still fighting you. Telegram is polled outbound, so nothing needs to reach your VPS. It runs fine behind a broken proxy.

**Prerequisite:** a webhook and polling cannot coexist. Run Step 3's `deleteWebhook` first, or every call returns `409 Conflict`.

Build this as a separate workflow (Telegram Trigger node is not used here):

**Node 1 — Schedule Trigger** · every 10 seconds.

**Node 2 — Code** ("Read offset"):

```javascript
const s = $getWorkflowStaticData('global');
return [{ json: { offset: s.offset || 0 } }];
```

**Node 3 — HTTP Request** ("getUpdates"):

- Method: `GET`
- URL: `https://api.telegram.org/bot{{ $env.TELEGRAM_TOKEN }}/getUpdates`
- Query parameters: `offset` = `={{ $json.offset }}` · `timeout` = `0` · `allowed_updates` = `["message"]`

Put the token in a docker env var rather than in the node body.

**Node 4 — Code** ("Parse + advance offset"):

```javascript
const s = $getWorkflowStaticData('global');
const updates = $input.first().json.result || [];
if (updates.length === 0) { return []; }

s.offset = updates[updates.length - 1].update_id + 1;

return updates
  .filter(u => u.message && u.message.text)
  .map(u => ({
    json: {
      chat_id: u.message.chat.id,
      text:    u.message.text,
      from:    u.message.from.first_name || ''
    }
  }));
```

**Node 5 — HTTP Request** → GigaChat (`https://gigachat.devices.sberbank.ru/api/v1/chat/completions`), body content = `={{ $json.text }}`.

**Node 6 — Telegram node** → *Send Message* · Chat ID = `={{ $('Parse + advance offset').item.json.chat_id }}`.

Three things that will bite you:

1. `$getWorkflowStaticData` **only persists in production runs.** Manual executions reset the offset and you will reprocess old messages. Test with the workflow **Active**.
2. Never run two copies of this workflow, and never leave the webhook registered — duplicated or lost messages follow.
3. A 10-second schedule creates ~8,600 executions/day. Add pruning:
   ```yaml
   - EXECUTIONS_DATA_PRUNE=true
   - EXECUTIONS_DATA_MAX_AGE=72
   ```
   and set the workflow's *Save successful executions* to **off** in workflow settings.

Once the webhook path works, deactivate this workflow — do not run both.

---

## Step 5 — Final verification checklist

- [ ] `dig +short n8n.n-enterprise.ru` — you know whether the proxy is on
- [ ] `curl -sIL` shows exactly one `200`, no redirect chain
- [ ] `docker exec n8n printenv | grep WEBHOOK_URL` returns the https domain
- [ ] `getWebhookInfo` shows the https domain and no `last_error_message`
- [ ] Workflow is **Active** and was toggled off→on after the last change
- [ ] Sending "test" to the bot creates a row in n8n → Executions
- [ ] Port 5678 is closed to the internet (`ufw status`)
- [ ] Bot token has been rotated via `@BotFather` → `/revoke` if it was ever pasted into a chat

---

## Appendix — how to stop Claude Code from looping on this

The loop happens because the agent has no external ground truth: n8n's UI looks healthy whether or not Telegram can reach it, so every "fix" appears plausible and it cycles through them forever.

Paste-ready prompt:

```
Context: n8n Telegram Trigger on n8n.n-enterprise.ru (Timeweb VPS 5.42.99.81),
Docker + Nginx + Let's Encrypt, Cloudflare status unknown.

Ground truth for this task is the output of:
  curl -s "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"

Rules:
1. Before proposing any change, ask me to run one diagnostic command and
   paste the output. Do not proceed without it.
2. Change exactly ONE thing per iteration, then ask for getWebhookInfo again.
3. If getWebhookInfo is byte-identical to the previous run, the change had no
   effect. Say so and pick a DIFFERENT hypothesis. Never repeat an attempt.
4. Keep a running list of ruled-out hypotheses and restate it every iteration.
5. If three iterations produce no change in last_error_message, stop and tell
   me to switch to the getUpdates polling fallback.
```

Rule 3 is the one that actually breaks the cycle — it forces the agent to treat an unchanged error as disconfirming evidence instead of a reason to try again harder.
