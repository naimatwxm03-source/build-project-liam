# Brief: Бот учёта расходов (Expense Tracking Bot)
**For:** Internal / demo-able to clients · **Runs on:** Timeweb VPS (n8n.n-enterprise.ru) · **Model:** Yandex Vision OCR + Qwen 3 · **Est. build:** 6–8 h
**Ports:** Liam Build 1 · **Portability:** ~90% — pattern intact, vendors swapped

## 1. What it does
An employee photographs a receipt in Telegram. The bot reads the receipt, writes the expense to a database, alerts the finance owner by email if it's over a threshold, and answers plain-language questions about spending ("сколько потратили на такси в августе?"). It replaces a person retyping receipts into a spreadsheet, and it answers at 2am.

## 2. Trigger
**Telegram Trigger** — updates: `message`. Download files: **on** (photo receipts arrive as `file_id`).
`[Phase 2]` Add a **VK Webhook** adapter feeding the same normalization node. Build 1 ships Telegram-only — this is your own internal tool, so ship fast; the adapter goes in with Build 2 where a client's users are involved.

## 3. Architecture
Pattern: **single agent + tools**, with OCR pulled *out* of the agent into a deterministic pre-step.

> **Deviation from Liam, on purpose.** He lets one multimodal model both read the image and decide what to do. Split it: OCR is a solved deterministic problem, and Yandex Vision is better at it than any general chat model. The agent then reasons over clean text. Cheaper, more accurate, and the OCR step is independently testable.

```
Telegram Trigger
  → Normalize Message (Set)
  → IF has photo?
      ├ yes → Get File (Telegram) → Yandex Vision OCR (HTTP) → Set: receipt_text
      └ no  → Set: receipt_text = ""
  → Expense Agent (AI Agent, Qwen 3 (Yandex AI Studio))
        ├ tool: Log Expense       (Postgres insert)
        ├ tool: Query Expenses    (Postgres select)
        ├ tool: Alert Finance     (Send Email / SMTP)
        └ memory: Postgres Chat Memory, key = tg:{user_id}
  → Telegram: Send Message
```

| # | n8n node | Does what | Key config | Fails how |
|---|---|---|---|---|
| 1 | Telegram Trigger | Receives messages | `message`, download files on | Webhook not registered after n8n restart |
| 2 | Edit Fields (Set) | Normalize to common envelope | `channel`, `user_id`, `session_key`, `text`, `file_id`, `message_id`, `ts` | — |
| 3 | Redis | Dedup on `message_id` | `SET NX EX 86400`; if key exists → NoOp | Redis down → skip dedup, log warn, continue |
| 4 | IF | Photo present? | `$json.file_id` not empty | — |
| 5 | Telegram: Get File | Download the photo | binary out | 400 — `file_id` expired (>1h old forward) |
| 6 | HTTP Request | Yandex Vision OCR | POST, base64 image, `IAM-Token` header | 401 IAM token expired (12h TTL); 413 image >20MB |
| 7 | *(node removed)* | Yandex AI Studio needs no OAuth/token-cache node — the API key goes straight in the credential | — | — |
| 8 | AI Agent | Decides: log / query / alert | Qwen 3 via OpenAI Chat Model node (Yandex AI Studio base URL), system prompt §Appendix | Model returns prose instead of a tool call |
| 9 | Postgres (tool) | Insert expense row | table `expenses` | Unique violation on `message_id` — intended, treat as already-logged |
| 10 | Postgres (tool) | Read for Q&A | parameterized `SELECT` only | Agent writes an unbounded query → cap `LIMIT 200` in the tool |
| 11 | Send Email (tool) | Finance alert over threshold | Yandex 360 SMTP | 535 auth — app password not set |
| 12 | Telegram: Send Message | Reply | `chat_id` from envelope | 403 — user blocked the bot |
| 13 | Error Trigger | Catch-all | separate workflow → Telegram alert to Naimat | — |

