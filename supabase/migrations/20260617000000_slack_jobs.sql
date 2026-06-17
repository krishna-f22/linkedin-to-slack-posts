-- Slack-native trigger: jobs can originate from a Slack @-mention (no Supabase user).
-- Allow user_id to be null and record where to reply.

alter table research_jobs alter column user_id drop not null;

alter table research_jobs
  add column if not exists source text not null default 'web'
    check (source in ('web','slack')),
  add column if not exists slack_channel text,
  add column if not exists slack_user text,
  add column if not exists slack_thread_ts text;

-- Web RLS unchanged: users still only see rows where auth.uid() = user_id.
-- Slack rows have user_id = null → invisible to web users. The background pipeline
-- writes via the service role, which bypasses RLS.
