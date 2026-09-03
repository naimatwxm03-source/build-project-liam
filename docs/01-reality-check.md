# Reality Check — Can You Actually Build This, What It Costs, and How to Keep It Genuine

**Written:** 2026-09-03. **Read this before spending a rouble.**

All prices below are **estimates marked `[VERIFY]`**. Currency and API pricing move. Your first hour of work is checking these numbers yourself — do not quote a client from this page.

---

## 1. The short answer

**Yes, you can build all four, genuinely, and it will mostly work.** Nothing here is a toy.

**No, it will not be smooth.** There are six specific places where you will lose hours. They're listed in §5, named, so you can plan for them instead of being surprised.

**Money is not your main obstacle.** You can build and demo all four builds for roughly **the cost of your existing VPS plus 0–3 000 ₽/month**. Most of the stack is free tiers or software you self-host.

**Identity is your main obstacle.** GigaChat and Yandex Cloud both need a Russian account. See §2 — this is the one thing that can stop you on day one, and it has nothing to do with money.

---

## 2. The real gate: identity, not money

Before anything else, confirm you have these three. This takes twenty minutes and decides everything.

| You need | Used for | If you don't have it |
|---|---|---|
| **Russian phone number (+7)** | Sber ID (→ GigaChat), Yandex ID, VK, Avito | **Hard stop on GigaChat and Yandex Cloud.** Nothing in this repo runs without one of them. |
| **Russian card (Мир) or bank account** | Yandex Cloud paid tier, Timeweb top-up, YooKassa later | You can still use free tiers and grants. Blocks scaling, not starting. |
| **ИП or ООО** | GigaChat `_CORP` scope, MAX bot, Voximplant phone number, invoicing clients in your own name | Blocks Build 3 Phase B and MAX. **Does not block Builds 1, 2, 4 or Build 3 Phase A.** |

**Do this first, before you write a single node:**
1. Register for GigaChat at developers.sber.ru → get client ID + secret → make **one** `curl` call for an OAuth token.
2. Register Yandex Cloud → create a service account → make **one** `curl` call to Vision OCR with any photo.

If both return 200, you're clear to build everything except Build 3 Phase B. If either fails on registration, stop and solve that — do not start building around a model you can't authenticate to.

---

## 3. What you buy, and what you don't

### Buy / already have — **Phase 0 (build + portfolio)**

| Item | Cost `[VERIFY]` | Why | When |
|---|---|---|---|
| **Timeweb VPS** — you have one | ~500–1 500 ₽/mo | Runs everything | now |
| **VPS upgrade to 8GB RAM** | +~1 000–1 500 ₽/mo | Only if Build 4 (n8n + Postgres + Redis + Qdrant + SearXNG + Firecrawl) doesn't fit. **Measure first.** | before Build 4 |
| **Domain (.ru)** | ~200–1 500 ₽/yr | Public demo URLs. A portfolio needs a real link, not `localhost`. | before Build 2 |
| **TLS certificate** | **free** | Let's Encrypt | with the domain |
| **GigaChat** | **free tier** — personal accounts get a token grant on signup | Every LLM call in all four builds | now |
| **Yandex Cloud** | **free trial grant** ~60 days | Vision OCR (Build 1), SpeechKit (Build 3), Geocoder (Build 2) | now |
| **Telegram bot** | **free** | Builds 1, 3 | now |
| **Bitrix24** | **free tier**, 12 users | CRM for Builds 2, 3, 4 | before Build 2 |
| **Postgres, Redis, Qdrant, SearXNG, Firecrawl** | **free**, self-hosted Docker | Storage, vectors, search, scraping | as needed |
| **HH.ru API, ФНС ЕГРЮЛ open data** | **free** | Company research, Build 4 | before Build 4 |
| **React frontend** | **free** | Build 4 | Build 4 |

**Realistic Phase 0 total: 0–3 000 ₽/month on top of the VPS you already pay for.**

That is the honest number. This is not an expensive project. It's a time-expensive project.

### Do NOT buy yet

