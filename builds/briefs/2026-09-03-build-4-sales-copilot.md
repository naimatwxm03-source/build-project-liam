# Brief: Копилот менеджера по продажам (Sales Rep Copilot)
**For:** Client-facing, capstone · **Runs on:** Timeweb VPS (n8n + React frontend + SearXNG + Firecrawl, all Docker/Nginx) · **Model:** Qwen 3 (Yandex AI Studio) · **Est. build:** 24–30 h
**Ports:** Liam Build 4 · **Portability:** ~50% — Lovable, SerpAPI, Apify and LinkedIn are all out. **The forced substitutions make this a better portfolio piece than the original.**

## 0. Why the substitutions are an upgrade
Liam has you vibe-code the frontend on Lovable and rent three research APIs. You can pay for none of them, and LinkedIn is RKN-blocked in Russia regardless. What you build instead:

| Liam | You | Why yours is better here |
|---|---|---|
| Lovable frontend | **React + Vite, written in Claude Code, deployed on your VPS** | Real code in a public repo that a client's own developer can read. A Lovable share link is not a portfolio artifact. |
| SerpAPI | **SearXNG self-hosted** | Free, yours, no per-query cost at copilot volume |
| Firecrawl cloud | **Firecrawl self-hosted** (Docker) | Same API surface, no card, no per-page cost |
| Apify LinkedIn scraper | **Rusprofile/Kontur by ИНН + HH.ru API** | LinkedIn is blocked in RU and isn't the RU B2B graph anyway. ИНН → выручка, учредители, суды, численность is *more* useful to a Russian salesperson than a job title. |
| Airtable | **Bitrix24** | The CRM the client already has |
| Gemini | **Qwen 3 (Yandex AI Studio)** | Runs from the box |

This is the build to put at the top of the portfolio: a full-stack, self-hosted, RU-native agent app with no foreign dependency anywhere on the critical path. That sentence is the sales pitch.

## 1. What it does
A salesperson opens a chat app before a call. They ask it to research the company they're about to speak to; it pulls the ИНН record, recent web mentions, and the company site, and returns a one-screen brief. They ask what the CRM knows about this lead; it pulls the deal, the Build 3 qualification, and the transcript. After the call they dictate what happened and it updates the deal stage and sends the follow-up email. Twenty minutes of pre-call prep becomes ninety seconds, and the CRM actually gets updated — which it currently doesn't.

## 2. Trigger
**Webhook** (POST `/webhook/copilot`) from the React frontend. Body `{ session_id, message }`. **Respond to Webhook** returns `{ session_id, reply (markdown), tool_calls[] }`.

Auth: a shared bearer token in the header for v1 `[Phase 2: per-user JWT]`. This endpoint reads and writes a client's CRM — **do not deploy it unauthenticated**, even for a demo.

## 3. Architecture
Pattern: **frontend + backend**, agent with tools. Two research tools are **workflow-as-tool** to keep the agent's tool list at 6 rather than 9 — over ~8 tools Qwen 3 (Yandex AI Studio) starts choosing wrong.

```
React frontend (VPS, Nginx)
   │ POST { session_id, message } + Bearer
   ↓
Webhook → Auth check (IF) → Normalize → Rate limit (Redis)
   ↓
Sales Copilot Agent (Qwen 3 (Yandex AI Studio))
   ├ memory: Postgres Chat Memory, key = copilot:{session_id}
   ├ tool: Research Company   → SUB-A
   ├ tool: Research Web       → SUB-B
   ├ tool: CRM Lookup         (Bitrix24 crm.deal.list + crm.timeline)
   ├ tool: CRM Update         (Bitrix24 crm.deal.update)
   ├ tool: Draft Email        (returns draft, does NOT send)
   └ tool: Send Email         (SMTP — separate tool, see §6)
   ↓
Format Response (Code) → Respond to Webhook { reply, tool_calls[] }

SUB-A Research Company:  { inn? , name }
  → HTTP: Rusprofile/Kontur by ИНН  [VERIFY API + pricing]
  → HTTP: HH.ru API (vacancies = hiring signal, headcount proxy)
  → Code: merge → compact profile
SUB-B Research Web:      { query }
  → HTTP: SearXNG /search?format=json
  → Code: pick top 3 URLs
  → HTTP: Firecrawl /scrape (self-hosted) ×3
  → Code: trim to ~1500 tokens total
```

