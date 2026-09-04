# Updating self-hosted n8n

**Target:** `n8n.n-enterprise.ru` on Timeweb VPS `5.42.99.81` — Docker + `docker-compose` + Nginx + Let's Encrypt
**Compose dir:** `/root/n8n/`
**This run:** `2.36.8` → **`2.37.10`** (current stable, pinned)
**Upstream doc:** <https://docs.n8n.io/deploy/host-n8n/keep-n8n-running/update-n8n>

Rule for this whole document: **back up before you pull, and verify Telegram after you start.**
An n8n restart re-registers every active webhook. On this box that is the step that breaks, not the upgrade itself.

---

## Step 0 — Is this upgrade safe?

**Yes, for this jump.** n8n's `BREAKING-CHANGES.md` lists nothing between `2.0.0` and `2.37.10` — the last
entry is the 2.0.0 `npm` → `pnpm` change in the `n8nio/runners` image, which only matters if you build a
custom runner image. You don't.

Check it yourself before any future jump — this is the single command that decides whether an upgrade is
routine or a project:

```bash
curl -s https://raw.githubusercontent.com/n8n-io/n8n/master/packages/cli/BREAKING-CHANGES.md | head -60
```

Current published versions:

```bash
curl -s https://registry.npmjs.org/n8n | python3 -c "import sys,json; print(json.load(sys.stdin)['dist-tags'])"
```

`latest` / `stable` is what you want. **Never deploy `next` or `beta` to this box** — clients touch it.

---

## Step 1 — Recon (run all four, write down the answers)

### 1A. What is actually running?

```bash
cd /root/n8n
docker-compose ps
docker exec -it n8n n8n --version
```

Note the container name from `ps` — the rest of this runbook assumes it's `n8n`. Substitute if not.

### 1B. Which image tag is pinned?

```bash
grep -n "image:" /root/n8n/docker-compose.yml
```

- `n8nio/n8n:2.36.8` → good, this runbook edits that line.
- `n8nio/n8n:latest` → **fix this while you're here.** `:latest` means the next `pull` silently moves you
  to whatever is current, including a future 3.0 with real breaking changes. Pin it.

### 1C. Where does n8n keep its own database?

n8n's own DB is separate from the Postgres you use for build data. Find out which it is:

```bash
grep -nE "DB_TYPE|DB_POSTGRESDB|volumes:" -A3 /root/n8n/docker-compose.yml
docker volume ls | grep -i n8n
```

- No `DB_TYPE` set → **SQLite**, living in the `/home/node/.n8n` volume. Back up the volume (Step 2).
- `DB_TYPE=postgresdb` → back up that Postgres database with `pg_dump` as well as the volume.

### 1D. What is the encryption key situation?

This is the one thing you cannot recover. Without it every stored credential — Yandex API key, Telegram
tokens, Bitrix24 — becomes undecryptable ciphertext.

```bash
grep -n "N8N_ENCRYPTION_KEY" /root/n8n/docker-compose.yml /root/n8n/.env 2>/dev/null
docker exec -it n8n sh -c 'cat /home/node/.n8n/config' 2>/dev/null
```

If it's in compose or `.env`, the Step 2 config backup covers it. If it only exists inside
`/home/node/.n8n/config`, the volume backup covers it — **so do not skip the volume backup.**

---

## Step 2 — Back up (not optional)

```bash
mkdir -p /root/n8n/backups
cd /root/n8n
STAMP=$(date +%F-%H%M)
```

### 2A. Config files

```bash
cp docker-compose.yml backups/docker-compose.yml.$STAMP
cp .env backups/.env.$STAMP 2>/dev/null || echo "no .env — config is inline in compose"
```

### 2B. Workflows, as readable JSON

Belt and braces — this survives even a total volume loss:

```bash
docker exec n8n n8n export:workflow --backup --output=/home/node/.n8n/backup-workflows/
docker cp n8n:/home/node/.n8n/backup-workflows ./backups/workflows-$STAMP
ls ./backups/workflows-$STAMP | wc -l
```

> Do **not** run `export:credentials --decrypted`. That writes every API key to disk in plaintext, and this
> directory is one `git add .` away from the repo. The encryption key backup is the correct recovery path.

### 2C. The data volume — with the container stopped

A SQLite file copied while n8n is writing to it can be torn. Stop first:

```bash
docker-compose down
```

Find the volume name from Step 1C, then (substituting `n8n_n8n_data` for yours):

```bash
docker run --rm \
  -v n8n_n8n_data:/data:ro \
  -v /root/n8n/backups:/backup \
  alpine tar czf /backup/n8n-data-$STAMP.tar.gz -C /data .

ls -lh backups/n8n-data-$STAMP.tar.gz
```

**If that file is a few kilobytes, the volume name is wrong.** Real size is megabytes. Do not continue
until it looks right.

### 2D. Postgres, if 1C said so

```bash
docker exec -t <postgres_container> pg_dump -U <user> <n8n_db> > backups/n8n-db-$STAMP.sql
ls -lh backups/n8n-db-$STAMP.sql
```

---

## Step 3 — Pin the new version

```bash
sed -i 's|image: n8nio/n8n:.*|image: n8nio/n8n:2.37.10|' /root/n8n/docker-compose.yml
grep -n "image: n8nio/n8n" /root/n8n/docker-compose.yml
```

