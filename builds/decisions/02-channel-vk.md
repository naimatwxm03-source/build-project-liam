# Decision 02 — VK is the primary channel for RU builds

**Date:** 2026-09-13 · **Status:** decided · **Supersedes:** the Telegram channel choice in Build 1 · **Amends:** Decision 01

## The call

**Build 1 and Build 3A ship on VK. Telegram is demoted to a global-client channel and is not on any critical path.**

Decision 01's Cloudflare DNS migration is **shelved, not cancelled** — it is the correct fix for Telegram and costs 0 ₽, but nothing in the RU roadmap now depends on it, so it waits for a global client who needs Telegram or WhatsApp.

## Why

The Telegram failure was never "n8n is misconfigured." It was geography:

> **Telegram's servers sit outside Russia and could not open a connection to `5.42.99.81`.**

Outbound was fixable from our side (the `edrus-telegram` Worker, still working). Inbound was not, because the party that has to make the connection is Telegram, and it is on the wrong side of the border. Every fix we attempted was an attempt to give Telegram a reachable address. The `tg-in` Worker did exactly that — and worked, for thirty minutes — until Telegram's resolvers stopped resolving `*.workers.dev`.

VK has neither problem:

| | Direction | Route | Status |
|---|---|---|---|
| **VK Callback API** | VK → n8n | Russian server → Russian IP | The normal case. `[VERIFY on first confirm]` |
| **VK Long Poll** | n8n → VK | Outbound from the VPS to a Russian service | Has never failed, for anything |

**Two independent working paths.** Callback is primary because it is event-driven and costs one execution per real message. Long Poll is the fallback and needs no inbound connectivity whatsoever — if Callback ever breaks, the bot keeps running.

Compare: Telegram had zero working inbound paths and we spent a day discovering it.

## This was already the rule

`.claude/skills/n8n-brief/SKILL.md` and Decision 01 both already mandated **VK / Avito / MAX as the default for Russian client work**, with Telegram reserved for internal tools and global clients. Build 1 shipped on Telegram because it started as an internal tool. It is now a portfolio piece shown to Russian clients, so the rule applies and the channel changes with it.

This decision is the rule being followed, not a new rule.

## Scope of the change — smaller than it sounds

The inbound failure was **specific to Telegram's servers**. A browser in Russia reaches `n8n.n-enterprise.ru` without trouble. So:

| Build | Affected? | Why |
|---|---|---|
| **1 — Receipt bot** | ✅ Channel swap | Telegram → VK |
| **2 — Lead-gen widget** | ❌ No change | A browser POSTs to the VPS. Never blocked. |
| **3A — Voice qualifier** | ✅ Channel swap | Voice messages arrive via VK instead of Telegram |
| **4 — Sales copilot** | ❌ No change | React frontend on the VPS, no third-party inbound |

Two builds touched, and both through **one shared adapter** rather than two rewrites.

## What VK costs us

**n8n has no native VK node.** Everything is HTTP Request. That is a real cost, paid once:

- A **VK channel adapter** sub-workflow — receive and normalize on one side, send on the other.
- It emits the envelope the Telegram build already used: `channel, user_id, chat_id, session_key, text, file_url, message_id, ts`. Unchanged. This is what the channel-adapter pattern in `CLAUDE.md` was for.
- Builds 1 and 3A call it. Build 2's web widget can be made to emit the same envelope later, which makes a single agent serve both surfaces.

**What VK gives back:**
- **Photo URLs arrive in the payload.** No `getFile` round-trip — one node fewer than Telegram, and no 1-hour `file_id` expiry to handle.
- `random_id` is server-side dedup, layered under our own Redis check.
- No proxy, no Worker, no Base URL override anywhere in the path.

## Three mechanics that decide whether this works

1. **The confirmation handshake.** VK POSTs `{"type":"confirmation"}` once and demands the community's confirmation string back as **bare plain text**. n8n's default webhook response is JSON, so the Webhook node must use **Respond: Using 'Respond to Webhook' Node**. Get this wrong and the address is rejected before a single message flows.
2. **Respond `ok` before doing any work.** VK retries a slow endpoint, and a retry means the same receipt logged twice. The workflow answers first and processes after. This also makes VK's exact timeout irrelevant — the correct design does not depend on knowing it.
3. **Verify `secret` on every event.** The webhook URL is public. The secret is the only thing separating a real VK event from anyone who guesses the path.

## The risk, stated honestly

VK's audience skews differently from Telegram's, and some Russian SMB owners personally prefer Telegram. That is a **sales** objection, not a technical one, and the answer is the adapter: the agent is channel-agnostic, so adding Avito or MAX later is a new adapter and a config change, never a rebuild. When a client insists on Telegram, Decision 01's migration is the unlock — 20 minutes of clicks, already written up, still costing 0 ₽.

MAX remains blocked on ИП/ООО. Unchanged.

## Standing rules

1. **`groups.getCallbackServers` is ground truth for VK**, exactly as `getWebhookInfo` was for Telegram. Never the n8n UI.
2. **Answer the webhook before processing it.** Applies to every inbound integration, not just VK.
3. **Verify the shared secret on every public webhook.**
4. **New channels are new adapters.** The agent and its tools never learn what channel they are on.
5. **Telegram is a global-client channel now.** It does not go on a RU critical path without Decision 01 being executed first.
