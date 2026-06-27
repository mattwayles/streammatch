-- StreamMatch "watched" memory.
-- Run this once in your existing Supabase project (SQL Editor).
-- It only creates a new, dedicated table — nothing else in your DB is touched.

create table if not exists public.streammatch_watched (
  id          uuid primary key default gen_random_uuid(),
  tmdb_id     integer not null,
  media_type  text not null check (media_type in ('movie', 'tv')),
  title       text,
  created_at  timestamptz not null default now(),
  unique (tmdb_id, media_type)
);

-- Row-Level Security: lock the table down, then grant the anon role exactly
-- what StreamMatch needs (read + insert) on THIS table only. The app uses the
-- anon key server-side and keeps a single shared watched list.
alter table public.streammatch_watched enable row level security;

drop policy if exists "streammatch_watched anon select" on public.streammatch_watched;
create policy "streammatch_watched anon select"
  on public.streammatch_watched
  for select to anon
  using (true);

drop policy if exists "streammatch_watched anon insert" on public.streammatch_watched;
create policy "streammatch_watched anon insert"
  on public.streammatch_watched
  for insert to anon
  with check (true);

-- Delete lets the "watched library" page re-enable a title for recommendations.
drop policy if exists "streammatch_watched anon delete" on public.streammatch_watched;
create policy "streammatch_watched anon delete"
  on public.streammatch_watched
  for delete to anon
  using (true);

-- Disliked titles: hidden from future suggestions AND used as a negative-taste
-- signal so the curator steers away from similar picks.
create table if not exists public.streammatch_disliked (
  id          uuid primary key default gen_random_uuid(),
  tmdb_id     integer not null,
  media_type  text not null check (media_type in ('movie', 'tv')),
  title       text,
  created_at  timestamptz not null default now(),
  unique (tmdb_id, media_type)
);

alter table public.streammatch_disliked enable row level security;

drop policy if exists "streammatch_disliked anon select" on public.streammatch_disliked;
create policy "streammatch_disliked anon select"
  on public.streammatch_disliked
  for select to anon
  using (true);

drop policy if exists "streammatch_disliked anon insert" on public.streammatch_disliked;
create policy "streammatch_disliked anon insert"
  on public.streammatch_disliked
  for insert to anon
  with check (true);

drop policy if exists "streammatch_disliked anon delete" on public.streammatch_disliked;
create policy "streammatch_disliked anon delete"
  on public.streammatch_disliked
  for delete to anon
  using (true);

-- Watchlist: titles the user wants to watch later.
-- These become the candidate pool when the user picks "Something from my watch list."
create table if not exists public.streammatch_watchlist (
  id          uuid primary key default gen_random_uuid(),
  tmdb_id     integer not null,
  media_type  text not null check (media_type in ('movie', 'tv')),
  title       text,
  created_at  timestamptz not null default now(),
  unique (tmdb_id, media_type)
);

alter table public.streammatch_watchlist enable row level security;

drop policy if exists "streammatch_watchlist anon select" on public.streammatch_watchlist;
create policy "streammatch_watchlist anon select"
  on public.streammatch_watchlist
  for select to anon
  using (true);

drop policy if exists "streammatch_watchlist anon insert" on public.streammatch_watchlist;
create policy "streammatch_watchlist anon insert"
  on public.streammatch_watchlist
  for insert to anon
  with check (true);

drop policy if exists "streammatch_watchlist anon delete" on public.streammatch_watchlist;
create policy "streammatch_watchlist anon delete"
  on public.streammatch_watchlist
  for delete to anon
  using (true);

-- Liked titles: watched and enjoyed — used as a strong positive-taste signal
-- so the curator prioritizes similar genres, tones, and themes.
create table if not exists public.streammatch_liked (
  id          uuid primary key default gen_random_uuid(),
  tmdb_id     integer not null,
  media_type  text not null check (media_type in ('movie', 'tv')),
  title       text,
  created_at  timestamptz not null default now(),
  unique (tmdb_id, media_type)
);

alter table public.streammatch_liked enable row level security;

drop policy if exists "streammatch_liked anon select" on public.streammatch_liked;
create policy "streammatch_liked anon select"
  on public.streammatch_liked
  for select to anon
  using (true);

drop policy if exists "streammatch_liked anon insert" on public.streammatch_liked;
create policy "streammatch_liked anon insert"
  on public.streammatch_liked
  for insert to anon
  with check (true);

drop policy if exists "streammatch_liked anon delete" on public.streammatch_liked;
create policy "streammatch_liked anon delete"
  on public.streammatch_liked
  for delete to anon
  using (true);
