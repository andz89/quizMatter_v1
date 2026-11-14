-- Sharing fixes from the 2026-11-13 review (spec docs/superpowers/specs/2026-11-15-sharing-review-fixes-design.md,
-- test supabase/tests/sharing_fixes.sql). An admin's hide of a teacher's shared copy must stick:
-- 1. A teacher can't delete an original whose shared copy is hidden (QMHID): the delete took the hidden copy and its
--    reports with it, and a copy made earlier could then be published. Admins still can; account deletion still
--    works (it runs without a logged-in user).
-- 2. share_presentation refuses while the copy is hidden, so "Update shared presentation" can't overwrite it.
-- 3. share_presentation follows the whole copied_from chain (a copy of a copy of a hidden presentation).
-- 4. has_publishable_content skips hidden slides and empty text boxes (same rule as hasSlideContent in
--    src/lib/schema.ts).

create or replace function public.check_hidden_copy_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null or pg_trigger_depth() > 1 or public.is_admin() then
    return old;
  end if;
  if old.shared_from is not null and old.hidden_at is not null
    and exists (select 1 from public.presentations p where p.id = old.shared_from) then
    raise exception 'QuizMatter hid the shared copy, so it can''t be made private.' using errcode = '42501';
  end if;
  -- Deleting the original would delete its hidden shared copy (on delete cascade).
  if old.shared_from is null
    and exists (select 1 from public.presentations p where p.shared_from = old.id and p.hidden_at is not null) then
    raise exception 'QuizMatter hid this presentation''s shared copy, so it can''t be deleted.' using errcode = 'QMHID';
  end if;
  return old;
end;
$$;

create or replace function public.has_publishable_content(target_id text)
returns boolean
language sql
stable
set search_path = ''
as $$
  -- A slide viewers can see (not hidden) with something on it. A text box counts only when its text, without the
  -- tags, isn't blank; every other element (shape, picture, table, diagram, …) counts.
  select exists (
    select 1 from public.presentations p
    where p.id = target_id and btrim(p.title) <> ''
  ) and exists (
    select 1 from public.slides s
    where s.presentation_id = target_id
      and coalesce(s.data ->> 'hidden', 'false') <> 'true'
      and (
        btrim(coalesce(s.data ->> 'question', '')) <> ''
        or exists (
          select 1 from jsonb_array_elements(coalesce(s.data -> 'elements', '[]')) e
          where e ->> 'assetId' is distinct from 'text-box'
            or btrim(replace(regexp_replace(coalesce(e #>> '{text,html}', ''), '<[^>]*>', '', 'g'), '&nbsp;', ' '),
              E' \t\r\n ') <> ''
        )
        or coalesce(s.data ->> 'embedUrl', '') <> ''
        or btrim(coalesce(s.data ->> 'correctAnswer', '')) <> ''
        or exists (select 1 from jsonb_array_elements(coalesce(s.data -> 'options', '[]')) o where btrim(coalesce(o ->> 'text', '')) <> '')
      )
  );
$$;

create or replace function public.share_presentation(target_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  original public.presentations;
  copy_id text;
begin
  select * into original from public.presentations p where p.id = target_id for update;
  if not found or original.owner_id is distinct from auth.uid() or original.from_admin or original.shared_from is not null then
    raise exception 'You can only share your own presentations.' using errcode = '42501';
  end if;
  if public.is_editor() then
    raise exception 'Editors send presentations to QuizMatter instead of publishing them.' using errcode = '42501';
  end if;
  if original.hidden_at is not null
    or exists (select 1 from public.presentations p where p.shared_from = target_id and p.hidden_at is not null) then
    raise exception 'QuizMatter hid this presentation, so it can''t be shared.' using errcode = '42501';
  end if;
  -- Every presentation it was copied from, step by step (a copy of a copy …), and their shared copies.
  if exists (
    with recursive sources (id, steps) as (
      select original.copied_from, 1 where original.copied_from is not null
      union all
      select p.copied_from, s.steps + 1
      from sources s join public.presentations p on p.id = s.id
      where p.copied_from is not null and s.steps < 100
    )
    select 1 from sources s
    join public.presentations p on p.id = s.id or p.shared_from = s.id
    where p.hidden_at is not null
  ) then
    raise exception 'QuizMatter hid the presentation this was copied from, so it can''t be shared.' using errcode = '42501';
  end if;
  if public.is_review_locked(target_id) then
    raise exception 'This presentation is waiting for QuizMatter.' using errcode = 'QMREV';
  end if;
  -- Same rule as publishableSchema in src/lib/schema.ts.
  if not public.has_publishable_content(target_id) then
    raise exception 'Add a title and some content before publishing.' using errcode = 'QMPUB';
  end if;

  select p.id into copy_id from public.presentations p where p.shared_from = target_id for update;
  perform public.count_click('share');
  if copy_id is null then
    perform public.count_click('publish');
  end if;

  -- Lets the shared copy triggers through for these changes only (until this transaction ends).
  -- A new presentations column goes in both the insert and the update (supabase/tests/sharing_fixes.sql checks).
  perform set_config('quizmatter.sharing', 'yes', true);
  if copy_id is null then
    copy_id := gen_random_uuid()::text;
    insert into public.presentations (
      id, owner_id, title, description, grades, subject, term, week, day, curriculum, learning_competency, author,
      reference_links, tags, transition, transition_speed, is_published, from_admin, shared_from, shared_at,
      created_at, updated_at, data_version
    )
    values (
      copy_id, original.owner_id, original.title, original.description, original.grades, original.subject,
      original.term, original.week, original.day, original.curriculum, original.learning_competency, original.author,
      original.reference_links, original.tags, original.transition, original.transition_speed, true, false,
      target_id, now(), now(), now(), original.data_version
    );
  else
    -- Same id and created_at, so links, bookmarks and reports stay. (A hidden copy is refused above.)
    update public.presentations p set
      title = original.title,
      description = original.description,
      grades = original.grades,
      subject = original.subject,
      term = original.term,
      week = original.week,
      day = original.day,
      curriculum = original.curriculum,
      learning_competency = original.learning_competency,
      author = original.author,
      reference_links = original.reference_links,
      tags = original.tags,
      transition = original.transition,
      transition_speed = original.transition_speed,
      data_version = original.data_version,
      shared_at = now(),
      updated_at = now()
    where p.id = copy_id;
    delete from public.slides s where s.presentation_id = copy_id;
  end if;
  insert into public.slides (presentation_id, id, position, data)
  select copy_id, s.id, s.position, s.data from public.slides s where s.presentation_id = target_id;
  perform set_config('quizmatter.sharing', '', true);

  return jsonb_build_object('id', copy_id, 'sharedAt', floor(extract(epoch from now()) * 1000)::bigint);
end;
$$;