| # | n8n node | Does what | Key config | Fails how |
|---|---|---|---|---|
| 1 | Webhook | Frontend entry | POST, respond via node | Unauthenticated = CRM write access to the internet |
| 2 | IF | Bearer check | compare to env var | — |
| 3 | Redis | Rate limit | 60 req / 10 min / session | — |
| 4 | AI Agent | Reason + choose tools | Qwen 3 (Yandex AI Studio), prompt §Appendix | >8 tools → wrong tool choice. Keep to 6. |
| 5 | Postgres Chat Memory | Per-chat context | key `copilot:{session_id}`, window 12 | Reps share context if unkeyed |
| 6 | Execute Workflow (tool) | Research Company | inputs model-defined | Model passes a company name where ИНН is needed — sub-flow must handle both |
| 7 | Execute Workflow (tool) | Research Web | — | Scrape returns 40k tokens → **must** trim in the sub-flow, not the agent |
| 8 | HTTP Request (tool) | Bitrix24 read | `crm.deal.list`, `crm.timeline.comment.list` | Empty result is normal |
| 9 | HTTP Request (tool) | Bitrix24 update | `crm.deal.update` | **Writes to a client's CRM.** See §6. |
| 10 | Code (tool) | Draft email | returns text only | — |
| 11 | Send Email (tool) | SMTP send | Yandex 360 | Sends to a real customer. See §6. |
| 12 | Code | Format response | `{ reply, tool_calls[{name, ok}] }` | — |
| 13 | Respond to Webhook | Return | — | >60s → frontend must stream or poll |
| 14–19 | Sub-flow nodes | as above | — | Rusprofile 429; SearXNG down; Firecrawl OOM on a heavy page |
| 20 | Error Trigger | Alert | → Telegram | — |

**Frontend** (`builds/04-sales-copilot/frontend/`): React + Vite + Tailwind. Chat list in a sidebar, one `session_id` (UUID) per chat persisted in `localStorage`, markdown rendering, per-message tool-call chips with ✓/✗, a thinking state. Built with Claude Code, `/design` first if you want the layout settled visually before coding.

## 4. Credentials & environment
- **Qwen 3 (Yandex AI Studio)** — reuse the Yandex AI Studio credential.
- **Rusprofile / Kontur.Focus** — `[VERIFY API access model and pricing — this may be the one paid RU dependency. If it's not affordable, fall back to open ЕГРЮЛ data from ФНС.]`
- **HH.ru API** — public endpoints, no key for basic search `[VERIFY rate limits]`.
- **SearXNG** — Docker on the VPS, JSON output enabled in `settings.yml` (off by default).
- **Firecrawl self-hosted** — Docker. Memory-hungry; give it a limit or it will take the box down. Set it now.
- **Bitrix24 inbound webhook** — scopes `crm`. Client-owned.
- **SMTP** — Yandex 360 app password. **Sends as the client's domain** — they must add the SPF/DKIM records or the follow-ups land in spam and they'll blame you.
- **Frontend** — Nginx vhost, TLS via Let's Encrypt, `COPILOT_TOKEN` env var.

## 5. Data
**In:** `{ session_id: uuid, message: string }` + `Authorization: Bearer`
**Out:** `{ session_id, reply: markdown, tool_calls: [{ name, ok, ms }] }`

**Stored:**
- `copilot_memory` — chat transcripts, 90-day retention
- `research_cache` — Postgres, keyed by ИНН/URL, **TTL 7 days**. Company data does not change hourly; caching cuts the dominant cost and makes the copilot feel instant on a repeat lookup.
- `tool_audit` — every CRM write and every email send: who, what, when, before/after. **Non-negotiable.** When a rep says "I didn't change that stage", this is the answer.

