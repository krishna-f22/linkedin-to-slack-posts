# AI-Powered LinkedIn Research Assistant

Natural-language intent → GPT-5 turns it into a LinkedIn search keyword → LinkdAPI fetches posts →
GPT-5 summarizes, ranks by relevance, enforces location, drops duplicates → results posted to Slack.

**Two ways to trigger it:**
- **Web UI** — type an intent in the app (Supabase login) → results go to a fixed Slack channel (incoming webhook).
- **Slack-native** — `@bot posts where AI engineers are hiring in India` → bot runs the same pipeline and
  replies **where it was tagged**: in a thread for channel mentions, in the DM for direct messages.

Stack: Next.js (web) · Supabase (Auth + Postgres + Edge Functions/Deno) · OpenAI GPT-5 ·
LinkdAPI (RapidAPI) · Slack (Incoming Webhook + Events API/Bot).

---

## Flow

```
Trigger A — Web UI (Supabase Auth) → invoke edge fn "research"
Trigger B — Slack @-mention/DM → edge fn "slack-events" (verifies signature, acks <3s, "Searching… 🔎")
  → both run the SAME background pipeline (lib/pipeline.ts):
     1. plan     : GPT-5 → search keyword + filters (hiring intents → "hiring <role>", sort=date_posted)
     2. search   : LinkdAPI /search/posts (1 call ≈ 10 posts, dedup by URL)
     3. summarize: GPT-5 → per-post summary + relevance(0-100); enforces intent location, merges dupes
     4. gate     : keep posts with relevance >= MIN_RELEVANCE (default 50), sorted high→low
     5. post     : one card per job (summary + link + image/video if present)
                   - web   → Slack incoming webhook (fixed channel)
                   - slack → chat.postMessage back to the originating channel (thread) or DM
Web UI subscribes to the research_jobs row (Supabase Realtime) for live status + result.
```

## Project layout

```
/web                              Next.js app (App Router, TS)
/supabase
  migrations/                     research_jobs table + RLS (+ slack columns)
  functions/research/             web entry (index.ts) + shared lib/* (pipeline, llm, slack, …)
    .env.example                  required secrets/config (template)
  functions/slack-events/         Slack Events API entry (signature verify, @-mention/DM → pipeline)
```

---

# Setup from scratch (portable — deploy to ANY new Supabase project)

Nothing here is hardcoded to a specific project. Follow top-to-bottom on a clean machine/account and you
get a fully working copy. Where you see a `<PLACEHOLDER>`, substitute your own value.

## 0. Prerequisites

| Need | Where | Notes |
|------|-------|-------|
| Node.js 18+ & npm | <https://nodejs.org> | runs the web app + the Supabase CLI (via `npx`) |
| A Supabase account | <https://supabase.com> | free tier is fine |
| An OpenAI API key | <https://platform.openai.com/api-keys> | used for the planner + summarizer (GPT-5) |
| A RapidAPI account + LinkdAPI subscription | <https://rapidapi.com> → search "LinkdAPI" | subscribe to **LinkdAPI**; copy the `x-rapidapi-key`. Free Basic = ~5 searches/month per key |
| A Slack workspace where you can install apps | <https://slack.com> | company workspaces may need admin approval to install |

```bash
git clone <THIS_REPO_URL>
cd <repo>
```

## 1. Create a new Supabase project

1. <https://supabase.com/dashboard> → **New project** → pick org, name, **database password**, region → create.
2. Once provisioned, grab these from the dashboard:
   - **Project ref** — Settings → General → "Reference ID" (looks like `abcd1234efgh5678`). Call it `<PROJECT_REF>`.
   - **Project URL** — Settings → API → `https://<PROJECT_REF>.supabase.co`.
   - **anon public key** — Settings → API → `anon` `public` (a long `eyJ…` JWT). For the web app.
   - **service_role key** — Settings → API → `service_role` (secret `eyJ…`). Server-side only — never expose.

## 2. Link the CLI to your project

```bash
npx supabase login                              # opens browser, authorizes the CLI
npx supabase link --project-ref <PROJECT_REF>   # prompts for the DB password from step 1
```

