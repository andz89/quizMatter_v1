-- Element effects (supabase/migrations/20261231002900_element_effects.sql; an element's `effect`, DATA_VERSION 7).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/element_effects.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- ─── Setup (as postgres): a teacher ──────────────────────────────────────────────────────────────────────────
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000f7', 'element-effects-teacher@example.com', '{"first_name": "Effects", "last_name": "Teacher"}');

do $$
begin
  if public.current_data_version() < 7 then
    raise exception 'FAIL: current_data_version() is below 7, so older tabs could save over element effects';
  end if;
end $$;

-- ─── As the teacher ───────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000f7', 'role', 'authenticated', 'aal', 'aal2')::text, true);

-- A blank slide with an element effect, saved by the new app (version 7).
select set_config('test.saved_at', public.save_presentation(
  presentation => '{
    "id": "test-element-effects", "title": "Element effects", "description": "", "grades": [], "subject": "", "term": "",
    "week": "", "day": "", "curriculum": "", "learningCompetency": "", "author": "", "referenceLinks": [], "tags": [],
    "transition": "slide", "transitionSpeed": 3, "isPublished": false, "fromAdmin": false, "createdAt": 1790000000000,
    "slides": [
      {"id": "s1", "type": "blank", "question": "", "layout": "grid", "questionHeight": 100, "correctOptionId": null,
       "options": [{"id": "o1", "text": ""}, {"id": "o2", "text": ""}, {"id": "o3", "text": ""}, {"id": "o4", "text": ""}],
       "elements": [{"id": "e1", "assetId": "star", "x": 0, "y": 0, "width": 100, "height": 100, "color": "#000000",
                     "containerId": null, "effect": {"type": "pop", "order": 1, "speed": 3}}]}
    ]
  }'::jsonb,
  slide_ids => array['s1'],
  base_updated_at => null::bigint,
  app_version => 7
)::text, true);

do $$
begin
  if (select s.data #> '{elements,0,effect}' from public.slides s
      where s.presentation_id = 'test-element-effects' and s.id = 's1')
     is distinct from '{"type": "pop", "order": 1, "speed": 3}'::jsonb then
    raise exception 'FAIL: the save lost the element''s effect';
  end if;
  if (select p.data_version from public.presentations p where p.id = 'test-element-effects') is distinct from 7 then
    raise exception 'FAIL: a save from the app with element effects wasn''t stored as version 7';
  end if;
end $$;

-- An older tab (version 6, which doesn't know effects) saving the slide without them is refused.
do $$
begin
  perform public.save_presentation(
    presentation => '{
      "id": "test-element-effects", "title": "Element effects", "description": "", "grades": [], "subject": "",
      "term": "", "week": "", "day": "", "curriculum": "", "learningCompetency": "", "author": "", "referenceLinks": [],
      "tags": [], "transition": "slide", "transitionSpeed": 3, "isPublished": false, "fromAdmin": false,
      "createdAt": 1790000000000,
      "slides": [{"id": "s1", "type": "blank", "question": "", "layout": "grid", "questionHeight": 100,
        "correctOptionId": null,
        "options": [{"id": "o1", "text": ""}, {"id": "o2", "text": ""}, {"id": "o3", "text": ""}, {"id": "o4", "text": ""}],
        "elements": [{"id": "e1", "assetId": "star", "x": 0, "y": 0, "width": 100, "height": 100, "color": "#000000",
                      "containerId": null}]}]
    }'::jsonb,
    slide_ids => array['s1'],
    base_updated_at => current_setting('test.saved_at')::bigint,
    app_version => 6
  );
  raise exception 'FAIL: an older tab saved over the element effects';
exception when sqlstate 'QMOLD' then
  null;
end $$;

reset role;
rollback;
