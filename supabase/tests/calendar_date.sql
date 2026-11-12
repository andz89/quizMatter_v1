-- Calendar dates (supabase/migrations/20261231000800_calendar_date.sql; an element's `calendarDate`, DATA_VERSION 2).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/calendar_date.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- ─── Setup (as postgres): a teacher ──────────────────────────────────────────────────────────────────────────
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000e2', 'calendar-teacher@example.com', '{"first_name": "Calendar", "last_name": "Teacher"}');

do $$
begin
  if public.current_data_version() < 2 then
    raise exception 'FAIL: current_data_version() is below 2, so older tabs could save over a calendar''s date';
  end if;
end $$;

-- ─── As the teacher ───────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000e2', 'role', 'authenticated', 'aal', 'aal2')::text, true);

-- A new presentation with a calendar set to 4 November 2026, saved by the new app (version 2).
select set_config('test.saved_at', public.save_presentation(
  presentation => '{
    "id": "test-calendar-a", "title": "Calendar A", "description": "", "grades": [], "subject": "", "term": "",
    "week": "", "day": "", "curriculum": "", "learningCompetency": "", "author": "", "referenceLinks": [], "tags": [],
    "transition": "slide", "transitionSpeed": 3, "isPublished": false, "fromAdmin": false, "createdAt": 1790000000000,
    "slides": [
      {"id": "s1", "type": "blank", "question": "What day is it?", "elements": [
        {"id": "e1", "assetId": "calendar-page", "x": 0, "y": 0, "width": 200, "height": 200, "color": "#6B3DF5",
         "containerId": null, "calendarDate": {"year": 2026, "month": 11, "day": 4}}
      ]}
    ]
  }'::jsonb,
  slide_ids => array['s1'],
  base_updated_at => null::bigint,
  app_version => 2
)::text, true);

do $$
begin
  if (select s.data #> '{elements,0,calendarDate}' from public.slides s
      where s.presentation_id = 'test-calendar-a' and s.id = 's1')
     is distinct from '{"year": 2026, "month": 11, "day": 4}'::jsonb then
    raise exception 'FAIL: the save lost the calendar''s date';
  end if;
  if (select p.data_version from public.presentations p where p.id = 'test-calendar-a') is distinct from 2 then
    raise exception 'FAIL: a save from the app with calendars wasn''t stored as version 2';
  end if;
end $$;

-- An older tab (version 1, which doesn't know `calendarDate`) saving the calendar without it is refused.
do $$
begin
  perform public.save_presentation(
    presentation => '{
      "id": "test-calendar-a", "title": "Calendar A", "description": "", "grades": [], "subject": "", "term": "",
      "week": "", "day": "", "curriculum": "", "learningCompetency": "", "author": "", "referenceLinks": [],
      "tags": [], "transition": "slide", "transitionSpeed": 3, "isPublished": false, "fromAdmin": false,
      "createdAt": 1790000000000,
      "slides": [{"id": "s1", "type": "blank", "question": "What day is it?", "elements": [
        {"id": "e1", "assetId": "calendar-page", "x": 0, "y": 0, "width": 200, "height": 200, "color": "#6B3DF5",
         "containerId": null}
      ]}]
    }'::jsonb,
    slide_ids => array['s1'],
    base_updated_at => current_setting('test.saved_at')::bigint,
    app_version => 1
  );
  raise exception 'FAIL: an older tab saved over a calendar''s date';
exception when sqlstate 'QMOLD' then
  null;
end $$;

do $$
begin
  if (select s.data #> '{elements,0,calendarDate}' from public.slides s
      where s.presentation_id = 'test-calendar-a' and s.id = 's1') is null then
    raise exception 'FAIL: the refused older save still dropped the calendar''s date';
  end if;
end $$;

reset role;
rollback;
