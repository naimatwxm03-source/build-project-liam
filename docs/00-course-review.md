# Review: Liam's 4 n8n Builds — What's Real, What Breaks, What's Worth Your Time

**Reviewed:** 2026-09-03 · **Reviewer:** Claude Code (for Naimat, NXAI / N-Enterprise)
**Verdict in one line:** the *patterns* are genuine and worth learning; the *vendor stack* is unbuildable from Russia and the *"AI generates your workflow"* pipeline is demo-grade. Rebuild all four on the RU stack — that's where the portfolio value is.

---

## 1. Is the course genuine?

Yes, but be precise about what "genuine" means here.

**What is real:**
- The four builds cover four genuinely distinct, genuinely sellable agent patterns. There is no filler.
- The progression is deliberate: extraction → RAG + sub-workflows → event-driven automation → full-stack. Each build reuses the previous build's data. That's good curriculum design, not marketing.
- "Speed to lead" and "24/7 site chat that captures leads" are the two highest-conversion automation offers in any market, including Russia. That claim holds.

**What is oversold:**
- **The 3-step AI pipeline (CTO GPT → Relevance brief → n8n AI builder) is the weakest part.** It works for a 7-node demo and falls apart on anything with real branching, error handling, or a non-trivial API response. You will spend more time fixing generated nodes than you would building them. Liam's own Build 2 notes admit this — the Code node that parses the Solar API response is "the most likely place things break."
- **n8n's "Build with AI" is a cloud feature.** Your box is self-hosted 2.36.8 behind Nginx. Do not plan any build around step 3 of that pipeline existing. `[VERIFY on your instance before you rely on it]`
- **The scenarios are toys.** "Smith Solar", a $500 CFO threshold, a fake sales rep. A portfolio piece built on a fake company with fake data is a tutorial screenshot. A portfolio piece built on a real vertical with a real deployed URL is a sales asset. Same effort, different outcome.
- **Nothing here is proprietary knowledge.** Every pattern in these four builds is documented in n8n's own docs and in free YouTube content. What you're paying for is sequencing and Liam's judgment calls — which are decent. Don't expect secrets.

**Will it develop your portfolio?** Only if you do three things Liam doesn't ask for:
1. Re-ground each build in a real Russian vertical with real pricing/data.
2. Deploy each one to a public URL on your VPS and record a 60-second demo.
3. Commit the workflow JSON + a README + the brief to a public repo (this one).

Without those, you have four n8n screenshots. With them, you have four case studies you can put in a proposal.

---

## 2. The hard blocker: this stack cannot run from Russia

Two separate walls, and the second one is the real problem:

| Wall | What it hits |
|---|---|
| **IP geo-block** | Google AI Studio / Gemini API, Google Cloud (Solar, some Geocoding quota paths), Anthropic, OpenAI, Retell AI, LinkedIn (RKN-blocked since 2016) |
| **Payment** | Every single paid vendor in the course. Russian cards do not work on Google Cloud, OpenAI, Anthropic, Retell, Apify, SerpAPI, Firecrawl, Lovable, Airtable paid, n8n Cloud. |

The payment wall matters more. You can proxy an IP; you cannot proxy a card. Any build whose critical path needs a foreign subscription is a build you cannot maintain for a paying client, and cannot hand over.

**Build 2 has a third problem no VPN fixes:** the Google Solar API has no coverage data for Russia. Even with perfect access, it returns nothing for a Russian address. That build must be re-grounded on a different data source regardless of your network.

Full substitution table: [`docs/ru-stack-map.md`](ru-stack-map.md)

---

## 3. Telegram vs VK vs MAX — your actual question

You're right and your own `n8n-brief` skill is too conservative here. Correcting it:

**Telegram is not blocked in Russia.** The 2018 block was lifted in 2020. It is the highest-usage messenger in the country and normal for business bots. What *has* been restricted is Telegram/WhatsApp **voice calling**, and there is ongoing regulatory pressure plus a state push behind MAX (preinstall mandate on new devices from Sept 2025). So the risk is not "Telegram doesn't work today" — it's "Telegram may be throttled or restricted at some future date, and your client's lead flow dies with it."

**The correct answer is not to pick one. It's to stop caring which one it is.**

Build every client-facing agent as:

