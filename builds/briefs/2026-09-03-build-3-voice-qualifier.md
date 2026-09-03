# Brief: Голосовая квалификация лида (Speed-to-Lead Voice Qualifier)
**For:** Client-facing, same client as Build 2 · **Runs on:** Timeweb VPS · **Model:** Yandex SpeechKit STT + GigaChat · **Est. build:** Phase A 8–10 h · Phase B +10–14 h
**Ports:** Liam Build 3 · **Portability:** ~30% — Retell is unpayable and RU telephony needs a legal entity. **Two-phase path below sidesteps the blocker.**

## 0. The blocker, and the way around it
Liam uses Retell AI: card declined, and a Russian inbound phone number requires a **verified legal entity** (ИП/ООО) — the same blocker already open for MAX. That's legal, not technical; no amount of building fixes it.

So this build ships in two phases:

| | Channel | Needs ИП/ООО? | Teaches |
|---|---|---|---|
| **Phase A** — build now | Voice **message** in Telegram/VK → STT → qualify | **No** | Everything: STT, transcript analysis, structured output, CRM matching, event-driven flow |
| **Phase B** — after ИП exists | Real inbound call via Voximplant → same pipeline | Yes | Telephony provisioning only |

Phase A is not a compromise. It teaches every transferable skill in Liam's build and it's *independently sellable* — "клиент присылает голосовое, через 30 секунд менеджер видит квалифицированную заявку" is a real offer. Phase B swaps the front door; §3's ingest node onward is unchanged. **Design it that way from the first node.**

## 1. What it does
A lead who came through the Build 2 widget gets asked to send a voice message (Phase A) or call a number (Phase B) and answer three questions. The system transcribes it, judges against the client's qualification criteria, and updates their Bitrix24 deal to Квалифицирован or Отказ with a written reason and the transcript attached. A salesperson opens their morning list already sorted. Nobody listens to 40 minutes of audio.

## 2. Trigger
**Phase A:** Telegram Trigger — `message` with `voice`. Same normalization node as Builds 1–2.
**Phase B:** **Webhook** (POST) receiving Voximplant's call-ended event `[VERIFY exact payload shape]`, immediately followed by **Respond to Webhook** 200. Voximplant retries on non-200 — acknowledge first, process after.

## 3. Architecture
Pattern: **event ingest**, fully automated, no human in the loop. Liam's build is an if/else tree; keep it that way — the branches are enumerable, so an agent would be slower, pricier, and non-deterministic for zero gain.

```
Telegram voice  ──┐
Voximplant hook ──┼→ Normalize Ingest (Set) { phone, transcript_source, audio_url, ts }
                  │        ↓
                  │   Respond 200 (webhook path only)
                  │        ↓
                  │   Redis dedup on call_id / message_id
                  │        ↓
                  │   IF audio? → Yandex SpeechKit STT → transcript
                  │        ↓
                  │   Workflow Configuration (Set)
                  │        ↓
                  │   Bitrix24: crm.deal.list by PHONE
                  │        ↓
                  │   IF lead found?
                  │     ├ no  → Postgres: unmatched_calls + Telegram alert
                  │     └ yes → Bitrix24 update stage = "Контакт установлен"
                  │              ↓
                  │           GigaChat: analyze transcript
                  │            + Structured Output Parser
                  │              ↓
                  │           Switch on qualified
                  │             ├ true  → stage "Квалифицирован" + fields
                  │             └ false → stage "Отказ" + reason
                  └→ Error Trigger → Telegram alert
```

