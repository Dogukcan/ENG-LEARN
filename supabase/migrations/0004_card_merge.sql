-- ENG-LEARN schema, migration 0004 (card merge). Run in the Supabase SQL editor AFTER
-- 0001, 0002 and 0003. It is safe to run twice. Check Security Advisor afterwards.
--
-- A server transaction chooses the higher-reps FSRS branch while keeping the server id.
-- Durable redirects repair both existing and late logs, including retries after lost replies.
-- Internal updates clear client_updated_at so 0003 does not silently discard the merge.
-- A final reps guard protects same-id state while still permitting one-step undo.

create table if not exists public.eng_card_redirects (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  from_id text not null,
  to_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  client_updated_at timestamptz,
  primary key (user_id, from_id)
);
alter table public.eng_card_redirects enable row level security;
drop policy if exists eng_card_redirects_select_own on public.eng_card_redirects;
create policy eng_card_redirects_select_own on public.eng_card_redirects
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists eng_card_redirects_insert_own on public.eng_card_redirects;
create policy eng_card_redirects_insert_own on public.eng_card_redirects
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists eng_card_redirects_update_own on public.eng_card_redirects;
create policy eng_card_redirects_update_own on public.eng_card_redirects
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists eng_card_redirects_delete_own on public.eng_card_redirects;
create policy eng_card_redirects_delete_own on public.eng_card_redirects
  for delete to authenticated using (auth.uid() = user_id);
drop trigger if exists eng_card_redirects_set_updated_at on public.eng_card_redirects;
create trigger eng_card_redirects_set_updated_at before update on public.eng_card_redirects
  for each row execute function public.eng_set_updated_at();
-- Server only: deliberately absent from the realtime publication and client mapping.
create index if not exists eng_review_logs_user_card_idx on public.eng_review_logs (user_id, card_id);

create or replace function public.eng_merge_card(p_card jsonb)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_uid uuid;
  v_from text;
  v_word text;
  v_target text;
  v_card public.eng_cards%rowtype;
  v_selected boolean := false;
  v_flag text := current_setting('eng.bundle', true);
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  v_from := p_card->>'id';
  v_word := p_card->>'word_id';
  if v_from is null or v_word is null then raise exception 'Card id and word_id required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || v_word, 0));

  select r.to_id into v_target from public.eng_card_redirects r
    where r.user_id = v_uid and r.from_id = v_from;
  if found then
    select c.* into strict v_card from public.eng_cards c
      where c.user_id = v_uid and c.id = v_target for update;
    if v_card.deleted_at is not null then
      return jsonb_build_object('canonical_id', v_card.id, 'selected', false, 'card', to_jsonb(v_card));
    end if;
  else
    select c.* into v_card from public.eng_cards c
      where c.user_id = v_uid and c.word_id = v_word and c.deleted_at is null for update;
    if not found then
      begin
        insert into public.eng_cards (
          id, user_id, word_id, stability, stability_fast, difficulty, state, schedule_status,
          due_at, last_review_at, reps, scheduled_days, learning_step, lapses, leech,
          created_at, deleted_at, client_updated_at
        ) values (
          v_from, v_uid, v_word, (p_card->>'stability')::double precision,
          (p_card->>'stability_fast')::double precision, (p_card->>'difficulty')::double precision,
          (p_card->>'state')::smallint, p_card->>'schedule_status', (p_card->>'due_at')::timestamptz,
          (p_card->>'last_review_at')::timestamptz, (p_card->>'reps')::integer,
          (p_card->>'scheduled_days')::double precision, (p_card->>'learning_step')::integer,
          (p_card->>'lapses')::integer, (p_card->>'leech')::boolean,
          (p_card->>'created_at')::timestamptz, (p_card->>'deleted_at')::timestamptz,
          (p_card->>'client_updated_at')::timestamptz
        ) returning * into v_card;
        return jsonb_build_object('canonical_id', v_from, 'selected', true, 'card', to_jsonb(v_card));
      exception when unique_violation then
        select c.* into v_card from public.eng_cards c
          where c.user_id = v_uid and c.word_id = v_word and c.deleted_at is null for update;
        if not found then
          raise exception using errcode = 'P0001', message = 'eng_merge_card: card id exists as a tombstone';
        end if;
      end;
    end if;
  end if;

  if v_card.id = v_from then
    return jsonb_build_object('canonical_id', v_card.id, 'selected', false, 'card', to_jsonb(v_card));
  end if;
  update public.eng_cards set deleted_at = now(), client_updated_at = null
    where user_id = v_uid and id = v_from and deleted_at is null;
  if (p_card->>'reps')::integer > v_card.reps then
    update public.eng_cards set
      stability = (p_card->>'stability')::double precision,
      stability_fast = (p_card->>'stability_fast')::double precision,
      difficulty = (p_card->>'difficulty')::double precision,
      state = (p_card->>'state')::smallint,
      schedule_status = p_card->>'schedule_status',
      due_at = (p_card->>'due_at')::timestamptz,
      last_review_at = (p_card->>'last_review_at')::timestamptz,
      reps = (p_card->>'reps')::integer,
      scheduled_days = (p_card->>'scheduled_days')::double precision,
      learning_step = (p_card->>'learning_step')::integer,
      lapses = (p_card->>'lapses')::integer,
      leech = (p_card->>'leech')::boolean,
      client_updated_at = null
      where user_id = v_uid and id = v_card.id returning * into v_card;
    v_selected := true;
  end if;
  insert into public.eng_card_redirects (user_id, from_id, to_id)
    values (v_uid, v_from, v_card.id)
    on conflict (user_id, from_id) do update set to_id = excluded.to_id, client_updated_at = null;
  update public.eng_card_redirects set to_id = v_card.id, client_updated_at = null
    where user_id = v_uid and to_id = v_from;
  perform set_config('eng.bundle', 'on', true);
  update public.eng_review_logs set card_id = v_card.id, client_updated_at = null
    where user_id = v_uid and card_id = v_from;
  perform set_config('eng.bundle', coalesce(v_flag, ''), true);
  return jsonb_build_object('canonical_id', v_card.id, 'selected', v_selected, 'card', to_jsonb(v_card));
