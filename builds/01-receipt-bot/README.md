# Build 1 — Бот учёта расходов (VK)

Photograph a receipt in VK. The bot reads it, extracts every line, checks the
arithmetic against the printed total, and writes the expense to a table.

**Status:** running in production on `n8n.n-enterprise.ru` since 2026-09-13.
**Channel:** VK community [NXAI AUTOMATION](https://vk.com/club238091644) (`238091644`).
**Measured:** ~10s end to end, with an acknowledgement in ~2s.

---

## What it actually does

```
VK message with a photo
  → dedup on VK's event_id
  → "🔍 Читаю чек…"                    (~2s, before any real work)
  → download the photo (≤1600px rendition)
  → Yandex Vision OCR
  → flatten to text
  → YandexGPT Lite extracts fields + line items
  → deterministic validation and reconciliation
  → row in `expenses`
  → reply with the total and every line
```

Real output, from the live bot:

```
✅ Записал

ООО "АШАН"
1940.8 RUB · 2026-09-04
Категория: канцтовары

Позиции (9):
• ONE ДЛЯ КОТЯТ КУР — 144.99
• КРЕМ-СУП Д/К КР.40Г — 114.99
• ТЕТРАДЬ 48Л.ГЕОМ ЗАГ — 29.97
• ТЕТРАДЬ 48Л.ГЕОМ ЗАГ — 29.97
• ONE ПАУЧ ДЛЯ КОТЯТ — 31.99
• ONE ПАУЧ ДЛЯ КОТЯТ — 31.99
• ТЕТ/КОН. А4 80Л.СКР. ×5 — 974.95
• ТЕТР COLORS 80Л КЛЕТ ×5 — 574.95
• ПАКЕТ-МАЙКА БЕЛЫЙ ПН — 7.00
```

## The design decision that matters

**The model extracts. It never decides what is valid.**

The prompt tells it to pass amounts and dates through *exactly as printed* —
apostrophes, `=` signs and all. A separate deterministic layer
(`normalize.js`, 43 tests) then repairs, validates, and reconciles.

This is not fussiness. Yandex Vision misreads Cyrillic in thermal-print fonts:
`3` comes back as `З`, `Э` as `З`. A model asked to "fix" that would quietly
turn `ООО РАФАЗЛЬ` into `ООО РАФА3ЛЬ`, and there would be no record it happened.
Instead:

- Glyph repair runs on **typed numeric fields only** — amount, date, ИНН, card
  mask. Vendor names and addresses are never character-substituted.
- A repaired value is **flagged as repaired** and shown in the reply, so the
  correction is auditable rather than invisible.
- Anything that cannot be repaired becomes a review record **with a stated
  reason** — never a zero, never a silent drop, never an automated rejection.

## The reconciliation check

A receipt states its own total, so the line items must add up to it. When they
don't, OCR lost a line or the model invented one.

This caught a real failure on its first live run. The model collapsed two pairs
of identical lines (`ТЕТРАДЬ 48Л ×2`, `ONE ПАУЧ ×2`) into one entry each, and
the bot reported:

```
сумма позиций 1878.84 не сходится с итогом 1940.80
```

Exactly the two dropped lines. Without the check, that row would have looked
clean while being 62 ₽ short. The prompt now forbids merging repeated lines,
and the check remains as the backstop.

Tolerance is one kopeck per line — enough for rounding on per-unit prices, not
enough to hide a missing row.

## Failure paths

Nothing is ever dropped silently. Every one of these writes a row and tells the
user what to do:

| Situation | Behaviour |
|---|---|
| Blurred / dark photo | OCR output judged unusable *before* the model sees it — no hallucinated receipt |
| Several slips in one photo | Detected and refused; the bot will not pick one and call it "the" expense |
| No date on the receipt | Falls back to the send date, marked `date_assumed`, reason stated |
| Model returns prose, not JSON | Review row with that reason |
| A field fails its pattern | Review row; fields that *did* parse are still captured |
| PDF sent instead of a photo | Explains itself rather than crashing OCR |

## Files

| File | Purpose |
|---|---|
| `workflow.json` | The 33-node workflow. Import into n8n. |
| `normalize.js` | OCR repair, field validation, item reconciliation. **Single source of truth.** |
| `normalize.test.js` | 43 tests, including a corpus of values taken verbatim from real receipts |
| `ocr-text.js` | Yandex Vision response → flat text |
| `ocr-text.test.js` | 10 tests, run against the real captured responses |
| `node-code/*.node.js` | Generated copies for pasting into a live n8n node without re-importing |
| `test-receipts/`, `ocr-results/` | The real Samara receipts and their OCR responses |

The VK plumbing lives in [`../vk-adapter/`](../vk-adapter/) and is shared with
Build 3A.

## Setup

1. VK community + token: [`docs/05-vk-setup.md`](../../docs/05-vk-setup.md)
2. Two Data Tables, created **from CSV** (importing into an existing table only
   appends rows, it will not build a schema):
   - `expenses` — from `expenses-schema.csv`, then add columns `items` (String),
     `items_total` (Number), `items_count` (Number)
   - `processed_events` — from `processed-events-schema.csv`
3. Import `workflow.json`, then select:
   - `VK Group Token` (Query Auth) on **Ack — Reading** and **Send VK Reply**
   - `Yandex AI Studio` (OpenAI type, Base URL `https://llm.api.cloud.yandex.net/v1`) on the model node
   - `Yandex Api-Key` (Header Auth, `Authorization` = `Api-Key <key>`) on **Yandex Vision OCR**
   - the two Data Tables on the four Data Table nodes
4. Set **Workflow Settings → Error Workflow** to `00 Error Alerts — VK`
5. Publish

> **Importing replaces nothing.** n8n *appends* on import and suffixes colliding
> node names with `1`, which breaks the `$('Node Name')` references the Code
> nodes rely on. To update: select all on the canvas, delete, then import.
> For a code-only change, paste from `node-code/` instead and skip the import.

## Why it is fast

Measured on the same receipt, same day:

| Change | Time |
|---|---|
| Baseline (`qwen3-235b-a22b-fp8`, 2560px image, model echoing OCR text) | **40.5s** |
| → `yandexgpt-lite` | 17.3s |
| → image capped at 1600px, `raw_text` no longer echoed by the model | **10.1s** |

Qwen 3 is a reasoning model: it generates a long internal chain of thought
before answering, which is pure cost on a fixed-field extraction, and it carries
the ~30× markup Yandex applies to Chinese models. Lite is RU-native, cheaper and
accurate enough here — vendor, total and date were identical across every
comparison. The Qwen model string is kept in the node's notes for one-field
switch-back on reasoning-heavy work.

Asking the model to return `raw_text` made it retype up to 2000 characters of
OCR output it had just been given — roughly as many output tokens as the useful
answer. Generation latency is made of output tokens.

**~10s is close to the floor for this architecture.** Four network round-trips
happen in sequence: VK's CDN, the Vision upload, Vision processing, and model
generation. What makes it feel instant is answering in 2s and thinking after.

## Not built yet

- **Q&A over the history** («сколько потратили на такси в августе?») — in the
  brief, not implemented. The data is in `expenses` and ready for it.
- **Threshold alerts** to a finance owner. When built, it must be split into
  draft and send — never one tool that composes and sends unreviewed.
- Line items are stored as JSON in one column. Fine at this volume; a proper
  `expense_items` table is the move if a client needs per-item reporting.

## Tests

```bash
node builds/01-receipt-bot/normalize.test.js          # 43
node --test builds/01-receipt-bot/ocr-text.test.js    # 10
node --test builds/vk-adapter/*.test.js               # 22
python3 builds/vk-adapter/sync-code-node.py --check   # workflow vs source drift
```

The test corpus is real. `З'980.00 РУБ`, `=10480.00`, `ООО РАФАЗЛЬ`, `****5353 W`
are values taken verbatim from Vision's output on the receipts in
`test-receipts/`. Testing against them is what exposed the amount parser
rejecting almost every real total — it only accepted a bare `2'690.00`, and real
slips never print one.
