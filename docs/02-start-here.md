# START HERE — From Your Current VS Code Screen to Build 1 Running

macOS. You already have VS Code (you used it for Python). Follow this top to bottom. **Every command is copy-paste.** Every prompt to give Claude Code is written out for you.

If a step fails, the fix is almost always in §9 at the bottom. Check there before asking.

---

## Step 1 — Open a clean window (2 min)

Your VS Code currently has `super30` open with Python notebooks. Don't mix projects.

1. VS Code menu: **File → New Window**
2. In the new window: **Terminal → New Terminal** (or `` Ctrl+` ``)
3. Paste:

```bash
cd ~
mkdir -p projects && cd projects
git clone https://github.com/naimatwxm03-source/build-project-liam.git
cd build-project-liam
git checkout claude/liam-projects-review-33if7h
code -r .
```

The window reloads with this project. `super30` stays untouched in its own window.

---

## Step 2 — Install Claude Code (5 min)

In the same terminal:

```bash
npm install -g @anthropic-ai/claude-code
claude --version
```

**If `npm` is not found**, install Node first:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node
```

Then start it:
```bash
claude
```

Log in when prompted. Then type `/` — you should see **`automation-cto`** and **`n8n-brief`** in the list.

> Don't see `automation-cto`? Type `/exit`, then `claude` again. Project skills load at session start.

---

## Step 3 — Your secrets file (2 min)

```bash
cp .env.example .env
```

`.env` is gitignored — it will never reach GitHub. Leave it empty for now; you'll fill it in Step 5.

**Rule: never paste a real key into a chat message, a brief, or a workflow JSON. Only into `.env` and into n8n's credential fields.**

---

## Step 4 — Read before building (20 min, and it saves you days)

Open these in VS Code and read them, in this order:

1. `docs/01-reality-check.md` — costs, what to buy, where it hurts
2. `docs/ru-stack-map.md` — §1 Models especially
3. `builds/briefs/2026-09-03-build-1-expense-bot.md` — the whole thing

You don't need to memorise them. You need to know what's in them so you can point Claude Code at the right section.

---

## Step 5 — Yandex Cloud, the one account that runs everything (30 min)

This single account gives you the LLM (Qwen), receipt OCR, speech-to-text, and geocoding. Do it once, use it in all four builds.

**5.1** Go to [console.yandex.cloud](https://console.yandex.cloud), sign in with your Yandex ID, create a **billing account** (activate the trial grant), and note your **Folder ID** from the console URL or the folder page.

**5.2** Create a service account: **Folder → Service accounts → Create**. Name it `nxai-n8n`. Give it roles: `ai.languageModels.user`, `ai.vision.user`, `ai.speechkit-stt.user`.

**5.3** Create an **API key** for that service account (not an IAM token — API keys don't expire). Copy it immediately; it's shown once.

**5.4** Put both in `.env`:
```bash
YANDEX_CLOUD_FOLDER_ID=b1g...your_folder_id
YANDEX_API_KEY=AQVN...your_key
```

**5.5 — Prove it works before touching n8n.** Paste this whole block into your terminal:

```bash
source .env
curl -s https://llm.api.cloud.yandex.net/v1/chat/completions \
  -H "Authorization: Api-Key $YANDEX_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"gpt://$YANDEX_CLOUD_FOLDER_ID/qwen3-235b-a22b-fp8/latest\",
    \"messages\": [{\"role\": \"user\", \"content\": \"Ответь одним словом: работает?\"}]
  }" | head -40
```

**You must see a JSON reply with Russian text in it.** If you do — the hardest part of this whole project is already done.

If you get an error, don't guess. Paste the full error into Claude Code with:
> This is the Yandex AI Studio response. What's wrong and what's the exact fix?

---

## Step 6 — The receipt test (1 hour, do NOT skip)

**Build 1's entire value depends on one unknown: can Yandex Vision OCR read a crumpled Russian till receipt?** Nobody can answer that from a desk. Find out now, before you build anything around it.

1. Collect **20 real receipts** from your wallet — crumpled, faded, angled, bad lighting. Realistic ones, not clean flat ones.
2. Photograph them with your phone, put them in `builds/01-receipt-bot/test-receipts/`
3. In Claude Code:

> Write me a small shell or Python script that sends every image in
> `builds/01-receipt-bot/test-receipts/` to Yandex Vision OCR using the
> API key and folder ID from `.env`, and saves each raw JSON response to
> `builds/01-receipt-bot/ocr-results/`. Then summarise: for each receipt,
> did it find a vendor, a date, and a total?

Read the results yourself. Then decide:
- **Good (15+ of 20 readable)** → build exactly as the brief says
- **Bad (under 10)** → tell me the numbers and we change the approach *before* wasting a week

Whatever the outcome, **save the numbers.** "Vision OCR read 17 of 20 real receipts" is a real measurement, and real measurements are what make a portfolio credible.

---

## Step 7 — Telegram bot (10 min)

1. Open Telegram, message **@BotFather**
2. `/newbot` → give it a name → copy the token
3. Into `.env`:
```bash
TELEGRAM_BOT_TOKEN=8123...:AAF...
```

---

## Step 8 — Build it (the loop)

Now you work in Claude Code. **These are the exact prompts. Use them in order. Do not skip ahead — one green step before the next.**

**8.1 — the workflow JSON**
> Read `builds/briefs/2026-09-03-build-1-expense-bot.md`. Write the n8n
> workflow JSON for step 1 of §11 only — Telegram Trigger → Edit Fields →
> Telegram Send Message. Target n8n 2.36.8 self-hosted. Save it to
> `builds/01-receipt-bot/workflow.json`.

Then in n8n: **Workflows → Import from File** → pick that file → add your Telegram credential → **Execute** → message your bot. It should echo back.

**8.2 — the database**
> Now add the Postgres nodes from §3 of the brief, plus the `expenses`
> table schema from §5 as a `.sql` file I can run. Update workflow.json.

**8.3 — the model**
> Now add the OpenAI Chat Model node pointed at Yandex AI Studio, using
> the base URL and model string from `docs/ru-stack-map.md` §1. If the
> OpenAI node v2 has the base-URL bug, use the version that works.

**8.4 — OCR → agent → database**
> Now wire the full happy path from §3: photo → Yandex Vision OCR →
> agent → Postgres insert → Telegram reply.

**8.5 — the rest**
> Now add the remaining pieces from §11: the Q&A read tool, the threshold
> email alert, Redis dedup, and the Error Trigger workflow.

**8.6 — the test that catches the classic bug**
> Walk me through testing session isolation from §7 item 7 — two Telegram
> accounts talking at once must not share conversation memory.

**When something breaks**, paste the error into Claude Code exactly as n8n shows it:
> n8n gave this error on the [node name] node. Here's the full text: [paste]. What's the fix?

Don't retype or summarise the error. Paste it raw.

---

## Step 9 — When you're stuck: check here first

| Symptom | Fix |
|---|---|
| `automation-cto` missing from `/` list | `/exit`, then `claude` again |
| `npm: command not found` | Install Homebrew + Node — see Step 2 |
| LLM call returns 401 | Header must be `Authorization: Api-Key <key>` — **not** `Bearer` |
| "model not found" | Must be `gpt://<folder_id>/qwen3-235b-a22b-fp8/latest`, not `qwen3` |
| n8n credential test passes but the node 404s | Known OpenAI-node-v2 bug. Use node v1.8, or the AI Agent's OpenAI Chat Model node |
| Vision OCR 401 after working yesterday | You used an IAM token (12h expiry). Switch to a service-account **API key** |
| Imported workflow won't load | Paste the import error into Claude Code — it's usually a `typeVersion` field |
| Bot replies to the wrong person's question | Chat memory isn't keyed. Must be keyed by `channel + user_id` |
| Same receipt logged twice | Redis dedup on `message_id` is missing or not firing |

---

## Step 10 — Finish each build properly

A build isn't done when it runs. It's done when it's **evidence**. Four things, every time:

1. **Deployed** to a real URL with TLS — not localhost
2. **Used by real people** — 3–5 humans, real data
3. **A 60-second demo video** — screen recording, no narration needed
4. **A README** in `builds/0N-<name>/` — problem → architecture → stack → **what broke and how you fixed it**

That fourth item is the one that matters. Anyone can show a working demo. Almost nobody can explain the bug they solved. **That is your qualification, and later it's your course.**

---

## Step 11 — Saving your work

At the end of every session:

```bash
# in Claude Code, first:
/security-review

# then in the terminal:
git add -A
git commit -m "build 1: <what you did>"
git push -u origin claude/liam-projects-review-33if7h
```

`/security-review` catches an API key accidentally left in a workflow JSON. **Exported n8n workflows are the usual leak.** Run it every time — it takes 30 seconds and GitHub never forgets a committed secret.

---

## What to do right now, in order

1. Steps 1–3 — **15 minutes**
2. Step 5, the Yandex `curl` test — **30 minutes.** Stop here until it returns 200.
3. Step 6, the 20 receipts — **1 hour.** This decides Build 1's design.
4. Step 7 — **10 minutes**
5. Step 8.1 — first workflow green in n8n

That's Build 1's foundation in one evening. The rest of Build 1 is Step 8.2 onward.

**Come back to me when:** the Yandex curl fails, the OCR test scores badly, or an n8n error survives two attempts. Otherwise keep going — the prompts above are written to carry you through without me.
