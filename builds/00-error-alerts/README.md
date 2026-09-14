# 00 — Error alerts to VK

**Status: live and tested 2026-09-14.** Breaking the Vision OCR URL on purpose
produced, within seconds: workflow name, `Узел: Yandex Vision OCR`, the error
text, and a link to the failed execution. Restored afterwards and confirmed
normal.

A failure nobody hears about is worse than a failure, because the client finds
it before you do. This workflow is the difference between a demo and something
you can put a client's name on.

## What it does

n8n's **Error Trigger** fires when any workflow naming this one as its error
workflow fails. The alert goes to Naimat's own VK, not the user's, and names:

- which workflow died
- **which node** — `lastNodeExecuted`, so you know whether it is the Yandex key,
  VK, or the Data Table before you open anything
- the error message
- a direct link to the failed execution

## Setup

1. Add your own VK id to `/root/n8n/docker-compose.yml`:

   ```yaml
         - VK_ADMIN_PEER_ID=123456789
   ```

   That is your **personal** VK user id, not the community id. Open your VK
   profile — `vk.com/id123456789` — and take the number. Then:

   ```bash
   cd /root/n8n && docker-compose down && docker-compose up -d
   ```

2. Import `workflow.json`, select the existing `VK Group Token` credential on
   **Alert Naimat On VK**, and **Publish**.

3. On every workflow you want covered: **Workflow Settings → Error Workflow →
   `00 Error Alerts — VK`**. Do this for `01 Expense Bot — VK`.

## Test it

Temporarily break something small — for example put a wrong character in the
Vision OCR URL in Build 1 — send a receipt, and confirm the alert arrives. Then
undo it. An untested alarm is not an alarm.

## Notes

- `random_id` here is clock-based, deliberately. Elsewhere it is derived from
  the event id so a retry cannot double-reply; here two separate failures must
  both get through.
- The bot messages you from the community, so **you must have written to the
  community at least once** — VK will not let a community open a conversation
  with a user who has never messaged it.
