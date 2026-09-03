# RU Stack Map — Vendor Substitution Table

Every service Liam's four builds depend on, why it fails from a Russian IP / Russian card, and what replaces it on the NXAI stack (Timeweb VPS, n8n 2.36.8 self-hosted, Docker behind Nginx).

`[VERIFY]` = plausible but confirm pricing/availability before you build on it. Do not let an unverified line reach a client quote.

---

## 1. Models

| Liam uses | Fails because | NXAI substitute | Notes |
|---|---|---|---|
| Gemini 2.5 Flash (text) | Google AI Studio geo-blocks RU; card declined | **GigaChat** (Sber) | No native n8n node. HTTP Request pattern: OAuth token → chat completion, token cached in Set/Redis with TTL. Budget a token-refresh node + the cert-chain workaround. Proven in your VK bot. |
| Gemini 2.5 Flash (vision) | same | **GigaChat multimodal** `[VERIFY current vision quality on RU receipts]`, fallback **Yandex Vision OCR** | For receipts specifically, Yandex Vision OCR is likely more accurate than a general multimodal model — it's purpose-built for documents and returns structured text blocks. Recommended path: Yandex Vision OCR for text extraction → GigaChat for field structuring. Two cheap calls beat one expensive uncertain one. |
| Gemini embeddings | same | **GigaChat Embeddings**, or self-host `multilingual-e5-large` / `ruBERT` in a container on the VPS | Self-hosting removes a per-call cost and a network dependency. Worth it once you have >1 KB-backed build. |
| — | — | **YandexGPT 5** | Fallback model. Keep credentials configured so a GigaChat outage is a one-field switch in the Workflow Configuration node. |

**Rule:** anything running on `n8n.n-enterprise.ru` calls GigaChat or YandexGPT. Anthropic/OpenAI/Google direct calls from that box fail. Claude belongs in VS Code, not in a workflow node.

---

## 2. Messaging channels

| Liam uses | Status in RU | NXAI substitute |
|---|---|---|
| Telegram | **Works.** Not blocked (2018 block lifted 2020). Highest-usage messenger in RU. Voice *calling* is restricted; bot API is not. Ongoing regulatory pressure = future risk, not present blocker. | **Telegram, primary** — with a VK adapter behind the same channel abstraction |
| — | — | **VK** — compliance-safe fallback, mandatory for gov-adjacent clients |
| — | — | **MAX** — state-pushed, preinstalled on new devices. **Blocked for you:** registration requires a verified Russian legal entity (ИП/ООО). Open risk, not a technical one. |
| — | — | **Avito** — where RU SMB lead flow actually lives. No equivalent in Liam's course. Your differentiator. |
| Website chat widget (n8n Chat Trigger) | n8n's hosted chat UI is fine; embedding is fine | **Own widget**, static JS served from your VPS → n8n Webhook. Don't depend on n8n's embed script for a client site. |

See §3 of [`00-course-review.md`](00-course-review.md) for the channel-adapter architecture. Build it once, reuse in every build.

---

## 3. Storage / CRM

| Liam uses | Fails because | NXAI substitute | Notes |
|---|---|---|---|
| Google Sheets | Works, but OAuth from a RU IP is flaky and it's not a real datastore | **Postgres** (already on the VPS for n8n — use a separate DB, not n8n's own) | Faster, queryable, no OAuth, no rate limit. For a client who wants to *see* a sheet, add a read-only Metabase view or a scheduled CSV export. |
| Airtable (CRM) | Free tier reachable; paid tier uncard-able; not a CRM a RU client recognises | **Bitrix24** | Free tier, full REST API, RU-hosted, and it's the CRM most RU SMBs already have. Selling into an existing Bitrix24 is far easier than migrating them to Airtable. **amoCRM** as the alternative. |
| Gmail (send) | OAuth setup painful from RU; deliverability to RU inboxes mediocre | **Yandex 360 SMTP** or **Mail.ru для бизнеса SMTP** via n8n's Send Email node | Plain SMTP, no OAuth dance. Better inbox placement domestically. |
| — | — | **Redis** (VPS) | Token caching, dedup keys, rate limiting. You will want it by Build 2. |
| — | — | **Qdrant** (VPS, Docker) | Vector store. n8n has a native Qdrant node. Replaces n8n's Simple Vector Store, which is in-memory and dies on restart. |

---

## 4. External APIs

| Liam uses | Fails because | NXAI substitute | Notes |
|---|---|---|---|
| Google Geocoding API | Card + quota | **Yandex Geocoder HTTP API** | Direct equivalent, better RU address coverage, free tier. Address → lat/lon + normalized components. |
| **Google Solar API** | Card + **no data coverage for Russia at all** | **Nothing equivalent exists.** Re-scope the build. | This is not a substitution problem, it's a scope problem. See Build 2 brief. Replace with a domestic vertical whose estimate comes from a real data source (building data / your own pricing matrix). |
| SerpAPI (Google search) | Card | **SearXNG self-hosted** on the VPS, or **Yandex XML** search API | SearXNG is free, MIT, Docker, and gives you a JSON search endpoint you own. Yandex XML has RU-relevant results but needs quota registration `[VERIFY limits]`. |
| Apify LinkedIn Scraper | Card + **LinkedIn is RKN-blocked in Russia since 2016** | **Rusprofile / Kontur.Focus** (company by ИНН) `[VERIFY API pricing]`, **HH.ru API** (roles, hiring signals), **VK API** (person research) | LinkedIn is simply not the RU B2B graph. Do not port this — replace the research target. ИНН → company financials, founders, headcount, arbitration history is *more* useful for RU sales than a LinkedIn profile. |
| Firecrawl | Card | **Self-hosted Firecrawl** (open source, Docker) on the VPS, or a Playwright container + Readability | Self-hosting also removes the per-page cost, which matters at Build 4's call volume. |
| Retell AI (voice) | Card + geo + RU telephony licensing | **Voximplant** (RU, telephony + ASR/TTS + scenario webhooks), or **Yandex SpeechKit** + SIP via Novofon / Zadarma / Mango Office | An inbound RU number requires a legal entity. Until ИП/ООО exists, use the de-risked path: voice *messages* in Telegram/VK → SpeechKit STT → same pipeline. Teaches everything except number provisioning. |

---

## 5. Build tools

| Liam uses | Fails because | NXAI substitute | Notes |
|---|---|---|---|
| AI Automation CTO GPT | ChatGPT access + it's just a system prompt | **`automation-cto` skill** in this repo | Same job, your constraints baked in, runs in VS Code next to the code. |
| Relevance AI Brief Generator | Card | **`n8n-brief` skill** (you already have it) | Already better — it enforces the VPS constraints the Relevance form knows nothing about. |
| n8n "Build with AI" | Cloud-only feature `[VERIFY on 2.36.8 self-hosted]` | **Claude Code writes the workflow JSON**, you import it | Reviewable, diffable, committed to git. A generated workflow you can't diff is a liability. |
| Lovable (frontend) | Card | **Claude Code + Vite/React**, deployed on your VPS behind Nginx | Strictly better portfolio artifact — real code a client's dev can read, not a share link. |
| n8n Cloud | Card | **Already self-hosted 2.36.8** ✓ | The one thing you're ahead on. |

---

## 6. The two rules that follow from this table

1. **No build's critical path may depend on a service you cannot pay for.** A build that works today on someone's trial credit is a build you cannot hand to a client or maintain in six months.
2. **Every external dependency gets a named fallback in the Workflow Configuration node.** Model, channel, and storage should each be a one-field switch. That's not over-engineering — it's the thing you sell.
