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
- **Models on the VPS:** **Qwen 3 via Yandex AI Studio**, OpenAI-compatible endpoint `https://llm.api.cloud.yandex.net/v1`, model `gpt://<folder_id>/qwen3-235b-a22b-fp8/latest`, auth `Authorization: Api-Key <key>`. Use n8n's **OpenAI Chat Model** node — no custom HTTP node, no OAuth, no cert-chain workaround. YandexGPT then GigaChat as fallbacks (one-field switch). DeepSeek on the same endpoint for reasoning-heavy steps. Anthropic/OpenAI/Google direct calls **fail from that box**. Claude belongs in VS Code, never in a workflow node.
- **Check the model's capability BEFORE designing anything on top of it.** A model that cannot do the job fails *fluently* — it narrates the thing it cannot do, which reads like a prompt problem and invites rounds of prompt edits that can never work. Cost us three rounds on Build 2. The check is one curl against the real endpoint with the real feature, before the first node is written.
  - **Function calling / tools:** only **YandexGPT Pro 5** and **Pro 5.1** support it. **`yandexgpt-lite` does NOT.** Verify a URI with one call carrying a `tools` array — pass is `tool_calls` in the response, fail is prose in `content`. Any n8n **AI Agent** build needs this, because every AI Agent tool is a function call.
  - Same rule for structured output, vision, and context length: confirm on the endpoint, not from the docs and never from memory.
