-- Tags: short keywords saying what a presentation is about, e.g. {fractions, addition}. Teachers add them in
-- the Details panel (and Claude when it sends a presentation); the home page search looks in them.

alter table public.presentations add column tags text[] not null default '{}';

-- Same limit as MAX_TAGS in src/lib/schema.ts (each tag's length is checked there with zod).
alter table public.presentations
  add constraint presentations_tags_size check (cardinality(tags) <= 10) not valid;

-- The tags as one line of text ("fractions addition"), so search can find part of a tag with ilike, like the
-- title. Generated: the database keeps it up to date by itself. (array_to_string isn't marked immutable,
-- which a generated column needs, so this small wrapper is. Joining text never changes, so that's safe.)
create function public.tags_text(tags text[])
returns text
language sql
immutable
set search_path = ''
as $$ select array_to_string(tags, ' ') $$;

alter table public.presentations
  add column tags_text text generated always as (public.tags_text(tags)) stored;

-- Same as before (20261001000000_safer_presentation_saves.sql), plus tags. "create or replace" keeps who may run it.
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
  if slide_count = 0 or slide_count > 300 then
    raise exception 'A presentation needs 1 to 300 slides.' using errcode = '22023';
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
    id, title, description, grade, subject, curriculum, learning_competency, author, reference_links, tags,
    is_published, from_admin, created_at, updated_at
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
