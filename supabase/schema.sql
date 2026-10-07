-- Teaching IDE — Supabase schema.
--
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- Everything here is additive; re-running it is safe.
--
-- Two tables. `progress` is what the learner sees restored when they sign back
-- in. `sessions` is the evidence: the observer's full event log, written
-- without anyone having to remember to click Export.
--
-- Row-level security is on for both, and every policy is scoped to
-- auth.uid() — a signed-in learner can only ever read or write their own rows.

-- ---------------------------------------------------------------- progress

create table if not exists public.progress (
  user_id     uuid        not null references auth.users (id) on delete cascade,
  -- Keyed by the exercise's string id, never its position. Inserting an
  -- exercise in the middle of the ramp must not silently repoint saved rows.
  exercise_id text        not null,
  solved      boolean     not null default false,
  tier        int         not null default 1 check (tier between 1 and 5),
  attempts    int         not null default 0,
  hints_given int         not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (user_id, exercise_id)
);

alter table public.progress enable row level security;

drop policy if exists "progress is private" on public.progress;
create policy "progress is private"
  on public.progress
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- What the teacher remembers about a learner, per exercise. Added after the
-- first version of this table, so each is `add column if not exists` — running
-- this file again on an existing project upgrades it in place.
alter table public.progress add column if not exists begs   int         not null default 0;
alter table public.progress add column if not exists seen   text[]      not null default '{}';
alter table public.progress add column if not exists thread jsonb       not null default '[]'::jsonb;

-- ---------------------------------------------------------------- sessions

create table if not exists public.sessions (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  started_at  timestamptz not null,
  duration_ms bigint      not null default 0,
  -- Which exercise they were on when the session was last flushed.
  exercise_id text,
  -- The observer's weights and thresholds at the time. A log read back without
  -- the config that produced it cannot be interpreted.
  config      jsonb,
  events      jsonb       not null default '[]'::jsonb,
  event_count int         not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists sessions_user_started_idx
  on public.sessions (user_id, started_at desc);

alter table public.sessions enable row level security;

drop policy if exists "sessions are private" on public.sessions;
create policy "sessions are private"
  on public.sessions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- --------------------------------------------------------------- updated_at

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists progress_touch on public.progress;
create trigger progress_touch
  before update on public.progress
  for each row execute function public.touch_updated_at();

drop trigger if exists sessions_touch on public.sessions;
create trigger sessions_touch
  before update on public.sessions
  for each row execute function public.touch_updated_at();
