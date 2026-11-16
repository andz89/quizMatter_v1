-- A review draft needs its text details (save path review, round 2).
-- check_review_draft let a draft through without a title, description, subject, curriculum or learning competency
-- (the length checks give "unknown" for a missing one, and "unknown" counted as fine). The app always sends them,
-- but a draft sent straight to the API without them saved and submitted, and then the admin's Publish failed with
-- a raw not-null error (publish_review writes them into the presentations row, where they can't be empty). Now
-- such a draft is refused when saved or submitted (22023), like the other table checks.
-- Test: supabase/tests/review_draft_details.sql.

-- Same as before (20261210000200_database_fixes.sql), plus the "missing detail" check. "create or replace" keeps
-- the revoke.
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
end;
$$;