## 3. Apply the database schema (migrations)

This creates the `research_jobs` table (+ RLS, + the Slack columns).

```bash
npx supabase db push
```

Verify in the dashboard (Table editor) that `research_jobs` exists with columns including
`source`, `slack_channel`, `slack_user`, `slack_thread_ts`, and a nullable `user_id`.

## 4. Set the edge-function secrets

These power the pipeline. `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are **auto-injected** in production,
so you do NOT set them here.

```bash
npx supabase secrets set \
  OPENAI_API_KEY=sk-...your-openai-key... \
  LINKDAPI_KEYS=your-rapidapi-linkdapi-key \
  SLACK_WEBHOOK_URL=https://hooks.slack.com/services/XXX/YYY/ZZZ \
  --project-ref <PROJECT_REF>
```

- `LINKDAPI_KEYS` — one key, or several **comma-separated** for automatic failover when one hits its quota
  (e.g. `key1,key2,key3`).
- `SLACK_WEBHOOK_URL` — only used by the **web** trigger (posts to one fixed channel). Create it in your Slack
  app under **Incoming Webhooks** (enable → Add New Webhook → pick a channel → copy the URL). If you only care
  about the Slack-native bot, you can point this at any channel; it just needs to be a valid webhook URL.
- The Slack **bot** secrets (`SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`) are set in **step 6** after you create
  the Slack app.

> Tip: you can instead fill `supabase/functions/research/.env` (copy from `.env.example`, it is gitignored)
> and run `npx supabase secrets set --env-file supabase/functions/research/.env`.

## 5. Deploy the edge functions

```bash
# web trigger (requires a Supabase JWT — keep the default verify)
npx supabase functions deploy research --project-ref <PROJECT_REF>

# Slack trigger — PUBLIC. Slack can't send a Supabase JWT, so we verify via the signing secret instead.
npx supabase functions deploy slack-events --no-verify-jwt --project-ref <PROJECT_REF>
```

Your Slack endpoint is now: `https://<PROJECT_REF>.functions.supabase.co/slack-events`

> **Windows/CLI gotcha:** if a `.env` file with raw (non `KEY=value`) lines sits in the repo root, the CLI may
> fail with `failed to parse environment file: .env`. Temporarily move it aside during deploy
> (`mv .env .env.hold` → deploy → `mv .env.hold .env`).

## 6. Create & wire the Slack app (for the @-mention / DM bot)

1. <https://api.slack.com/apps> → **Create New App** → **From scratch** → name it, pick your workspace.
2. **OAuth & Permissions → Bot Token Scopes** → add:
   `app_mentions:read`, `chat:write`, `im:history`, `im:read`, `im:write`.
3. **Install to Workspace** → **Allow** (company workspace may need admin approval).
   - Copy the **Bot User OAuth Token** (`xoxb-…`).
   - **Basic Information → App Credentials → Signing Secret** → copy it.
4. Set both as secrets:
   ```bash
   npx supabase secrets set SLACK_BOT_TOKEN=xoxb-... SLACK_SIGNING_SECRET=... --project-ref <PROJECT_REF>
   ```
   (Redeploy `slack-events` once after setting these so it cold-starts with them — repeat the step-5 command.)
5. **Event Subscriptions** → toggle **Enable Events** on → **Request URL**:
   `https://<PROJECT_REF>.functions.supabase.co/slack-events`
   It should flip to **✓ Verified** (this proves the signing secret + handshake work).
6. **Subscribe to bot events** → **Add Bot User Event** → add `app_mention` **and** `message.im` → **Save Changes**.
7. **Install App → Reinstall to Workspace** (activates the new event subscriptions).
8. (Optional) **Incoming Webhooks** → enable → **Add New Webhook to Workspace** → pick a channel → that URL is
   your `SLACK_WEBHOOK_URL` from step 4 (re-set the secret if you skipped it earlier).
9. In Slack: create/open a channel, `/invite @YourBot`, then tag it:
   `@YourBot posts where AI engineers are hiring in India`.

## 7. Run the web app (local)

