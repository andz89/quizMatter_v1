-- Each tag, reference and grade has a length limit (save path review, round 3).
-- zod (src/lib/schema.ts) refuses a tag over 30 characters (tagsSchema), a reference over 500 (referenceSchema) and
-- a grade over 40 (DETAIL_MAX_LENGTH.grade), but the database only counted them (presentations_tags_size,
-- presentations_details_size, presentations_grades_size). So a save sent straight to the API could keep a huge one,
-- shown on every card and search, and the presentation then couldn't open (zod refuses it there too). Now the table
-- refuses them, and so does a review draft, which publish_review writes into the table.
-- The app never sends one (zod is stricter: it counts UTF-16 units, the database counts characters).
-- Test: supabase/tests/detail_item_lengths.sql.

-- Whether every text in the list is at most max_length characters (an empty or missing list is fine).
create function public.texts_fit(items text[], max_length int)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(char_length(item) <= max_length), true) from unnest(items) as item;
$$;
-- Like grades_from and tags_text: the table's check runs it as the saver, so logged-in users keep it.
revoke execute on function public.texts_fit(text[], int) from public, anon;
grant execute on function public.texts_fit(text[], int) to authenticated;

-- Not valid, like the table's other size checks: rows saved before aren't checked now, but every new row and
-- every change is.
alter table public.presentations
  add constraint presentations_item_lengths check (
    public.texts_fit(tags, 30) and public.texts_fit(reference_links, 500) and public.texts_fit(grades, 40)
  ) not valid;

-- Same as before (20261231001700_review_draft_details.sql), plus the item lengths at the end. "create or replace"
-- keeps the revoke.
create or replace function public.check_review_draft(target_id text, review_draft jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  slide_count int := jsonb_array_length(coalesce(review_draft -> 'slides', '[]'));
begin
  if review_draft ->> 'id' is distinct from target_id then
    raise exception 'The draft is for another presentation.' using errcode = '22023';
  end if;
  if slide_count = 0 or slide_count > 100 then
    raise exception 'A presentation needs 1 to 100 slides.' using errcode = '22023';
  end if;
  if octet_length(review_draft::text) > 5000000 then
    raise exception 'The draft is too big.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(review_draft -> 'slides') as slide
    where jsonb_typeof(slide) <> 'object' or coalesce(slide ->> 'id', '') = '' or octet_length(slide::text) > 2000000
  ) or (
    select count(distinct slide ->> 'id') from jsonb_array_elements(review_draft -> 'slides') as slide
  ) <> slide_count then
    raise exception 'Every slide needs its own id and must be at most 2 MB.' using errcode = '22023';
  end if;
  -- publish_review writes these into the presentations row, where none may be empty (null). Term, week, day,
  -- links, tags and the slide effect get a default there, so they may be missing.
  if (review_draft ->> 'title') is null
    or (review_draft ->> 'description') is null
    or (review_draft ->> 'subject') is null
    or (review_draft ->> 'curriculum') is null
    or (review_draft ->> 'learningCompetency') is null then
    raise exception 'The draft is missing a detail (title, description, subject, curriculum or learning competency).'
      using errcode = '22023';
  end if;
  if not coalesce(
    char_length(review_draft ->> 'title') <= 120
      and char_length(review_draft ->> 'description') <= 1000
      and char_length(review_draft ->> 'subject') <= 80
      and char_length(coalesce(review_draft ->> 'term', '')) <= 40
      and char_length(coalesce(review_draft ->> 'week', '')) <= 40
      and char_length(coalesce(review_draft ->> 'day', '')) <= 40
      and char_length(review_draft ->> 'curriculum') <= 80
      and char_length(review_draft ->> 'learningCompetency') <= 1000
      and jsonb_array_length(coalesce(review_draft -> 'referenceLinks', '[]')) <= 20,
    true
  ) then
    raise exception 'A detail of the draft is too long.' using errcode = '22023';
  end if;
  -- Same limits as MAX_TAGS, MAX_GRADES, SLIDE_TRANSITIONS and SLIDE_EFFECT_SPEED_MIN / _MAX in src/lib/schema.ts
  -- (and the presentations table's checks). A missing one gets publish_review's default, so it passes. The speed is
  -- compared as text, so "2.5" or "fast" is refused here instead of breaking publish_review's number cast.
  if jsonb_array_length(coalesce(review_draft -> 'tags', '[]')) > 10
    or cardinality(public.grades_from(review_draft)) > 14
    or coalesce(review_draft ->> 'transition', 'slide') not in ('none', 'fade', 'slide', 'zoom')
    or coalesce(review_draft ->> 'transitionSpeed', '3') not in ('1', '2', '3', '4', '5') then
    raise exception 'The draft has too many tags or grades, or a slide effect that doesn''t exist.'
      using errcode = '22023';
  end if;
  -- New: each one's length, the same as presentations_item_lengths (and zod).
  if not (
    public.texts_fit(array(select jsonb_array_elements_text(coalesce(review_draft -> 'tags', '[]'))), 30)
    and public.texts_fit(array(select jsonb_array_elements_text(coalesce(review_draft -> 'referenceLinks', '[]'))), 500)
    and public.texts_fit(public.grades_from(review_draft), 40)
  ) then
    raise exception 'A tag, reference or grade of the draft is too long.' using errcode = '22023';
  end if;
end;
$$;
