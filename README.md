# AI-Powered LinkedIn Research Assistant

Natural-language intent → GPT-5 turns it into a LinkedIn search keyword → LinkdAPI fetches posts →
GPT-5 summarizes, ranks by relevance, enforces location, drops duplicates → results posted to Slack.

Stack: Next.js (web) · Supabase (Auth + Postgres + Edge Functions/Deno) · OpenAI GPT-5 ·
LinkdAPI (RapidAPI) · Slack Incoming Webhook.

## Flow

```
Web UI (Supabase Auth) → invoke edge fn "research"
  → returns {job_id} immediately, then runs in background:
     1. plan   : GPT-5 → search keyword + filters  (hiring intents → "hiring <role>", sort=date_posted)
     2. search : LinkdAPI /search/posts (1 call ≈ 10 posts, dedup by URL)
     3. summarize: GPT-5 → per-post summary + relevance(0-100); enforces intent location, merges duplicate jobs
     4. gate   : keep posts with relevance >= MIN_RELEVANCE (default 50), sorted high→low
     5. slack  : post one card per job (summary + link + image/video if present)
Web UI polls research_jobs row (Supabase Realtime) for live status + result.
```

## Project layout

```
/web                              Next.js app (App Router, TS)
/supabase
  migrations/                     research_jobs table + RLS
  functions/research/             edge function (index.ts + lib/*)
    .env.example                  required secrets/config (template)
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

### 3. Deploy the function
```bash
npx supabase functions deploy research --project-ref <your-project-ref>
```

### 4. Web app
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