| # | n8n node | Does what | Key config | Fails how |
|---|---|---|---|---|
| 1 | Telegram Trigger / Webhook | Ingest | download files on / POST | Voximplant retries if not 200 within its timeout |
| 2 | Respond to Webhook | Immediate ack | 200, empty body | Placed after processing = duplicate events. **Must be node 2.** |
| 3 | Edit Fields | Normalize ingest | `phone` **normalized to E.164** | Bitrix24 stores `+7`, `8`, and `7` variants — normalize both sides or the match silently fails |
| 4 | Redis | Dedup | `SET NX EX 86400` on `call_id`/`message_id` | Without this, one call qualifies a lead twice |
| 5 | Telegram: Get File | Fetch voice `.oga` | binary | file_id expired |
| 6 | HTTP Request | Yandex SpeechKit STT | `[VERIFY]` async recognition for >30s audio; sync for short | Sync endpoint caps at ~30s — a 2-min message needs the async API + polling |
| 7 | Edit Fields | Workflow Configuration | `bitrix_webhook_url`, `phone_field`, `min_budget`, `region`, `stage_ids` | Hardcoding these into 6 nodes is how you lose an afternoon later |
| 8 | HTTP Request | Bitrix24 `crm.deal.list` | filter on phone | 401 stale webhook; empty result is normal, not an error |
| 9 | IF | Lead found? | — | — |
| 10 | HTTP Request | Bitrix24 `crm.deal.update` | stage → Контакт установлен | Wrong `stage_id` — they're pipeline-specific, read them from the client's portal, never assume |
| 11 | Basic LLM Chain | Analyze transcript | GigaChat + Structured Output Parser, schema §5 | Returns prose not JSON — see §6 |
| 12 | Switch | Route on `qualified` | — | Null `qualified` → route to manual review, not to Отказ. **Never auto-reject on a parse failure.** |
| 13/14 | HTTP Request | Update deal | qualified / disqualified + reason + transcript | Field length limit on the comment |
| 15 | Postgres | `unmatched_calls` | phone, transcript, ts | — |
| 16 | Error Trigger | Alert | → Telegram | — |

## 4. Credentials & environment
- **Telegram Bot API** — reuse Build 1's bot or a client-specific one.
- **Yandex Cloud SpeechKit** — service account, IAM token (12h TTL, refresh on a schedule into Redis) or API key `[VERIFY which STT accepts]`. Model: `general:rc` with `ru-RU`.
- **GigaChat** — reuse the OAuth+cache sub-workflow.
- **Bitrix24 inbound webhook** — scopes `crm`. **The client owns it.**
- **Voximplant (Phase B)** — account, application, scenario, purchased RU number. **Number purchase requires ИП/ООО + document verification.** Budget 1–2 weeks for that, not 1–2 hours.
- **Postgres** — `unmatched_calls`, `qualification_log`.

