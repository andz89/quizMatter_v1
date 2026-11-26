-- Photo storage review fixes, round 4 (on top of 20261231002700_photo_storage_fixes.sql).
-- Test: supabase/tests/photo_storage_fixes_2.sql.
--
-- 1. A reservation is given back only while it's still this request's. Before, two uploads of the same file at once
--    could go: A reserves, B reserves (replacing A's row), A is refused and releases: A's release deleted (or reset)
--    the row B was using, so B's photo never counted. Now reserve_photo_upload writes its own time (clock time, so
--    two in a row differ) and answers it (`written_at`); release_photo_upload(target, src, previous, written_at)
--    changes the row only while it still has that time.
-- 2. Moving one of your own photos between slides in one save never counts as new. save_presentation deletes the
--    removed slides first (their slide_photos go with them) and saves the others one row at a time, so the slide
--    that gets the photo used to see it as "not counting" and refuse the save (QMSTO) for a teacher over the limit.
--    Now a photo taken off one of the owner's slides is remembered for the rest of the request (a transaction-local
--    setting) and counts as already counting when another slide of theirs gets it.
--
-- Deploy: paste this into the live SQL editor BEFORE the app that sends `written_at`. (Until that app is live, its
-- release calls fail and a refused upload holds its space for 10 minutes, as before 002700.)

-- ─── 1. Reserve: answers { previous, written_at } ──────────────────────────────────────────────────────────────
create or replace function public.reserve_photo_upload(target uuid, target_src text, file_bytes integer) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  previous jsonb;
  written_at timestamptz := clock_timestamp();
begin
  -- One teacher's uploads (and saves of slides with their uploads) are checked one at a time, so two at once can't
  -- both slip past the limit.
  perform pg_advisory_xact_lock(hashtext('photo_storage:' || target::text));

  if not public.photo_upload_fits(target, target_src, file_bytes) then
    raise exception 'Your photo storage is full (% MB).', public.photo_storage_limit(target) / 1048576
      using errcode = 'QMSTO';
  end if;

  select jsonb_build_object('bytes', u.bytes, 'size_known', u.size_known, 'created_at', u.created_at)
  into previous
  from public.photo_uploads u where u.user_id = target and u.src = target_src;

  insert into public.photo_uploads (user_id, src, bytes, size_known, created_at)
  values (target, target_src, file_bytes, true, written_at)
  on conflict (user_id, src) do update
    set bytes = excluded.bytes, size_known = true, created_at = excluded.created_at;

  return jsonb_build_object('previous', previous, 'written_at', written_at);
end;
$$;

-- ─── 1. Release: only the row this request wrote ──────────────────────────────────────────────────────────────
-- previous: reserve_photo_upload's `previous` (null = the row was new: it's deleted; else it gets its old size and
-- time back). written_at: reserve's `written_at`. Another upload of the same file since then wrote its own time, so
-- the row is left as that one made it.
drop function if exists public.release_photo_upload(uuid, text, jsonb);
create function public.release_photo_upload(target uuid, target_src text, previous jsonb, written_at timestamptz)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('photo_storage:' || target::text));
  if previous is null or jsonb_typeof(previous) = 'null' then
    delete from public.photo_uploads u
    where u.user_id = target and u.src = target_src and u.created_at = written_at;
  else
    update public.photo_uploads u
    set bytes = (previous ->> 'bytes')::int,
      size_known = (previous ->> 'size_known')::boolean,
      created_at = (previous ->> 'created_at')::timestamptz
    where u.user_id = target and u.src = target_src and u.created_at = written_at;
  end if;
end;
$$;

revoke all on function public.release_photo_upload(uuid, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.release_photo_upload(uuid, text, jsonb, timestamptz) to service_role;

-- ─── 2. Photos taken off the owner's slides in this request ──────────────────────────────────────────────────
-- A transaction-local setting (gone when the request ends; clients can't set `qm.*` settings) holding a jsonb array
-- of "<owner> <src>". Only the owner's own uploads on a presentation that counts (not a shared copy QuizMatter hid):
-- those counted before they were taken off.
create or replace function public.remember_freed_slide_photo() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  owner uuid;
  freed jsonb;
begin
  select p.owner_id into owner from public.presentations p
  where p.id = old.presentation_id and (p.shared_from is null or p.hidden_at is null);
  if owner is null
    or not exists (select 1 from public.photo_uploads u where u.user_id = owner and u.src = old.src)
  then
    return null;
  end if;
  freed := coalesce(nullif(current_setting('qm.freed_slide_photos', true), '')::jsonb, '[]'::jsonb);
  if not freed ? (owner::text || ' ' || old.src) then
    perform set_config('qm.freed_slide_photos', (freed || to_jsonb(owner::text || ' ' || old.src))::text, true);
  end if;
  return null;
end;
$$;

revoke all on function public.remember_freed_slide_photo() from public, anon, authenticated;

drop trigger if exists remember_freed_slide_photo on public.slide_photos;
create trigger remember_freed_slide_photo after delete on public.slide_photos
for each row execute function public.remember_freed_slide_photo();

-- Was this photo taken off one of the owner's slides earlier in this request?
create or replace function public.slide_photo_freed(target uuid, target_src text) returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce(nullif(current_setting('qm.freed_slide_photos', true), '')::jsonb, '[]'::jsonb)
    ? (target::text || ' ' || target_src);
$$;

revoke all on function public.slide_photo_freed(uuid, text) from public, anon, authenticated;

-- ─── 2. Saving a slide checks the limit (newest: a photo moved from another of the owner's slides is not new) ──
create or replace function public.sync_slide_photos() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  new_srcs text[] := public.slide_photo_srcs(new.data);
  old_srcs text[];
  owner uuid;
  storage_limit bigint;
  extra bigint;
begin
  select coalesce(array_agg(sp.src order by sp.src), '{}') into old_srcs
  from public.slide_photos sp
  where sp.presentation_id = new.presentation_id and sp.slide_id = new.id;

  -- Same photos as before (e.g. only the words changed): nothing to write.
  if new_srcs = old_srcs then
    return null;
  end if;

  select p.owner_id into owner from public.presentations p where p.id = new.presentation_id;
  storage_limit := public.photo_storage_limit(owner);
  if storage_limit is not null
    and exists (
      select 1 from public.photo_uploads u
      where u.user_id = owner and u.src = any (new_srcs) and not (u.src = any (old_srcs))
    )
  then
    perform pg_advisory_xact_lock(hashtext('photo_storage:' || owner::text));
    select coalesce(sum(u.bytes), 0) into extra
    from public.photo_uploads u
    where u.user_id = owner and u.src = any (new_srcs) and not (u.src = any (old_srcs))
      and not public.photo_upload_counts(owner, u.src)
      -- Moved here from another of their slides in this same save: it counted already.
      and not public.slide_photo_freed(owner, u.src);
    if extra > 0 and public.photo_storage_used(owner) + extra > storage_limit then
      raise exception 'Your photo storage is full (% MB).', storage_limit / 1048576 using errcode = 'QMSTO';
    end if;
  end if;

  delete from public.slide_photos sp where sp.presentation_id = new.presentation_id and sp.slide_id = new.id;
  insert into public.slide_photos (presentation_id, slide_id, src)
  select new.presentation_id, new.id, unnest(new_srcs);
  return null;
end;
$$;
