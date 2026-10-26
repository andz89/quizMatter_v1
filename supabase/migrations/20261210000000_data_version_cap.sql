-- Data version cap: nobody can push a saved version above the newest one the app knows.
-- Before, save_presentation, save_review_draft and submit_review stored any app_version they were sent, and
-- publish_review (draft → live lesson) and approve_submission (original → approved copy) carried it on. One huge
-- number sent straight to the API made every later save from the app refused (QMOLD), for good.
-- 1. current_data_version(): the newest DATA_VERSION (src/lib/schema.ts) the database knows. 0 today.
-- 2. presentations.data_version and presentation_reviews.draft_version are capped at it on every insert and update,
--    whatever writes them (the app's functions, a direct write to the column). A cap, not a refusal: a forgotten
--    bump can't break saving, the version just isn't raised.
-- 3. save_presentation also refuses (QMOLD) a new presentation copied from one that newer app code saved: an old
--    tab's "Make a copy" would quietly drop the fields it doesn't know.
-- 4. share_presentation gives the shared copy its original's version, so that check also works for copies of
--    another teacher's published presentation.
-- Spec: docs/superpowers/specs/2026-10-24-review-fixes-design.md (C, and B9).
--
-- The trigger functions are security definer: they call current_data_version(), which nobody else may run.

-- ─── 1. The newest version ────────────────────────────────────────────────────────────────────────────────
-- Bump it (create or replace, in a new migration) and apply that BEFORE deploying an app with a higher DATA_VERSION:
-- until then the new app's saves are stored with the old number, so older tabs aren't refused yet. See
-- "Changing the saved shape" in src/lib/CLAUDE.md.
-- "stable", not "immutable": Postgres may keep an immutable function's answer inside a connection's saved query
-- plans, so after a bump some connections would go on capping at the old number.
create function public.current_data_version()
returns int
language sql
stable
set search_path = ''
as $$
  -- Same as DATA_VERSION in src/lib/schema.ts.
  select 0;
$$;

revoke execute on function public.current_data_version() from public, anon, authenticated;

-- ─── 2. The cap ───────────────────────────────────────────────────────────────────────────────────────────
create function public.cap_presentation_data_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.data_version := least(new.data_version, public.current_data_version());
  return new;
end;
$$;

revoke execute on function public.cap_presentation_data_version() from public, anon, authenticated;

create trigger cap_presentation_data_version
  before insert or update on public.presentations
  for each row execute function public.cap_presentation_data_version();

create function public.cap_review_draft_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.draft_version := least(new.draft_version, public.current_data_version());
  return new;
end;
$$;

revoke execute on function public.cap_review_draft_version() from public, anon, authenticated;

create trigger cap_review_draft_version
  before insert or update on public.presentation_reviews
  for each row execute function public.cap_review_draft_version();

-- ─── 3. save_presentation: same as before (20261209000000_data_version.sql), plus the copy check ──────────
-- "create or replace" keeps who may run it.
create or replace function public.save_presentation(presentation jsonb, slide_ids text[], base_updated_at bigint, app_version int default 0)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_id text := presentation ->> 'id';
  saved_updated_at timestamptz;
  saved_version int;
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
  -- Only an old app tab sends a teacher's presentation as published (today's app publishes with share_presentation).
  if not coalesce((presentation ->> 'fromAdmin')::boolean, false) and coalesce((presentation ->> 'isPublished')::boolean, false) then
    raise exception 'Reload the page to publish: publishing makes a shared copy now.' using errcode = '42501';
  end if;

  -- Locked until the save ends, so two saves of the same presentation can't cross.
  select p.updated_at, p.data_version into saved_updated_at, saved_version
  from public.presentations p where p.id = target_id for update;
  -- Checked before the conflict below, so an old tab always gets this one (the app keeps its work).
  if found and coalesce(app_version, 0) < saved_version then
    raise exception 'QuizMatter was updated. Reload the page.' using errcode = 'QMOLD';
  end if;
  if found and (base_updated_at is null or floor(extract(epoch from saved_updated_at) * 1000)::bigint <> base_updated_at) then
    raise exception 'This presentation was saved somewhere else since it was opened.' using errcode = 'QM409';
  end if;
  -- A new presentation copied from one that newer app code saved (Make a copy in an old tab): the copy would lose
  -- the fields this tab doesn't know. Only a source the saver can read counts (this runs as the saver), the same
  -- as keep_copied_from.
  if not found and exists (
    select 1 from public.presentations src
    where src.id = nullif(presentation ->> 'copiedFrom', '') and src.data_version > coalesce(app_version, 0)
  ) then
    raise exception 'QuizMatter was updated. Reload the page.' using errcode = 'QMOLD';
  end if;

  insert into public.presentations (
    id, title, description, grades, subject, term, week, day, curriculum, learning_competency, author, reference_links, tags, transition,
    transition_speed, is_published, from_admin, created_at, updated_at, copied_from, data_version
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
    now(),
    -- Make a copy sends where it was copied from (only on the first save; later saves never change it, see
    -- keep_copied_from). A teacher's other saves send none.
    nullif(presentation ->> 'copiedFrom', ''),
    coalesce(app_version, 0)
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
    data_version = greatest(public.presentations.data_version, excluded.data_version),
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

-- ─── 4. share_presentation: same as before (20261124000000_shared_copy_moderation.sql), plus the version ────
-- The shared copy has the original's slides, so the original's version too (the cap above still bounds it). Before,
-- every copy stayed at 0, so the copy check in section 3 never refused "Make a copy" of another teacher's published
-- presentation (always a shared copy). "create or replace" keeps who may run it.
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
  if original.hidden_at is not null then
    raise exception 'QuizMatter hid this presentation, so it can''t be shared.' using errcode = '42501';
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
      created_at, updated_at, data_version
    )
    values (
      copy_id, original.owner_id, original.title, original.description, original.grades, original.subject,
      original.term, original.week, original.day, original.curriculum, original.learning_competency, original.author,
      original.reference_links, original.tags, original.transition, original.transition_speed, true, false,
      target_id, now(), now(), now(), original.data_version
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