## 6. Error handling
- Error Trigger → Telegram alert to Naimat.
- **Two tools cause irreversible outside-world effects: CRM update and email send.** Handle them differently from the rest:
  - Email: split into `Draft Email` (returns text) and `Send Email` (sends). The agent may draft freely; the prompt requires it to show the draft and get an explicit "отправляй" before calling send. **Never one tool that composes and sends in a single step** — an LLM emailing a real customer unreviewed is how you lose a client.
  - CRM update: allowed directly, but every write goes to `tool_audit`, and stage transitions are validated against an allowlist in the Workflow Configuration node. An agent must not be able to set a deal to "Закрыт успешно".
- Research sub-flow fails → agent reports what it couldn't find and continues. A copilot that dies because one API is down is worse than no copilot.
- Firecrawl OOM → catch, return partial results, alert.
- Retries: SearXNG 1, Firecrawl 2, Rusprofile 2, Bitrix24 3, Qwen 3 retries. **SMTP: 0 retries** — a retry on an ambiguous SMTP response sends the email twice.
- Rate limits at 10 reps × 30 messages/day: Bitrix24 fine, HH.ru `[VERIFY]`, Rusprofile likely the binding one — hence the cache.

## 7. Test plan
1. **Happy path:** "подготовь меня к звонку в ООО Ромашка, ИНН 7707083893" → returns ИНН record + web mentions + site summary in one screen, `tool_calls` shows Research Company ✓ and Research Web ✓.
2. **CRM read:** "что у нас по лиду +7 916 123-45-67" → deal, stage, Build 3 qualification, transcript excerpt.
3. **CRM write:** "поставь этому лиду стадию Замер назначен" → deal updated, `tool_audit` row written, reply confirms.
4. **Email guard:** "напиши и отправь письмо" → agent drafts and **stops for confirmation**. If it sends without one, fix the prompt before anyone touches production. Test this explicitly, every time you change the prompt.
5. **Stage allowlist:** "закрой сделку как успешную" → refused. Reps close deals, not copilots.
6. **Failure case:** stop SearXNG → agent reports the gap, still returns ИНН data.
7. **Failure case:** Firecrawl on a 10MB page → trimmed or failed gracefully, box still up.
8. **Session isolation:** two reps, two sessions → no crossover.
9. **Auth:** request without the bearer → 401. Try it from outside the VPS.
10. **Cache:** same ИНН twice → second is instant, one API call in the logs.
11. **Frontend:** markdown renders, tool chips show, thinking state appears, new chat gets a fresh UUID, reload preserves history.

## 8. Cost at stated volume
10 reps × 30 messages/day = 300 agent turns/day.
- Qwen: 300 × ~3 500 tokens (research context is heavy) ≈ 32M tokens/mo → **dominant cost.** The 7-day research cache is what keeps this affordable — build it in v1, not as an optimization later.
- Rusprofile/Kontur: `[VERIFY]` — with cache, ~40 unique lookups/day
- SearXNG, Firecrawl: self-hosted, VPS resources only
- **VPS impact is real here:** n8n + Postgres + Redis + Qdrant + SearXNG + Firecrawl + frontend. **Check RAM headroom before deploying.** Firecrawl is the one that will surprise you. If the box is tight, move Firecrawl to the second VPS.

## 9. Commercial
- Setup: **250 000–400 000 ₽** · Retainer: **35 000–50 000 ₽/mo**
- Retainer covers: prompt tuning against real usage, new research sources, CRM field/stage changes, frontend tweaks, hosting, uptime.
- **Sell on CRM hygiene, not on research.** Every sales manager complains their reps don't update the CRM. This makes updating it easier than not updating it. That's the line that closes the deal — the research is the demo, the hygiene is the value.
- This is your reference build. Public repo + deployed URL + 90-second demo → attach to every `outreach-engine` pitch.

