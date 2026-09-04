# Decision 01 — Network architecture for RU + global clients

**Date:** 2026-09-04 · **Status:** decided · **Review:** not before 2027-03

## The problem, stated once

A Telegram bot hosted on a Russian IP does not work reliably. Both directions fail, each with a symptom that points away from its cause:

- **Outbound** (n8n → `api.telegram.org`): hangs. n8n never returns, Cloudflare times out the browser, Publish shows `504`. No webhook is ever registered, so there is nothing inbound to debug.
- **Inbound** (Telegram → VPS): registration succeeds, delivery reports `Connection timed out` against `5.42.99.81`. Updates queue in `pending_update_count` and arrive minutes late or never.

Neither is visible in the n8n UI. n8n looks healthy in both cases. **Ground truth is `getWebhookInfo`, always.**

## What we tried, and what it taught us

| Attempt | Result | Lesson |
|---|---|---|
| Direct webhook to `n8n.n-enterprise.ru` | Registers; delivery times out | Telegram **can resolve** the domain, **cannot reach** the Russian IP |
| Outbound Worker (`edrus-telegram`) as credential Base URL | ✅ **Works, still works** | Outbound is solved permanently. Keep this. |
| Inbound Worker (`tg-in`) + `WEBHOOK_URL` | Worked for ~30 min, then `Failed to resolve host` | **`*.workers.dev` is not reliably resolvable by Telegram.** Verified: manual `setWebhook` to *both* Workers fails identically, with no n8n involved. |

**The decisive finding:** Telegram resolves `n-enterprise.ru` every single time and never once failed on it. It intermittently fails on `workers.dev`. So the hostname must be ours, not Cloudflare's shared one.

## The decision

**Put `n-enterprise.ru` on Cloudflare (free plan) and proxy the subdomains. One change, both markets, no per-client variation.**

```
                    n-enterprise.ru — Cloudflare DNS (free)
                                 │
              ┌──────────────────┴──────────────────┐
              │                                     │
    n-enterprise.ru                      n8n.n-enterprise.ru
    personal site · proxied              proxied (orange cloud)
                                                    │
                                          Timeweb VPS 5.42.99.81
                                          (origin, not public-facing)

    INBOUND   Telegram / VK / Avito / any webhook
              → Cloudflare global anycast → origin        ✅ works worldwide

    OUTBOUND  n8n → edrus-telegram Worker → api.telegram.org   ✅ already working
```

Two components. Both free. Both permanent.

**Why this is the answer and not a workaround:**
- Telegram resolves a hostname it has never failed on, and connects to a Cloudflare IP rather than a Russian one.
- Cloudflare's anycast edge is global — a client in Moscow, Berlin or Dubai hits the same architecture. **There is no RU-vs-global difference in the connectivity layer.**
- No `workers.dev` anywhere in the inbound path, so the failure that broke us cannot recur.
- The `tg-in` Worker becomes unnecessary and should be deleted.

## What is genuinely different for global clients

Connectivity is **not** one of them — that is the point of this decision. What actually differs:

| Concern | RU client | Global client |
|---|---|---|
| Connectivity | Solved by this decision | Solved by this decision |
| Channel | VK / Avito / MAX preferred; Telegram fine | Telegram / WhatsApp |
| Model | Qwen on Yandex AI Studio (152-ФЗ) | Claude or OpenAI direct — cheaper, no markup |
| Payment | YooKassa / СБП | Stripe / Paddle / wire |
| **Data residency** | Russian VPS is correct | **EU/UK customer data must not sit on a Russian VPS** |

**Only the last one needs new infrastructure**, and only when a client with that requirement signs. A €5/month VPS in Germany or Finland, paid from that client's setup fee. **Do not buy it now.**

## The one real risk, and the mitigation

Roskomnadzor has intermittently restricted parts of Cloudflare. If that escalates, RU users could lose access to anything behind the proxy.

**Mitigation, already available:**
- Any subdomain can be switched from proxied (orange) to DNS-only (grey) in one click, restoring the direct path in under a minute.
- **For RU client deliverables, prefer VK / Avito / MAX** — those channels never route through Cloudflare and have none of these problems. This is what `n8n-brief` already mandated; this incident is the evidence for why.
- Telegram stays the default for Naimat's own tools and for global clients.

## Execution

**Prerequisite check (2 min).** Before touching nameservers, capture what exists:
```bash
dig +short NS n-enterprise.ru
dig +short MX n-enterprise.ru
dig +short A n-enterprise.ru
dig +short A n8n.n-enterprise.ru
dig +short TXT n-enterprise.ru
```
If `MX` returns anything, email lives on this domain — those records must be copied to Cloudflare **and left DNS-only (grey cloud)**. Proxying MX breaks mail.

**Steps (~20 min work, then propagation):**
1. Cloudflare → **Add a domain** → `n-enterprise.ru` → **Free** plan
2. Cloudflare auto-scans existing DNS. **Compare its list against the `dig` output above.** Add anything missing by hand.
3. Set `n8n` (A → `5.42.99.81`) to **Proxied** (orange cloud). Set MX and any mail-related records to **DNS only** (grey).
4. Cloudflare shows two nameservers. At **reg.ru** → domain → DNS servers → replace with Cloudflare's two.
5. Wait for Cloudflare to report **Active** (15 min – 2 h typical, 24 h worst case).
6. SSL/TLS → **Full (strict)**. The origin has a valid Let's Encrypt cert, so strict works.
7. Security → WAF → Custom rule: `URI Path starts with /webhook` → **Skip** all managed rules, Bot Fight Mode, rate limiting. Telegram's POSTs are bot traffic by definition and will be challenged otherwise.
8. On the VPS: revert `WEBHOOK_URL` to `https://n8n.n-enterprise.ru/` in `/root/n8n/docker-compose.yml`, then `docker-compose down && docker-compose up -d`.
9. In n8n: Unpublish → Publish.
10. Verify: `getWebhookInfo` must show `ip_address` as a Cloudflare address (`104.x`, `172.67.x`, `188.114.x`), **not** `5.42.99.81`.
11. Delete the `tg-in` Worker. Keep `edrus-telegram` — outbound still needs it.

**Cost: 0 ₽.** Cloudflare Free covers DNS, proxy, WAF rules and Workers at this volume.

## Until DNS is Active

The bot is blocked on step 5. Two options while waiting:
- **Do nothing** — wait it out, then finish Build 1. Usually under 2 hours.
- **Polling fallback** (`docs/04-telegram-webhook-runbook.md`) — `getUpdates` through the outbound Worker. Telegram never touches the VPS. Works today, but ~8 600 executions/day and needs pruning. **Delete it once webhooks work.** Do not ship polling to a client.

## Standing rules from this incident

1. **Never use `*.workers.dev` as a webhook hostname** that an external service must resolve. Own domain only.
2. **`getWebhookInfo` is ground truth.** The n8n UI cannot tell you whether Telegram can reach you.
3. **A 504 on Publish means outbound.** `Connection timed out` in `last_error_message` means inbound. They look alike and are not.
4. **RU client work defaults to VK / Avito / MAX.** Telegram for internal tools and global clients.
5. Buy foreign infrastructure only when a signed client's data-residency requirement demands it, funded by their setup fee.
