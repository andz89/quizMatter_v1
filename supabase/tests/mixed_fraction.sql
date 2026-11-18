-- Mixed fraction (supabase/migrations/20261231002000_mixed_fraction.sql; a mixed fraction's `whole`, DATA_VERSION 5).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/mixed_fraction.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- ─── Setup (as postgres): a teacher ──────────────────────────────────────────────────────────────────────────
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000f5', 'mixed-fraction-teacher@example.com', '{"first_name": "Mixed", "last_name": "Teacher"}');

do $$
begin
  if public.current_data_version() < 5 then
    raise exception 'FAIL: current_data_version() is below 5, so older tabs could save over a mixed fraction''s whole number';
  end if;
end $$;

-- ─── As the teacher ───────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000f5', 'role', 'authenticated', 'aal', 'aal2')::text, true);

-- A new presentation with a mixed fraction 2 3/4, saved by the new app (version 5).
select set_config('test.saved_at', public.save_presentation(
  presentation => '{
    "id": "test-mixed-fraction-a", "title": "Mixed fraction A", "description": "", "grades": [], "subject": "", "term": "",
    "week": "", "day": "", "curriculum": "", "learningCompetency": "", "author": "", "referenceLinks": [], "tags": [],
    "transition": "slide", "transitionSpeed": 3, "isPublished": false, "fromAdmin": false, "createdAt": 1790000000000,
    "slides": [
      {"id": "s1", "type": "blank", "question": "", "elements": [
        {"id": "e1", "assetId": "mixed-fraction", "x": 0, "y": 0, "width": 170, "height": 100, "color": "#191A2C",
         "containerId": null, "fraction": {"whole": 2, "shaded": 3, "parts": 4}}
      ]}
    ]
  }'::jsonb,
  slide_ids => array['s1'],
  base_updated_at => null::bigint,
  app_version => 5
)::text, true);

do $$
begin
  if (select s.data #>> '{elements,0,fraction,whole}' from public.slides s
      where s.presentation_id = 'test-mixed-fraction-a' and s.id = 's1')
     is distinct from '2' then
    raise exception 'FAIL: the save lost the whole number';
  end if;
  if (select p.data_version from public.presentations p where p.id = 'test-mixed-fraction-a') is distinct from 5 then
    raise exception 'FAIL: a save from the app with mixed fractions wasn''t stored as version 5';
  end if;
end $$;

-- An older tab (version 4, which doesn't know `whole`) saving the fraction without it is refused.
do $$
begin
  perform public.save_presentation(
    presentation => '{
      "id": "test-mixed-fraction-a", "title": "Mixed fraction A", "description": "", "grades": [], "subject": "", "term": "",
      "week": "", "day": "", "curriculum": "", "learningCompetency": "", "author": "", "referenceLinks": [],
      "tags": [], "transition": "slide", "transitionSpeed": 3, "isPublished": false, "fromAdmin": false,
      "createdAt": 1790000000000,
      "slides": [{"id": "s1", "type": "blank", "question": "", "elements": [
        {"id": "e1", "assetId": "mixed-fraction", "x": 0, "y": 0, "width": 170, "height": 100, "color": "#191A2C",
         "containerId": null, "fraction": {"shaded": 3, "parts": 4}}
      ]}]
    }'::jsonb,
    slide_ids => array['s1'],
    base_updated_at => current_setting('test.saved_at')::bigint,
    app_version => 4
  );
  raise exception 'FAIL: an older tab saved over a mixed fraction''s whole number';
exception when sqlstate 'QMOLD' then
  null;
end $$;

reset role;
rollback;