end;
$$;

create or replace function public.eng_redirect_review_log()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare v_target text;
begin
  select r.to_id into v_target from public.eng_card_redirects r
    where r.user_id = new.user_id and r.from_id = new.card_id;
  if found then new.card_id := v_target; end if;
  return new;
end;
$$;
-- Run after set_updated_at, including when that trigger returns OLD on a stale log write.
drop trigger if exists eng_review_logs_zz_redirect on public.eng_review_logs;
create trigger eng_review_logs_zz_redirect before insert or update on public.eng_review_logs
  for each row execute function public.eng_redirect_review_log();

create or replace function public.eng_guard_card_reps()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  -- Deletion is structural and must survive even when its FSRS snapshot is stale.
  if old.deleted_at is null and new.deleted_at is not null then return new; end if;
  if current_setting('eng.bundle', true) = 'on' then return new; end if;
  if new.reps < old.reps then
    new.stability := old.stability;
    new.stability_fast := old.stability_fast;
    new.difficulty := old.difficulty;
    new.state := old.state;
    new.schedule_status := old.schedule_status;
    new.due_at := old.due_at;
    new.last_review_at := old.last_review_at;
    new.reps := old.reps;
    new.scheduled_days := old.scheduled_days;
    new.learning_step := old.learning_step;
    new.lapses := old.lapses;
    new.leech := old.leech;
    new.updated_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists eng_cards_zz_reps_guard on public.eng_cards;
create trigger eng_cards_zz_reps_guard before update on public.eng_cards
  for each row execute function public.eng_guard_card_reps();

-- Cards push first. A rejected undo must not remove a review still counted by the card.
create or replace function public.eng_guard_review_log_undo()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if current_setting('eng.bundle', true) = 'on' then return new; end if;
  if new.deleted_at is not null and exists (
    select 1 from public.eng_cards c
    where c.user_id = new.user_id and c.id = new.card_id and c.deleted_at is null
  ) then
    new.deleted_at := null;
    new.updated_at := now();
  end if;
  return new;
end;
$$;
-- Alphabetical order: set_updated_at, zz_redirect, zzz_undo_guard.
drop trigger if exists eng_review_logs_zzz_undo_guard on public.eng_review_logs;
create trigger eng_review_logs_zzz_undo_guard before insert or update on public.eng_review_logs
  for each row execute function public.eng_guard_review_log_undo();

create or replace function public.eng_reject_redirected_card()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if exists (select 1 from public.eng_card_redirects r where r.user_id = new.user_id and r.from_id = new.id) then
    raise exception 'Card id has a canonical redirect' using errcode = '23505';
  end if;
  return new;
