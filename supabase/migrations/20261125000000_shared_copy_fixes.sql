-- Shared copy, small fixes (after 20261124000000_shared_copy_moderation.sql).
--
-- 1. An app tab opened before shared copies (still running the old code) "published" by saving the presentation
--    with isPublished = true. save_presentation quietly saved it private, and the old tab said "published" though
--    nothing was shared. Now that save is refused, so the old tab says it couldn't change it (a reload fixes it).
-- 2. Move to QuizMatter (a presentation becomes from_admin): its shared copy goes in the same step, so the move and
--    the removal happen together or not at all.

-- ─── 1. save_presentation: same as before (20261123000000_shared_copy.sql), refuses isPublished from old tabs ───
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
  -- Only an old app tab sends a teacher's presentation as published (today's app publishes with share_presentation).
  if not coalesce((presentation ->> 'fromAdmin')::boolean, false) and coalesce((presentation ->> 'isPublished')::boolean, false) then
    raise exception 'Reload the page to publish: publishing makes a shared copy now.' using errcode = '42501';
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

-- ─── 2. Move to QuizMatter removes the shared copy ────────────────────────────────────────────────────────────
-- A QuizMatter presentation has no shared copy (its Shared switch is on the presentation itself). Only an admin
-- moves one, so a hidden copy may go too (check_hidden_copy_delete).
create function public.remove_copy_of_quizmatter_presentation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.presentations p where p.shared_from = new.id;
  return null;
end;
$$;

revoke execute on function public.remove_copy_of_quizmatter_presentation() from public, anon;

create trigger remove_copy_of_quizmatter_presentation
  after update of from_admin on public.presentations
  for each row when (new.from_admin and not old.from_admin)
  execute function public.remove_copy_of_quizmatter_presentation();
