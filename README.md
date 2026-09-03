# build-project-liam — Liam's 4 n8n Builds, Rebuilt RU-Native

Four agent builds from Liam's course, re-architected to run entirely on a Russian stack: **Qwen 3 (Yandex AI Studio) / Yandex Cloud / Bitrix24 / Qdrant / Voximplant**, self-hosted n8n 2.36.8 on a Timeweb VPS. No foreign dependency on any critical path, nothing that needs a card that doesn't work.

**New here? Start with [`docs/02-start-here.md`](docs/02-start-here.md)** — copy-paste path from an empty VS Code window to Build 1 running.

**Why this repo exists:** [`docs/00-course-review.md`](docs/00-course-review.md) — what's real in the course, what breaks from Russia, and what's worth your time.

---

## Why rebuilt, not followed

Liam's stack — Gemini, Retell AI, Lovable, SerpAPI, Apify, Firecrawl, Airtable, Google Solar API — fails from Russia on two walls: IP geo-blocking and, more decisively, payment. A build that runs on a trial credit cannot be handed to a client or maintained in six months.

One build cannot be ported at all: the **Google Solar API has no data coverage for Russia**, so Build 2 is re-scoped to a domestic vertical rather than translated. Three substitutions are outright upgrades — a self-hosted React frontend beats a Lovable share link, ИНН-based company data beats a LinkedIn profile for Russian B2B, and self-hosted SearXNG/Firecrawl remove a per-call cost.

The patterns Liam teaches are genuine and worth learning. The vendors are not portable and the "AI generates your workflow" pipeline is demo-grade. This repo keeps the first and replaces the rest.

---

## The four builds

| # | Build | Brief | RU stack | Portability |
|---|---|---|---|---|
| 1 | Бот учёта расходов | [brief](builds/briefs/2026-09-03-build-1-expense-bot.md) | Telegram · Yandex Vision OCR · Qwen 3 (Yandex AI Studio) · Postgres | ~90% |
| 2 | Чат-виджет со сметой | [brief](builds/briefs/2026-09-03-build-2-lead-widget.md) | Own widget · Qdrant · Yandex Geocoder · Bitrix24 | ~40% — re-scoped |
| 3 | Голосовая квалификация | [brief](builds/briefs/2026-09-03-build-3-voice-qualifier.md) | SpeechKit STT · Qwen 3 (Yandex AI Studio) · Bitrix24 · Voximplant (phase B) | ~30% — two-phase |
| 4 | Копилот менеджера | [brief](builds/briefs/2026-09-03-build-4-sales-copilot.md) | React on VPS · SearXNG · Firecrawl · Rusprofile · Bitrix24 | ~50% — upgraded |

Each brief is buildable node-by-node with no second research session: architecture table, credentials, data schemas, error handling, test plan, cost math, pricing, open risks, build order.

They chain the way Liam's do — Build 2 captures the lead, Build 3 qualifies it, Build 4 helps close it — so a client who buys one is a warm buyer for the next.

---

## Channel architecture

Telegram is **not** blocked in Russia and is the country's highest-usage messenger — it's a valid primary channel. The risk is future regulatory pressure, not present availability, and it's handled architecturally:

```
[Telegram] [VK] [MAX] [Avito] → normalize → ONE channel-agnostic agent → route reply back
```

The agent never sees a `chat_id`. Adding or swapping a channel is one adapter, not a rebuild — and it's something you sell: *"if this channel gets restricted, your bot moves in an afternoon."*

---

## Tooling — replacing Liam's AI pipeline

| Liam's tool | Replacement | Where |
|---|---|---|
| AI Automation CTO GPT | `automation-cto` skill | [`.claude/skills/automation-cto/`](.claude/skills/automation-cto/) |
| Relevance AI Brief Generator | `n8n-brief` skill | account-level |
| n8n "Build with AI" (cloud-only) | Claude Code writes the workflow JSON | reviewable, diffable, committed |

`automation-cto` decides the architecture — pattern, RU substitutions, scope cuts, kill risks — and hands off to `n8n-brief`, which writes the buildable spec. Both have the VPS constraints hard-coded, so neither can propose Gemini or Retell by accident.

---

## Repo layout

```
docs/
  00-course-review.md     what's genuine, what breaks, per-build verdict
  ru-stack-map.md         every vendor → RU substitute, with reasoning
  02-start-here.md        step-by-step: VS Code -> Yandex Cloud -> Build 1
  01-reality-check.md     costs, what to buy, friction points, timeline
  vscode-workflow.md      the 5-stage build loop + skill map
builds/
  briefs/                 the four implementation briefs
  decisions/              automation-cto architecture decisions
  0N-<build>/             workflow JSON, frontend code, README, demo
.claude/skills/
  automation-cto/         the architecture-decision skill
```

---

## Working on this

Setup and the full operating manual: [`docs/vscode-workflow.md`](docs/vscode-workflow.md).

```bash
git clone https://github.com/naimatwxm03-source/build-project-liam.git
cd build-project-liam && git checkout claude/liam-projects-review-33if7h
cp .env.example .env    # gitignored — never commit real values
code .
```

The loop, per build: `/automation-cto` → `/n8n-brief` → verify the `[VERIFY]` tags with WebSearch → Claude Code writes the workflow JSON → import into n8n → build **step 1 of §11 in isolation and confirm it runs green before adding step 2** → `/security-review` → push → deploy → demo video.

---

## Ground rules

1. **Nothing on a critical path may need a card that doesn't work from Russia.**
2. **Every external dependency gets a named fallback** in the Workflow Configuration node — model, channel, and storage each a one-field switch.
3. **A build isn't done until it's deployed, demoed, and documented.** Without a public URL, a 60-second video, and a README, it's a screenshot — not a case study.
4. **Never commit a token.** `/security-review` before every push.
