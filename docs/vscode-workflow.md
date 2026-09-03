# Working This Repo From VS Code — Setup and Operating Manual

Everything below runs on your laptop. Claude Code in VS Code is where planning, briefing, and code-writing happen; the VPS is where workflows run. Never confuse the two — Claude never runs inside an n8n node.

---

## Part A — One-time setup (~20 minutes)

### 1. Install
- **VS Code** — code.visualstudio.com
- **Claude Code extension** — VS Code Extensions panel → search "Claude Code" → Install. Or install the CLI (`npm i -g @anthropic-ai/claude-code`) and run `claude` in VS Code's integrated terminal; the extension auto-detects it.
- **Git** — `git --version` to check.
- **Node 20+** — needed for Build 4's frontend.

### 2. Clone this repo
```bash
git clone https://github.com/naimatwxm03-source/build-project-liam.git
cd build-project-liam
git checkout claude/liam-projects-review-33if7h
code .
```

### 3. Confirm the skills loaded
In the Claude Code panel, type `/` — you should see `automation-cto` and `n8n-brief`. The first is project-scoped (lives in `.claude/skills/` here); the second is on your account and follows you everywhere.

If `automation-cto` doesn't appear: restart the Claude Code session — project skills load at session start.

### 4. Secrets — read this before you paste a single token
```bash
cp .env.example .env
```
`.env` is gitignored. **Never** put a real token in a brief, a workflow JSON, or a commit. Workflow JSON exported from n8n contains credential *references*, not secrets — but check before committing, every time.

Before any push: `/security-review`.

---

## Part B — The build loop (repeat per build)

This replaces Liam's `CTO GPT → Relevance → n8n AI` chain. Same five stages, all in one window, all committed to git.

### Stage 1 — Decide the architecture · `/automation-cto`
```
/automation-cto Build 2 from the course — website lead-gen chat with an
instant estimate. Re-ground it for RU: what vertical, what data source
replaces the Solar API, what channel?
```
Returns a decided architecture: pattern, dependencies with RU substitutes, what's being cut, where the human stays, kill risks. **Not a menu.** If it hands you options, tell it to pick.

Save the output to `builds/decisions/NN-<slug>.md` and commit. In six months this file is why you built it that way.

### Stage 2 — Spec it · `/n8n-brief`
```
/n8n-brief <paste the architecture from Stage 1>
```
Returns the node-by-node build document into `builds/briefs/`. If a brief needs rewriting, it failed — send it back with what was missing rather than patching it by hand.

### Stage 3 — Research the unknowns · `WebSearch` / `WebFetch`
Every `[VERIFY]` tag in the brief is a task. Ask in the same session:
```
Check the current Qwen 3 (Yandex AI Studio) API pricing and whether the vision endpoint
handles photographed receipts. Update builds/briefs/<file> with what you find.
```
This is the one thing Liam's CTO GPT does that you must not skip — API research. Claude Code does it in the same window as the code.

### Stage 4 — Build
```
Write the n8n workflow JSON for §3 of builds/briefs/<file>.
Target n8n 2.36.8 self-hosted. Qwen 3 via the OpenAI Chat Model node
pointed at Yandex AI Studio. Save to builds/02-lead-widget/workflow.json.
```
Then in n8n: **Workflows → Import from File**, reconnect credentials, run node-by-node.

Build **step 1 of §11 in isolation and confirm it runs green before adding step 2.** This is the rule that got the VK bot built. It has not stopped being true.

When something breaks, paste the n8n error straight into Claude Code — it has the brief, the JSON, and the error in one context. That's the advantage over screenshotting into a GPT.

Frontend work (Build 4): `/run` to launch and check it in a browser; `/design` if you want to lay the UI out visually before coding it.

### Stage 5 — Ship
```bash
git add -A && git commit -m "build 2: lead widget workflow + brief"
git push -u origin claude/liam-projects-review-33if7h
```
Before the push: `/security-review`. Before merging anything substantial: `/code-review`.

Then the part Liam doesn't teach and that is where the portfolio actually lives:
- Deploy to a public URL on the VPS
- Record a 60-second demo
- Write `builds/NN-<slug>/README.md`: problem → architecture → stack → demo link

A build without those three is a screenshot. With them it's a case study you can put in a proposal.

---

