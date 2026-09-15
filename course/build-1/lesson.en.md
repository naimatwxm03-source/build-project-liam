# Build 1: Receipt Expense Tracker

> **Stack note.** This build runs on Russian infrastructure — VK instead of
> Telegram, Yandex AI Studio instead of OpenAI, self-hosted n8n instead of
> cloud. That is not a preference, it is connectivity and law: a Telegram bot
> on a Russian IP does not work, and client data may not leave the country
> (152-FZ). The *pattern* transfers anywhere; the vendors swap. Where a global
> substitute exists, it is named.

## What You're Building

A bot in a VK community that works as a company expense tracker. An employee
photographs a receipt, and it:

* reads the receipt with Yandex Vision OCR;
* extracts vendor, date, total, tax, category and **every line item**;
* reconciles the line items against the printed total and catches the gap;
* writes a row to a table;
* replies with exactly what it recorded, itemised.

**Measured on the live bot:** ~10 seconds photo to row, acknowledgement in ~2.

| This build | Global substitute |
|---|---|
| VK Callback API | Telegram Bot API |
| Yandex Vision OCR | Google Document AI, AWS Textract |
| YandexGPT Lite | GPT-4o-mini, Gemini Flash, Claude Haiku |
| n8n Data Tables | Google Sheets, Airtable, Postgres |

## Why This Build Matters

This is your first end-to-end agent. It teaches three skills you reuse in
every build after it:

1. **Structured data from an image** — turning a photograph into clean JSON.
2. **A channel adapter** — the inbound → work → reply loop, built so a second
   channel is a new adapter file rather than a rewrite.
3. **The boundary between the model and the truth** — the important one.
   The model **extracts**. The model **never decides what is valid.**

## The Build Process

Three steps, repeated in every build:

1. **Settle the architecture** — `/automation-cto`. Not "write me a bot", but
   an argument about what should be automated at all. Half of every idea gets
   simpler at this step and some of it gets deleted.
2. **Write the brief** — `/n8n-brief`. Turns a settled architecture into a
   node-by-node plan: nodes, credentials, error handling, test plan, cost.
3. **Generate the workflow** — Claude Code writes `workflow.json` from the
   brief. Import, connect credentials, publish.

> **Why not n8n's "Build with AI".** That button does not exist in self-hosted
> n8n — it is cloud-only. And self-hosting is mandatory here, because client
> data cannot leave the country. So the JSON is generated outside and imported.

**Never skip step 1 on a fuzzy idea.** A brief written against an unsettled
architecture is a well-formatted wrong answer.

## Workflow Architecture

33 nodes, in four readable blocks:

```
VK: message with a photo
      ↓
  [1] INTAKE       verify secret → reply "ok" immediately → dedup on event_id
      ↓
  [2] ACK          "🔍 Reading the receipt…"        ← ~2s, BEFORE any work
      ↓
  [3] EXTRACT      download photo → Yandex Vision OCR → flatten to text
      ↓                  → YandexGPT Lite: extract fields and line items
      ↓
  [4] VERIFY       normalize.js: OCR repair, validation, reconciliation
      ↓                  ├── reconciles → row in `expenses`
      ↓                  └── does not   → review row, with a stated reason
      ↓
  VK: reply with the total and every line
```

**Three VK mechanics that decide whether this works at all:**

1. The address handshake demands a **bare string as plain text**, not JSON. The
   Webhook node must use "Respond to Webhook", or VK never confirms the server.
2. **Reply `ok` before doing any work.** VK treats a slow endpoint as a failure
   and retries — and you log the same receipt twice.
3. **Verify the `secret` field on every event.** The webhook URL is public.

*(Telegram equivalents: no handshake, but the same retry behaviour and the same
need to answer fast.)*

## The Key Decision: the Model Extracts, It Does Not Judge

Yandex Vision misreads Cyrillic in thermal print: `3` comes back as `З`, `Э` as
`З`. A model asked to "fix" that will quietly turn `ООО РАФАЗЛЬ` into
`ООО РАФА3ЛЬ`, and there will be no record it happened.

So the prompt requires amounts and dates **exactly as printed**, apostrophes and
`=` signs included. A separate deterministic layer repairs them —
a Code node inside the workflow, covered by 43 tests:

* glyph repair runs on **typed numeric fields only** — total, date, tax ID, card
  mask. Vendor names and addresses are never character-substituted;
* a repaired value is **flagged as repaired** and shown in the reply, so the
  correction is auditable rather than invisible;
* whatever cannot be repaired becomes a review row **with a stated reason**.
  Never a zero, never a silent drop, never an automated rejection.

## Reconciliation — the Check That Caught a Real Failure

A receipt states its own total, so the line items must add up to it.