## 5. Data
**In (Phase A):** Telegram voice message + `from.id`. Phone must be obtained separately — **Telegram does not expose a phone number unless the user shares a contact.** Either the Build 2 widget already captured it (preferred — that's the actual link between builds), or the bot asks with a `request_contact` keyboard button. Do not assume you have it.

**In (Phase B):** `{ call_id, from_number (E.164), duration, transcript | recording_url, ended_at }`

**Structured output schema** (Structured Output Parser):
```json
{
  "qualified": true,
  "in_region": true,
  "is_owner": true,
  "budget_ok": true,
  "budget_mentioned": 150000,
  "objections": ["дорого", "нужно посоветоваться с женой"],
  "summary": "Двухкомнатная в Химках, балкон 3.2м, хочет тёплое остекление до конца месяца",
  "next_action": "замер",
  "confidence": 0.86
}
```
Every boolean gets its own field, not just `qualified` — when the client disputes a rejection you need to point at *which* criterion failed.

**Stored:** `qualification_log` (deal_id, transcript, parsed JSON, model, ts) — you will need this to tune the prompt against real calls, and to defend a disputed rejection.

**Retention:** transcripts are персональные данные under 152-ФЗ. Agree a retention window with the client (90 days is defensible) and actually implement the delete job. Most competitors don't. Say so.

## 6. Error handling
- Error Trigger → Telegram alert to Naimat + the client's manager if the deal was already touched.
- **STT fails** → attach the raw audio URL to the deal, set stage "Требует прослушивания", alert the manager. Never silently drop.
- **Structured Output Parser fails** → retry once with a stricter prompt; on second failure route to **manual review**, never to Отказ. An automated rejection based on a parse error is the single most damaging failure mode in this build — it loses the client a real customer and they will find out.
- **Confidence < 0.7** → stage "Требует проверки" regardless of the verdict.
- **No phone match** → log + alert. A rising unmatched rate means the widget isn't storing phones correctly; that's a Build 2 bug surfacing here.
- Retries: SpeechKit 2, GigaChat 3, Bitrix24 3.
- Rate limits: Bitrix24 REST ~2 req/s. At 50 calls/day, fine.

## 7. Test plan
1. **Happy path:** voice message — "да, я из Химок, квартира моя, бюджет тысяч 150" → deal moves to Квалифицирован with all three booleans true and `budget_mentioned: 150000`.
2. **Edge case:** ambiguous — "ну, надо посчитать, может тысяч сто, квартира вообще жены" → **must not** auto-qualify. Expect low confidence → Требует проверки. This is the case that decides whether the client trusts the system.
3. **Edge case:** 2-minute rambling message → confirm the async STT path works. The sync endpoint will silently truncate.
4. **Failure case:** bad IAM token → audio attached to the deal, manager alerted, nothing lost.
5. **Failure case:** malformed LLM output → manual review, **never** Отказ. Test by forcing it.
6. **Dedup:** replay the same webhook twice → one update.
7. **Phone matching:** test `+79161234567`, `89161234567`, `7 916 123-45-67` all match the same Bitrix24 deal. They will not, until you normalize both sides. Budget an hour for this alone.
8. **No match:** unknown number → `unmatched_calls` row + alert, no crash.

## 8. Cost at stated volume
50 qualifications/day.
- SpeechKit STT: 50 × ~90s = 75 min/day ≈ 2 250 min/mo → `[VERIFY ₽/min]`, likely the dominant cost
- GigaChat: 50 × ~2 500 tokens (transcripts are long) ≈ 3.8M tokens/mo
- Bitrix24: free tier sufficient
- Voximplant (Phase B): number rental + per-minute inbound `[VERIFY]`
- VPS: negligible

## 9. Commercial
- Phase A setup: **80 000–110 000 ₽** · Phase B (+telephony): **+60 000–90 000 ₽** · Retainer: **15 000–20 000 ₽/mo**
- Retainer covers: criteria tuning against real transcripts (do this monthly — it's the highest-value hour you'll spend), stage mapping changes when they restructure their pipeline, STT/model updates, uptime.
- **Sell on response time, not on AI.** "Лид, который оставил заявку в 23:40, утром уже лежит квалифицированным в вашей воронке" — the numbers on speed-to-lead conversion are real and the client can check them.
- Sell Phase A to a Build 2 client at month 2. The upsell path is the whole point of doing these in order.

## 10. Open risks
- **ИП/ООО blocks Phase B entirely.** Not negotiable, not technical. Phase A is the answer until it's resolved — do not promise a client a phone number you cannot buy.
- **Getting the phone number in Phase A is the real design problem**, not the STT. Solve it in Build 2 (widget captures the phone, then invites the voice message) rather than in Build 3.
- `[VERIFY]` SpeechKit accuracy on phone-quality audio with background noise. Test with 10 real messages before quoting.
- `[VERIFY]` Voximplant webhook payload shape and whether it includes a transcript or only a recording URL. Changes node 6 substantially.
- `[VERIFY]` Bitrix24 `stage_id` values are per-pipeline — read them from the client's actual portal.
- Auto-rejecting a real customer is the reputational risk. The conservative routing in §6 exists for that reason; do not "optimize" it away to look more automated.

## 11. Build order
1. Telegram voice message → Get File → save binary. Green.
2. SpeechKit STT standalone, one real voice message, read the raw response.
3. Async STT path for >30s audio. Do this now, not when a client hits it.
4. Bitrix24 `crm.deal.list` standalone. **Solve phone normalization here**, in isolation, before it's buried in a flow.
5. GigaChat + Structured Output Parser on a hardcoded transcript. Get clean JSON reliably before wiring anything.
6. Wire the full path with the IF/Switch branches.
7. Deal updates, both branches, correct `stage_id`s from the client's portal.
8. Dedup, Error Trigger, low-confidence routing, unmatched logging.
9. Run 20 real voice messages through it. Read every parsed output by hand. **This is the step that makes it trustworthy** — skip it and you'll find out from the client.
10. Phase B: swap the front door, only after ИП exists.

> **Next: open n8n at n8n.n-enterprise.ru, build step 1 of §11 in isolation, confirm it runs green before adding step 2.**

---
### Appendix — Transcript analysis prompt (RU)
```
Ты анализируешь расшифровку разговора с потенциальным клиентом
компании по остеклению балконов.

Критерии квалификации:
1. Регион: объект в {{region}} или ближайшей области
2. Собственность: человек владеет квартирой (не арендует)
3. Бюджет: готов потратить не менее {{min_budget}} ₽

Верни СТРОГО JSON по схеме. Правила:
- Если критерий прямо не прозвучал — ставь false и понижай confidence.
  НЕ додумывай за клиента.
- qualified = true только если все три критерия true.
- В objections перечисли реальные возражения его словами.
- summary — 1–2 предложения, что именно нужно клиенту.
- confidence — насколько уверенно расшифровка отвечает на все три вопроса.
  Плохое качество записи или уклончивые ответы = низкий confidence.

Лучше вернуть низкий confidence, чем уверенно ошибиться:
ошибочный отказ стоит компании реального клиента.
```
