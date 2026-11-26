-- Photo storage review fixes (on top of 20261231002600_photo_storage.sql).
-- Test: supabase/tests/photo_storage_fixes.sql.
--
-- 0. Catch-up. The live database got an early version of 20261231002600 (one limit for all, photo_storage_limit()
--    with no arguments); that file was changed in place afterwards. This brings any version of it to the newest
--    one: photo_storage_limit(target) (500 MB for an editor, none for an admin), photo_upload_fits, hidden shared
--    copies don't count, remove_my_photo's `hidden` and real `removed`, photo_uploads_unknown_sizes as one jsonb
--    array, and the backfill counting only the teacher's own uploads. On a database that already has the newest
--    version (a local reset), it changes nothing.
-- 1. Saving a slide checks the limit too. Before, only uploads were checked: a teacher could upload 50 MB, take the
--    photos out of "My photos" (they then count only while on a saved slide or 10 minutes after the upload), keep
--    them on unsaved slides, upload 50 MB more, and so on, then save slides holding all of it. Now a slide that gets
--    one of the owner's own uploads that doesn't count right now (photo_upload_counts) must fit, like an upload
--    (QMSTO). Photos that already count, and photos someone else uploaded (copies), never trigger it.
-- 2. reserve_photo_upload answers the row it replaced (`previous`), and release_photo_upload puts it back. The upload
--    route reserves BEFORE the click limit counts the try, so a try refused for a full account is never counted as a
--    click, and gives the space back when the click limit (or storing the file) then refuses.
--
-- Deploy: paste this into the live SQL editor BEFORE the app that calls release_photo_upload.

-- ─── 0. The limit, per account (the early version had one limit for all, with no arguments) ──────────────────
-- Same numbers as PHOTO_STORAGE_LIMIT_BYTES / EDITOR_PHOTO_STORAGE_LIMIT_BYTES (src/lib/photoStorage.ts).
drop function if exists public.photo_storage_limit();
create or replace function public.photo_storage_limit(target uuid) returns bigint
language sql stable security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.admins a where a.user_id = target) then null
    when exists (select 1 from public.editors e where e.user_id = target) then 524288000::bigint -- 500 × 1024 × 1024
    else 52428800::bigint -- 50 × 1024 × 1024
  end;
$$;

revoke all on function public.photo_storage_limit(uuid) from public, anon, authenticated;
grant execute on function public.photo_storage_limit(uuid) to service_role;

-- ─── Does this upload count for them right now? (the one rule; photo_storage_used and photo_upload_fits use it) ─
-- It's in their "My photos", on a slide of a presentation they own (not a shared copy QuizMatter hid), or it was
-- (re)uploaded less than 10 minutes ago (its space is held while the file is stored).
create or replace function public.photo_upload_counts(target uuid, target_src text) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.photo_uploads u
    where u.user_id = target and u.src = target_src
      and (
        u.created_at > now() - interval '10 minutes'
        or exists (select 1 from public.photos p where p.user_id = target and p.src = u.src)
        or exists (
          select 1 from public.slide_photos sp
          join public.presentations pr on pr.id = sp.presentation_id
          where sp.src = u.src and pr.owner_id = target
            -- Not a shared copy QuizMatter hid (the teacher can't change it, so it would count for good).
            and (pr.shared_from is null or pr.hidden_at is null)
        )
      )
  );
$$;

create or replace function public.photo_storage_used(target uuid) returns bigint
language sql stable security definer
set search_path = ''
as $$
  select coalesce(sum(u.bytes), 0)::bigint
  from public.photo_uploads u
  where u.user_id = target and public.photo_upload_counts(target, u.src);
$$;

-- True for an admin (no limit), or when the file already counts for them (uploading it again adds nothing), or
-- when it fits.
create or replace function public.photo_upload_fits(target uuid, target_src text, file_bytes integer) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.photo_storage_limit(target) is null
    or public.photo_upload_counts(target, target_src)
    or public.photo_storage_used(target) + file_bytes <= public.photo_storage_limit(target);
$$;

-- ─── Before an upload's file is stored (upload-image, with the secret key) ───────────────────────────────────
-- Answers { previous }: the row this upload replaced (null when it's new), for release_photo_upload.
drop function if exists public.reserve_photo_upload(uuid, text, integer);
create function public.reserve_photo_upload(target uuid, target_src text, file_bytes integer) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  previous jsonb;
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
  values (target, target_src, file_bytes, true, now())
  on conflict (user_id, src) do update
    set bytes = excluded.bytes, size_known = true, created_at = now();

  return jsonb_build_object('previous', previous);
end;
$$;

-- ─── Gives a reservation back (upload-image, when the click limit or storing the file refuses after it) ──────
-- previous: reserve_photo_upload's `previous`. Null = the row was new: it's deleted. Else the row gets its old size
-- and time back, so a refused re-upload holds no space.
create function public.release_photo_upload(target uuid, target_src text, previous jsonb) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('photo_storage:' || target::text));
  if previous is null or jsonb_typeof(previous) = 'null' then
    delete from public.photo_uploads u where u.user_id = target and u.src = target_src;
  else
    update public.photo_uploads u
    set bytes = (previous ->> 'bytes')::int,
      size_known = (previous ->> 'size_known')::boolean,
      created_at = (previous ->> 'created_at')::timestamptz
    where u.user_id = target and u.src = target_src;
  end if;
