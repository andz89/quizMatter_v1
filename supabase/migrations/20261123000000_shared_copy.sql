-- Shared copy: a teacher's Publish makes a copy that other teachers see (see
-- docs/superpowers/specs/2026-10-16-shared-copy-design.md).
--
-- Before, "published" was only a switch on the teacher's own presentation, so other teachers saw every save at once.
-- Now the copy is its own presentation row (shared_from = the original's id). The teacher keeps editing the original
-- in private; the copy changes only through share_presentation ("Update shared presentation" in the Share card).
--
-- - share_presentation makes the copy, or copies the original over it again (same id, so links, bookmarks and
--   reports stay). unshare_presentation (Private) deletes it. Deleting the original deletes it too (cascade).
-- - Nothing else can change a copy (shared_copy_change and shared_copy_slides triggers), except an admin hiding it.
-- - A teacher's original is never published itself (save_presentation and count_share_clicks).
-- - Copies don't count in the 50-presentation limit or the "create" click limit.
-- - QuizMatter (from_admin) presentations keep the old Draft / Shared switch.
--
-- Development stage: every teacher presentation published today is deleted.

-- ─── 1. Delete today's published teacher presentations ───────────────────────────────────────────────────────
-- The review lock triggers would refuse deleting one that waits for QuizMatter, so they're let through here.
select set_config('quizmatter.publishing_review', 'yes', true);
delete from public.presentations p where not p.from_admin and p.is_published;
select set_config('quizmatter.publishing_review', '', true);

-- ─── 2. The copy's columns ────────────────────────────────────────────────────────────────────────────────────
alter table public.presentations
  add column shared_from text unique references public.presentations (id) on delete cascade,
  add column shared_at timestamptz;

-- ─── 3. Nothing else changes a copy ───────────────────────────────────────────────────────────────────────────
-- Only share_presentation (it sets quizmatter.sharing). An admin may still hide or show a copy (hidden_at). Deleting
-- a copy isn't guarded: the owner's direct delete is the same as Private, and admins delete reported ones.
create function public.check_shared_copy_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(current_setting('quizmatter.sharing', true), '') = 'yes' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.shared_from is null and new.shared_at is null then
      return new;
    end if;
  elsif old.shared_from is null then
    -- An original can't be turned into a copy.
    if new.shared_from is null and new.shared_at is not distinct from old.shared_at then
      return new;
    end if;
  -- tags_text and search_text are worked out by the database (null in NEW here), so they're left out.
  elsif (to_jsonb(new) - 'hidden_at' - 'tags_text' - 'search_text') = (to_jsonb(old) - 'hidden_at' - 'tags_text' - 'search_text') then
    return new;
  end if;
  raise exception 'A shared copy only changes with "Update shared presentation".' using errcode = '42501';
end;
$$;

create trigger shared_copy_change
  before insert or update on public.presentations
  for each row execute function public.check_shared_copy_change();

-- A copy's slides: same rule. When its presentation row is gone (deleted, or by cascade from the original), its
-- slides may go.
create function public.check_shared_copy_slides()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_id text := case tg_op when 'DELETE' then old.presentation_id else new.presentation_id end;
begin
  if coalesce(current_setting('quizmatter.sharing', true), '') <> 'yes'
    and exists (select 1 from public.presentations p where p.id = target_id and p.shared_from is not null) then
    raise exception 'A shared copy only changes with "Update shared presentation".' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger shared_copy_slides
  before insert or update or delete on public.slides
  for each row execute function public.check_shared_copy_slides();

-- ─── 4. A teacher's original is never published itself ───────────────────────────────────────────────────────
-- Same trigger as before (20261106000000_fix_share_count_on_save.sql). It no longer counts clicks:
-- share_presentation and unshare_presentation do. It refuses publishing a teacher's original directly.
create or replace function public.count_share_clicks()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.from_admin or new.shared_from is not null or not new.is_published then
    return new;
  end if;
  raise exception 'Publish with the Share button: it makes a shared copy.' using errcode = '42501';
end;
$$;

-- ─── 5. save_presentation: same as before (20261118000000_presentation_term.sql) ─────────────────────────────
-- Only a QuizMatter presentation's isPublished is saved; a teacher's original stays private (an old app tab may
-- still send true). The publish content check moved to share_presentation.
create or replace function public.save_presentation(presentation jsonb, slide_ids text[], base_updated_at bigint)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_id text := presentation ->> 'id';
  saved_updated_at timestamptz;
  slide_count int := coalesce(cardinality(slide_ids), 0);
begin
  -- Same as MAX_SLIDES in src/lib/schema.ts. Every presentation has at least one slide.
  if slide_count = 0 or slide_count > 100 then
    raise exception 'A presentation needs 1 to 100 slides.' using errcode = '22023';
  end if;
  if (select count(distinct id) from unnest(slide_ids) as id) <> slide_count then
    raise exception 'A slide id is used twice.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(presentation -> 'slides') as slide where not (slide ->> 'id' = any (slide_ids))
  ) then
    raise exception 'A sent slide is missing from slide_ids.' using errcode = '22023';
  end if;

  -- Locked until the save ends, so two saves of the same presentation can't cross.
  select p.updated_at into saved_updated_at from public.presentations p where p.id = target_id for update;
  if found and (base_updated_at is null or floor(extract(epoch from saved_updated_at) * 1000)::bigint <> base_updated_at) then
    raise exception 'This presentation was saved somewhere else since it was opened.' using errcode = 'QM409';
  end if;

  insert into public.presentations (
    id, title, description, grades, subject, term, week, day, curriculum, learning_competency, author, reference_links, tags, transition,
    transition_speed, is_published, from_admin, created_at, updated_at
  )
  values (
    target_id,
    presentation ->> 'title',
    presentation ->> 'description',
    public.grades_from(presentation),
    presentation ->> 'subject',
    -- An app tab opened before Term existed sends none: keep it empty.
    coalesce(presentation ->> 'term', ''),
    -- An app tab opened before Week and Day existed sends none: keep them empty.
    coalesce(presentation ->> 'week', ''),
    coalesce(presentation ->> 'day', ''),
    presentation ->> 'curriculum',
    presentation ->> 'learningCompetency',
    presentation ->> 'author',
    array(select jsonb_array_elements_text(presentation -> 'referenceLinks')),
    -- An app tab opened before tags existed sends none: keep it empty.
    array(select jsonb_array_elements_text(coalesce(presentation -> 'tags', '[]'))),
    -- An app tab opened before slide effects existed sends none: use the default.
    coalesce(presentation ->> 'transition', 'slide'),
    -- An app tab opened before effect speeds existed sends none: use the default.
    coalesce((presentation ->> 'transitionSpeed')::smallint, 3),
    -- A teacher's original is never published itself (its shared copy is).
    coalesce((presentation ->> 'fromAdmin')::boolean, false) and (presentation ->> 'isPublished')::boolean,
    coalesce((presentation ->> 'fromAdmin')::boolean, false),
    to_timestamp((presentation ->> 'createdAt')::bigint / 1000.0),
    now()
  )
  on conflict (id) do update set
    title = excluded.title,
    description = excluded.description,
    grades = excluded.grades,
    subject = excluded.subject,
    term = excluded.term,
    week = excluded.week,
    day = excluded.day,
    curriculum = excluded.curriculum,
    learning_competency = excluded.learning_competency,
    author = excluded.author,
    reference_links = excluded.reference_links,
    tags = excluded.tags,
    transition = excluded.transition,
    transition_speed = excluded.transition_speed,
    -- from_admin isn't changed by a save, so the saved row says which kind it is.
    is_published = public.presentations.from_admin and (presentation ->> 'isPublished')::boolean,
    updated_at = now();

  delete from public.slides s where s.presentation_id = target_id and not (s.id = any (slide_ids));

  -- Unchanged slides: only their position, and only if it moved.
  update public.slides s set position = (t.ord - 1)::int
  from unnest(slide_ids) with ordinality as t(id, ord)
  where s.presentation_id = target_id and s.id = t.id and s.position <> t.ord - 1;

  insert into public.slides (presentation_id, id, position, data)
  select target_id, slide ->> 'id', array_position(slide_ids, slide ->> 'id') - 1, slide
  from jsonb_array_elements(presentation -> 'slides') as slide
  on conflict (presentation_id, id) do update set position = excluded.position, data = excluded.data;

  -- Every slide in the list must now be in the database. If one isn't (the app thought it was saved, but it
  -- isn't), nothing is saved and the app sends every slide instead.
  if (select count(*) from public.slides s where s.presentation_id = target_id) <> slide_count then
    raise exception 'Some slides are missing. Send every slide.' using errcode = 'QM422';
  end if;

  return floor(extract(epoch from now()) * 1000)::bigint;