| Item | Why not |
|---|---|
| **Voximplant phone number** | Needs ИП/ООО. Build 3 Phase A works without it and teaches the same skills. |
| **Rusprofile / Kontur.Focus API** | Likely the most expensive line in the whole stack. Free ФНС ЕГРЮЛ data covers Build 4's needs for a portfolio. Buy only when a paying client needs the richer data. |
| **A second VPS for Claude** | Not needed. You import workflow JSON by hand — a 30-second step. Buy it when you're deploying for clients, not now. |
| **Yandex Cloud paid tier** | The trial grant covers all testing. Switch to paid when a real client's volume arrives. |
| **n8n Cloud** | You're self-hosted. Never needed. |
| **Any course, template pack, or "AI automation" tool subscription** | You have Claude Code and two skills. That is the pipeline. |

### Phase 1 — when a paying client exists

Only then: GigaChat paid package, Yandex Cloud paid, ИП registration, Voximplant number, second VPS. **All of it paid for by the client's setup fee, not out of your pocket.** That's the whole point of quoting a setup fee.

---

## 4. What actually runs — build by build, honestly

| Build | Runs for real? | The catch |
|---|---|---|
| **1. Expense bot** | ✅ **100% real.** Real Telegram bot, real OCR on real receipts, real database, real email alerts. | OCR accuracy on crumpled RU thermal receipts is unknown until you test it. This is a quality question, not a "does it run" question. |
| **2. Lead widget** | ✅ **Real**, with one condition | You have no client, so you have no pricing matrix. **Fix: use a real published price list from a real остекление company's website.** Public data, real numbers, and you can say exactly where they came from. That is honest and demonstrable. Inventing prices is what makes it fake. |
| **3A. Voice qualifier (voice messages)** | ✅ **100% real.** Real speech-to-text, real qualification, real CRM update. | Needs no phone number, no ИП. This is the whole reason Phase A exists. |
| **3B. Voice qualifier (real calls)** | ❌ **Blocked** | Needs ИП/ООО for a Russian phone number. Legal, not technical. Don't promise it to anyone yet. |
| **4. Sales copilot** | ✅ **Real** | Self-hosted SearXNG and Firecrawl are real search and real scraping. ФНС ЕГРЮЛ is real company data. The only downgrade vs. the paid version is data richness, not authenticity. |

**Three and a half of four builds are fully genuine and deployable right now.** That is a strong portfolio.

---

## 5. Where it will hurt — the six friction points

Plan for these. They are the difference between "two weeks" and "two months."

| # | Problem | How bad | What fixes it |
|---|---|---|---|
| 1 | **GigaChat TLS certificate chain** | 🔴 Hours. The #1 reason people give up. | The Russian trusted root (Минцифры) must be in the n8n container's CA store. Add it to your Dockerfile / mount it — do **not** disable TLS verification globally. Solve this in a scratch workflow before you build anything real. |
| 2 | **No native GigaChat node in n8n** | 🟠 Half a day, once | Hand-build: HTTP Request for OAuth → cache token in Redis with TTL → HTTP Request for completion. **Build it once as a sub-workflow and reuse it in all four builds.** You already did this for the VK bot — go copy it. |
| 3 | **GigaChat is weaker than Gemini 2.5 Flash** | 🟠 Ongoing, real | It follows instructions less reliably and returns malformed JSON more often. **This is a genuine downgrade and you should know it.** Mitigations, all already in the briefs: keep tool lists to ≤6, use Switch/IF instead of an agent wherever branches are enumerable, always use a Structured Output Parser with a retry, keep YandexGPT configured as a one-field fallback. |
| 4 | **Yandex IAM tokens expire every 12 hours** | 🟡 One hour | A Schedule Trigger that refreshes the token into Redis. Build it early — it will bite you at 3am otherwise. |
| 5 | **Phone number matching (Build 3)** | 🟡 An hour, deceptively | `+79161234567`, `89161234567`, `7 916 123-45-67` are the same person. Normalize both sides to E.164 before comparing. Solve it in isolation, not inside a flow. |
| 6 | **Firecrawl memory on a small VPS** | 🟡 Build 4 only | Set a Docker memory limit before you start it. Without one it can take the box down and n8n goes with it. |

**Bonus honest point:** n8n's "Build with AI" is a cloud feature — your self-hosted 2.36.8 probably doesn't have it. So step 3 of Liam's pipeline doesn't exist for you. Claude Code writes the JSON instead, which is better (diffable, version-controlled), but imported JSON often needs `typeVersion` fixes. Paste the import error back into Claude Code and it's a two-minute fix.