end;
$$;
drop trigger if exists eng_cards_reject_redirected_insert on public.eng_cards;
create trigger eng_cards_reject_redirected_insert before insert on public.eng_cards
  for each row execute function public.eng_reject_redirected_card();

revoke execute on function public.eng_merge_card(jsonb) from public, anon;
grant execute on function public.eng_merge_card(jsonb) to authenticated;
revoke execute on function public.eng_redirect_review_log() from public, anon;
grant execute on function public.eng_redirect_review_log() to authenticated;
revoke execute on function public.eng_guard_card_reps() from public, anon;
grant execute on function public.eng_guard_card_reps() to authenticated;
revoke execute on function public.eng_reject_redirected_card() from public, anon;
grant execute on function public.eng_reject_redirected_card() to authenticated;
revoke execute on function public.eng_guard_review_log_undo() from public, anon;
grant execute on function public.eng_guard_review_log_undo() to authenticated;

-- A card and its logs are classified against one locked server snapshot.
create or replace function public.eng_push_card_bundle(p_card jsonb, p_logs jsonb)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id text;
  v_old public.eng_cards%rowtype;
  v_new public.eng_cards%rowtype;
  v_log public.eng_review_logs%rowtype;
  v_source public.eng_review_logs%rowtype;
  v_item jsonb;
  v_snapshot jsonb;
  v_history jsonb;
  v_tombstones text[];
  v_bundled text[];
  v_ancestors jsonb := '[]'::jsonb;
  v_ancestor jsonb;
  v_reached boolean := false;
  v_counted text[] := array[]::text[];
  v_reps integer;
  v_last timestamptz;
  v_step integer;
  v_logs jsonb;
  v_flag text := current_setting('eng.bundle', true);
