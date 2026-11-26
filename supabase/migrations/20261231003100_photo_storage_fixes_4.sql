-- Photo storage review fixes, round 6 (on top of 20261231003000_photo_storage_fixes_3.sql).
-- Test: supabase/tests/photo_storage_fixes_4.sql.
--
-- 1. A slide save makes every photo on a live QuizMatter slide public again, as before round 5. Round 5 inserts
--    only a slide's new photos into slide_photos, so publish_photos_of_new_slide (after insert) stopped running for
--    the photos that stay. A waiting editor photo already on a live lesson (e.g. an editor uploaded that file after
--    it was on the lesson) used to go public at the slide's next photo change; now sync_slide_photos does that for
--    every photo of the changed slide itself.
-- 2. Ending a fresh upload's hold keeps the record findable by its own upload. reserve_photo_upload's time
--    (created_at = written_at) is also how release_photo_upload finds the record it wrote. remove_my_photo used to
--    set it to now() - 10 minutes, so an upload of the same file still in progress couldn't release it any more (a
--    record for a file the teacher never uploaded could stay). Now it moves the time back by exactly one day (always
--    past the hold, even for a reservation written after this request began), and the release matches either time.
--
-- Deploy: paste this into the live SQL editor after 20261231003000. No app change: before or after the app.

-- ─── 1. Saving a slide (newest: every photo of a changed slide on a live QuizMatter lesson is public) ──────────
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

  -- Only the photos that left the slide, then only the new ones (the rest stay as they are).
  delete from public.slide_photos sp
  where sp.presentation_id = new.presentation_id and sp.slide_id = new.id and not (sp.src = any (new_srcs));
  insert into public.slide_photos (presentation_id, slide_id, src)
  select new.presentation_id, new.id, s from unnest(new_srcs) s where not (s = any (old_srcs));

  -- The new ones were made public by publish_photos_of_new_slide; the ones that stayed are too, as when every row
  -- was inserted again (same rule: a live, shown QuizMatter presentation).
  update public.shared_photos sp set is_public = true
  where sp.src = any (new_srcs) and not sp.is_public
    and exists (
      select 1 from public.presentations p
      where p.id = new.presentation_id and p.from_admin and p.is_published and p.hidden_at is null
    );
  return null;
end;
$$;

-- ─── 2. Release: its own time, or that time moved back a day by remove_my_photo ─────────────────────────────────────
create or replace function public.release_photo_upload(target uuid, target_src text, previous jsonb, written_at timestamptz)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('photo_storage:' || target::text));
  if previous is null or jsonb_typeof(previous) = 'null' then
    delete from public.photo_uploads u
    where u.user_id = target and u.src = target_src
      and u.created_at in (written_at, written_at - interval '1 day');
  else
    update public.photo_uploads u
    set bytes = (previous ->> 'bytes')::int,
      size_known = (previous ->> 'size_known')::boolean,
      created_at = (previous ->> 'created_at')::timestamptz
    where u.user_id = target and u.src = target_src
      and u.created_at in (written_at, written_at - interval '1 day');
  end if;
end;
$$;

revoke all on function public.release_photo_upload(uuid, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.release_photo_upload(uuid, text, jsonb, timestamptz) to service_role;

-- ─── 2. Removing from My photos moves the hold's time back by exactly one day ─────────────────────────────────
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

  -- The upload is done (its My photos row existed), so its 10-minute hold isn't needed any more: its time moves
  -- back by exactly one day (past the hold), so an upload of this file still in progress can still release the
  -- record it wrote (release_photo_upload matches that time too). Same lock as reserve_photo_upload.
  if removed then
    perform pg_advisory_xact_lock(hashtext('photo_storage:' || me::text));
    update public.photo_uploads u
    set created_at = u.created_at - interval '1 day'
    where u.user_id = me and u.src = target_src and u.created_at > now() - interval '10 minutes';
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

revoke all on function public.remove_my_photo(text, text) from public, anon;
grant execute on function public.remove_my_photo(text, text) to authenticated, service_role;
