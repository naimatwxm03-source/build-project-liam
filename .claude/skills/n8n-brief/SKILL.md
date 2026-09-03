---
name: n8n-brief
description: Turn a raw automation idea into a buildable n8n implementation brief — architecture, node-by-node plan, credentials, error handling, test plan, cost, and client pricing. Use whenever Naimat describes an automation he wants to build or scope, or says "brief", "n8n brief", "scope this", "how would I build this", "разбери автоматизацию", "составь бриф", or pastes a client's requirements from the pre-audit form. Also use before starting any new n8n build, and when a client asks "can you automate X?" — the answer should be a brief, not a guess. Enforces the NXAI stack constraints (Yandex AI Studio, RU-native channels, self-hosted n8n) so the brief is buildable on the actual Timeweb VPS, not in theory.
type: skill
owner: Naimat (NXAI Automation / N-Enterprise)
version: 2.0
last_updated: 2026-09-03
---

# n8n Brief Engine

> **Mission:** take a fuzzy automation idea and return a document Naimat can open in n8n and build from, node by node, without a second research session. A brief that needs rewriting has failed.

**Position in the pipeline:** `idea → automation-cto → n8n-brief (this) → build in n8n → deploy`

---

## 1. When to trigger

- "brief this" · "scope this" · "how would I build this" · "n8n brief" · "составь бриф" · "разбери автоматизацию"
- Naimat pastes client requirements, a pre-audit form response, or a voice-note transcript of a client call
- Before starting any new build in this repo
- A client asks whether X can be automated — produce the brief first, quote second

If ambiguous, ask once: "Brief this as an n8n build? Yes / no."

If the architecture is still undecided, run `automation-cto` first. A brief on an undecided architecture is a well-formatted wrong answer.

---

## 2. Intake — ask once, in one block

Ask for these seven fields. If Naimat already gave three or more, do NOT re-ask — infer the rest, mark inferences `[ASSUMED]`, and move on. Speed matters more than completeness; the brief itself surfaces gaps.

| Field | What it needs |
|---|---|
| **Purpose** | What problem this solves, in the client's words |
| **Trigger** | Event or schedule that starts it (webhook, new Avito message, daily 09:00, form submit) |
| **Outcome** | What exists in the world after it runs that didn't before |
| **Providers** | Named services: VK, Avito, Bitrix24, Yandex AI Studio, Postgres, Qdrant, YooKassa |
| **Usage pattern** | Runs per day, peak load, latency tolerance |
| **Where it runs** | Naimat's VPS / client's own infra / laptop only — **this decides the model, see §3** |
| **Notes** | Data schemas, edge cases, compliance, anything the client insisted on |

If Naimat says "just go", default to: runs on his Timeweb VPS, Qwen 3 on Yandex AI Studio, RU client, moderate load (<500 runs/day), Telegram + VK adapter — and say so at the top of the brief.

---

## 3. Stack constraints — apply these before writing a single node

Environment facts, not preferences. A brief that violates one is unbuildable. Full detail: `docs/ru-stack-map.md`.

**Model routing by where it runs:**

| Runs on | Model |
|---|---|
| Timeweb VPS (n8n.n-enterprise.ru) | **Qwen 3 via Yandex AI Studio.** YandexGPT then GigaChat as fallbacks. Anthropic/OpenAI/Google direct calls fail from that box. |
| Reasoning-heavy steps | DeepSeek on Yandex AI Studio — same endpoint, different model string |
| Vision / document OCR | **Yandex Vision OCR** for extraction → Qwen for structuring |
| Speech to text | Yandex SpeechKit |
| Embeddings | Yandex AI Studio embeddings, or self-hosted `multilingual-e5-large` |
| Naimat's laptop (Claude Code) | Claude — reasoning-heavy work lives here, never in a workflow node |
| Client infra outside RU | Claude / OpenAI, only if they genuinely host outside RU |

**Yandex AI Studio in n8n:** OpenAI-compatible. Use n8n's **OpenAI Chat Model** node with:
- Base URL `https://llm.api.cloud.yandex.net/v1` (no trailing path)
- Model `gpt://<folder_id>/qwen3-235b/latest`
- Auth `Authorization: Api-Key <service-account key>` — **not** `Bearer`

No OAuth flow, no token-cache node, no cert-chain workaround. **n8n gotcha:** OpenAI node **v2** with a custom base URL can pass the credential test then 404 at runtime; **v1.8 and the AI Agent's OpenAI Chat Model node work.** Backup: `n8n-nodes-yc` community node.

**One-account rule:** LLM, Vision OCR, SpeechKit and Geocoder all come from the same Yandex Cloud account — one credential, one bill, one auth pattern. Never add a second model vendor without a stated reason.

**Model cost:** Yandex marks Chinese models up ~30x vs calling them directly. That markup buys 152-ФЗ compliance and a rouble invoice, so it is the correct choice for client work. Never route a client through a payment intermediary. Reduce cost by reducing tokens — retrieval without generation, Redis caching, a small model for routing, deterministic Switch nodes — and always put the cloud account in the client's name so consumption is their bill.

**Client-facing channels (RU):** Telegram is **not blocked** and is the highest-usage RU messenger — a valid primary. Mitigate future regulatory risk architecturally, not by avoiding it: build the channel-adapter pattern so Telegram → VK is a config change. The agent must never see a `chat_id`. VK is the compliance-safe fallback and primary for gov-adjacent clients. Avito is where RU SMB lead flow actually is. Never route a RU client's end users through Stripe, HubSpot, or anything VPN-gated.

