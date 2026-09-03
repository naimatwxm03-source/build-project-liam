# RU Stack Reference — for `automation-cto`

Load when the architecture touches a service whose RU availability is uncertain. Canonical, longer version with reasoning: `docs/ru-stack-map.md` in the repo root.

`[VERIFY]` = confirm pricing/limits before it reaches a client quote.

## Models
| Need | Use | Notes |
|---|---|---|
| Text LLM on VPS | GigaChat | No native n8n node — HTTP Request: OAuth token → completion. Cache token in Set/Redis with TTL. Cert-chain workaround needed. |
| Fallback LLM | YandexGPT 5 | Keep credentials live so an outage is a one-field switch |
| Document / receipt OCR | Yandex Vision OCR → GigaChat for structuring | More accurate on documents than general multimodal |
| Image understanding (general) | GigaChat multimodal `[VERIFY quality]` | |
| Embeddings | GigaChat Embeddings, or self-hosted `multilingual-e5-large` | Self-host once >1 KB-backed build exists |
| **Never on the VPS** | Anthropic, OpenAI, Google Gemini | Direct calls fail. Claude belongs in VS Code. |

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