On the very first live run the model collapsed two pairs of identical lines
(`ТЕТРАДЬ 48Л ×2`, `ONE ПАУЧ ×2`) into one entry each. The bot replied:

```
line items 1878.84 do not reconcile with total 1940.80
```

Exactly the two dropped lines. Without the check that row would have looked
clean while being 62 ₽ short. The prompt now forbids merging repeated lines, and
the check remains as the backstop.

Tolerance is one kopeck per line — enough for rounding, not enough to hide a
missing row.

## Step-by-Step Build Guide

### 1. VK community and token
The full procedure is attachment **"3. Настройка ВКонтакте.docx"** — ~15 minutes,
free, needs only a personal VK account.

One rule from it is worth knowing up front: **the workflow must be published
BEFORE you press "Подтвердить" in Callback API settings.** Otherwise VK marks
the address failed and you confirm again from scratch.

**Ground truth for the connection is `groups.getCallbackServers`**
(`status`: `ok` / `failed` / `wait`), never the n8n UI — n8n looks healthy
either way.

*(On Telegram there is no handshake, but the publish-before-register ordering
still applies.)*

### 2. Two tables, created FROM CSV
Make a CSV with these headers and **create the tables from them** — the columns
come from the header row:

```
expenses
event_id,channel,user_id,vendor,expense_date,total,currency,category,
confidence,needs_review,review_reason,raw_text

processed_events
event_id,channel,processed_at
```

Then add three columns to `expenses`: `items` (String), `items_total` (Number),
`items_count` (Number).

**Set the column types explicitly — a CSV does not carry them:**
`total`, `items_total`, `items_count` are **Number**; `needs_review` is
**Boolean**; everything else **String**. A wrong type does not fail — it
quietly corrupts. A total stored as text will not add up in a report.

> Importing a CSV **into an existing table** only appends rows — it will not
> build a schema. Create the table from the CSV.

### 3. Yandex Cloud
One account for everything: model, Vision OCR, SpeechKit. One credential, one
bill, one auth pattern. The account goes in **the client's** name, not yours.

### 4. Import and connect credentials
* `VK Group Token` (Query Auth) — on **Ack — Reading** and **Send VK Reply**
* `Yandex AI Studio` (OpenAI type, Base URL `https://llm.api.cloud.yandex.net/v1`) — on the model node
* `Yandex Api-Key` (Header Auth, `Authorization` = `Api-Key <key>`) — on **Yandex Vision OCR**
* both tables — on the four Data Table nodes

### 5. Error Workflow
**Workflow Settings → Error Workflow** → `00 Error Alerts — VK`.

> This setting lives in the workflow's `settings`, and importing a file
> overwrites `settings` wholesale. Set by hand, it disappears on the next
> import — leaving the build with no alerting precisely when it is being
> changed.

### 6. Publish and test
Photograph a real receipt. Check: acknowledgement in ~2s, row in the table, every
line item in the reply. Then a blurred photo: you should get a review row with a
reason, not an invented receipt.

## Why It Is Fast

Measured on the same receipt, same day:

| Change | Time |
|---|---|
| Baseline (`qwen3-235b-a22b-fp8`, 2560px image, model echoing OCR text) | **40.5s** |
| → `yandexgpt-lite` | 17.3s |
| → image capped at 1600px, `raw_text` dropped from the response | **10.1s** |

Two causes. Qwen 3 is a **reasoning** model: it generates a long internal chain
of thought before answering, which is pure cost on fixed-field extraction. And
asking for `raw_text` made the model retype up to 2000 characters it had just
been handed.

**Generation latency is made of output tokens.** Never ask a model to return
something you already have.

**~10s is close to the floor for this architecture.** Four network round-trips
run in sequence: VK's CDN, the Vision upload, Vision processing, generation.
What makes it feel instant is answering in 2s and thinking afterwards.

## Key Concepts Learned

* **Multimodal extraction** — data out of an image.
* **The trust boundary** — model extracts, code decides. This transfers to
  everything.
* **Webhook deduplication** — external services retry. Always.
* **Answer before you work** — why the acknowledgement precedes processing.
* **Reconciliation as a backstop** — a check that catches what tests cannot.
* **Tests on real data** — a corpus of actual receipts, not invented strings.

## Resources

* **`1. Журнал сборки.docx`** (Build Log) — **read this first.** Everything
  that broke, why, and the prompt that would have prevented it. These
  mistakes cost days.
* **`2. Бриф.docx`** (Brief) — the brief the workflow was generated from.
* **`3. Настройка ВКонтакте.docx`** (VK Setup) — community, token, Callback
  API. You need it at step 1.
* **`4. n8n Workflow.json`** — the finished workflow, 33 nodes, ready to
  import (connect your own credentials).