```bash
cd web
cp .env.local.example .env.local
# fill:
#   NEXT_PUBLIC_SUPABASE_URL=https://<PROJECT_REF>.supabase.co
#   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon public key from step 1>
npm install
npm run dev          # http://localhost:3000
```

Sign up / log in (Supabase Auth), enter an intent, and watch results stream into the dashboard + Slack.
To deploy the web app (e.g. Vercel), set the same two `NEXT_PUBLIC_*` env vars in the host.

---

## Environment variables reference

| Variable | Where set | Required | Purpose |
|----------|-----------|----------|---------|
| `OPENAI_API_KEY` | Supabase secret | ✅ | GPT-5 planner + summarizer |
| `LINKDAPI_KEYS` | Supabase secret | ✅ | RapidAPI LinkdAPI key(s), comma-sep for failover |
| `SLACK_WEBHOOK_URL` | Supabase secret | ✅ | Web trigger → fixed channel |
| `SLACK_BOT_TOKEN` | Supabase secret | ✅ (bot) | `chat.postMessage` replies |
| `SLACK_SIGNING_SECRET` | Supabase secret | ✅ (bot) | Verify inbound Slack signatures |
| `SLACK_BOT_USER_ID` | Supabase secret | optional | Bot user id (mention is stripped by regex regardless) |
| `MAX_LINKDAPI_CALLS` | Supabase secret | optional (6) | Per-job LinkdAPI call budget |
| `MIN_POSTS_THRESHOLD` | Supabase secret | optional (8) | Search loop stop target |
| `MIN_RELEVANCE` | Supabase secret | optional (50) | Drop posts scoring below this (0-100) |
| `OPENAI_PLANNER_MODEL` / `OPENAI_SUMMARIZER_MODEL` | Supabase secret | optional (gpt-5) | Model overrides |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | auto-injected in prod | — | Set locally only for `supabase functions serve` |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `web/.env.local` | ✅ (web) | Browser client config (public) |

## Verify end-to-end

1. **DB** — `research_jobs` table exists with the Slack columns.
2. **Slack URL** — Event Subscriptions shows **✓ Verified**.
3. **Channel** — tag the bot → "Searching… 🔎" appears in a thread within ~1–2s → result cards follow
   (India jobs ranked top, foreign lower, duplicates merged).
4. **DM** — DM the bot the same text → reply arrives in the DM (no thread).
5. **Web** — log in at `localhost:3000`, submit an intent → live status → results + Slack post.
6. **Logs** — Supabase Dashboard → Edge Functions → Logs (or `supabase functions logs slack-events`) → no errors.

## Troubleshooting / gotchas

- **Bot stays silent after tagging** — Event Subscriptions not saved, or app not reinstalled after adding the
  bot events. Re-save + **Reinstall to Workspace**.
- **Request URL won't verify** — `SLACK_SIGNING_SECRET` wrong/unset, or `slack-events` not deployed with
  `--no-verify-jwt`. Re-set the secret, redeploy.
- **`failed to parse environment file: .env`** during deploy — move the root `.env` aside (see step 5 gotcha).
- **Quota / `HTTP 429` / "key exhausted"** — LinkdAPI free plan ≈ **5 searches/month per key**. Add more keys
  to `LINKDAPI_KEYS` (comma-sep) and redeploy. On failure the bot now replies in-thread instead of hanging.
- **3s ack** — Slack drops requests not answered in 3s; the bot acks first and runs the pipeline in
  `EdgeRuntime.waitUntil`, then posts results. No loops/double-posts: it ignores its own messages
  (`bot_id`/`subtype`) and Slack retries (`X-Slack-Retry-Num`).

## Pipeline notes (proven against LinkdAPI)

- **Keyword = `hiring <role>`** (verb first), **no location** in the keyword — adding "india" skews results to
  recruitment-agency commentary instead of real job posts. Location is enforced by the summarizer instead
  (intent location ranks top; other countries rank lower but are still shown).
- **`sortBy=date_posted`** for hiring intents → freshest real job posts.
- Duplicate jobs (same role reposted by different recruiters) are merged; the same company in different
  cities/branches is kept separate.