## 10. Open risks
- `[VERIFY]` **Rusprofile/Kontur API pricing is the one dependency that could break the economics.** Check first, before building. Fallback: free ФНС ЕГРЮЛ data — less rich, but it's free and it's an API.
- `[VERIFY]` HH.ru API terms for commercial use.
- **VPS capacity.** Seven services on one box. Measure before you deploy, and price the second VPS into the setup fee if it's needed.
- SPF/DKIM on the client's domain — outside your control, and follow-ups silently land in spam without it. Get written confirmation it's done before go-live.
- **The email guard is the highest-consequence line in this brief.** An agent that sends unreviewed email to a client's customers is a business-ending incident, not a bug. Test it every time the prompt changes.
- 152-ФЗ: the copilot handles personal data of the client's customers. Retention and access control are contractual, not optional.
- `[ASSUMED]` 10 reps. At 50+ the memory and cache tables need real indexing and the agent needs per-user auth, not a shared token.

## 11. Build order
1. **`/security-review` the auth design before writing the webhook.** This endpoint writes to a client's CRM.
2. Webhook + bearer check + hardcoded reply. Test 401 from outside the VPS.
3. Agent with Qwen 3 (Yandex AI Studio), no tools. Postgres memory. Session isolation test.
4. SearXNG in Docker, JSON output on, query it with curl. Green standalone.
5. Firecrawl in Docker **with a memory limit**. Scrape one page via curl.
6. SUB-B Research Web end-to-end. **Check the output token count** — this is where the cost blows up.
7. Rusprofile/HH.ru standalone. Verify pricing before building SUB-A around it.
8. SUB-A Research Company + the 7-day cache.
9. Attach both sub-flows as tools. Watch what the agent passes in.
10. Bitrix24 read tool.
11. Bitrix24 write tool + `tool_audit` + stage allowlist. **Test the allowlist before moving on.**
12. Draft Email tool. Then Send Email as a separate tool. **Test the confirmation guard.**
13. Format Response + `tool_calls` array.
14. Frontend: `/design` for layout, then React + Vite. Point it at the webhook.
15. Nginx + TLS + deploy. `/security-review` again before it's public.
16. `builds/04-sales-copilot/README.md` + 90-second demo video.

> **Next: open n8n at n8n.n-enterprise.ru, build step 1 of §11 in isolation, confirm it runs green before adding step 2.**

---
### Appendix — Copilot system prompt (RU)
```
Ты — копилот менеджера по продажам компании по остеклению.
Помогаешь готовиться к звонкам, вести CRM и писать письма.

Инструменты:
- Research Company — данные по ИНН: выручка, учредители, численность, суды
- Research Web — поиск и чтение страниц в интернете
- CRM Lookup — сделки, стадии, результаты квалификации, расшифровки звонков
- CRM Update — смена стадии и комментарии
- Draft Email — черновик письма
- Send Email — отправка письма

ЖЁСТКИЕ ПРАВИЛА:
1. НИКОГДА не вызывай Send Email без явного подтверждения менеджера.
   Сначала покажи черновик целиком. Дождись «отправляй» или «да, шли».
   Слова «напиши письмо» — это НЕ разрешение на отправку.
2. Не выдумывай данные о компании. Если инструмент ничего не вернул —
   так и скажи. Менеджер пойдёт на звонок с твоими словами.
3. Перед сменой стадии в CRM назови текущую и новую, коротко.
4. Отвечай кратко и по делу. Менеджер читает тебя за 30 секунд до звонка,
   а не изучает отчёт.
5. Если не хватает данных для действия — спроси одним вопросом,
   не анкетой.

Формат брифа перед звонком:
**Компания** — чем занимается, размер, сигналы (найм, суды, новости)
**Что знаем** — из CRM: откуда пришёл, что говорил, стадия
**О чём спросить** — 2–3 конкретных вопроса
**Риски** — возражения, которые уже звучали
```
