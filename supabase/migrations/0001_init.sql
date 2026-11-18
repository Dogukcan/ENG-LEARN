-- ENG-LEARN schema, migration 0001.
-- Mirrors src/data/types.ts. Run this once in the Supabase SQL editor.
--
-- Design rules shared by every table:
--  * id is a text primary key: the client makes a UUID while offline, so the id never changes.
--  * user_id defaults to auth.uid(), so the client never has to send it.
--  * updated_at is set by a trigger on every update; sync uses it to find newer rows.
--  * deleted_at is a soft delete: a deleted row stays so other devices learn about the deletion.
--  * Row Level Security (RLS) is on, and only the owner of a row can touch it.

-- One shared trigger function that stamps updated_at. The client clock is never trusted for this.
create or replace function public.eng_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- eng_books ----------
create table public.eng_books (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null,
  short_name  text not null,
  unit        integer not null default 1,
  page        integer not null default 1,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- Unique rules / indexes. Partial (deleted_at is null) so a soft-deleted row does not block a new one.
-- No extra unique rules for books.

-- Keep updated_at fresh on every update.
create trigger eng_books_set_updated_at
  before update on public.eng_books
  for each row execute function public.eng_set_updated_at();

-- RLS: on, with owner-only policies. There is deliberately no policy for the anon role,
-- so a request without a signed-in user sees and changes nothing.
alter table public.eng_books enable row level security;

create policy "eng_books_select_own" on public.eng_books
  for select to authenticated using (auth.uid() = user_id);
create policy "eng_books_insert_own" on public.eng_books
  for insert to authenticated with check (auth.uid() = user_id);
create policy "eng_books_update_own" on public.eng_books
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "eng_books_delete_own" on public.eng_books
  for delete to authenticated using (auth.uid() = user_id);

-- ---------- eng_inbox ----------
create table public.eng_inbox (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  word            text not null,
  -- Lower-cased, trimmed copy of `word` (same rule as normalizeWord in the app).
  normalized      text not null,
  sentence        text,
  meaning_tr      text,
  alternatives    text[],
  -- CaptureSource union stored as JSON, e.g. {"kind":"kitap","bookId":"...","page":12}.
  source          jsonb not null,
  created_at      timestamptz not null,
  previous_status text check (previous_status in ('known', 'ignored')),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- Unique rules / indexes. Partial (deleted_at is null) so a soft-deleted row does not block a new one.
create unique index eng_inbox_user_normalized_uq on public.eng_inbox (user_id, normalized) where deleted_at is null;

-- Keep updated_at fresh on every update.
create trigger eng_inbox_set_updated_at
  before update on public.eng_inbox
  for each row execute function public.eng_set_updated_at();

-- RLS: on, with owner-only policies. There is deliberately no policy for the anon role,
-- so a request without a signed-in user sees and changes nothing.
alter table public.eng_inbox enable row level security;

create policy "eng_inbox_select_own" on public.eng_inbox
  for select to authenticated using (auth.uid() = user_id);
create policy "eng_inbox_insert_own" on public.eng_inbox
  for insert to authenticated with check (auth.uid() = user_id);
create policy "eng_inbox_update_own" on public.eng_inbox
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "eng_inbox_delete_own" on public.eng_inbox
  for delete to authenticated using (auth.uid() = user_id);

-- ---------- eng_words ----------
create table public.eng_words (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  lemma       text not null,
  -- Lower-cased, trimmed copy of `lemma` for the duplicate check.
  normalized  text not null,
  status      text not null check (status in ('learning', 'known', 'ignored')),
  meaning_tr  text,
  sentence    text,
  alternatives text[],
  source      jsonb not null,
  created_at  timestamptz not null,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- Unique rules / indexes. Partial (deleted_at is null) so a soft-deleted row does not block a new one.
create unique index eng_words_user_normalized_uq on public.eng_words (user_id, normalized) where deleted_at is null;

-- Keep updated_at fresh on every update.
create trigger eng_words_set_updated_at
  before update on public.eng_words
  for each row execute function public.eng_set_updated_at();

-- RLS: on, with owner-only policies. There is deliberately no policy for the anon role,
-- so a request without a signed-in user sees and changes nothing.
alter table public.eng_words enable row level security;

create policy "eng_words_select_own" on public.eng_words
  for select to authenticated using (auth.uid() = user_id);
create policy "eng_words_insert_own" on public.eng_words
  for insert to authenticated with check (auth.uid() = user_id);
create policy "eng_words_update_own" on public.eng_words
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "eng_words_delete_own" on public.eng_words
  for delete to authenticated using (auth.uid() = user_id);

-- ---------- eng_cards ----------
create table public.eng_cards (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  word_id         text not null,
  stability       double precision not null,
  stability_fast  double precision not null,
  difficulty      double precision not null,
  state           smallint not null check (state between 0 and 3),
  schedule_status text not null check (schedule_status in ('new', 'learning', 'review')),
  due_at          timestamptz not null,
  last_review_at  timestamptz,
  reps            integer not null default 0,
  scheduled_days  double precision not null default 0,
  learning_step   integer not null default 0,
  lapses          integer not null default 0,
  leech           boolean not null default false,
  created_at      timestamptz not null,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- Unique rules / indexes. Partial (deleted_at is null) so a soft-deleted row does not block a new one.
create unique index eng_cards_user_word_uq on public.eng_cards (user_id, word_id) where deleted_at is null;
create index eng_cards_user_due_idx on public.eng_cards (user_id, due_at);

-- Keep updated_at fresh on every update.
create trigger eng_cards_set_updated_at
  before update on public.eng_cards
  for each row execute function public.eng_set_updated_at();

-- RLS: on, with owner-only policies. There is deliberately no policy for the anon role,
-- so a request without a signed-in user sees and changes nothing.
alter table public.eng_cards enable row level security;

create policy "eng_cards_select_own" on public.eng_cards
  for select to authenticated using (auth.uid() = user_id);
create policy "eng_cards_insert_own" on public.eng_cards
  for insert to authenticated with check (auth.uid() = user_id);
create policy "eng_cards_update_own" on public.eng_cards
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "eng_cards_delete_own" on public.eng_cards
  for delete to authenticated using (auth.uid() = user_id);

-- ---------- eng_review_logs ----------
create table public.eng_review_logs (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  card_id       text not null,
  grade         text not null check (grade in ('again', 'good')),
  reviewed_at   timestamptz not null,
  -- The ts-fsrs log entry and the card before the answer (needed for undo), kept as JSON
  -- because they are only ever read back whole, never filtered by field.
  revlog        jsonb not null,
  previous_card jsonb not null,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- Unique rules / indexes. Partial (deleted_at is null) so a soft-deleted row does not block a new one.
create index eng_review_logs_user_reviewed_idx on public.eng_review_logs (user_id, reviewed_at);

-- Keep updated_at fresh on every update.
create trigger eng_review_logs_set_updated_at
  before update on public.eng_review_logs
  for each row execute function public.eng_set_updated_at();

-- RLS: on, with owner-only policies. There is deliberately no policy for the anon role,
-- so a request without a signed-in user sees and changes nothing.
alter table public.eng_review_logs enable row level security;

create policy "eng_review_logs_select_own" on public.eng_review_logs
  for select to authenticated using (auth.uid() = user_id);
create policy "eng_review_logs_insert_own" on public.eng_review_logs
  for insert to authenticated with check (auth.uid() = user_id);
create policy "eng_review_logs_update_own" on public.eng_review_logs
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "eng_review_logs_delete_own" on public.eng_review_logs
  for delete to authenticated using (auth.uid() = user_id);

-- ---------- eng_activity ----------
create table public.eng_activity (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  block       text not null check (block in ('okuma', 'kelime', 'dinleme', 'konusma')),
  started_at  timestamptz not null,
  seconds     integer not null check (seconds >= 0),
  source      text not null check (source in ('timer', 'manual')),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- Unique rules / indexes. Partial (deleted_at is null) so a soft-deleted row does not block a new one.
create index eng_activity_user_started_idx on public.eng_activity (user_id, started_at);

-- Keep updated_at fresh on every update.
create trigger eng_activity_set_updated_at
  before update on public.eng_activity
  for each row execute function public.eng_set_updated_at();

-- RLS: on, with owner-only policies. There is deliberately no policy for the anon role,
-- so a request without a signed-in user sees and changes nothing.
alter table public.eng_activity enable row level security;

create policy "eng_activity_select_own" on public.eng_activity
  for select to authenticated using (auth.uid() = user_id);
create policy "eng_activity_insert_own" on public.eng_activity
  for insert to authenticated with check (auth.uid() = user_id);
create policy "eng_activity_update_own" on public.eng_activity
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "eng_activity_delete_own" on public.eng_activity
  for delete to authenticated using (auth.uid() = user_id);

-- ---------- eng_settings ----------
create table public.eng_settings (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  daily_minimum_minutes integer not null default 20,
  daily_target_minutes  integer not null default 95,
  -- Record<SkillBlock, number> as JSON.
  block_plan_minutes    jsonb not null default '{"okuma":35,"kelime":15,"dinleme":25,"konusma":20}',
  new_card_limit        integer not null default 10,
  active_book_id        text,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- Unique rules / indexes. Partial (deleted_at is null) so a soft-deleted row does not block a new one.
-- One settings row per user (the client makes a UUID for the id; the unique index keeps it to one row).
create unique index eng_settings_user_uq on public.eng_settings (user_id);

-- Keep updated_at fresh on every update.
create trigger eng_settings_set_updated_at
  before update on public.eng_settings
  for each row execute function public.eng_set_updated_at();

-- RLS: on, with owner-only policies. There is deliberately no policy for the anon role,
-- so a request without a signed-in user sees and changes nothing.
alter table public.eng_settings enable row level security;

create policy "eng_settings_select_own" on public.eng_settings
  for select to authenticated using (auth.uid() = user_id);
create policy "eng_settings_insert_own" on public.eng_settings
  for insert to authenticated with check (auth.uid() = user_id);
create policy "eng_settings_update_own" on public.eng_settings
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "eng_settings_delete_own" on public.eng_settings
  for delete to authenticated using (auth.uid() = user_id);

-- ---------- Realtime ----------
-- Lets other devices receive changes live. Realtime still respects RLS.
alter publication supabase_realtime add table public.eng_books;
alter publication supabase_realtime add table public.eng_inbox;
alter publication supabase_realtime add table public.eng_words;
alter publication supabase_realtime add table public.eng_cards;
alter publication supabase_realtime add table public.eng_review_logs;
alter publication supabase_realtime add table public.eng_activity;
alter publication supabase_realtime add table public.eng_settings;
