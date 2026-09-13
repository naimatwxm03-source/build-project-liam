# VK channel adapter

The receive-and-reply layer every RU build sits on. Import the echo workflow once to get VK's Callback address confirmed; after that, Builds 1 and 3A reuse the same three pieces.

**Why this exists as a shared thing:** n8n has no VK node. Without an adapter, each build would grow its own copy of the confirmation handshake, the secret check and the attachment parsing — and they would drift. Here they are written once and unit-tested.

## Files

| File | What it is |
|---|---|
| `normalize-vk.js` | **Single source of truth.** VK Callback event → the shared envelope. Pure function, no n8n APIs. |
| `normalize-vk.test.js` | 18 tests. Group chats, photo rendition picking, PDF routing, voice notes, malformed bodies, dedup stability. |
| `sync-code-node.py` | Injects `normalize-vk.js` into the Code node of every workflow listed inside it. |
| `vk-echo.workflow.json` | Import this first. Confirmation + secret + echo reply. |

## The envelope

Identical in shape to the Telegram one, so the agent never learns which channel it is on:

```js
{
  channel: 'vk',
  event_id,          // VK's own id — stable across VK's retries. The dedup key.
  group_id,
  user_id,           // from_id — who wrote it
  chat_id,           // peer_id — where the reply goes. Differs in group chats.
  session_key,       // 'vk:<from_id>' — memory is per-person, never per-chat
  text,
  file_url,          // largest photo rendition, or an image doc. '' if none.
  file_kind,         // 'photo' | 'doc' | 'doc_unsupported' | 'audio_message' | ''
  audio_url,         // voice messages (Build 3A). Prefers .ogg.
  message_id,
  ts,                // ISO 8601
  reply_random_id,   // deterministic from event_id — see below
}
```

Every id is a **string**, so Redis keys and Data Table rows never vary by type between a numeric and a stringified id.

## Four things that are easy to get wrong

**1. `responseMode` must be `responseNode`.**
n8n's default webhook response is `{"message":"Workflow was started"}`. VK wants the bare confirmation string and nothing else. Wrong setting → «Неверный ответ сервера» and the address is never confirmed.

**2. Respond before doing any work.**
`Respond OK` sits immediately after the confirmation branch, before the secret check and before anything expensive. VK retries a slow endpoint, and a retry means the same receipt logged twice. Answering first also makes VK's exact timeout irrelevant — the design does not depend on knowing it.

**3. `random_id` is derived, not random.**
VK requires it non-zero and dedups sends that repeat one. `reply_random_id` is a hash of `event_id`, so if n8n retries the send, VK discards the duplicate instead of double-replying. A clock-based value would not.

**4. VK reports failure with HTTP 200.**
A failed `messages.send` returns `200 OK` with `{"error": {"error_code": 901, ...}}`. HTTP status alone never catches it, which is why `VK Returned An Error?` inspects the body and `Raise VK Error` turns it into a failed execution the Error Trigger can alert on.

## Environment

On the VPS, in the n8n env:

```bash
VK_GROUP_TOKEN=vk1.a....        # not used by expressions — lives in the credential
VK_GROUP_ID=123456789
VK_CALLBACK_SECRET=<openssl rand -hex 24>
VK_CONFIRMATION_STRING=<VK shows this in Callback API settings>

N8N_BLOCK_ENV_ACCESS_IN_NODE=false   # required, or $env resolves to nothing
```

That last line matters: without it the confirmation node responds with an empty body and VK rejects the address, with no error anywhere in n8n.

```bash
cd /root/n8n && docker-compose down && docker-compose up -d
```

`docker-compose` with the hyphen. The spaced form is not installed, and 1.29.2 crashes with `KeyError: 'ContainerConfig'` on recreate — hence down-then-up rather than `restart`.

**The token goes in a credential, never in a file here.** In n8n create a **Query Auth** credential named `VK Group Token`, parameter name `access_token`, value the group token. The workflow JSON then carries only `"id": "REPLACE_ON_IMPORT"`, which is what keeps exported workflows safe to commit.

## Import order

1. Import `vk-echo.workflow.json`.
2. Create the `VK Group Token` credential and select it on **Send Reply**.
3. **Activate** the workflow. The live URL contains `/webhook/`, not `/webhook-test/`.
4. Now, and only now, do Step 5 of `docs/05-vk-setup.md` and press **Подтвердить**.
5. Message the community. Expect an echo in under 3 seconds.

## Verifying

Ground truth, never the n8n UI:

```bash
curl -s "https://api.vk.com/method/groups.getCallbackServers?group_id=$VK_GROUP_ID&access_token=$VK_GROUP_TOKEN&v=5.199" \
  | python3 -m json.tool
```

`items[].status` → `ok` delivering · `failed` VK gave up · `wait` never confirmed.

You can also exercise the endpoint without VK:

```bash
# confirmation handshake — must print the bare confirmation string
curl -s -X POST https://n8n.n-enterprise.ru/webhook/vk-receipt \
  -H 'Content-Type: application/json' \
  -d '{"type":"confirmation","group_id":123456789}'

# a bad secret — must print ok and log nothing
curl -s -X POST https://n8n.n-enterprise.ru/webhook/vk-receipt \
  -H 'Content-Type: application/json' \
  -d '{"type":"message_new","secret":"wrong","object":{"message":{}}}'
```

## Changing the normalizer

`normalize-vk.js` and the Code node inside each workflow must not drift:

```bash
node --test builds/vk-adapter/*.test.js   # 18 tests
python3 builds/vk-adapter/sync-code-node.py
git add builds/vk-adapter builds/01-receipt-bot/workflow.json
```

`sync-code-node.py --check` exits non-zero on drift, so it can gate a push.

**Never hand-edit the `jsCode` inside a workflow.json.** The sync overwrites it.

## Adding a channel later

Write `normalize-<channel>.js` emitting this same envelope, add the workflow to the list in `sync-code-node.py`, and point the agent at it. Avito and MAX are new adapters, not new builds. The agent and its tools do not change.