```
[ Telegram adapter ]  ─┐
[ VK adapter       ]  ─┼─→  normalize to a common message envelope
[ MAX adapter      ]  ─┤     { channel, user_id, text, media_url, session_key }
[ Avito adapter    ]  ─┘              ↓
                              ONE agent workflow (channel-agnostic)
                                       ↓
                              normalize reply → route back to origin channel
```

The agent workflow never knows what a Telegram chat_id is. Adding MAX later is one new adapter, not a rebuild. This is the single most valuable architectural decision in the whole rebuild, and it is a **thing you can sell**: "if Telegram gets restricted, your bot moves to VK in an afternoon, at no extra cost." No tutorial-follower can say that.

**Practical default per build:**
- **Your own internal bots** (Build 1 receipt bot): Telegram only. It's you. Ship fast.
- **Client-facing, client is comfortable:** Telegram primary + VK adapter live as insurance.
- **Client is a government-adjacent / large RU entity:** VK or MAX primary. MAX registration needs a verified Russian legal entity — that's the ИП/ООО blocker you already have open.
- **Marketplace leads:** Avito adapter. This is where RU SMB lead flow actually is, and Liam's course has no equivalent.

---

## 4. Can you replace the CTO GPT and the Relevance tool?

Yes, completely, and you already have half of it.

| Liam's tool | Your replacement | Status |
|---|---|---|
| AI Automation CTO GPT | `automation-cto` skill | **Built in this repo** — `.claude/skills/automation-cto/` |
| Relevance AI Brief Generator | `n8n-brief` skill | You already have it |
| n8n "Build with AI" | Claude Code writing workflow JSON directly | Better — reviewable, diffable, version-controlled |

Liam's chain is GPT-4-class → a form → a cloud generator. Yours is Opus in your own terminal, with your VPS constraints hard-coded into the skill so it cannot propose Gemini or Retell by accident, writing straight into a git repo. That is a strictly better pipeline, it costs you nothing extra, and it's a differentiator you can demo to a client.

The one thing you lose: Liam's GPT has web search for API research. Claude Code has `WebSearch`/`WebFetch` — same capability, in the same session as the code.

---

## 5. Per-build verdict

| # | Build | Portable to RU? | Worth building? | Re-grounded as |
|---|---|---|---|---|
| 1 | Telegram receipt tracker | **Yes, ~90%** — swap model + storage | **Yes, first** | Учёт расходов бот — Telegram, Qwen 3 (Yandex AI Studio) vision / Yandex Vision OCR, Postgres |
| 2 | Website lead-gen chat + Solar API | **No, ~40%** — Solar API is dead in RU | **Yes, but re-scoped** | Калькулятор ремонта/окон — Yandex Geocoder + own pricing matrix, Qdrant KB, Bitrix24 |
| 3 | Retell voice qualifier | **No, ~30%** — Retell + RU telephony licensing | **Yes, with a de-risked path** | Voximplant inbound, or Telegram voice-message qualifier (no phone number needed) |
| 4 | Lovable sales copilot | **Partly, ~50%** — Lovable/SerpAPI/Apify/LinkedIn all out | **Yes — best portfolio piece** | Own React frontend on your VPS, self-hosted SearXNG + Firecrawl, Rusprofile/HH.ru, Bitrix24 |

**Build 4's forced change is an upgrade.** Liam has you vibe-code the frontend on Lovable. You can't pay for Lovable — so you build it with Claude Code as real React in this repo, and deploy it on your own VPS behind Nginx. That is a *better* portfolio artifact than a Lovable share link, because it's code a client's own dev can read.

**Build 3 carries a real legal blocker.** A Russian phone number for an inbound voice agent requires a legal entity — the same ИП/ООО question already open in your `n8n-brief` skill. The de-risked path (Telegram/VK voice messages → Yandex SpeechKit STT → same qualification pipeline) teaches every skill in the build except telephony provisioning, and needs no legal entity. Do that first, add real telephony after the ИП exists.

---

## 6. What to actually do

1. Read [`docs/ru-stack-map.md`](ru-stack-map.md) — the vendor substitution table.
2. Read [`docs/vscode-workflow.md`](vscode-workflow.md) — how to run this whole thing from VS Code.
3. Work the four briefs in `builds/briefs/` in order. Each is buildable node-by-node with no second research session.
4. One build per week. Deploy each one before starting the next. A half-finished Build 3 is worth zero; a shipped Build 1 with a demo video is worth a client call.
