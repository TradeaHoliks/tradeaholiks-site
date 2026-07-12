-- Squawk watchlist: the "alert inbox" table.
-- Paste this whole file into Supabase -> SQL Editor -> New query -> Run.
-- The website may READ alerts (that's what the policy allows); only the
-- VPS poller, using the secret service key, can WRITE them.

create table if not exists public.alerts (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  source     text not null,            -- 'truth-social' | 'fed'
  who        text not null,            -- 'Donald Trump' | 'Federal Reserve'
  title      text not null,            -- the text the site speaks/shows
  url        text,                     -- link to the post/statement
  posted_at  timestamptz,              -- when the post/statement happened
  hash       text not null unique      -- dedup key: same item never inserted twice
);

alter table public.alerts enable row level security;

drop policy if exists "anyone can read alerts" on public.alerts;
create policy "anyone can read alerts"
  on public.alerts for select
  to anon, authenticated
  using (true);

-- speed up the site's "anything newer than id X?" poll
create index if not exists alerts_id_desc on public.alerts (id desc);