- **One-account rule:** LLM, Vision OCR and SpeechKit all come from the same Yandex Cloud account — one credential, one bill, one auth pattern.
- **Addresses: DaData, not Yandex Geocoder. Decision 03, 2026-09-14.** Geocoder has no free commercial tier — 195 000 ₽/yr for the cheapest licence, and its key comes from `developer.tech.yandex.ru`, a different portal from Yandex Cloud (Yandex also split JS API from HTTP Geocoder on 12.05.2026, so one key no longer covers both). DaData `clean/address` costs 20 коп per address and returns quality codes (`qc`, `qc_complete`) that say *what* is missing, which is the actual question. Needs both an API key and a secret key; server-side only, never from the browser.
- **Model cost:** Yandex marks Chinese models up ~30x vs direct; that markup buys 152-ФЗ compliance and a rouble invoice, so it is correct for client work. Never route a client through a payment intermediary. Cut cost by cutting tokens, and put the cloud account in the client's name.
- **n8n gotcha:** OpenAI node **v2** with a custom base URL can pass the credential test then 404 at runtime; **v1.8 and the AI Agent's OpenAI Chat Model node work.** Backup: `n8n-nodes-yc` community node.
- **OCR/STT:** Yandex Vision OCR, Yandex SpeechKit. IAM tokens expire in 12h — refresh on a schedule.
- **Storage:** Postgres (separate DB from n8n's own), Redis, Qdrant. Never n8n's Simple Vector Store — in-memory, dies on restart.
- **Никакая база не публикует порт наружу. 2026-09-17.** Qdrant, Redis и Postgres живут в `docker-compose.yml` **без секции `ports:`** — n8n ходит к ним по имени внутри сети Docker (`qdrant:6333`, `redis:6379`), и публиковать порт на хост незачем.
  - Qdrant стоял с `-p 6333:6333` на `0.0.0.0` **и без API-ключа**: любой, кто дотянулся до порта, мог читать, переписать и удалить векторы. Правило `iptables` в цепочке `DOCKER-USER` закрывало его, но правило **не переживает перезагрузку** — держалось только потому, что сервер не перезагружали две недели.
  - Постоянное решение — убрать публикацию порта, а не защищать её. Тома объявлены `external: true`, поэтому пересоздание контейнера данные не трогает. Образ **пинится по версии** (`qdrant/qdrant:v1.17.1`): `latest` однажды обновит Qdrant поверх его же хранилища.
  - **Смотреть Qdrant теперь только через контейнер:** `docker exec n8n sh -c "wget -qO- http://qdrant:6333/collections"`. С Mac — через туннель: `ssh -N -L 6333:localhost:6333 root@<vps>`.
  - `curl localhost:6333` **с хоста больше не работает, и это признак успеха, а не поломки.**
  - **Docker обходит `ufw`** — правила пишутся в цепочку `DOCKER-USER`. Но правило в firewall — это заплатка; отсутствие порта — это решение.
- **Приложение за Nginx слушает `127.0.0.1`, а не `0.0.0.0`. 2026-09-17.** Nginx работает на хосте и ходит в контейнер через loopback, поэтому публиковать порт на все интерфейсы не нужно — это просто второй вход в админку, уже без TLS и без логов Nginx.
  - Панель n8n висела на `0.0.0.0:5678`: `https://n8n.n-enterprise.ru` — это Nginx, но `http://5.42.99.81:5678` открывал ту же панель напрямую. Сейчас `- "127.0.0.1:5678:5678"`, а в Nginx `proxy_pass http://127.0.0.1:5678;` — явно, без `localhost` (он резолвится и в IPv6).
  - Точно так же закрыт сайт на `3000`: в Nginx **ничего** на него не проксировало — порт был открыт впустую. Проверка перед тем, как что-то закрывать: `grep -rn "<порт>" /etc/nginx/sites-enabled/`.
  - Правило: **любой опубликованный порт должен отвечать на вопрос «кто снаружи сюда ходит?».** Нет ответа — порт закрывается, а не обкладывается firewall'ом.
  - Ревизия одной командой: `ss -lntp | grep 0.0.0.0` — всё, что там осталось, должно быть только 22, 80 и 443.
  - `com.docker.compose.project.config_files` у контейнера может быть **относительным путём** (`docker-compose.yml`). Сначала `cd` в `working_dir`, иначе патчится чужой файл в текущей директории — на этом один прогон и промахнулся.
- **CRM:** Bitrix24. Client-owned credentials, always.
- **Channels — VK is the RU default. Decision 02, 2026-09-13.**
  - **VK Callback API is the primary inbound path.** VK's servers are in Russia, so Russian-server → Russian-IP works where Telegram could not. **VK Long Poll** is the fallback and needs no inbound connectivity at all.
  - **Ground truth for VK is `groups.getCallbackServers`** (`status`: `ok` / `failed` / `wait`), never the n8n UI. Setup: `docs/05-vk-setup.md`.
  - **Three mechanics that decide whether a VK build works:** (1) the confirmation handshake demands the bare confirmation string as **plain text**, so the Webhook node must use **Respond: Using 'Respond to Webhook' Node**, never the default JSON; (2) **respond `ok` before doing any work** — VK retries a slow endpoint and you log the same event twice; (3) **verify the `secret` field on every event** — the URL is public.
  - **No native VK node in n8n.** Everything is HTTP Request, through the shared adapter in `builds/vk-adapter/`. Photo URLs arrive in the payload — no `getFile` step, no `file_id` expiry.
  - `random_id` on `messages.send` must be non-zero and unique, or VK silently drops the message as a duplicate.
  - Always build the channel-adapter pattern so VK → Avito → MAX is a new adapter plus a config change, never a rebuild. MAX still needs a verified RU legal entity — blocked until ИП/ООО exists.
- **Telegram is a global-client channel only. Not on any RU critical path.**
  - **Outbound works** and stays working: `api.telegram.org` is unreachable from the VPS, so every Telegram credential sets **Base URL** to the Worker `https://edrus-telegram.naimatwxm03.workers.dev`. Symptom when wrong: Publish returns 504, `getWebhookInfo` shows `url: ""`. Source: `builds/01-receipt-bot/cloudflare-worker-telegram-proxy.js`.
  - **Inbound is unsolved and shelved.** Telegram's servers cannot reach `5.42.99.81`, and `*.workers.dev` is not reliably resolvable by Telegram's resolvers — so the `tg-in` Worker is a dead end. The fix is Decision 01 (put `n-enterprise.ru` on Cloudflare DNS, 20 min, 0 ₽) and it is **not executed**. Do it only when a global client needs Telegram or WhatsApp.
  - **Ground truth for any Telegram problem is `getWebhookInfo`**, never the n8n UI. A 504 on Publish means outbound; `last_error_message: "Connection timed out"` means inbound. Full procedure: `docs/04-telegram-webhook-runbook.md`.
- **VPS gotcha:** `docker compose` (space) is unavailable; use `docker-compose` (hyphen). Version 1.29.2 crashes with `KeyError: 'ContainerConfig'` on recreate — run `docker-compose down && docker-compose up -d` instead.
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
