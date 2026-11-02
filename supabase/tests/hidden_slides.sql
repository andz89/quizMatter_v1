-- Hidden slides (supabase/migrations/20261231000500_hidden_slides.sql; the slide's `hidden` field, DATA_VERSION 1).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/hidden_slides.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- ─── Setup (as postgres): a teacher ──────────────────────────────────────────────────────────────────────────
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000e1', 'hidden-teacher@example.com', '{"first_name": "Hidden", "last_name": "Teacher"}');

do $$
begin
  if public.current_data_version() < 1 then
    raise exception 'FAIL: current_data_version() is below 1, so older tabs could save over a hidden slide';
  end if;
end $$;

-- ─── As the teacher ───────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000e1', 'role', 'authenticated')::text, true);

-- A new presentation: s1 shown (it has a question, so it can be published), s2 hidden. The save time is kept for the
-- next saves.
select set_config('test.saved_at', public.save_presentation(
  presentation => '{
    "id": "test-hidden-a", "title": "Hidden A", "description": "", "grades": [], "subject": "", "term": "",
    "week": "", "day": "", "curriculum": "", "learningCompetency": "", "author": "", "referenceLinks": [], "tags": [],
    "transition": "slide", "transitionSpeed": 3, "isPublished": false, "fromAdmin": false, "createdAt": 1790000000000,
    "slides": [
      {"id": "s1", "type": "blank", "elements": [], "question": "What is 1 + 1?"},
      {"id": "s2", "type": "blank", "elements": [], "question": "Hide me", "hidden": true}
    ]
  }'::jsonb,
  slide_ids => array['s1', 's2'],
  base_updated_at => null::bigint,
  app_version => 1
)::text, true);

do $$
begin
  if (select (s.data ->> 'hidden')::boolean from public.slides s
      where s.presentation_id = 'test-hidden-a' and s.id = 's2') is distinct from true then
    raise exception 'FAIL: the save lost the slide''s hidden mark';
  end if;
  if (select s.data ? 'hidden' from public.slides s where s.presentation_id = 'test-hidden-a' and s.id = 's1') then
    raise exception 'FAIL: a shown slide got a hidden mark';
  end if;
  if (select p.data_version from public.presentations p where p.id = 'test-hidden-a') is distinct from 1 then
    raise exception 'FAIL: a save from the app with hidden slides wasn''t stored as version 1';
  end if;
end $$;

-- Publish: the shared copy carries the hidden mark, so it stays hidden there too.
select public.share_presentation(target_id => 'test-hidden-a');

do $$
begin
  if (select (s.data ->> 'hidden')::boolean
      from public.slides s join public.presentations p on p.id = s.presentation_id
      where p.shared_from = 'test-hidden-a' and s.id = 's2') is distinct from true then
    raise exception 'FAIL: the shared copy lost the slide''s hidden mark';
  end if;
end $$;

-- An older tab (version 0, which doesn't know `hidden`) saving the slide without it is refused, so it can't show the
-- slide again by accident.
do $$
begin
  perform public.save_presentation(
    presentation => '{
      "id": "test-hidden-a", "title": "Hidden A", "description": "", "grades": [], "subject": "", "term": "",
      "week": "", "day": "", "curriculum": "", "learningCompetency": "", "author": "", "referenceLinks": [],
      "tags": [], "transition": "slide", "transitionSpeed": 3, "isPublished": false, "fromAdmin": false,
      "createdAt": 1790000000000,
      "slides": [{"id": "s2", "type": "blank", "elements": [], "question": "Hide me"}]
    }'::jsonb,
    slide_ids => array['s1', 's2'],
    base_updated_at => current_setting('test.saved_at')::bigint,
    app_version => 0
  );
  raise exception 'FAIL: an older tab saved over a hidden slide';
exception when sqlstate 'QMOLD' then
  null;
end $$;

do $$
begin
  if (select (s.data ->> 'hidden')::boolean from public.slides s
      where s.presentation_id = 'test-hidden-a' and s.id = 's2') is distinct from true then
    raise exception 'FAIL: the refused older save still changed the hidden slide';
  end if;
end $$;

-- Show slide: the app sends only that slide, without the field (= shown).
select public.save_presentation(
  presentation => '{
    "id": "test-hidden-a", "title": "Hidden A", "description": "", "grades": [], "subject": "", "term": "",
    "week": "", "day": "", "curriculum": "", "learningCompetency": "", "author": "", "referenceLinks": [],
    "tags": [], "transition": "slide", "transitionSpeed": 3, "isPublished": false, "fromAdmin": false,
    "createdAt": 1790000000000,
    "slides": [{"id": "s2", "type": "blank", "elements": [], "question": "Hide me"}]
  }'::jsonb,
  slide_ids => array['s1', 's2'],
  base_updated_at => current_setting('test.saved_at')::bigint,
  app_version => 1
);

do $$
begin
  if (select s.data ? 'hidden' from public.slides s where s.presentation_id = 'test-hidden-a' and s.id = 's2') then
    raise exception 'FAIL: showing the slide again didn''t save';
  end if;
  if (select count(*) from public.slides s where s.presentation_id = 'test-hidden-a') <> 2 then
    raise exception 'FAIL: saving only the changed slide lost the other one';
  end if;
end $$;

reset role;
rollback;