**MAX bot:** registration requires a verified Russian business entity. If a brief specifies MAX, flag it as blocked in Open Risks with VK as the fallback path.

**Storage:** Postgres on the VPS by default (separate DB from n8n's own). Bitrix24 when the client already has it — they usually do; client-owned credentials, always. Qdrant for vectors — never n8n's Simple Vector Store, which is in-memory and dies on restart. Redis for dedup, caching and rate limits. Google Sheets internal-only, never a client deliverable.

**Payments:** YooKassa or СБП for RU. If the automation touches invoicing or collecting money in Naimat's own name, flag it — the ИП/ООО question is a legal blocker, not a technical one.

**n8n version:** 2.36.8, self-hosted, Docker behind Nginx. LangChain nodes available. Do not plan around n8n Cloud features, including "Build with AI".

---

## 4. Output — always this structure

Write to `builds/briefs/YYYY-MM-DD-<slug>.md` and echo it in chat.

```
# Brief: <name of the automation>
**For:** <client or internal> · **Runs on:** <env> · **Model:** <model> · **Est. build:** <hours>

## 1. What it does
<3 sentences. Problem, mechanism, result. No jargon — this paragraph goes in the client proposal.>

## 2. Trigger
<Exact n8n trigger node + its config. Named node, not a category.>

## 3. Architecture
| # | n8n node | Does what | Key config | Fails how |
|---|---|---|---|---|

## 4. Credentials & environment
- <each credential, where it comes from, who owns the account>
- <env vars, certs, webhook URLs to register>

## 5. Data
**In:** <schema of what arrives at the trigger>
**Out:** <schema of what leaves>
**Stored:** <what persists, where, how long — flag 152-ФЗ if personal data>

## 6. Error handling
- Error Trigger workflow → <where the alert goes>
- Retry policy per external call
- What happens to an item that fails mid-batch
- Rate limits that will actually be hit at the stated volume

## 7. Test plan
1. Happy path: <specific input → specific expected output>
2. Edge case: <the one most likely to break>
3. Failure case: <kill the API and confirm it degrades correctly>
4. Session isolation: <two users at once must not share context>

## 8. Cost at stated volume
- Model tokens/month + ₽ estimate
- Any paid API
- VPS headroom impact

## 9. Commercial
- Setup: ₽<X> · Retainer: ₽<Y>/mo
- What the retainer covers (monitoring, prompt tuning, volume changes)

## 10. Open risks
- <blockers, unknowns, things to confirm with the client>

## 11. Build order
1. <first thing to build and test in isolation>
...
```

---

## 5. Quality bar — what makes a brief buildable

**Name real n8n nodes.** Webhook, Schedule Trigger, Form Trigger, HTTP Request, Code, Edit Fields (Set), IF, Switch, Merge, Loop Over Items, Wait, Respond to Webhook, Error Trigger, Postgres, Redis, Qdrant Vector Store, Execute Workflow, Basic LLM Chain, AI Agent, OpenAI Chat Model, Structured Output Parser. If unsure a node exists in 2.36.8, say "HTTP Request against <API>" rather than inventing a node name — a wrong node name costs an hour of debugging.

**Every external call gets a failure row.** "Fails how" is not optional. Timeout, 401, rate limit, malformed response — pick the realistic one.

**Volume math, not vibes.** 500 runs/day × 2 LLM calls × ~800 tokens is a number. Write the number.

**Say what you don't know.** An `[ASSUMED]` tag or an Open Risk line is worth more than a confident guess. Never invent a client's data schema or an API's pricing.

**Reject scope that isn't automation.** If the request needs a human decision in the middle with no clear rule, say so and propose where the human sits in the flow rather than pretending an LLM can decide it.

---

## 6. Non-negotiables in every generated design

- **Chat memory keyed by `channel + user_id`** (or `session_id`). Unkeyed memory means every user shares one conversation. Check this on every agent build.
- **Every webhook dedups on the event ID in Redis.** External services retry.
- **An agent tool that sends email is split in two:** draft (returns text) and send (sends). Never one tool that composes and sends unreviewed.
- **An agent that writes to a client's CRM writes to an audit table**, and stage transitions go through an allowlist.
- **A parse failure routes to manual review, never to an automated rejection.**
- **Tool lists stay at ≤6.** Beyond that the model picks wrong. Collapse into sub-workflows.
- **Prefer a deterministic Switch/IF over an agent** wherever the branches are enumerable — cheaper, faster, debuggable.

---

## 7. Failure modes to catch before shipping the brief

- Architecture table has fewer than 4 rows → under-scoped, the real build always has more
- Any node calls Anthropic, OpenAI or Google directly while running on the VPS → replace with Yandex AI Studio
- A Russian client's end users touch Stripe or a VPN-gated service → replace with VK / MAX / Avito / YooKassa
- No error handling section → not a brief, a wish
- Pricing quoted without a retainer → re-price
- Personal data stored with no retention policy → add one, flag 152-ФЗ
- Placeholder text like `<client name>` survived into the output → re-ground before shipping
- The brief describes what the automation is instead of how to build it → rewrite §3

---

## 8. Two modes

**Internal brief** (Naimat is building it): full technical depth, skip §9 commercial or mark it internal.

**Client-facing brief** (going into a proposal): §1, §5, §7, §9, §10 only, in Russian if the client is Russian, with node names stripped out. Ask which mode if it isn't obvious.

---

## 9. Next action after every run

End every brief with this line:

> **Next: open n8n at n8n.n-enterprise.ru, build step 1 of §11 in isolation, confirm it runs green before adding step 2.**

One step at a time is how the VK bot got built. Same rule here.