## 4. Credentials & environment
- **Telegram Bot API** — token from @BotFather. Naimat owns.
- **Yandex Cloud** — service account + IAM token for Vision OCR. **IAM tokens expire in 12h** — either refresh via `Schedule Trigger` into Redis, or use an API key if the endpoint accepts one `[VERIFY which auth mode Vision OCR takes]`.
- **Yandex AI Studio (Qwen 3)** — same Yandex Cloud account and service-account **API key** as Vision OCR. In n8n create an **OpenAI credential** with:
  - API key: your Yandex Cloud service-account key
  - Base URL: `https://llm.api.cloud.yandex.net/v1`
  - Model string: `gpt://<folder_id>/qwen3-235b-a22b-fp8/latest`
  **No OAuth flow, no token cache, no cert-chain workaround.** If the OpenAI node v2 404s at runtime despite the credential test passing, use v1.8 or the AI Agent's OpenAI Chat Model node.
- **Postgres** — separate database `nxai_expenses`, not n8n's own DB. Own user, no superuser.
- **Redis** — already on the VPS. DB index dedicated to this workflow.
- **SMTP** — Yandex 360 app password.
- Webhook URL to register with Telegram: `https://n8n.n-enterprise.ru/webhook/<id>`

## 5. Data
**In:** `{ message_id, from.id, from.username, text?, photo[]?, date }`

**Out (to user):** confirmation with the parsed fields, or the answer to a query.

**Stored** — `expenses`:
```sql
id BIGSERIAL PK, logged_at TIMESTAMPTZ DEFAULT now(),
channel TEXT, user_id TEXT, username TEXT,
message_id TEXT UNIQUE,          -- dedup lives here
receipt_file_id TEXT, vendor TEXT, expense_date DATE,
currency TEXT DEFAULT 'RUB', total NUMERIC(12,2), tax NUMERIC(12,2),
category TEXT, notes TEXT,
confidence NUMERIC(3,2), needs_review BOOLEAN DEFAULT false,
over_threshold BOOLEAN DEFAULT false, alert_sent_at TIMESTAMPTZ
```
Index `(user_id, expense_date)` and `(category, expense_date)` — the Q&A tool hits both.

Retention: indefinite (accounting). Receipt images are **not** stored — only `file_id` and extracted fields.

## 6. Error handling
- **Error Trigger workflow** → Telegram DM to Naimat with workflow name, node, error, `execution_id`.
- **Retries:** Vision OCR and Qwen 3 (Yandex AI Studio) — 3 attempts, 2s/4s/8s. Postgres — 1 retry. SMTP — 2.
- **OCR fails entirely** → do not drop the message. Reply "не смог прочитать чек, отправьте сумму текстом" and let the agent take the text path. A failed read must never silently lose an expense.
- **Confidence < 0.8** → `needs_review = true`, still logged, reply says it needs checking. Logging a flagged row beats losing it.
- **Mid-batch failure:** n/a, one message per execution.
- **Rate limits at stated volume** — Telegram 30 msg/s (irrelevant), Vision OCR `[VERIFY RPS quota]`, Qwen 3 (Yandex AI Studio) per-plan. At <200 receipts/day nothing here binds.

## 6a. OCR field normalisation — verified finding, 2026-09-03

Yandex Vision OCR was tested live against real Russian thermal receipts (ООО Рафаэль, Самара, card terminal slips + Z-report). **Result: vendor, date and totals were all correctly found.** Build 1 proceeds as designed.

One real artifact surfaced and must be handled in the parsing step:

**Cyrillic/digit lookalikes.** On thermal paper, OCR confuses:
- `З` (Cyrillic ZE, U+0417) ↔ `3` (digit three)
- `О` (Cyrillic O, U+041E) ↔ `0` (digit zero)

**Normalise ONLY inside fields already known to be numeric** — `total`, `tax`, `expense_date`, ИНН, card number. Never across the whole OCR string, and never in `vendor` or `notes`: `ЗАО` would silently become `3АО`, `Заря` becomes `3аря`. A corrupted vendor name is worse than an unparsed one because it looks correct.

Implementation: extract the field first with a numeric-context regex, then normalise the characters inside the captured group only.

**Photograph one receipt per image.** Multiple slips in a single frame come back as one undifferentiated text blob with no reliable way to split them. The Telegram bot naturally enforces this (one photo per message), but say so in the user-facing instructions.

