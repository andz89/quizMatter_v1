-- Safer, lighter presentation saves.
--
-- 1. Size limits in the database itself. The app checks every save with zod (presentationSchema) first, but a
--    logged-in user could skip the app and write to these tables directly. These checks stop huge or broken
--    rows there too. "not valid" = only new and changed rows are checked, so old rows can never block anything.
-- 2. save_presentation refuses a save made from an older copy (another tab or device saved in between), instead
--    of silently deleting the newer work.
-- 3. save_presentation only gets the slides that changed, plus every slide id in order. Unchanged slides are
--    not sent again and not rewritten; only their position is updated if it moved.

alter table public.slides
  add constraint slides_data_is_small_object
  check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 2000000) not valid;

-- Same limits as DETAIL_MAX_LENGTH and MAX_REFERENCE_LINKS in src/lib/schema.ts.
alter table public.presentations
  add constraint presentations_details_size
  check (
    char_length(id) <= 100
    and char_length(title) <= 120
    and char_length(description) <= 1000
    and char_length(subject) <= 80
    and char_length(curriculum) <= 80
    and char_length(learning_competency) <= 1000
    and char_length(author) <= 120
    and coalesce(cardinality(reference_links), 0) <= 20
  ) not valid;

drop function public.save_presentation(jsonb);

-- `presentation`: the details, and in `slides` only the slides that changed (all of them for a new presentation).
-- `slide_ids`: every slide's id, in order. `base_updated_at`: when the copy being edited was last saved (Unix ms),
-- or null for a presentation that was never saved. Returns the new save time (Unix ms), the next save's base.
--
-- Errors: QM409 = someone saved a newer copy since `base_updated_at`; QM422 = a slide in `slide_ids` is neither
-- sent nor in the database (the app then saves again with every slide).
create function public.save_presentation(presentation jsonb, slide_ids text[], base_updated_at bigint)
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
    id, title, description, grade, subject, curriculum, learning_competency, author, reference_links, is_published,
    from_admin, created_at, updated_at
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

revoke execute on function public.save_presentation(jsonb, text[], bigint) from public, anon;
grant execute on function public.save_presentation(jsonb, text[], bigint) to authenticated;
