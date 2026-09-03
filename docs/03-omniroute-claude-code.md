# OmniRoute + Claude Code — Two Lanes, Never One

**What this solves:** Claude Code stops when your Anthropic quota runs out. OmniRoute lets you keep working on other models instead of losing the evening.

**What this does NOT solve:** anything in n8n. See §6 — this distinction matters more than everything else on this page.

---

## 1. Fix this first — your gateway is open to the network

Your OmniRoute terminal is printing this warning right now:

> ⚠ SECURITY: listening on 0.0.0.0 with NO API-key requirement — the inference plane (/v1/*) is reachable by ANY device that can route to this host, and requests are billed to your configured providers.

**On café wifi, a co-working space, or any shared network, anyone can use your gateway and spend your provider credits.** Fix it before anything else:

```bash
# ~/.omniroute/.env
OMNIROUTE_SERVER_HOST=127.0.0.1
```

That binds it to your machine only. If you ever genuinely need it reachable from another device, use `REQUIRE_API_KEY=true` instead — never both off.

Restart OmniRoute. The warning should be gone.

---

## 2. How it actually works (and how it doesn't)

**What you might be imagining:** Claude Code runs on Anthropic, hits the quota limit, and silently continues on a free model.

**What actually happens:** Claude Code speaks the Anthropic Messages API. OmniRoute implements that same API (`/v1/messages`), so Claude Code can be pointed at OmniRoute *instead of* Anthropic. From then on, **every** request goes through OmniRoute, which does the routing and fallback among the providers you've connected.

So the switch happens **at OmniRoute's level, not Claude Code's.** Claude Code doesn't know Anthropic exists any more.

That leads to the one trap that catches everybody:

> **Once `ANTHROPIC_BASE_URL` points at localhost, there is no path back to Anthropic.** If OmniRoute isn't running, Claude Code isn't working. And you are no longer using the Claude subscription you're paying for.

Which is why the correct setup is two lanes, not one.

---

## 3. The two-lane setup — do it this way

Keep real Claude as your default. Add a second command for when the quota is gone.

Add to `~/.zshrc`:

```bash
# Lane 2 — free models via OmniRoute, only when you ask for it
claude-free() {
  ANTHROPIC_BASE_URL="http://localhost:20128" \
  ANTHROPIC_MODEL="auto/best-free" \
  command claude "$@"
}
```

Then `source ~/.zshrc`.

Now:
- `claude` → real Claude on your subscription. **Default. Unchanged.**
- `claude-free` → OmniRoute, free models, auto-fallback across providers

Two rules that will save you an hour of confusion:
- **No `/v1` on the base URL.** It's `http://localhost:20128`, not `.../v1`. The `/v1` is for OpenAI-style clients, not Claude Code.
- **The env is read once at startup.** Changing it mid-session does nothing — exit and relaunch.

`omniroute setup-claude` will also wire this up automatically if you prefer, but it edits your global config, which is exactly what you don't want when you're paying for a Claude subscription.

## 3b. Optional — pick which model each tier uses

Claude Code asks for three tiers internally. You can map them:

```bash
export ANTHROPIC_DEFAULT_OPUS_MODEL="glm/glm-5.2"
export ANTHROPIC_DEFAULT_SONNET_MODEL="kmc/kimi-k2.6"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="glm/glm-4.7-flash"
```

`auto/best-free` is simpler and already has a fallback chain with circuit breakers underneath. **Start with `auto/best-free`.** Only map tiers by hand if one specific model is clearly doing better on your work.

---

## 4. Be honest about the quality drop

Claude Code's system prompts, tool-calling behaviour and skills are tuned for Claude models. Other models work through it — they don't work *as well*. Expect more failed tool calls, more re-prompting, more drift on long multi-step tasks.

So split the work by what it costs you when it goes wrong:

| Use `claude-free` for | Keep real `claude` for |
|---|---|
| Writing README and docs | Architecture decisions (`/automation-cto`) |
| Boilerplate, config files, SQL schemas | Generating n8n workflow JSON |
| Formatting, renaming, mechanical edits | Debugging an error that survived one attempt |
| Reading a log and summarising it | Anything touching credentials or security |
| Commit messages | `/security-review`, `/code-review` |

Rough rule: **if being wrong costs you an hour, use real Claude.** If it costs two minutes, use free.

---

## 5. Known issues

| Symptom | Cause / fix |
|---|---|
| "Request too large (max 32MB)" on the first prompt | Known OmniRoute + Claude Code bug. Start a fresh session with a smaller first message. |
| Claude Code ignores the gateway entirely | `/v1` left on the base URL, or you didn't restart — env is read once at startup |
| Random 429s | Free tiers are a **shared** pool across everyone using that provider. Not your fault, not fixable — let auto-fallback route around it |
| Claude Code won't start at all | OmniRoute isn't running. That's the cost of lane 2 — no gateway, no assistant |
| Free provider needs payment to continue | Same Russian-card problem as everywhere else. Stay on genuinely free tiers; don't use payment intermediaries |

---

## 6. The line you must not cross

**OmniRoute is for your laptop. It has nothing to do with the four builds.**

| | Runs where | Model | Why |
|---|---|---|---|
| **Claude Code** (writing code, briefs, workflow JSON) | Your MacBook | Claude, or free models via OmniRoute | Your development tool. Yours alone. |
| **n8n workflows** (Builds 1–4) | Timeweb VPS | **Yandex AI Studio (Qwen 3)** — always | Client data. 152-ФЗ. Must be reachable, billable in roubles, and running 24/7. |

**Never point an n8n node at `localhost:20128`.** That address is your MacBook. A client's production workflow cannot depend on your laptop being open, on your home wifi, with a gateway running. It also sends their customers' personal data through foreign providers — which breaks 152-ФЗ and the payability rule at the same time.

One sentence to remember: **OmniRoute helps you build the thing. Yandex AI Studio runs the thing.**

---

## 7. Setup order, today

1. Fix the `0.0.0.0` binding (§1) — **two minutes, do it now**
2. Add the `claude-free` function to `~/.zshrc` (§3)
3. In OmniRoute's dashboard → **Providers**, connect 2–3 free-tier providers so `auto/best-free` has somewhere to fall back to
4. Test: `claude-free` → ask it something trivial → confirm the request appears in OmniRoute's **Request Logs**
5. Go back to `docs/02-start-here.md` Step 5 and keep building

Use `claude` by default. Switch to `claude-free` only when you're out of quota and would otherwise stop for the day.

---

**Sources:** [OmniRoute Claude Code configuration guide](https://github.com/diegosouzapw/OmniRoute/blob/main/docs/guides/CLAUDE-CODE-CONFIGURATION.md) · [OmniRoute wiki](https://github.com/diegosouzapw/OmniRoute/wiki/Claude-Code-Configuration) · [32MB bug report](https://github.com/diegosouzapw/OmniRoute/issues/7990)
