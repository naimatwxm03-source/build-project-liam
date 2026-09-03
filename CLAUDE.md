# CLAUDE.md — build-project-liam

Four n8n agent builds from Liam's course, rebuilt RU-native for NXAI / N-Enterprise.

## Read first
- `docs/00-course-review.md` — the verdict on the course and per-build portability
- `docs/ru-stack-map.md` — vendor → RU substitute, authoritative
- `docs/vscode-workflow.md` — setup and the build loop

## Pipeline
`idea → /automation-cto → /n8n-brief → Claude Code writes workflow JSON → import to n8n → deploy`

Never skip `automation-cto` on a fuzzy idea. A brief on an undecided architecture is a well-formatted wrong answer.

## Hard constraints — these are environment facts, not preferences
- **Runtime:** n8n 2.36.8, self-hosted, Docker behind Nginx, Timeweb VPS. No n8n Cloud features (including "Build with AI").
- **Models on the VPS:** GigaChat (HTTP Request + OAuth token cached in Redis, TTL, cert-chain workaround), YandexGPT fallback. Anthropic/OpenAI/Google direct calls **fail from that box**. Claude belongs in VS Code, never in a workflow node.
- **OCR/STT:** Yandex Vision OCR, Yandex SpeechKit. IAM tokens expire in 12h — refresh on a schedule.
- **Storage:** Postgres (separate DB from n8n's own), Redis, Qdrant. Never n8n's Simple Vector Store — in-memory, dies on restart.
- **CRM:** Bitrix24. Client-owned credentials, always.
- **Channels:** Telegram is not blocked and is a valid primary. Always build the channel-adapter pattern so Telegram → VK is a config change. MAX needs a verified RU legal entity — blocked until ИП/ООО exists.
- **Payability rule:** nothing on a critical path may require a card that doesn't work from Russia.

## Conventions
- Briefs: `builds/briefs/YYYY-MM-DD-<slug>.md`, structure per the `n8n-brief` skill
- Architecture decisions: `builds/decisions/NN-<slug>.md`
- Build artifacts: `builds/0N-<slug>/` — `workflow.json`, `README.md`, frontend code
- Mark unverified claims `[VERIFY]` and inferences `[ASSUMED]`. Never invent API pricing or a client's data schema.
- Secrets live in `.env` (gitignored). Run `/security-review` before every push — exported workflow JSON is the usual leak.

## Non-negotiables in generated designs
- Chat memory is keyed by `channel + user_id` (or `session_id`). An unkeyed memory means every user shares one conversation — check this on every agent build.
- Every webhook dedups on the event ID in Redis. External services retry.
- An agent tool that sends email must be split: draft (returns text) and send (sends). Never one tool that composes and sends unreviewed.
- An agent that writes to a client's CRM writes to an audit table, and stage transitions go through an allowlist.
- A parse failure routes to manual review, never to an automated rejection.
