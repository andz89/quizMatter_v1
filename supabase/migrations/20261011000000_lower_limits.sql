-- Lower limits: at most 100 slides per presentation (was 300) and 50 presentations per teacher (was 100; admins
-- still have no limit). No saved presentation or teacher was over the new limits when this was written.
--
-- Error codes the app shows a message for: QMMAX = too many presentations.

-- ─── 1. At most 50 presentations per teacher ───────────────────────────────────────────────────────────────
-- Same as before (20261001010000_limits_and_reports.sql), with 50 instead of 100.

create or replace function public.check_presentation_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if public.is_admin() then
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
  if (select count(*) from public.presentations p where p.owner_id = new.owner_id) >= 50 then
    raise exception 'You have 50 presentations, the most allowed.' using errcode = 'QMMAX';
  end if;
  return new;
end;
$$;

-- ─── 2. At most 100 slides per presentation ────────────────────────────────────────────────────────────────
-- Same as before (20261008000000_presentation_transition_speed.sql), with 100 slides instead of 300.
-- `presentation`: the details, and in `slides` only the slides that changed (all of them for a new presentation).
-- `slide_ids`: every slide's id, in order. `base_updated_at`: when the copy being edited was last saved (Unix ms),
-- or null for a presentation that was never saved. Returns the new save time (Unix ms), the next save's base.
--
-- Errors: QM409 = someone saved a newer copy since `base_updated_at`; QM422 = a slide in `slide_ids` is neither
-- sent nor in the database (the app then saves again with every slide).
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
    id, title, description, grade, subject, curriculum, learning_competency, author, reference_links, tags, transition,
    transition_speed, is_published, from_admin, created_at, updated_at
  )
  values (
    target_id,
    presentation ->> 'title',
    presentation ->> 'description',
    presentation ->> 'grade',
    presentation ->> 'subject',
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
    (presentation ->> 'isPublished')::boolean,
    coalesce((presentation ->> 'fromAdmin')::boolean, false),
    to_timestamp((presentation ->> 'createdAt')::bigint / 1000.0),
    now()
  )
  on conflict (id) do update set
    title = excluded.title,
    description = excluded.description,
    grade = excluded.grade,
    subject = excluded.subject,
    curriculum = excluded.curriculum,
    learning_competency = excluded.learning_competency,
    author = excluded.author,
    reference_links = excluded.reference_links,
    tags = excluded.tags,
    transition = excluded.transition,
    transition_speed = excluded.transition_speed,
    is_published = excluded.is_published,
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
