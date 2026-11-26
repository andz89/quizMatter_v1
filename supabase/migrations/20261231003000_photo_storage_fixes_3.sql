-- Photo storage review fixes, round 5 (on top of 20261231002800_photo_storage_fixes_2.sql).
-- Test: supabase/tests/photo_storage_fixes_3.sql.
--
-- 1. Removing a photo you just uploaded frees its space at once. An upload holds its space for 10 minutes (so the
--    file can be stored before the My photos row exists), and that hold used to stay after the teacher removed the
--    photo from My photos: a teacher near the limit who removed a wrong upload was still "full" for 10 minutes.
--    Now remove_my_photo ends the hold (moves the record's time back past the 10 minutes) when it really removed the
--    row. The record stays, so the photo still counts while it's on one of their slides.
-- 2. Saving a slide changes only the slide_photos rows that really change. sync_slide_photos used to delete every
--    row of the slide and insert them again, so every photo on it was remembered as "freed", not only the ones taken
--    off. Now it deletes the photos that left and inserts the new ones.
-- 3. The "freed" list is written once per statement, not once per row. The row trigger re-read and re-wrote the whole
--    list for every deleted row, so a big delete got slower with the square of its size (2,000 rows: about 2 s).
--    Now a statement trigger (with the deleted rows as a transition table) adds them all in one step.
--
-- Deploy: paste this into the live SQL editor after 20261231002800 (and 20261231002900). The app doesn't change
-- for it, so it can go before or after the app.

-- ─── 1. Removing from My photos ends a fresh upload's hold ─────────────────────────────────────────────────────
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

  -- The upload is done (its My photos row existed), so its 10-minute hold isn't needed any more. Same lock as
  -- reserve_photo_upload. A release of another upload of this file still in progress then matches nothing and leaves
  -- the record as it is (it counts again once that upload's My photos row is written).
  if removed then
    perform pg_advisory_xact_lock(hashtext('photo_storage:' || me::text));
    update public.photo_uploads u
    set created_at = now() - interval '10 minutes'
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

-- ─── 2. Saving a slide changes only the rows that change ───────────────────────────────────────────────────────
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
  return null;
end;
$$;

-- ─── 3. The freed list, once per statement ─────────────────────────────────────────────────────────────────────
-- Same rule as before: only the owner's own uploads, on a presentation that counts (not a shared copy QuizMatter
-- hid). A presentation being deleted is already gone when its slide_photos go (the cascade runs after), so those
-- add nothing: no later save in the request can need them.
create or replace function public.remember_freed_slide_photos() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  added jsonb;
begin
  select jsonb_agg(distinct p.owner_id::text || ' ' || o.src) into added
  from freed_rows o
  join public.presentations p on p.id = o.presentation_id and (p.shared_from is null or p.hidden_at is null)
  where exists (select 1 from public.photo_uploads u where u.user_id = p.owner_id and u.src = o.src);
  if added is null then
    return null;
  end if;

  perform set_config('qm.freed_slide_photos', (
    select jsonb_agg(k)::text
    from (
      select jsonb_array_elements_text(
        coalesce(nullif(current_setting('qm.freed_slide_photos', true), '')::jsonb, '[]'::jsonb)) as k
      union
      select jsonb_array_elements_text(added)
    ) s
  ), true);
  return null;
end;
$$;

revoke all on function public.remember_freed_slide_photos() from public, anon, authenticated;

drop trigger if exists remember_freed_slide_photo on public.slide_photos;
drop function if exists public.remember_freed_slide_photo();
create trigger remember_freed_slide_photos after delete on public.slide_photos
referencing old table as freed_rows
for each statement execute function public.remember_freed_slide_photos();
