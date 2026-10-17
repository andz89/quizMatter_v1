-- Fixes for 20261126000000_editor_photos.sql, after its review:
-- 1. Faster: slide_photos gets an index on src (the delete lock looks photos up by src).
-- 2. The lock on "My photos" only stops the person whose own presentation or review is waiting, not every teacher
--    who happens to have the same file. (The shared library's ✕ still stops everyone.)
-- 3. Two editors with the same file: when one removes it, the waiting photo is handed to the other instead of
--    leaving Admin → Photos.
-- 4. A teacher who becomes an editor later: their older photos are added as waiting too.
-- 5. Going public checks only the photo that was just added to a slide, not all the presentation's photos each time.

-- ─── 1. Index ───────────────────────────────────────────────────────────────────────────────────────────────────
create index slide_photos_src on public.slide_photos (src);

-- ─── 2. The lock, per person ────────────────────────────────────────────────────────────────────────────────────
-- Same as photo_waiting_for_approval in 20261126000000_editor_photos.sql, but with `owner`: when given, only that
-- person's submissions and reviews count. Null = anyone's.
create function public.photo_waiting_for_approval(target_src text, owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.slide_photos sp
    join public.presentation_submissions s on s.presentation_id = sp.presentation_id
    where sp.src = target_src and s.status = 'submitted' and (owner is null or s.submitter_id = owner)
  ) or exists (
    select 1
    from public.presentation_reviews r
    where r.status = 'submitted' and r.draft is not null and (owner is null or r.reviewer_id = owner)
      and target_src = any(public.slide_photo_srcs(r.draft))
  );
$$;
revoke execute on function public.photo_waiting_for_approval(text, uuid) from public, anon, authenticated;

-- "My photos" (photos): only the person removing it. The shared library (shared_photos): anyone's.
create or replace function public.refuse_locked_photo_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and public.photo_waiting_for_approval(
    old.src,
    case when tg_table_name = 'photos' then old.user_id end
  ) then
    raise exception 'This photo is in a presentation waiting for QuizMatter, so it can''t be removed yet.'
      using errcode = 'QMPHL';
  end if;
  return old;
end;
$$;

drop function public.photo_waiting_for_approval(text);

-- ─── 3. Same file, two editors ──────────────────────────────────────────────────────────────────────────────────
-- The editor took a photo off "My photos" while it was still waiting: if another editor still has the same file,
-- it becomes theirs; otherwise it leaves the shared library (it was never public). A public one stays.
create or replace function public.drop_waiting_editor_photo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_owner uuid;
begin
  if not exists (
    select 1 from public.shared_photos sp where sp.src = old.src and not sp.is_public and sp.uploaded_by = old.user_id
  ) then
    return null;
  end if;
  select p.user_id into next_owner
  from public.photos p
  join public.editors e on e.user_id = p.user_id
  where p.src = old.src
  order by p.created_at
  limit 1;
  if next_owner is null then
    delete from public.shared_photos sp where sp.src = old.src and not sp.is_public and sp.uploaded_by = old.user_id;
  else
    update public.shared_photos sp set uploaded_by = next_owner
    where sp.src = old.src and not sp.is_public and sp.uploaded_by = old.user_id;
  end if;
  return null;
end;
$$;

-- ─── 4. New editors ─────────────────────────────────────────────────────────────────────────────────────────────
-- Their WebP "My photos" become waiting shared photos (like the backfill in 20261126000000_editor_photos.sql);
-- those already used in a live QuizMatter presentation are public at once.
create function public.share_new_editor_photos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.shared_photos (src, width, height, category_id, uploaded_by, is_public)
  select p.src, p.width, p.height, c.id, p.user_id, false
  from public.photos p
  cross join public.photo_categories c
  where p.user_id = new.user_id and p.src like '%.webp' and lower(c.name) = 'from editors'
  on conflict (src) do nothing;

  update public.shared_photos sp set is_public = true
  where not sp.is_public
    and sp.uploaded_by = new.user_id
    and exists (
      select 1
      from public.slide_photos slp
      join public.presentations pr on pr.id = slp.presentation_id
      where slp.src = sp.src and pr.from_admin and pr.is_published and pr.hidden_at is null
    );
  return null;
end;
$$;

create trigger share_new_editor_photos
after insert on public.editors
for each row execute function public.share_new_editor_photos();

-- ─── 5. Going public, one photo at a time ───────────────────────────────────────────────────────────────────────
-- Each new slide_photos row makes only its own photo public (if the presentation is live), instead of every photo of
-- the presentation again. publish_waiting_photos stays for the presentations trigger (shared or shown again later).
create or replace function public.publish_photos_of_new_slide()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.shared_photos sp set is_public = true
  where sp.src = new.src
    and not sp.is_public
    and exists (
      select 1 from public.presentations p
      where p.id = new.presentation_id and p.from_admin and p.is_published and p.hidden_at is null
    );
  return null;
end;
$$;
