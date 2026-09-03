# Brief: Чат-виджет с расчётом сметы (Lead-Gen Widget with Instant Estimate)
**For:** Client-facing (vertical: остекление балконов / натяжные потолки / ремонт) · **Runs on:** Timeweb VPS · **Model:** GigaChat + GigaChat Embeddings · **Est. build:** 14–18 h
**Ports:** Liam Build 2 · **Portability:** ~40% — **the Solar API has no RU equivalent and no RU coverage. This build is re-scoped, not translated.**

## 0. Why this is re-scoped
Liam's build calls the Google Solar API: address → roof geometry → panel count → savings. Three separate walls: the card doesn't work, the IP is blocked, and **the Solar API has no data for Russia** — it would return empty for a Moscow address even with perfect access.

So the *learning objectives* are preserved and the *domain* is replaced:

| Liam's objective | Preserved as |
|---|---|
| Call a custom external API | **Yandex Geocoder** — address → coordinates + normalized components |
| Turn a messy API response into a clean estimate | **Own pricing matrix** in Postgres + a Code node, driven by geocoded district + user-supplied параметры |
| Workflow-as-tool | Same — the estimate is a sub-workflow the agent calls |
| Knowledge base / RAG | Same — Qdrant + GigaChat Embeddings |
| Lead → CRM | **Bitrix24** instead of Airtable |
| Website chat deployment | **Own widget** on your VPS instead of n8n's embed |

**Vertical to pick:** остекление балконов. Reason: high ticket (60–200k ₽), address genuinely matters (район + этаж + тип дома drive price), the buyer is an SMB that already advertises on Avito, and the estimate is defensible from a pricing matrix rather than invented. Кухни and натяжные потолки work identically if you'd rather.

**Stretch, after the base build is green:** enrich the estimate with building data (год постройки, этажность, серия дома) from ГИС ЖКХ / Реформа ЖКХ open data `[VERIFY API availability and rate limits]`. This restores the "external API returns rich structured data you must parse" lesson at full difficulty. Do **not** put it on the critical path of v1.

## 1. What it does
A visitor on a остекление company's site opens the chat widget. It answers their questions from the company's own materials (сроки, гарантия, рассрочка, профили), then offers a free estimate. It asks for the address and the balcony parameters, computes a real price range from the company's pricing matrix, shows it, and then asks for name and phone — which lands as a lead in Bitrix24 with the estimate attached. The sales team calls someone who already has a number in their head.

## 2. Trigger
**Webhook** (POST, `/webhook/chat`) from your own widget. Body: `{ session_id, message }`. Responds via **Respond to Webhook**.

Not n8n's Chat Trigger — you need control over the embed on a client's site, and a client's marketing team will want to restyle it.

`[Phase 2]` The same agent behind Telegram + VK + Avito adapters. Build the normalization node now even though only the web channel uses it — retrofitting it later is a rewrite.

## 3. Architecture
Pattern: **single agent + tools**, one of which is **workflow-as-tool**.

```
MAIN:
Webhook → Normalize (Set) → Rate Limit (Redis) → Lead Agent (GigaChat)
              ├ memory: Postgres Chat Memory, key = web:{session_id}
              ├ tool: Knowledge Base   (Qdrant vector store retriever)
              ├ tool: Calc Estimate    (Execute Workflow → SUB)
              └ tool: Create Lead      (Bitrix24 crm.lead.add)
          → Respond to Webhook { reply, session_id }

SUB (Calc Estimate):
Execute Workflow Trigger { address, width_m, glazing_type, floor }
  → HTTP: Yandex Geocoder (address → lat/lon + district)
  → Postgres: pricing matrix lookup (district tier × glazing type)
  → Code: compute range, сроки, что входит
  → return { price_min, price_max, breakdown[], days, disclaimer }
```

