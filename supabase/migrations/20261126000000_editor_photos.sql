-- Editor photos wait in the shared library until QuizMatter uses them.
-- Design: docs/superpowers/specs/2026-10-17-editor-photos-design.md
--
-- Every photo an editor uploads to "My photos" also becomes a shared photo that is still WAITING (not public): admins
-- see it in Admin → Photos and fill in its name, category, tags, … but teachers and Claude don't get it. It becomes
-- public, for good, as soon as a live QuizMatter presentation uses it (an approved submission, a published review,
-- or a QuizMatter draft that is shared). While a photo is in a presentation or review waiting for QuizMatter, nobody
-- can delete it (QMPHL). Deleting it otherwise only takes it off a list: the weekly cleanup keeps every used file.

-- ─── 1. Waiting or public ───────────────────────────────────────────────────────────────────────────────────────
-- Every photo already shared stays public.
alter table public.shared_photos add column is_public boolean not null default true;

-- Every shared photo needs a category: editors' photos start here, and an admin moves them.
-- (Names are unique without caring about capitals, see photo_categories_name.)
insert into public.photo_categories (name) values ('From editors') on conflict do nothing;

-- ─── 2. Locked while waiting for approval ───────────────────────────────────────────────────────────────────────
-- True while the photo is on a slide of a presentation waiting for QuizMatter (a submitted submission), or in the
-- draft of a review waiting for QuizMatter. A review still being worked on doesn't count: its reviewer can still
-- change the draft.
create function public.photo_waiting_for_approval(target_src text)
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
    where sp.src = target_src and s.status = 'submitted'
  ) or exists (
    select 1
    from public.presentation_reviews r
    where r.status = 'submitted' and r.draft is not null and target_src = any(public.slide_photo_srcs(r.draft))
  );
$$;
revoke execute on function public.photo_waiting_for_approval(text) from public, anon, authenticated;

-- Refuses the delete (from "My photos" or from the shared library) while the photo waits for approval. Only for a
-- logged-in person: deleting an account (no auth.uid()) takes its photos with it and must never get stuck here.
create function public.refuse_locked_photo_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and public.photo_waiting_for_approval(old.src) then
    raise exception 'This photo is in a presentation waiting for QuizMatter, so it can''t be removed yet.'
      using errcode = 'QMPHL';
  end if;
  return old;
end;
$$;

create trigger refuse_locked_photo_delete
before delete on public.photos
for each row execute function public.refuse_locked_photo_delete();

create trigger refuse_locked_photo_delete
before delete on public.shared_photos
for each row execute function public.refuse_locked_photo_delete();

