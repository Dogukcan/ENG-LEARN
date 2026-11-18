-- ENG-LEARN schema, migration 0002: listening videos and speaking sessions.
-- Mirrors the video and speaking types in src/data/types.ts. Run this once in the Supabase SQL
-- editor, AFTER 0001_init.sql (it uses the eng_set_updated_at() function created there).
--
-- Same rules as 0001 for every table:
--  * id is a text primary key made by the client (a UUID), so it never changes.
--  * user_id defaults to auth.uid(), so the client never has to send it.
--  * updated_at is set by a trigger on every update; the client clock is never trusted for it.
--  * deleted_at is a soft delete, so other devices learn about deletions.
--  * Row Level Security is on, and only the owner of a row can touch it.

-- ---------- eng_videos ----------
create table public.eng_videos (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  youtube_id  text not null,
  title       text not null,
  channel     text not null,
  level       text not null check (level in ('kolay', 'orta', 'zor')),
  duration_minutes integer not null check (duration_minutes >= 1),
  status      text not null check (status in ('todo', 'watched')),
  watched_at  timestamptz,
  understanding text check (understanding in ('az', 'yarisi', 'cogu')),
  -- The activity row that markWatched wrote, so undoing "watched" removes exactly that row.
  activity_id text,
  created_at  timestamptz not null,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- Unique rules / indexes. Partial (deleted_at is null) so a soft-deleted row does not block a new one.
create unique index eng_videos_user_youtube_uq on public.eng_videos (user_id, youtube_id) where deleted_at is null;
create index eng_videos_user_status_idx on public.eng_videos (user_id, status);

-- Keep updated_at fresh on every update.
create trigger eng_videos_set_updated_at
  before update on public.eng_videos
  for each row execute function public.eng_set_updated_at();

-- RLS: on, with owner-only policies. There is deliberately no policy for the anon role,
-- so a request without a signed-in user sees and changes nothing.
alter table public.eng_videos enable row level security;

create policy "eng_videos_select_own" on public.eng_videos
  for select to authenticated using (auth.uid() = user_id);
create policy "eng_videos_insert_own" on public.eng_videos
  for insert to authenticated with check (auth.uid() = user_id);
create policy "eng_videos_update_own" on public.eng_videos
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "eng_videos_delete_own" on public.eng_videos
  for delete to authenticated using (auth.uid() = user_id);

-- ---------- eng_speaking_sessions ----------
create table public.eng_speaking_sessions (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  scenario_id text not null,
  started_at  timestamptz not null,
  -- The whole parsed report (errors, better phrases, new words, summary), kept as JSON.
  raw_report  jsonb not null,
  created_at  timestamptz not null,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- Unique rules / indexes. Partial (deleted_at is null) so a soft-deleted row does not block a new one.
-- No extra unique rules for sessions.
create index eng_speaking_sessions_user_started_idx on public.eng_speaking_sessions (user_id, started_at);

-- Keep updated_at fresh on every update.
create trigger eng_speaking_sessions_set_updated_at
  before update on public.eng_speaking_sessions
  for each row execute function public.eng_set_updated_at();

-- RLS: on, with owner-only policies. There is deliberately no policy for the anon role,
-- so a request without a signed-in user sees and changes nothing.
alter table public.eng_speaking_sessions enable row level security;

create policy "eng_speaking_sessions_select_own" on public.eng_speaking_sessions
  for select to authenticated using (auth.uid() = user_id);
create policy "eng_speaking_sessions_insert_own" on public.eng_speaking_sessions
  for insert to authenticated with check (auth.uid() = user_id);
create policy "eng_speaking_sessions_update_own" on public.eng_speaking_sessions
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "eng_speaking_sessions_delete_own" on public.eng_speaking_sessions
  for delete to authenticated using (auth.uid() = user_id);

-- ---------- eng_speaking_errors ----------
create table public.eng_speaking_errors (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id  text not null,
  -- Category id from the report (for example 'article'). Plain text, so adding a category in the
  -- app never needs a database change.
  category    text not null,
  original    text not null,
  corrected   text not null,
  note        text,
  created_at  timestamptz not null,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- Unique rules / indexes. Partial (deleted_at is null) so a soft-deleted row does not block a new one.
-- No extra unique rules for errors.
create index eng_speaking_errors_user_session_idx on public.eng_speaking_errors (user_id, session_id);

-- Keep updated_at fresh on every update.
create trigger eng_speaking_errors_set_updated_at
  before update on public.eng_speaking_errors
  for each row execute function public.eng_set_updated_at();

-- RLS: on, with owner-only policies. There is deliberately no policy for the anon role,
-- so a request without a signed-in user sees and changes nothing.
alter table public.eng_speaking_errors enable row level security;

create policy "eng_speaking_errors_select_own" on public.eng_speaking_errors
  for select to authenticated using (auth.uid() = user_id);
create policy "eng_speaking_errors_insert_own" on public.eng_speaking_errors
  for insert to authenticated with check (auth.uid() = user_id);
create policy "eng_speaking_errors_update_own" on public.eng_speaking_errors
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "eng_speaking_errors_delete_own" on public.eng_speaking_errors
  for delete to authenticated using (auth.uid() = user_id);

-- ---------- Realtime ----------
-- Lets other devices receive changes live. Realtime still respects RLS.
alter publication supabase_realtime add table public.eng_videos;
alter publication supabase_realtime add table public.eng_speaking_sessions;
alter publication supabase_realtime add table public.eng_speaking_errors;