end;
$$;

revoke all on function public.photo_storage_used(uuid) from public, anon, authenticated;
grant execute on function public.photo_storage_used(uuid) to service_role;

revoke all on function public.photo_upload_fits(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.photo_upload_fits(uuid, text, integer) to service_role;

revoke all on function public.photo_upload_counts(uuid, text) from public, anon, authenticated;
grant execute on function public.photo_upload_counts(uuid, text) to service_role;

revoke all on function public.reserve_photo_upload(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.reserve_photo_upload(uuid, text, integer) to service_role;

revoke all on function public.release_photo_upload(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.release_photo_upload(uuid, text, jsonb) to service_role;

-- ─── 0. For the Photos panel's bar (the limit per account) ──────────────────────────────────────────────────
create or replace function public.my_photo_storage() returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'used', public.photo_storage_used((select auth.uid())),
    'limit', public.photo_storage_limit((select auth.uid()))
  );
$$;

-- ─── 0. Removing a photo from "My photos" (newest: `hidden` slides, hidden shared copies left out, real `removed`)
create or replace function public.remove_my_photo(target_src text, mode text) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  uses jsonb;
  removed boolean := false;
begin
  if me is null then
    raise exception 'Please log in again.' using errcode = '42501';
  end if;
  if mode is null or mode not in ('if_unused', 'ask', 'remove') then
    raise exception 'Unknown mode.' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(u order by u.title, u.id), '[]'::jsonb) into uses
  from (
    select pr.id, pr.title, pr.shared_from is not null as is_shared_copy,
      jsonb_agg(s.position + 1 order by s.position) as slides,
      coalesce(
        jsonb_agg(s.position + 1 order by s.position) filter (where coalesce((s.data ->> 'hidden')::boolean, false)),
        '[]'::jsonb
      ) as hidden
    from public.slide_photos sp
    join public.presentations pr on pr.id = sp.presentation_id
    join public.slides s on s.presentation_id = sp.presentation_id and s.id = sp.slide_id
    where sp.src = target_src and pr.owner_id = me and (pr.shared_from is null or pr.hidden_at is null)
    group by pr.id, pr.title, pr.shared_from
  ) u;

  if mode = 'remove' or (mode = 'if_unused' and uses = '[]'::jsonb) then
    -- Through the photos table's own triggers: a photo waiting for QuizMatter is still refused (QMPHL).
    delete from public.photos p where p.user_id = me and p.src = target_src;
    -- False when it was already gone (e.g. removed in another tab).
    removed := found;
  end if;

  return jsonb_build_object(
    'removed', removed,
    'uses', uses,
    'bytes', (select u.bytes from public.photo_uploads u where u.user_id = me and u.src = target_src),
    'used', public.photo_storage_used(me),
    'limit', public.photo_storage_limit(me)
  );
end;
$$;

-- ─── 0. Real sizes to fix: one jsonb array (the early version returned rows, which PostgREST cuts at 1,000) ──
drop function if exists public.photo_uploads_unknown_sizes();
create function public.photo_uploads_unknown_sizes() returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(distinct u.src), '[]'::jsonb) from public.photo_uploads u where not u.size_known;
$$;

revoke all on function public.my_photo_storage() from public, anon;
grant execute on function public.my_photo_storage() to authenticated, service_role;
revoke all on function public.remove_my_photo(text, text) from public, anon;
grant execute on function public.remove_my_photo(text, text) to authenticated, service_role;
revoke all on function public.photo_uploads_unknown_sizes() from public, anon, authenticated;
grant execute on function public.photo_uploads_unknown_sizes() to service_role;

-- ─── 0. The early backfill counted every "My photos" file for whoever had it, even one someone else shared ────
-- (an admin's shared photo, another editor's waiting one). The newest adds only the teacher's own. A backfilled row
-- still has its "My photos" row's exact time (an upload since then has the upload's own time), so only those go.
delete from public.photo_uploads u
using public.photos p, public.shared_photos sp
where p.user_id = u.user_id and p.src = u.src and p.created_at = u.created_at
  and sp.src = u.src and sp.uploaded_by is distinct from u.user_id;

-- ─── Saving a slide checks the limit too ─────────────────────────────────────────────────────────────────────
-- sync_slide_photos (after insert or update of a slide's data) keeps slide_photos. New: when the slide gets photos
-- the owner uploaded that don't count for them right now, they must fit (QMSTO), like an upload. Only photos new
-- on this slide are looked at, so a save that changes only words never checks. Admins have no limit.
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
      and not public.photo_upload_counts(owner, u.src);
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