end;
$$;

-- ─── 6. The 50-presentation limit: same as before (20261011000000_lower_limits.sql), copies don't count ──────
create or replace function public.check_presentation_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if public.is_admin() or new.shared_from is not null then
    return new;
  end if;
  -- save_presentation's "insert … on conflict do update" runs this for existing presentations too: those are
  -- only being saved again, not added.
  if exists (select 1 from public.presentations p where p.id = new.id) then
    return new;
  end if;
  -- Two new presentations from the same teacher at the same moment wait for each other, so both are counted.
  perform pg_advisory_xact_lock(hashtext(new.owner_id::text));
  -- Same as MAX_PRESENTATIONS in src/lib/schema.ts.
  if (select count(*) from public.presentations p where p.owner_id = new.owner_id and p.shared_from is null) >= 50 then
    raise exception 'You have 50 presentations, the most allowed.' using errcode = 'QMMAX';
  end if;
  return new;
end;
$$;

-- ─── 6b. The "create" click limit: same as before (20261107000000_create_limit.sql), a copy isn't a new one ───
create or replace function public.count_new_presentation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- save_presentation's "insert … on conflict do update" runs this for existing presentations too: those are only
  -- being saved again, not made. A shared copy is counted as a share instead (share_presentation).
  if new.from_admin or new.shared_from is not null or exists (select 1 from public.presentations p where p.id = new.id) then
    return new;
  end if;
  perform public.count_click('create');
  return new;
