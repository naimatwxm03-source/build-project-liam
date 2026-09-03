# RU Stack Reference — for `automation-cto`

Load when the architecture touches a service whose RU availability is uncertain. Canonical, longer version with reasoning: `docs/ru-stack-map.md` in the repo root.

`[VERIFY]` = confirm pricing/limits before it reaches a client quote.

## Models
| Need | Use | Notes |
|---|---|---|
| Text LLM on VPS | **Qwen 3 via Yandex AI Studio** | Base URL `https://llm.api.cloud.yandex.net/v1`, model `gpt://<folder_id>/qwen3-235b-a22b-fp8/latest`, auth `Authorization: Api-Key <key>`. OpenAI-compatible → use n8n's OpenAI Chat Model node. No OAuth, no cert-chain fight. |
| Reasoning-heavy | DeepSeek on Yandex AI Studio | Same endpoint, different model string |
| Fallback LLM | YandexGPT 5, then GigaChat | One-field switch in Workflow Configuration |
| Document / receipt OCR | Yandex Vision OCR → Qwen for structuring | Same cloud account |
| Speech to text | Yandex SpeechKit | Same cloud account |
| Embeddings | Yandex AI Studio embeddings, or self-hosted `multilingual-e5-large` | Same key |
| **Never on the VPS** | Anthropic, OpenAI, Google Gemini | Direct calls fail. Claude belongs in VS Code. |

**Why Yandex AI Studio over GigaChat:** one account for LLM + OCR + STT + Geocoder; OpenAI-compatible so native n8n nodes work; better JSON/tool-calling than GigaChat. GigaChat is a fallback only — separate OAuth, cert-chain problems in Docker, expensive.

**Cost lever:** Yandex marks Chinese models up ~30x vs direct, and that markup buys 152-ФЗ compliance. Never go direct (RU cards fail, intermediaries are fragile). Cut cost with fewer tokens — retrieval without generation, Redis caching, a small model for routing, deterministic Switch nodes — and put the cloud account in the client's name so consumption is their bill.

**n8n gotcha:** OpenAI node v2 + custom base URL can pass the credential test then 404 at runtime; v1.8 and the AI Agent's OpenAI Chat Model node work. Backup: `n8n-nodes-yc` community node.

## Channels
| Channel | Status | Use for |
|---|---|---|
| Telegram | Works. Not blocked. Highest RU usage. Bot API fine (voice *calling* restricted, irrelevant to bots). | Default primary, internal + client-facing |
| VK | Works. Compliance-safe. | Fallback adapter; primary for gov-adjacent clients |
| MAX | **Blocked for Naimat** — registration needs verified RU legal entity | Flag as Open Risk until ИП/ООО |
| Avito | Works. Where RU SMB leads are. | Marketplace lead capture — no course equivalent, your edge |
| WhatsApp | Regulatory pressure, unreliable | Avoid as a critical path |

Always build the channel-adapter pattern. The agent must never see a `chat_id`.

## Storage / CRM
| Need | Use |
|---|---|
| App data | Postgres on VPS (separate DB from n8n's own) |
| CRM | Bitrix24 (free tier, REST API, most RU SMBs already have it). amoCRM alternative. |
| Vector store | Qdrant on VPS (native n8n node). Never n8n's Simple Vector Store — in-memory, dies on restart. |
| Cache / dedup / tokens | Redis on VPS |
| Email send | Yandex 360 SMTP or Mail.ru для бизнеса SMTP. Plain SMTP, no OAuth. |
| Spreadsheet | Google Sheets — internal only, never a client deliverable |

## External APIs
| Need | Use | Instead of |
|---|---|---|
| Geocoding | Yandex Geocoder HTTP API | Google Geocoding |
| Web search | SearXNG self-hosted, or Yandex XML `[VERIFY quota]` | SerpAPI |
| Page scrape | Self-hosted Firecrawl (Docker), or Playwright + Readability | Firecrawl cloud |
| Company research | Rusprofile / Kontur.Focus by ИНН `[VERIFY pricing]`, HH.ru API | Apify LinkedIn — **LinkedIn is RKN-blocked in RU** |
| Person research | VK API | LinkedIn |
| Voice / telephony | Voximplant, or Yandex SpeechKit + SIP (Novofon / Zadarma / Mango) | Retell AI |
| STT without a phone number | Yandex SpeechKit on Telegram/VK voice messages | — |
| Payments | YooKassa / СБП | Stripe |
| **No substitute exists** | Google Solar API — no RU coverage even with access | Re-scope the build |

## Build tooling
| Need | Use |
|---|---|
| Architecture decision | `automation-cto` skill (this one) |
| Implementation spec | `n8n-brief` skill |
| Workflow JSON | Claude Code writes it, you import. n8n "Build with AI" is cloud-only `[VERIFY on 2.36.8]` |
| Frontend | Claude Code + Vite/React on the VPS behind Nginx. Not Lovable (unpayable). |
| Platform | n8n 2.36.8 self-hosted, Docker, Nginx ✓ |

## The payability rule
Nothing on a critical path may require a card that doesn't work from Russia. A build that runs on a trial credit cannot be handed over or maintained. Check this in §3.5 of the skill, before designing.