---

## 6. "Will it build if I paste one prompt into VS Code?"

No. Be realistic about the split:

| Claude Code does | You do |
|---|---|
| Architecture decisions (`/automation-cto`) | Register for services, get keys |
| The buildable spec (`/n8n-brief`) | Paste credentials into n8n |
| Writing the workflow JSON | Import it, click through nodes |
| Writing the React frontend | Test with real data |
| Debugging errors you paste in | Look at what actually came back |
| Docs, READMEs, proposals | Deploy, record the demo |

Roughly **60% generated, 40% hands-on.** The 40% is the part that makes it real, and it's the part that becomes your course.

Nobody builds a working agent from one prompt. Anyone who says otherwise is selling something.

---

## 7. Keeping it genuine — the part that matters most

The tech will be real. **Fakeness sneaks in through data and deployment, not code.** Four rules:

1. **Real data, named source.** Build 2's prices come from a real company's public price list — cite it. Build 1 runs on real receipts from your own wallet. Build 4 researches real companies by real ИНН. Never invent a number and never invent a company.
2. **Deployed to a real URL with TLS.** `n8n.n-enterprise.ru` and a demo subdomain. A screenshot of localhost is not a portfolio piece.
3. **Used by real people.** Get 3–5 humans to actually use each build. Ten real receipts through Build 1, five real conversations through Build 2. Real usage produces real bugs, and fixing real bugs is the qualification.
4. **Evidence you can show.** Per build: a 60-second screen recording, a screenshot of real data in the database/CRM, the workflow JSON in a public repo, and a README saying problem → architecture → stack → what broke → how you fixed it.

**That fourth item — "what broke and how I fixed it" — is what separates a portfolio from a tutorial screenshot.** Anyone can show a working demo. Very few can explain the TLS chain problem they solved.

---

## 8. Documentation you need, which is also your course

You said you'll eventually sell this as a course. Then write the docs *as you build*, not after — you will forget the details within a week, and the details are the product.

Structure to fill in as you go:

```
docs/
  setup/
    01-gigachat.md        signup → keys → the TLS fix → n8n credential → test call
    02-yandex-cloud.md    service account → IAM refresh → Vision → SpeechKit
    03-bitrix24.md        portal → inbound webhook → scopes → stage IDs
    04-vps-services.md    docker-compose for Postgres/Redis/Qdrant/SearXNG/Firecrawl
    05-nginx-tls.md       vhosts, Let's Encrypt, CORS
  runbook.md              what to check when something breaks at 3am
builds/0N-<build>/
  README.md               problem → architecture → stack → screenshots → demo → what broke
  workflow.json           the actual importable workflow
```

**Every hour you spend stuck is a documentation page.** The GigaChat certificate problem cost you three hours? That's a lesson someone will pay for, because everyone hits it and nobody has written it down properly in English or in Russian.

That is your genuine course differentiator versus Liam's: **he teaches the happy path on a stack that doesn't work here. You'd be teaching the real path on the stack that does.** There is no competing course for "n8n AI agents on a Russian stack." That gap is worth more than the four builds themselves.

---

## 9. Realistic timeline

Assume evenings and weekends, not full-time.

| Week | What |
|---|---|
| **0** | Identity check (§2). GigaChat OAuth + TLS solved in a scratch workflow. Yandex Cloud service account working. **Nothing else. This week is infrastructure and it is not optional.** |
| **1** | Build 1 end to end. Deploy. 10 real receipts. Demo video. README. |
| **2–3** | Build 2. Qdrant, real price list, widget, deploy. 5 real conversations. |
| **4** | Build 3 Phase A. Voice messages → STT → qualification → Bitrix24. |
| **5–6** | Build 4. Docker services, sub-flows, React frontend, deploy. |
| **7** | Polish: READMEs, demo videos, portfolio page, `/security-review` everything, make the repo public. |

**Seven weeks to four genuinely deployed, genuinely working, genuinely documented builds on a stack nobody else teaches.**

If week 0 slips, everything slips. Do week 0 properly.

---

## 10. The one-line answer to "will it be fake?"

Not if you deploy it, use real data, let real people touch it, and write down what broke.

The code was never the fake part. Skipping those four things is.