-- ─── 3. Going public ────────────────────────────────────────────────────────────────────────────────────────────
-- The waiting photos on this presentation's slides become public, if it's a live QuizMatter presentation (shared
-- with every teacher, not hidden). A draft or a hidden one changes nothing.
create function public.publish_waiting_photos(target_presentation text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.shared_photos set is_public = true
  where not is_public
    and src in (select sp.src from public.slide_photos sp where sp.presentation_id = target_presentation)
    and exists (
      select 1 from public.presentations p
      where p.id = target_presentation and p.from_admin and p.is_published and p.hidden_at is null
    );
$$;
revoke execute on function public.publish_waiting_photos(text) from public, anon, authenticated;

-- slide_photos is rewritten each time a slide's photos change (sync_slide_photos), so this covers the copy that
-- approve_submission makes and the slides publish_review writes.
create function public.publish_photos_of_new_slide()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.publish_waiting_photos(new.presentation_id);
  return null;
end;
$$;

create trigger publish_photos_of_new_slide
after insert on public.slide_photos
for each row execute function public.publish_photos_of_new_slide();

-- A QuizMatter draft that uses a waiting photo is shared (or shown again) later.
create function public.publish_photos_of_live_presentation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.publish_waiting_photos(new.id);
  return null;
end;
$$;

create trigger publish_photos_of_live_presentation
after update of is_published, hidden_at on public.presentations
for each row execute function public.publish_photos_of_live_presentation();

-- ─── 4. Editors' uploads ────────────────────────────────────────────────────────────────────────────────────────
-- An editor's new "My photos" photo also becomes a waiting shared photo (theirs, in "From editors"). A photo that's
-- already shared stays as it is. Shared photos must be WebP, so a JPEG (from Safari) gets none. It must never make
-- the upload fail, so any error here is skipped.
create function public.share_editor_photo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.src like '%.webp' and exists (select 1 from public.editors e where e.user_id = new.user_id) then
    begin
      insert into public.shared_photos (src, width, height, category_id, uploaded_by, is_public)
      select new.src, new.width, new.height, c.id, new.user_id, false
      from public.photo_categories c
      where lower(c.name) = 'from editors'
      on conflict (src) do nothing;
    exception when others then
      null;
    end;
  end if;
  return null;
end;
$$;

create trigger share_editor_photo
after insert on public.photos
for each row execute function public.share_editor_photo();

-- The editor took a photo off "My photos" while it was still waiting (it was never public): it leaves the shared
-- library too. A public one stays.
create function public.drop_waiting_editor_photo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.shared_photos sp where sp.src = old.src and not sp.is_public and sp.uploaded_by = old.user_id;
  return null;
end;
$$;

create trigger drop_waiting_editor_photo
after delete on public.photos
for each row execute function public.drop_waiting_editor_photo();

-- ─── 5. Who reads waiting photos ────────────────────────────────────────────────────────────────────────────────
-- Teachers read only public photos; admins read every one (Admin → Photos).
drop policy "Everyone reads shared photos" on public.shared_photos;
create policy "Everyone reads public shared photos" on public.shared_photos
  for select to authenticated
  using (is_public or (select public.is_admin()));

-- Claude's find_photos calls this with the secret key, which skips the rules above, so it leaves waiting photos out
-- itself. Otherwise the same as 20261114000000_shuffle_photo_search.sql.
create or replace function public.search_shared_photos(query text)
returns table (src text, width integer, height integer, file_name text, category text, description text, tags text[], source text)
language sql
volatile
security invoker
set search_path = ''
as $$
  select sp.src, sp.width, sp.height, sp.file_name, c.name, sp.description, sp.tags, sp.source
  from public.shared_photos sp
  join public.photo_categories c on c.id = sp.category_id
  cross join lateral (
    -- Split into words (letters and digits only, so % and _ can't act as wildcards).
    select count(*) as hits
    from unnest(regexp_split_to_array(lower(query), '[^[:alnum:]]+')) as w (word)
    where w.word <> ''
      and (
        lower(sp.description) like '%' || w.word || '%'
        or lower(sp.file_name) like '%' || w.word || '%'
        or lower(c.name) like '%' || w.word || '%'
        or exists (select 1 from unnest(sp.tags) as t (tag) where lower(t.tag) like '%' || w.word || '%')
      )
  ) as m
  where sp.is_public and (m.hits > 0 or trim(query) = '')
  order by m.hits desc, case when trim(query) = '' then sp.created_at end desc nulls last, random()
  limit 20;
$$;

-- Same views as in 20261122000000_super_admin.sql, plus is_public and a count of waiting photos (added last, so
-- "create or replace" works).
create or replace view public.shared_photos_search with (security_invoker = true) as
  select
    sp.src,
    sp.width,
    sp.height,
    sp.category_id,
    sp.file_name,
    sp.description,
    sp.tags,
    sp.source,
    sp.bytes,
    sp.created_at,
    array_to_string(sp.tags, ' ') as tags_text,
    c.name as category_name,
    sp.uploaded_by,
    sp.is_public
  from public.shared_photos sp
  join public.photo_categories c on c.id = sp.category_id;

create or replace view public.shared_photo_counts with (security_invoker = true) as
  select
    category_id,
    count(*)::integer as photos,
    (count(*) filter (where description = ''))::integer as no_description,
    (count(*) filter (where source = ''))::integer as no_source,
    uploaded_by,
    (count(*) filter (where not is_public))::integer as waiting
  from public.shared_photos
  group by category_id, uploaded_by;

-- ─── 6. Editors' photos from before ─────────────────────────────────────────────────────────────────────────────
insert into public.shared_photos (src, width, height, category_id, uploaded_by, is_public)
select distinct on (p.src) p.src, p.width, p.height, c.id, p.user_id, false
from public.photos p
join public.editors e on e.user_id = p.user_id
cross join public.photo_categories c
where lower(c.name) = 'from editors' and p.src like '%.webp'
order by p.src, p.created_at
on conflict (src) do nothing;

-- Those already used in a live QuizMatter presentation are public at once.
update public.shared_photos sp set is_public = true
where not sp.is_public
  and exists (
    select 1
    from public.slide_photos slp
    join public.presentations pr on pr.id = slp.presentation_id
    where slp.src = sp.src and pr.from_admin and pr.is_published and pr.hidden_at is null
  );
