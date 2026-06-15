create table if not exists research_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  intent text not null,
  status text not null default 'pending'
    check (status in ('pending','planning','searching','summarizing','posting','completed','failed')),
  search_plan jsonb,
  posts jsonb,
  summary_markdown text,
  slack_posted_at timestamptz,
  error text,
  linkdapi_calls_used int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table research_jobs enable row level security;

create policy "users select own jobs"
  on research_jobs for select
  using (auth.uid() = user_id);

create policy "users insert own jobs"
  on research_jobs for insert
  with check (auth.uid() = user_id);

-- background pipeline (service role) updates job rows; service role bypasses RLS by default

create index if not exists research_jobs_user_id_created_at_idx
  on research_jobs (user_id, created_at desc);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger research_jobs_set_updated_at
  before update on research_jobs
  for each row
  execute function set_updated_at();
