# AI-Powered LinkedIn Research Assistant

Natural-language intent → GPT-5 turns it into a LinkedIn search keyword → LinkdAPI fetches posts →
GPT-5 summarizes, ranks by relevance, enforces location, drops duplicates → results posted to Slack.

**Two ways to trigger it:**
- **Web UI** — type an intent in the app (Supabase login) → results go to a fixed Slack channel (incoming webhook).
- **Slack-native** — `@bot posts where AI engineers are hiring in India` → bot runs the same pipeline and
  replies **where it was tagged**: in a thread for channel mentions, in the DM for direct messages.

Stack: Next.js (web) · Supabase (Auth + Postgres + Edge Functions/Deno) · OpenAI GPT-5 ·
LinkdAPI (RapidAPI) · Slack (Incoming Webhook + Events API/Bot).

## Flow

```
Trigger A — Web UI (Supabase Auth) → invoke edge fn "research"
Trigger B — Slack @-mention/DM → edge fn "slack-events" (verifies signature, acks <3s, "Searching… 🔎")
  → both run the SAME background pipeline (lib/pipeline.ts):
     1. plan   : GPT-5 → search keyword + filters  (hiring intents → "hiring <role>", sort=date_posted)
     2. search : LinkdAPI /search/posts (1 call ≈ 10 posts, dedup by URL)
     3. summarize: GPT-5 → per-post summary + relevance(0-100); enforces intent location, merges duplicate jobs
     4. gate   : keep posts with relevance >= MIN_RELEVANCE (default 50), sorted high→low
     5. post   : one card per job (summary + link + image/video if present)
                 - web   → Slack incoming webhook (fixed channel)
                 - slack → chat.postMessage back to the originating channel (thread) or DM
Web UI polls research_jobs row (Supabase Realtime) for live status + result.
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

## Setup

### 1. Supabase
```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push                       # apply migrations (research_jobs + RLS)
```

### 2. Edge function secrets
Copy `supabase/functions/research/.env.example` → fill real values → set them:
```bash
npx supabase secrets set --env-file supabase/functions/research/.env   # your filled copy (gitignored)
```
Required: `OPENAI_API_KEY`, `LINKDAPI_KEYS` (comma-sep for failover), `SLACK_WEBHOOK_URL`.
`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are auto-injected in production.

### 3. Deploy the functions
```bash
npx supabase functions deploy research --project-ref <your-project-ref>
# slack-events is public (Slack can't send a Supabase JWT — we verify via signing secret instead):
npx supabase functions deploy slack-events --no-verify-jwt --project-ref <your-project-ref>
```

### 4. Slack App (for the @-mention / DM trigger)
1. Create a Slack app (from scratch) at <https://api.slack.com/apps>.
2. **OAuth & Permissions → Bot Token Scopes**: `app_mentions:read`, `chat:write`, `im:history`, `im:read`, `im:write`.
3. **Install to Workspace** → copy the **Bot User OAuth Token** (`xoxb-…`). From **Basic Information** copy the **Signing Secret**.
4. Set the secrets:
   ```bash
   npx supabase secrets set SLACK_BOT_TOKEN=xoxb-... SLACK_SIGNING_SECRET=...
   ```
5. **Event Subscriptions** → enable → **Request URL**: `https://<project-ref>.functions.supabase.co/slack-events`
   (Slack does the `url_verification` handshake against the signing secret → should show **Verified**).
6. Under **Subscribe to bot events** add `app_mention` and `message.im`, then **Save** and reinstall if prompted.
7. Invite the bot to a channel (`/invite @yourbot`) and tag it: `@yourbot posts where AI engineers are hiring in India`.

### 5. Web app
```bash
cd web
cp .env.local.example .env.local           # fill NEXT_PUBLIC_SUPABASE_URL + ANON_KEY
npm install
npm run dev                                 # http://localhost:3000
```

## Notes / gotchas (proven against LinkdAPI)

- **Keyword = `hiring <role>`** (verb first), **no location** in the keyword — adding "india" skews
  results to recruitment-agency commentary instead of real job posts. Location is enforced by the
  summarizer instead (intent location ranks top; other countries rank bottom but still shown).
- **`sortBy=date_posted`** for hiring intents → freshest real job posts (hours old).
- **`authorJobTitle`** filter is strict (single title, can zero-out narrow searches) — left out of the UI.
- LinkdAPI free Basic plan = **5 searches/month per key**; use `LINKDAPI_KEYS` (comma list) for failover.
- Duplicate jobs (same role reposted by different recruiters) are merged by the summarizer;
  same company in different cities/branches are kept as separate jobs.
- **Slack-native**: `slack-events` must ack within **3s**, so it acks "Searching… 🔎" and runs the pipeline in
  `EdgeRuntime.waitUntil`. Every mention/DM burns one LinkdAPI search — mind the **5/month per key** limit.
  Inbound events are rejected unless the `X-Slack-Signature` HMAC (signing secret) checks out; the bot ignores
  its own messages (`bot_id`/`subtype`) and Slack retries (`X-Slack-Retry-Num`) so it never loops or double-posts.
