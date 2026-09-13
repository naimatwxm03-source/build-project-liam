# VK setup — community, token, Callback API

**Time:** ~15 minutes · **Cost:** 0 ₽ · **Needs:** a personal VK account. **No ИП/ООО, no card, no phone number purchase.**

This replaces the Telegram bot setup for every RU-facing build. Do it once; Builds 1 and 3A both use it.

---

## Read this before you start — the one ordering rule

**The n8n workflow must be built and Active BEFORE you press «Подтвердить» in VK's Callback API settings.**

VK confirms the address by POSTing to it once and demanding an exact plain-text string back. If n8n isn't listening yet, VK marks the address failed and you have to fix it and retry. Everyone gets this wrong once.

So: **Steps 1–4 now. Stop. Tell me. I finish the workflow. Then Step 5.**

---

## Step 1 — Create the community

1. vk.com → left menu → **Сообщества** → **Создать сообщество**
2. Pick **Бизнес** (or **Группа по интересам** — either works; a **Публичная страница** does not, avoid it)
3. Name it something a client would see. `NXAI Автоматизация` is fine for the demo.
4. Create.

## Step 2 — Turn on messages and bot capability

Both are off by default, and the second one is easy to miss.

1. Community → **Управление** → **Сообщения**
2. **Сообщения сообщества** → **Включены**
3. Still in **Сообщения** → tab **Настройки для бота**
4. **Возможности ботов** → **Включены**
5. Turn on **Отображать кнопку «Начать»** — it gives you a clean first-run for demos.

> If «Настройки для бота» isn't visible, messages aren't enabled yet. Do 2 before 3.

## Step 3 — Create the access token

1. **Управление** → **Работа с API** → tab **Ключи доступа** → **Создать ключ**
2. Tick these permissions (confirmed against the real dialog — no separate audio scope exists; voice messages arrive as message attachments and are already covered by "Сообщения сообщества"):
   - ✅ **Сообщения сообщества** — required, this is how the bot reads and sends
   - ✅ **Фотографии** — required for Build 1, receipts arrive as photo attachments
   - ✅ **Документы** — required, some clients send receipts as files not photos
   - ⬜ Leave everything else unchecked — управление сообществом, истории, стена, товары и заказы are all more access than the bot needs
3. Confirm. VK shows the token **once**.

**Put it straight into `.env` on the VPS. Do not paste it into this chat.**

```bash
# on the VPS, in /root/n8n/.env  (or wherever your n8n env lives)
VK_GROUP_TOKEN=vk1.a.xxxxx...
VK_GROUP_ID=123456789
VK_CALLBACK_SECRET=<invent a long random string, see below>
VK_CONFIRMATION_STRING=<from Step 5, VK shows it to you>

# Required, or the confirmation reply comes back empty and VK rejects the
# address with no error visible anywhere in n8n.
N8N_BLOCK_ENV_ACCESS_IN_NODE=false
```

Generate the secret yourself — it's yours to choose, not VK's:

```bash
openssl rand -hex 24
```

To verify the file never leaks a value:

```bash
sed 's/=.*/=***/' /root/n8n/.env
```

## Step 4 — Find your group_id

**Управление** → **Работа с API** → it's shown at the top. Or: open the community, the URL `vk.com/club123456789` — the number is the group id. If you set a custom short address, use **Управление** → **Настройки** → the id is still listed there.

Numeric only. No `club` prefix. Write it into `VK_GROUP_ID`.

---

# ⛔ STOP HERE. Tell me Steps 1–4 are done.

I need to build and activate the n8n workflow before VK is allowed to probe the address. Continuing past this point without it wastes a confirmation attempt.

---

## Step 5 — Callback API (after I say the workflow is live)

1. **Управление** → **Работа с API** → tab **Callback API**
2. **Версия API:** `5.199`
3. **Адрес:** the production webhook URL I give you. It looks like:
   `https://n8n.n-enterprise.ru/webhook/vk-receipt`
4. **Секретный ключ:** paste the same value you put in `VK_CALLBACK_SECRET`
5. VK displays **«Строка, которую должен вернуть сервер»** — a short string like `a1b2c3d4`. **Copy it into `VK_CONFIRMATION_STRING` in `.env` and restart n8n**, then come back.
6. Press **Подтвердить**.

**Expected:** the address turns green / shows «Подтверждён».

**If it fails**, the failure is one of exactly three things, in this order of likelihood:
| Symptom | Cause | Fix |
|---|---|---|
| «Неверный ответ сервера» | n8n returned JSON, not the bare string | Webhook node must be set to **Respond: Using 'Respond to Webhook' Node** — not "Immediately" |
| «Сервер не отвечает» | Workflow isn't Active, or you used the `/webhook-test/` URL | Activate the workflow; the live URL has `/webhook/`, not `/webhook-test/` |
| Green, but no messages arrive | Event subscription not ticked | Step 6 |

## Step 6 — Subscribe to events

Same page, tab **Типы событий**:

- ✅ **Входящее сообщение** (`message_new`) — required
- Leave everything else off. Extra events cost executions and teach the workflow nothing.

## Step 7 — Prove it works

Send your community a message from your own VK account. Expected: a reply in under 3 seconds.

Server-side ground truth, run from anywhere:

```bash
curl -s "https://api.vk.com/method/groups.getCallbackServers?group_id=$VK_GROUP_ID&access_token=$VK_GROUP_TOKEN&v=5.199" \
  | python3 -m json.tool
```

Read `items[].status`:
- `ok` — VK is delivering. Good.
- `failed` — VK gave up on the address. Re-confirm after fixing.
- `wait` — confirmation never completed. Go back to Step 5.

**This is the VK equivalent of `getWebhookInfo`. It is ground truth; the n8n UI is not.**

---

## Why VK and not Telegram — the short version

Telegram's servers live outside Russia and could not reach `5.42.99.81`. That was never an n8n problem and no amount of n8n configuration fixed it.

VK's servers are in Russia. Russian server → Russian IP is the normal case, not the exception. And if Callback ever disappoints, **VK Long Poll** is a fallback where n8n calls *out* to VK and nothing inbound is needed at all — outbound from the VPS to Russian services has never once failed.

Two working paths instead of zero. Full reasoning: `builds/decisions/02-channel-vk.md`.

## What's different from Telegram, practically

| | Telegram | VK |
|---|---|---|
| Inbound | Blocked from the VPS's IP | Works (Russian → Russian) |
| Photo handling | `file_id` → `getFile` → download | **URL is already in the payload** — one node fewer |
| Dedup | You build it | `random_id` server-side, **plus** our Redis check |
| n8n node | Native Telegram node | **None — HTTP Request.** We build the adapter once and reuse it |
| Reply target | `chat_id` | `peer_id` |
| Client trust (RU SMB) | Fine | Higher — it's where their customers already are |

## Standing rules

1. **`groups.getCallbackServers` is ground truth.** Not the n8n UI, not the VK settings page colour.
2. **Respond `ok` before doing any work.** VK retries on a slow response and you get the same receipt logged twice. The workflow answers first, thinks second.
3. **Always verify the `secret` field** on every incoming event. The webhook URL is public; the secret is what makes the request trustworthy.
4. **`random_id` on `messages.send` must be non-zero and unique per message**, or VK silently drops it as a duplicate.