Confirm the line reads exactly `image: n8nio/n8n:2.37.10` before continuing.

---

## Step 4 — Pull and start

```bash
cd /root/n8n
docker-compose pull
docker-compose up -d
```

> **VPS gotcha.** `docker compose` (space) does not exist on this box — always `docker-compose` (hyphen).
> Version 1.29.2 crashes with `KeyError: 'ContainerConfig'` on recreate, which is why this runbook does
> `down` (Step 2C) then `up -d`, and never `up -d --force-recreate`.

Watch the first start. Database migrations run automatically here, and a big jump can take a few minutes:

```bash
docker-compose logs -f n8n
```

Wait for the `Editor is now accessible via:` line. `Ctrl-C` only stops the log tail, not the container.

---

## Step 5 — Verify (all five, in order)

### 5A. Version

```bash
docker exec -it n8n n8n --version     # expect 2.37.10
docker-compose ps                      # expect Up, not Restarting
```

`Restarting` in a loop = failed migration. Go to Step 6.

### 5B. HTTP through Nginx

```bash
curl -sI https://n8n.n-enterprise.ru | head -3
```

### 5C. Credentials survived

Open the editor, go to **Credentials**, open the Yandex AI Studio one. If the API key field shows as set,
the encryption key came through. If credentials look blank or throw a decrypt error — **stop, roll back
(Step 6)**, and fix `N8N_ENCRYPTION_KEY` before trying again.

### 5D. Telegram webhooks re-registered — the step that actually bites

The restart made n8n call `setWebhook` again for every active workflow. Ground truth is Telegram, never the
n8n UI:

```bash
curl -s "https://api.telegram.org/bot<TOKEN>/getWebhookInfo" | python3 -m json.tool
```

Required state:

- `url` — points at your `WEBHOOK_URL` host (the `tg-in` Worker), not `localhost:5678`
- `ip_address` — a Cloudflare address (e.g. `188.114.96.0`), **not** `5.42.99.81`
- `pending_update_count` — `0` and staying there
- `last_error_message` — absent, or an old timestamp from before the upgrade

Anything else → `docs/04-telegram-webhook-runbook.md`. Confirm both compose vars survived the edit:

```bash
grep -nE "WEBHOOK_URL|N8N_HOST|N8N_PROXY_HOPS" /root/n8n/docker-compose.yml
```

And check the **Base URL** on every Telegram credential still points at `edrus-telegram`, not
`api.telegram.org` — outbound is blocked from this box in both directions.

### 5E. End-to-end

Send one message to the bot. A reply in under 3 seconds means both Workers and n8n are healthy. Then run
one workflow manually that hits Qwen 3 via the OpenAI Chat Model node — the v1.8-vs-v2 custom-base-URL
404 is exactly the class of thing a version bump can disturb.

---

## Step 6 — Rollback

Any failed verification, in this order:

```bash
cd /root/n8n
docker-compose down
cp backups/docker-compose.yml.$STAMP docker-compose.yml    # restores the 2.36.8 pin
docker-compose up -d
docker-compose logs -f n8n
```

If the data is also damaged (failed migration, corrupt DB), restore the volume too:

```bash
docker-compose down
docker run --rm \
  -v n8n_n8n_data:/data \
  -v /root/n8n/backups:/backup \
  alpine sh -c "rm -rf /data/* /data/..?* ; tar xzf /backup/n8n-data-$STAMP.tar.gz -C /data"
docker-compose up -d
```

> A downgrade **does not** reverse migrations. If 2.37.10 migrated the schema and you drop back to 2.36.8,
> the old binary may reject the new schema — which is why the volume restore, not the tag revert, is the
> real rollback.

---

## Step 7 — Housekeeping

```bash
docker image prune -f            # drop the superseded 2.36.8 layers
df -h /                          # Timeweb disk is small; images accumulate
ls -lht /root/n8n/backups | head # keep the last 3, delete older
```

Then update the version in `CLAUDE.md` so the next session isn't working from a stale fact.

---

## Checklist

- [ ] `BREAKING-CHANGES.md` checked for the version range
- [ ] Target version pinned explicitly — not `:latest`, not `next`/`beta`
- [ ] `docker-compose.yml` (and `.env`) copied to `backups/`
- [ ] Workflows exported to JSON
- [ ] Volume tarball exists and is **megabytes**, not kilobytes
- [ ] Encryption key location known and covered by a backup
- [ ] `n8n --version` reports the new version
- [ ] `docker-compose ps` shows `Up`, not `Restarting`
- [ ] A credential opens without a decrypt error
- [ ] `getWebhookInfo` shows a Cloudflare `ip_address` and `pending_update_count: 0`
- [ ] Bot replies to a real message in under 3 seconds
- [ ] One Qwen 3 workflow runs green
- [ ] `CLAUDE.md` version line updated

---

## Cadence

Patch and minor bumps within `2.x`: **monthly**, following this runbook, on a weekday morning when no
client demo is scheduled. Never on the day of a delivery.

The next major (`3.0`) is a different exercise — `docs.n8n.io` publishes a dedicated v3.0 breaking-changes
page, and that one gets read line by line and staged before it goes anywhere near this box. [VERIFY]