end;
$$;

-- ─── 7. Publish / Update shared presentation ─────────────────────────────────────────────────────────────────
-- Makes the copy of my presentation, or copies it over the copy again. Counts a "share" click (and a "publish"
-- click the first time). Returns the copy's id and when it was copied (Unix ms).
create function public.share_presentation(target_id text)
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
  perform set_config('quizmatter.sharing', 'yes', true);
  if copy_id is null then
    copy_id := gen_random_uuid()::text;
    insert into public.presentations (
      id, owner_id, title, description, grades, subject, term, week, day, curriculum, learning_competency, author,
      reference_links, tags, transition, transition_speed, is_published, from_admin, shared_from, shared_at,
      created_at, updated_at
    )
    values (
      copy_id, original.owner_id, original.title, original.description, original.grades, original.subject,
      original.term, original.week, original.day, original.curriculum, original.learning_competency, original.author,
      original.reference_links, original.tags, original.transition, original.transition_speed, true, false,
      target_id, now(), now(), now()
    );
  else
    -- Same id, created_at and hidden_at, so links, bookmarks, reports and an admin's hiding stay.
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

revoke execute on function public.share_presentation(text) from public, anon;
grant execute on function public.share_presentation(text) to authenticated;

-- ─── 8. Private: removes the copy ────────────────────────────────────────────────────────────────────────────
-- Its bookmarks and reports go with it. Counts a "share" click. No copy = nothing happens.
create function public.unshare_presentation(target_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.presentations p
    where p.id = target_id and p.owner_id = auth.uid() and not p.from_admin and p.shared_from is null
  ) then
    raise exception 'You can only change your own presentations.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.presentations p where p.shared_from = target_id) then
    return;
  end if;
  perform public.count_click('share');
  delete from public.presentations p where p.shared_from = target_id;
end;
$$;

revoke execute on function public.unshare_presentation(text) from public, anon;
grant execute on function public.unshare_presentation(text) to authenticated;
