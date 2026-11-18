-- Option row heights (supabase/migrations/20261231002100_option_row_heights.sql; an option's `rowSize` and a slide's
-- `gridRowSizes`, DATA_VERSION 6).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/option_row_heights.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- ─── Setup (as postgres): a teacher ──────────────────────────────────────────────────────────────────────────
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000f6', 'option-rows-teacher@example.com', '{"first_name": "Rows", "last_name": "Teacher"}');

do $$
begin
  if public.current_data_version() < 6 then
    raise exception 'FAIL: current_data_version() is below 6, so older tabs could save over option row sizes';
  end if;
end $$;

-- ─── As the teacher ───────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000f6', 'role', 'authenticated', 'aal', 'aal2')::text, true);

-- A choice slide with row sizes, saved by the new app (version 6).
select set_config('test.saved_at', public.save_presentation(
  presentation => '{
    "id": "test-option-rows-a", "title": "Option rows A", "description": "", "grades": [], "subject": "", "term": "",
    "week": "", "day": "", "curriculum": "", "learningCompetency": "", "author": "", "referenceLinks": [], "tags": [],
    "transition": "slide", "transitionSpeed": 3, "isPublished": false, "fromAdmin": false, "createdAt": 1790000000000,
    "slides": [
      {"id": "s1", "type": "choice", "question": "Which?", "layout": "list", "questionHeight": 160, "elements": [],
       "correctOptionId": "o1", "gridRowSizes": [1, 2],
       "options": [
         {"id": "o1", "text": "A long answer", "rowSize": 2.5},
         {"id": "o2", "text": "B", "rowSize": 1},
         {"id": "o3", "text": "C", "rowSize": 1},
         {"id": "o4", "text": "D", "rowSize": 1}
       ]}
    ]
  }'::jsonb,
  slide_ids => array['s1'],
  base_updated_at => null::bigint,
  app_version => 6
)::text, true);

do $$
begin
  if (select s.data #>> '{options,0,rowSize}' from public.slides s
      where s.presentation_id = 'test-option-rows-a' and s.id = 's1')
     is distinct from '2.5' then
    raise exception 'FAIL: the save lost an option''s rowSize';
  end if;
  if (select s.data #> '{gridRowSizes}' from public.slides s
      where s.presentation_id = 'test-option-rows-a' and s.id = 's1')
     is distinct from '[1, 2]'::jsonb then
    raise exception 'FAIL: the save lost the grid''s row sizes';
  end if;
  if (select p.data_version from public.presentations p where p.id = 'test-option-rows-a') is distinct from 6 then
    raise exception 'FAIL: a save from the app with row sizes wasn''t stored as version 6';
  end if;
end $$;

-- An older tab (version 5, which doesn't know row sizes) saving the slide without them is refused.
do $$
begin
  perform public.save_presentation(
    presentation => '{
      "id": "test-option-rows-a", "title": "Option rows A", "description": "", "grades": [], "subject": "", "term": "",
      "week": "", "day": "", "curriculum": "", "learningCompetency": "", "author": "", "referenceLinks": [],
      "tags": [], "transition": "slide", "transitionSpeed": 3, "isPublished": false, "fromAdmin": false,
      "createdAt": 1790000000000,
      "slides": [{"id": "s1", "type": "choice", "question": "Which?", "layout": "list", "questionHeight": 160,
        "elements": [], "correctOptionId": "o1",
        "options": [{"id": "o1", "text": "A long answer"}, {"id": "o2", "text": "B"}, {"id": "o3", "text": "C"},
                    {"id": "o4", "text": "D"}]}]
    }'::jsonb,
    slide_ids => array['s1'],
    base_updated_at => current_setting('test.saved_at')::bigint,
    app_version => 5
  );
  raise exception 'FAIL: an older tab saved over the option row sizes';
exception when sqlstate 'QMOLD' then
  null;
end $$;

reset role;
rollback;