## 7. Test plan
1. **Happy path:** photo of a 1 240 ₽ taxi receipt → row in `expenses` with vendor, date, total 1240.00, category "транспорт", `confidence ≥ 0.8`, `over_threshold=false`; Telegram reply confirms the parsed fields.
2. **Edge case:** blurred, angled receipt in poor light → either `needs_review=true` with partial fields, or a clean "не смог прочитать" reply. **Never** a silently wrong total. This is the case that decides whether the bot is trustworthy.
3. **Threshold:** receipt over 50 000 ₽ → row has `over_threshold=true`, `alert_sent_at` set, and the email actually lands in the finance inbox (check spam).
4. **Failure case:** stop Yandex Vision (bad IAM token) → user gets the text-fallback reply, error alert reaches Naimat, nothing is lost.
5. **Dedup:** forward the same message twice → one row, second execution short-circuits at Redis.
6. **Q&A:** "сколько потратили на транспорт в августе" → number matches a hand-written SQL sum. If it doesn't, the tool description is wrong, not the model.
7. **Session isolation:** two Telegram accounts talking at once → neither sees the other's context. Test this. It is the most-missed bug in agent builds.

## 8. Cost at stated volume
Assume 200 receipts/day + 50 Q&A/day.
- Yandex Vision OCR: 200/day ≈ 6 000 pages/mo → `[VERIFY ₽/1000 pages]`, order of magnitude ~1 000–2 000 ₽/mo
- Qwen: 250 runs/day × ~1 200 tokens ≈ 9M tokens/mo → `[VERIFY Qwen 3 (Yandex AI Studio) package pricing]`
- Postgres/Redis: on existing VPS, ~0 marginal
- SMTP: included in Yandex 360
- **VPS headroom:** negligible. This build does not move the needle on the box.

## 9. Commercial
- Setup: **35 000–50 000 ₽** · Retainer: **8 000 ₽/mo**
- Retainer covers: uptime monitoring, OCR prompt/category tuning as their vendors change, category taxonomy changes, volume growth, one channel addition per year.
- Sell it as: "ваш бухгалтер перестанет перебивать чеки руками", not "AI-бот". The buyer is whoever currently retypes receipts.

## 10. Open risks
- `[VERIFY]` Yandex Vision OCR accuracy on crumpled thermal-paper RU receipts. **Test this before quoting anyone.** The entire value proposition rests on it. Budget an hour with 20 real receipts from your own wallet.
- `[VERIFY]` Qwen 3 (Yandex AI Studio) auth scope — `_PERS` may have limits that bite on a client deployment; `_CORP` needs a legal entity.
- `[ASSUMED]` RUB default currency, 50 000 ₽ threshold. Client-configurable in the Workflow Configuration node.
- The ИП/ООО question blocks `_CORP` scope and MAX, same as everywhere else.

## 11. Build order
1. Telegram Trigger → Set → Telegram reply. Echo bot. **Green before anything else.**
2. Add Postgres. Log a hardcoded row. Confirm it lands.
3. Add the OpenAI Chat Model node pointed at Yandex AI Studio in a scratch workflow — one completion with Qwen. Confirm the base URL and `gpt://<folder_id>/qwen3-235b-a22b-fp8/latest` model string work before anything else.
4. Add Yandex Vision OCR standalone. Feed it one real receipt. Look at the raw response before you write any parsing.
5. Wire OCR → agent → Postgres insert. Full happy path.
6. Add the Q&A read tool.
7. Add the threshold email.
8. Add Redis dedup + Error Trigger.
9. Session-isolation test with two accounts.

> **Next: open n8n at n8n.n-enterprise.ru, build step 1 of §11 in isolation, confirm it runs green before adding step 2.**

---
### Appendix — Agent system prompt (RU)
```
Ты — ассистент по учёту расходов компании. Работаешь в Telegram.

Когда приходит текст с распознанного чека:
1. Извлеки: продавец, дата, сумма, НДС, валюта, категория.
2. Категории: транспорт, питание, проживание, ПО, оборудование, реклама, прочее.
3. Валюта по умолчанию RUB. Дата по умолчанию — сегодня, если не читается.
4. Оцени уверенность 0..1. Если < 0.8 — ставь needs_review=true.
5. Вызови инструмент Log Expense. Никогда не логируй дважды один message_id.
6. Если сумма > порога — вызови Alert Finance.
7. Всегда ответь пользователю: что записал, какими полями. Кратко.

Когда приходит вопрос о расходах — вызови Query Expenses и ответь числом
с периодом. Не выдумывай цифры: если инструмент вернул пусто, так и скажи.

Никогда не выдумывай сумму, которой не было в чеке. Лучше спросить.
```