| # | n8n node | Does what | Key config | Fails how |
|---|---|---|---|---|
| 1 | Webhook | Receives widget message | POST, respond via node | CORS — set headers for the client's domain, not `*` |
| 2 | Edit Fields | Normalize envelope | `channel='web'`, `session_key`, `text` | — |
| 3 | Redis | Rate limit per session | 20 msg / 10 min | Open widget = abuse surface. **Not optional.** |
| 4 | AI Agent | Conversation + tool choice | GigaChat, system prompt §Appendix | Asks for phone before delivering the estimate → kills conversion |
| 5 | Postgres Chat Memory | Per-session context | key `web:{session_id}`, window 10 | Missing key = all visitors share one conversation |
| 6 | Qdrant Vector Store (tool) | FAQ answers | collection `kb_<client>`, top-k 4 | Empty collection returns nothing; agent then invents. Guard in the prompt. |
| 7 | Execute Workflow (tool) | Estimate sub-flow | inputs "let model define", descriptions in §Appendix | Model passes address as `null` — validate in the sub-flow, don't trust it |
| 8 | Bitrix24 (tool) | `crm.lead.add` | webhook-auth REST | 401 stale webhook URL; duplicate lead on retry — dedup on phone |
| 9 | Respond to Webhook | Reply to widget | `{ reply, session_id }` | Timeout >30s — widget must show a spinner |
| 10 | Execute Workflow Trigger | Sub-flow entry | — | — |
| 11 | HTTP Request | Yandex Geocoder | `geocode`, `format=json`, `results=1` | Address not found → return a "уточните адрес" message, **never** guess a district |
| 12 | Postgres | Pricing matrix | `SELECT` by `district_tier`, `glazing_type` | No row → fall back to base tier, flag in output |
| 13 | Code | Compute the range | ±15% band, itemized | Divide-by-zero on width 0 — validate inputs first |
| 14 | Error Trigger | Catch-all | → Telegram alert to Naimat | — |

## 4. Credentials & environment
- **Yandex Geocoder API key** — Yandex Developer account. Free tier `[VERIFY daily request cap]`.
- **GigaChat** — same OAuth+cache pattern as Build 1. Reuse the sub-workflow.
- **Qdrant** — Docker on the VPS, own volume. Collection per client.
- **Bitrix24** — inbound webhook URL from the client's portal (`crm.lead.add` + `crm.lead.list` scopes). **The client owns this account, not you.** Say so in the contract.
- **Postgres** — `pricing_matrix`, `chat_memory` tables.
- **Widget hosting** — static JS/CSS on the VPS behind Nginx; client embeds one `<script>` tag.
- **CORS** — whitelist the client's domain explicitly.

## 5. Data
**In:** `{ session_id: uuid, message: string }`

**Out:** `{ session_id, reply: markdown }`

**Stored:**
- `chat_memory` — session transcripts, 30-day retention
- `pricing_matrix` — `district_tier`, `glazing_type`, `price_per_m`, `min_price`, `days_min`, `days_max` (client-supplied, **never invented**)
- `leads` mirror in Postgres for your own analytics; Bitrix24 is the system of record
- **152-ФЗ:** phone + name is персональные данные. The widget needs a согласие checkbox before the phone field, and the client must be the оператор ПДн. Flag this in the contract — it's their legal exposure, and mentioning it makes you look like a professional rather than a freelancer.

## 6. Error handling
- Error Trigger → Telegram alert to Naimat, plus a graceful widget reply: "секунду, соединяюсь с менеджером" + the client's phone number. **A dead-end error message on a lead-gen widget costs the client a sale.**
- Retries: Geocoder 2, GigaChat 3, Bitrix24 3 (idempotent-guarded).
- Estimate sub-flow fails → agent still captures the lead, marks it `estimate_failed`, tells the user a manager will call with numbers. **Never lose the lead because the calculator broke.**
- Qdrant unreachable → agent answers only what it can and offers the phone; must not hallucinate warranty terms. Bake into the prompt.
- Rate limits at 200 conversations/day: Geocoder fine, GigaChat fine, Bitrix24 REST 2 req/s — fine.

## 7. Test plan
1. **Happy path:** "сколько стоит остеклить балкон 3 метра" → agent asks address + type → estimate returns a range with breakdown → asks name+phone → lead in Bitrix24 with the estimate in the comment field.
2. **FAQ:** "какая гарантия" → answer traceable to a line in the KB doc. If it's fluent but not in the doc, RAG is broken.
3. **Edge case:** garbage address ("ул. Пушкина") → asks to clarify, does **not** produce a price. This is the case that protects the client from a wrong quote.
4. **Failure case:** kill Qdrant → agent degrades honestly, still captures the lead.
5. **Failure case:** kill Bitrix24 → lead written to the Postgres mirror + Telegram alert, user experience unchanged.
6. **Session isolation:** two browser tabs, different sessions → no crossover.
7. **Abuse:** 50 messages in a minute from one session → rate-limited, VPS unmoved.
8. **Conversion order:** confirm the agent never asks for a phone before delivering value. Ask-first kills the funnel — this is a business test, not a technical one.

