-- Several grades per presentation (e.g. Grade 1 and Grade 2): `grade` (text) becomes `grades` (text[]). A grade
-- becomes a one-item list, none becomes {}. Changing the column's type doesn't fire the review lock triggers, so
-- presentations under review convert too. Subject stays one.

alter table public.presentations alter column grade drop default;
alter table public.presentations
  alter column grade type text[] using (case when grade is null or grade = '' then '{}'::text[] else array[grade] end);
alter table public.presentations rename column grade to grades;
alter table public.presentations alter column grades set default '{}';
alter table public.presentations alter column grades set not null;

-- Same limit as MAX_GRADES in src/lib/schema.ts (the 13 list grades + one of the teacher's own; zod checks first).
alter table public.presentations
  add constraint presentations_grades_size check (cardinality(grades) <= 14);

-- The grades in a presentation's details: `grades` (a list), or an older single `grade` (an editor tab opened
-- before this change, or a review draft saved before it). "" = none.
create function public.grades_from(details jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(details -> 'grades') = 'array' then array(select jsonb_array_elements_text(details -> 'grades'))
    when coalesce(details ->> 'grade', '') <> '' then array[details ->> 'grade']
    else '{}'::text[]
  end;
$$;

-- Same as before (20261011000000_lower_limits.sql), with `grades` instead of `grade`.
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
    id, title, description, grades, subject, curriculum, learning_competency, author, reference_links, tags, transition,
    transition_speed, is_published, from_admin, created_at, updated_at
  )
  values (
    target_id,
    presentation ->> 'title',
    presentation ->> 'description',
    public.grades_from(presentation),
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
    grades = excluded.grades,
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

-- Same as before (20261022000000_review_fixes.sql), with `grades` instead of `grade` (a review draft saved before
-- this change has `grade`; grades_from reads either).
create or replace function public.publish_review(target_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  review public.presentation_reviews;
  d jsonb;
  f jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only admins can publish reviews.' using errcode = '42501';
  end if;
  select * into review from public.presentation_reviews r where r.presentation_id = target_id for update;
  if not found or review.status is distinct from 'submitted' or review.reviewer_id is null then
    raise exception 'This review isn''t waiting to be published.' using errcode = 'QMRVW';
  end if;
  if exists (select 1 from public.banned_users b where b.user_id = review.reviewer_id) then
    raise exception 'This reviewer is banned, so their review can''t be published.' using errcode = 'QMBRV';
  end if;
  d := review.draft;
  f := review.submitted_fields;

  -- Lets the lock triggers through for these changes only (until this transaction ends).
  perform set_config('quizmatter.publishing_review', 'yes', true);

  update public.presentations p set
    title = d ->> 'title',
    description = d ->> 'description',
    grades = public.grades_from(d),
    subject = d ->> 'subject',
    curriculum = d ->> 'curriculum',
    learning_competency = d ->> 'learningCompetency',
    reference_links = array(select jsonb_array_elements_text(d -> 'referenceLinks')),
    tags = array(select jsonb_array_elements_text(coalesce(d -> 'tags', '[]'))),
    transition = coalesce(d ->> 'transition', 'slide'),
    transition_speed = coalesce((d ->> 'transitionSpeed')::smallint, 3),
    updated_at = now()
  where p.id = target_id;

  delete from public.slides s
  where s.presentation_id = target_id
    and s.id not in (select slide ->> 'id' from jsonb_array_elements(d -> 'slides') as slide);

  insert into public.slides (presentation_id, id, position, data)
  select target_id, slide ->> 'id', (ord - 1)::int, slide
  from jsonb_array_elements(d -> 'slides') with ordinality as t(slide, ord)
  on conflict (presentation_id, id) do update set position = excluded.position, data = excluded.data;

  perform set_config('quizmatter.publishing_review', '', true);

  insert into public.presentation_reviewers (
    presentation_id, reviewer_id, name, email, background, reviewed_on, approved_by, approved_at
  )
  values (
    target_id, review.reviewer_id, f ->> 'name', f ->> 'email', f ->> 'background', (f ->> 'reviewedOn')::date,
    auth.uid(), now()
  )
  on conflict (presentation_id, reviewer_id) do update set
    name = excluded.name,
    email = excluded.email,
    background = excluded.background,
    reviewed_on = excluded.reviewed_on,
    approved_by = excluded.approved_by,
    approved_at = excluded.approved_at;

  update public.presentation_reviews set
    status = 'published',
    ended_at = now(),
    last_reviewer_id = review.reviewer_id,
    draft = null,
    draft_updated_at = null,
    submitted_fields = null,
    admin_note = null
  where presentation_id = target_id;
end;
$$;

-- Same as before (20261027000000_browse_counts.sql), but a presentation counts once for each of its grades.
create or replace function public.browse_counts()
returns table (grade text, subject text, count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select g.grade, p.subject, count(*)
  from public.presentations p
  cross join lateral unnest(p.grades) as g(grade)
  where p.is_published and p.hidden_at is null and p.owner_id <> auth.uid() and p.subject <> ''
  group by g.grade, p.subject;
$$;