## Part C — Which skill, when

Use them deliberately. Most of these you already have; the point is knowing which one owns which moment.

| Moment | Skill / tool | Why this one |
|---|---|---|
| Fuzzy idea, no architecture | `/automation-cto` | Decides. Cuts scope. Checks RU payability before you get attached. |
| Architecture decided, need node detail | `/n8n-brief` | The buildable spec. Enforces VPS constraints. |
| A `[VERIFY]` tag | `WebSearch` / `WebFetch` | Never answer an API-pricing question from memory. |
| Writing workflow JSON / frontend code | Claude Code directly | Reviewable, diffable, committed. |
| Need to see the app run | `/run` | Launches and drives it; screenshots the result. |
| Laying out a UI before coding | `/design` | Multi-artboard canvas you can tweak visually. Build 4's frontend. |
| Explaining architecture to a client | `/excalidraw-diagram` | Editable diagram. Goes straight into a proposal. |
| Client proposal as a document | `/docx` | Proper Word file, RU-formatted, printable. |
| Pitch deck / case study deck | `/pptx` | For the portfolio deck once 2+ builds ship. |
| Pricing model, cost table, volume math | `/xlsx` | §8 of every brief has numbers — put them somewhere real. |
| Before every push | `/security-review` | Catches a token in a workflow JSON before GitHub does. |
| After a substantial change | `/code-review` | Correctness pass. `--fix` applies findings. |
| Code works but is ugly | `/simplify` | Quality only, no bug hunt. |
| Daily client acquisition | `/outreach-engine` | The 10 touches. Attach a shipped build to each pitch. |
| A recurring check (deploy, CI, VPS health) | `/loop` | Don't hand-poll. |
| A new repeatable workflow emerges | `/skill-creator` | When you catch yourself explaining the same thing twice, make it a skill. |
| Too many permission prompts | `/fewer-permission-prompts` | Ten minutes, saves hours. |
| Token budget tight on a long session | `/caveman` | ~75% fewer tokens, same technical accuracy. |

**Skills to write next**, once these four builds are done — each is a recurring job you'll otherwise re-explain every time:
- `yandex-ai-node` — the Yandex AI Studio credential + model-string pattern, emitted correctly every time
- `channel-adapter` — generates the Telegram/VK/MAX/Avito normalization sub-workflow
- `client-proposal` — brief → RU-language proposal with pricing and retainer
- `vps-deploy` — deploy + Nginx + health check, one command

Run `/skill-creator` on each when the pattern has stabilized. Not before — a skill written from one example encodes an accident.

---

## Part D — VPS access

You mentioned buying a second VPS I can reach. When it exists:

1. **A separate box, not the production one.** Never give an agent shell on the box running client workflows.
2. **A dedicated user** with sudo scoped to what's needed, not root.
3. **SSH key, not a password.** Key in `.env`, path referenced — never the key material in a file that could be committed.
4. **Point n8n at a staging instance first.** A workflow that deletes a client's Bitrix24 deals is not recoverable by apology.

Until then everything above works fine — you import the JSON into n8n by hand. That's a 30-second step, not a blocker. Don't wait on the VPS to start Build 1.

---

## Part E — Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `/automation-cto` not in the skill list | Session started before the file existed | Restart the Claude Code session |
| Skill fires but ignores RU constraints | You pasted the idea without the skill | Invoke `/automation-cto` explicitly, don't just describe |
| Generated workflow JSON won't import | Node names/versions differ from 2.36.8 | Paste the import error back — the fix is a version field |
| LLM call 401 | Wrong auth header | Yandex AI Studio wants `Authorization: Api-Key <key>`, not `Bearer`. |
| LLM credential test passes but the node 404s | n8n OpenAI node v2 + custom base URL bug | Use node v1.8, or the AI Agent's OpenAI Chat Model node. |
| Model not found | Wrong model string | It's `gpt://<folder_id>/qwen3-235b/latest`, not `qwen3`. |
| Vision OCR / SpeechKit 401 after 12h | IAM token expired | Use a service-account **API key** instead of an IAM token where the endpoint allows it. |
| Agent replies with another user's context | No session key on memory | Key memory by `channel + user_id`. Check this on every agent build. |
| Webhook fires twice, record duplicated | External services retry | Dedup on message/event ID in Redis before processing |