begin
  if v_uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  perform set_config('eng.bundle', 'on', true);
  if jsonb_typeof(p_logs) is distinct from 'array' then raise exception 'Logs array required'; end if;
  v_id := coalesce(p_card->>'id', p_logs->0->>'card_id');
  if v_id is null then raise exception 'Card id required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || v_id, 0));
  -- Share the merge word lock too: inserts of different ids for one word cannot race merge.
  if p_card is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || (p_card->>'word_id'), 0));
  end if;
  if exists (select 1 from public.eng_card_redirects r where r.user_id = v_uid and r.from_id = v_id)
    or (p_card is not null and exists (select 1 from public.eng_cards c where c.user_id = v_uid
      and c.word_id = p_card->>'word_id' and c.id <> v_id and c.deleted_at is null)) then
    perform set_config('eng.bundle', coalesce(v_flag, ''), true);
    return jsonb_build_object('status', 'merge');
  end if;
  select c.* into v_old from public.eng_cards c where c.user_id = v_uid and c.id = v_id for update;
  for v_item in select value from jsonb_array_elements(p_logs) loop
    if v_item->>'card_id' is distinct from v_id then raise exception 'Mixed card bundle'; end if;
    if v_item->>'deleted_at' is null then
      -- An accepted undo is final, even when a live bundle response was lost.
      select l.* into v_source from public.eng_review_logs l
        where l.user_id = v_uid and l.id = v_item->>'id' for update;
      if found and v_source.deleted_at is not null then
        continue;
      end if;
      v_log := jsonb_populate_record(null::public.eng_review_logs, v_item);
      v_log.user_id := v_uid; v_log.updated_at := now(); v_log.client_updated_at := null;
      insert into public.eng_review_logs (id, user_id, card_id, grade, reviewed_at, revlog, previous_card, updated_at, deleted_at, client_updated_at)
      values (v_log.id, v_log.user_id, v_log.card_id, v_log.grade, v_log.reviewed_at, v_log.revlog, v_log.previous_card, v_log.updated_at, v_log.deleted_at, v_log.client_updated_at)
      on conflict (id) do update set card_id = excluded.card_id, grade = excluded.grade, reviewed_at = excluded.reviewed_at, revlog = excluded.revlog, previous_card = excluded.previous_card, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, client_updated_at = excluded.client_updated_at;
    end if;
  end loop;
  -- One history pool for both walks. Prefer server snapshots, including for bundle tombstones.
  select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) into v_history
    from public.eng_review_logs l where l.user_id = v_uid and l.card_id = v_id;
  for v_item in select value from jsonb_array_elements(p_logs) loop
    if not exists (select 1 from jsonb_array_elements(v_history) h where h->>'id' = v_item->>'id') then
      v_history := v_history || jsonb_build_array(v_item);
    end if;
  end loop;
  select coalesce(array_agg(value->>'id'), array[]::text[]) into v_tombstones
    from jsonb_array_elements(p_logs) where value->>'deleted_at' is not null;
  select coalesce(array_agg(value->>'id'), array[]::text[]) into v_bundled from jsonb_array_elements(p_logs);
  if p_card is not null then
    v_new := jsonb_populate_record(null::public.eng_cards, p_card);
    v_new.user_id := v_uid; v_new.updated_at := now(); v_new.client_updated_at := null;
    -- U contains OLD and only the parents undone by tombstones in this bundle.
    v_reps := coalesce(v_old.reps, 0); v_last := v_old.last_review_at;
    for v_step in 0..jsonb_array_length(v_history) loop
      v_ancestors := v_ancestors || jsonb_build_array(jsonb_build_object(
        'reps', v_reps, 'last', v_last, 'snapshot', v_snapshot));
      exit when v_reps <= 0;
      select h into v_item from jsonb_array_elements(v_history) h
        where (h->>'reviewed_at')::timestamptz = v_last
          and (h->'previous_card'->>'reps')::integer + 1 = v_reps
        limit 1;
      exit when not found;
      exit when not (v_item->>'id' = any(v_tombstones));
      v_snapshot := v_item->'previous_card';
      v_reps := (v_snapshot->>'reps')::integer;
      v_last := (v_snapshot->>'lastReviewAt')::timestamptz;
    end loop;
    -- Walk NEW backwards through live producing logs until it intersects U.
    v_reps := v_new.reps; v_last := v_new.last_review_at; v_snapshot := null;
    for v_step in 0..jsonb_array_length(v_history) loop
      select h into v_ancestor from jsonb_array_elements(v_ancestors) h
        where (h->>'reps')::integer = v_reps
          and (h->>'last')::timestamptz is not distinct from v_last
        limit 1;
      if found then
        v_reached := true;
        if v_reps = v_new.reps and v_last is not distinct from v_new.last_review_at then
          v_snapshot := nullif(v_ancestor->'snapshot', 'null'::jsonb);
        end if;
        exit;
      end if;
      exit when v_reps <= 0;
      select h into v_item from jsonb_array_elements(v_history) h
        where (h->>'reviewed_at')::timestamptz = v_last
          and (h->'previous_card'->>'reps')::integer + 1 = v_reps
        limit 1;
      exit when not found;
      exit when v_item->>'deleted_at' is not null or v_item->>'id' = any(v_tombstones);
      v_reps := (v_item->'previous_card'->>'reps')::integer;
      v_last := (v_item->'previous_card'->>'lastReviewAt')::timestamptz;
    end loop;
    if v_old.deleted_at is null and v_old.id is not null and v_new.deleted_at is not null then
      null; -- Structural soft deletion always passes.
    elsif v_reached then
      if v_snapshot is not null then
        v_new.stability := (v_snapshot->>'stability')::double precision;
        v_new.stability_fast := (v_snapshot->>'stabilityFast')::double precision;
        v_new.difficulty := (v_snapshot->>'difficulty')::double precision;
        v_new.state := (v_snapshot->>'state')::smallint;
        v_new.schedule_status := v_snapshot->>'scheduleStatus';
        v_new.due_at := (v_snapshot->>'dueAt')::timestamptz;
        v_new.last_review_at := (v_snapshot->>'lastReviewAt')::timestamptz;
        v_new.reps := (v_snapshot->>'reps')::integer;
        v_new.scheduled_days := (v_snapshot->>'scheduledDays')::double precision;
        v_new.learning_step := (v_snapshot->>'learningStep')::integer;
        v_new.lapses := (v_snapshot->>'lapses')::integer;
        v_new.leech := (v_snapshot->>'leech')::boolean;
      end if;
    elsif v_old.id is not null then
      v_new.stability := v_old.stability;
      v_new.stability_fast := v_old.stability_fast;
      v_new.difficulty := v_old.difficulty;
      v_new.state := v_old.state;
      v_new.schedule_status := v_old.schedule_status;
      v_new.due_at := v_old.due_at;
      v_new.last_review_at := v_old.last_review_at;
      v_new.reps := v_old.reps;
      v_new.scheduled_days := v_old.scheduled_days;
      v_new.learning_step := v_old.learning_step;
      v_new.lapses := v_old.lapses;
      v_new.leech := v_old.leech;
    end if;
    insert into public.eng_cards (id, user_id, word_id, stability, stability_fast, difficulty, state, schedule_status, due_at, last_review_at, reps, scheduled_days, learning_step, lapses, leech, created_at, updated_at, deleted_at, client_updated_at)
      values (v_new.id, v_new.user_id, v_new.word_id, v_new.stability, v_new.stability_fast, v_new.difficulty, v_new.state, v_new.schedule_status, v_new.due_at, v_new.last_review_at, v_new.reps, v_new.scheduled_days, v_new.learning_step, v_new.lapses, v_new.leech, v_new.created_at, v_new.updated_at, v_new.deleted_at, v_new.client_updated_at)
      on conflict (id) do update set word_id = excluded.word_id, stability = excluded.stability, stability_fast = excluded.stability_fast, difficulty = excluded.difficulty, state = excluded.state, schedule_status = excluded.schedule_status, due_at = excluded.due_at, last_review_at = excluded.last_review_at, reps = excluded.reps, scheduled_days = excluded.scheduled_days, learning_step = excluded.learning_step, lapses = excluded.lapses, leech = excluded.leech, created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, client_updated_at = excluded.client_updated_at;
  end if;
  select c.* into v_new from public.eng_cards c where c.user_id = v_uid and c.id = v_id;
  -- Count the settled card's ancestry, including missing bundle logs not written yet.
  v_reps := v_new.reps; v_last := v_new.last_review_at;
  for v_step in 0..jsonb_array_length(v_history) loop
    exit when v_reps is null or v_reps <= 0;
    select h into v_item from jsonb_array_elements(v_history) h
      where (h->>'reviewed_at')::timestamptz = v_last
        and (h->'previous_card'->>'reps')::integer + 1 = v_reps
      limit 1;
    exit when not found;
    exit when (v_item->>'deleted_at' is not null and not (v_item->>'id' = any(v_bundled)))
      or v_item->>'id' = any(v_counted);
    v_counted := array_append(v_counted, v_item->>'id');
    v_reps := (v_item->'previous_card'->>'reps')::integer;
    v_last := (v_item->'previous_card'->>'lastReviewAt')::timestamptz;
  end loop;
  for v_item in select value from jsonb_array_elements(p_logs) where value->>'deleted_at' is not null loop
    select l.* into v_log from public.eng_review_logs l where l.user_id = v_uid and l.id = v_item->>'id';
    if not found then v_log := jsonb_populate_record(null::public.eng_review_logs, v_item);
      -- A bundle tombstone is only a request until checked against the counted chain.
      v_log.deleted_at := null;
    end if;
    v_log.deleted_at := coalesce(v_log.deleted_at, case when v_new.id is null or v_new.deleted_at is not null
      or not (v_log.id = any(v_counted)) then (v_item->>'deleted_at')::timestamptz else null end);
    v_log.user_id := v_uid; v_log.updated_at := now(); v_log.client_updated_at := null;
    insert into public.eng_review_logs (id, user_id, card_id, grade, reviewed_at, revlog, previous_card, updated_at, deleted_at, client_updated_at)
      values (v_log.id, v_log.user_id, v_log.card_id, v_log.grade, v_log.reviewed_at, v_log.revlog, v_log.previous_card, v_log.updated_at, v_log.deleted_at, v_log.client_updated_at)
      on conflict (id) do update set card_id = excluded.card_id, grade = excluded.grade, reviewed_at = excluded.reviewed_at, revlog = excluded.revlog, previous_card = excluded.previous_card, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, client_updated_at = excluded.client_updated_at;
  end loop;
  select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) into v_logs from public.eng_review_logs l
    where l.user_id = v_uid and l.id in (select value->>'id' from jsonb_array_elements(p_logs));
  perform set_config('eng.bundle', coalesce(v_flag, ''), true);
  return jsonb_build_object('status', 'ok', 'card', case when v_new.id is null then null else to_jsonb(v_new) end, 'logs', v_logs);
end;
$$;
revoke execute on function public.eng_push_card_bundle(jsonb, jsonb) from public, anon;
grant execute on function public.eng_push_card_bundle(jsonb, jsonb) to authenticated;