## 8. Cost at stated volume
200 conversations/day, ~8 turns each = 1 600 LLM calls/day.
- GigaChat: 1 600 × ~900 tokens ≈ 43M tokens/mo → **the dominant cost.** `[VERIFY package pricing]`. If it's too high, route FAQ answers through retrieval-only (no generation) and reserve the LLM for the estimate flow — halves it.
- Embeddings: one-time on KB ingest + ~1 per query. Negligible.
- Yandex Geocoder: ~40 estimate requests/day, free tier `[VERIFY]`
- Qdrant + Postgres + widget: VPS resources. **Qdrant is the memory-hungry one** — budget ~1GB. Check headroom before deploying alongside n8n.

## 9. Commercial
- Setup: **120 000–180 000 ₽** · Retainer: **20 000–25 000 ₽/mo**
- Retainer covers: KB updates as their offering changes, pricing-matrix updates (seasonal — they'll want this quarterly), prompt tuning against real transcripts, uptime, one channel addition.
- **Sell on the estimate, not the chat.** Every competitor has a chat. Almost none give a real number before a call. Lead with: "посетитель получает цену за 40 секунд, а вы получаете его телефон".
- Pitch the transcript review as part of the retainer — reading real conversations monthly is how you upsell Build 3 to the same client.

## 10. Open risks
- **The pricing matrix must come from the client.** If they can't give you one, they don't have a repeatable price and this build cannot be honest. Ask for it in the pre-audit form, before quoting. This is the #1 kill risk.
- `[VERIFY]` Yandex Geocoder free-tier daily cap at 200 conv/day.
- `[VERIFY]` GigaChat token cost at 43M/mo — could make the unit economics fail. **Verify before signing a retainer.**
- `[VERIFY]` GigaChat Embeddings quality on Russian technical KB text vs self-hosted `multilingual-e5-large`. If retrieval is weak, self-host — it's a container, not a rewrite.
- 152-ФЗ compliance is the client's, but you must not build a form that collects a phone without consent. Non-negotiable.
- `[ASSUMED]` остекление балконов as the vertical. Changing it changes only the KB and the pricing matrix — the architecture holds.

## 11. Build order
1. Widget → Webhook → hardcoded reply → widget renders it. **Green first.** Get CORS right now, not later.
2. Add the agent with GigaChat, no tools. Plain conversation.
3. Add Postgres chat memory. **Test session isolation immediately** — before more tools make it hard to see.
4. Qdrant: ingest the KB doc, query it standalone, eyeball the retrieved chunks. Only then attach as a tool.
5. Sub-flow standalone: Geocoder only, hardcoded address, look at the raw response.
6. Sub-flow: add pricing lookup + Code node. Test with 5 real addresses across districts.
7. Attach the sub-flow as a tool. Watch what the agent passes in — this is where "let the model define" goes wrong.
8. Bitrix24 lead creation + dedup.
9. Rate limiting, Error Trigger, graceful degradation.
10. Style the widget, deploy behind Nginx, record the demo.

> **Next: open n8n at n8n.n-enterprise.ru, build step 1 of §11 in isolation, confirm it runs green before adding step 2.**

---
### Appendix — Agent system prompt (RU)
```
Ты — консультант компании по остеклению балконов. Общаешься в чате на сайте.

Порядок работы:
1. Отвечай на вопросы ТОЛЬКО из базы знаний (инструмент Knowledge Base).
   Если в базе ответа нет — честно скажи и предложи связать с менеджером.
   НИКОГДА не выдумывай сроки, гарантии, цены или условия рассрочки.
2. Как только уместно — предложи бесплатный расчёт стоимости.
3. Для расчёта нужны: адрес, ширина балкона в метрах, тип остекления
   (холодное / тёплое), этаж. Спрашивай по одному, не анкетой.
4. Вызови Calc Estimate. Покажи диапазон и что в него входит.
   Обязательно скажи, что точная цена — после замера.
5. ТОЛЬКО ПОСЛЕ расчёта спроси имя и телефон, чтобы менеджер
   уточнил детали. Вызови Create Lead.
6. Никогда не проси телефон раньше, чем дал пользователю пользу.

Тон: коротко, по-человечески, без канцелярита. Ты не робот-анкета.
```

### Appendix — Tool input descriptions (set "let the model define")
- `address` — "Полный адрес объекта: город, улица, дом. Если пользователь назвал только улицу — сначала уточни город и номер дома." (string)
- `width_m` — "Ширина балкона в метрах, число. Если не назвал — спроси." (number)
- `glazing_type` — "Тип остекления: 'холодное' или 'тёплое'." (string, enum)
- `floor` — "Этаж, число. Влияет на стоимость подъёма материалов." (number)
