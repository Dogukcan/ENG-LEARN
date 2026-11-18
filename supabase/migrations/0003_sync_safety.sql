-- ENG-LEARN schema, migration 0003 (sync safety). Run in the Supabase SQL editor AFTER
-- 0001_init.sql and 0002_videos_speaking.sql. It is safe to run twice.
--
-- 1. client_updated_at: the local time of the edit a device pushes. The server never uses it as
--    the row's time (updated_at stays the server clock); it only compares it with updated_at to
--    refuse a stale edit. Without this, a device that was closed or offline pushed its OLD copy of
--    a row and the server stamped it as the newest change, so it won over a newer edit that
--    another device had already made ("last sender wins" instead of "last write wins").
-- 2. eng_set_updated_at(): the stale-edit check lives here, and search_path is fixed (Supabase
--    Security Advisor rule "function_search_path_mutable"). now() lives in pg_catalog, which is
--    always searched, so the behaviour is the same.
-- 3. eng_settings ids: the client used the id "app" for every account, but id is the primary key
--    of the whole table, so a second account could never save its settings. The id is now the
--    account's own user id. Existing rows are renamed here.

alter table public.eng_books            add column if not exists client_updated_at timestamptz;
alter table public.eng_inbox            add column if not exists client_updated_at timestamptz;
alter table public.eng_words            add column if not exists client_updated_at timestamptz;
alter table public.eng_cards            add column if not exists client_updated_at timestamptz;
alter table public.eng_review_logs      add column if not exists client_updated_at timestamptz;
alter table public.eng_activity         add column if not exists client_updated_at timestamptz;
alter table public.eng_settings         add column if not exists client_updated_at timestamptz;
alter table public.eng_videos           add column if not exists client_updated_at timestamptz;
alter table public.eng_speaking_sessions add column if not exists client_updated_at timestamptz;
alter table public.eng_speaking_errors  add column if not exists client_updated_at timestamptz;

create or replace function public.eng_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A write that carries an edit time older than the row's last server change is stale: another
  -- device changed the row after this edit was made. Returning OLD keeps the row exactly as it
  -- is (no change, no new updated_at); the sender gets the newer row on its next pull.
  if tg_op = 'UPDATE' and new.client_updated_at is not null and new.client_updated_at < old.updated_at then
    return old;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

-- One settings row per account, with the account's user id as its id.
update public.eng_settings set id = user_id::text where id <> user_id::text;
