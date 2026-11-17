-- Table cell fills (supabase/migrations/20261231001900_table_cell_fill.sql; a cell's `fill`, DATA_VERSION 4).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/table_cell_fill.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- ─── Setup (as postgres): a teacher ──────────────────────────────────────────────────────────────────────────
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000f4', 'cell-fill-teacher@example.com', '{"first_name": "Fill", "last_name": "Teacher"}');

do $$
begin
  if public.current_data_version() < 4 then
    raise exception 'FAIL: current_data_version() is below 4, so older tabs could save over a cell''s colors';
  end if;
end $$;

-- ─── As the teacher ───────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000f4', 'role', 'authenticated', 'aal', 'aal2')::text, true);

-- A new presentation with a one-cell table whose cell is colored, saved by the new app (version 4).
select set_config('test.saved_at', public.save_presentation(
  presentation => '{
    "id": "test-cell-fill-a", "title": "Cell fill A", "description": "", "grades": [], "subject": "", "term": "",
    "week": "", "day": "", "curriculum": "", "learningCompetency": "", "author": "", "referenceLinks": [], "tags": [],
    "transition": "slide", "transitionSpeed": 3, "isPublished": false, "fromAdmin": false, "createdAt": 1790000000000,
    "slides": [
      {"id": "s1", "type": "blank", "question": "", "elements": [
        {"id": "e1", "assetId": "table", "x": 0, "y": 0, "width": 200, "height": 200, "color": "#6B3DF5",
         "containerId": null, "table": {"rows": [[{"html": "<p>Hi</p>", "fill": "#FF5A5F"}]]}}
      ]}
    ]
  }'::jsonb,
  slide_ids => array['s1'],
  base_updated_at => null::bigint,
  app_version => 4
)::text, true);

do $$
begin
  if (select s.data #>> '{elements,0,table,rows,0,0,fill}' from public.slides s
      where s.presentation_id = 'test-cell-fill-a' and s.id = 's1')
     is distinct from '#FF5A5F' then
    raise exception 'FAIL: the save lost the cell''s fill';
  end if;
  if (select p.data_version from public.presentations p where p.id = 'test-cell-fill-a') is distinct from 4 then
    raise exception 'FAIL: a save from the app with cell fills wasn''t stored as version 4';
  end if;
end $$;

-- An older tab (version 3, which doesn't know `fill`) saving the table without it is refused.
do $$
begin
  perform public.save_presentation(
    presentation => '{
      "id": "test-cell-fill-a", "title": "Cell fill A", "description": "", "grades": [], "subject": "", "term": "",
      "week": "", "day": "", "curriculum": "", "learningCompetency": "", "author": "", "referenceLinks": [],
      "tags": [], "transition": "slide", "transitionSpeed": 3, "isPublished": false, "fromAdmin": false,
      "createdAt": 1790000000000,
      "slides": [{"id": "s1", "type": "blank", "question": "", "elements": [
        {"id": "e1", "assetId": "table", "x": 0, "y": 0, "width": 200, "height": 200, "color": "#6B3DF5",
         "containerId": null, "table": {"rows": [[{"html": "<p>Hi</p>"}]]}}
      ]}]
    }'::jsonb,
    slide_ids => array['s1'],
    base_updated_at => current_setting('test.saved_at')::bigint,
    app_version => 3
  );
  raise exception 'FAIL: an older tab saved over a cell''s colors';
exception when sqlstate 'QMOLD' then
  null;
end $$;

reset role;
rollback;
