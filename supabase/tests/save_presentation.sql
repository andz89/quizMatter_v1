-- save_presentation (supabase/migrations/20261001000000_safer_presentation_saves.sql, newest in
-- 20261210000000_data_version_cap.sql): the one-step save, QM409 (a newer save exists), QM422 (a listed slide is
-- missing), the slide delete, the input checks, and that nobody saves someone else's presentation.
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/save_presentation.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- ─── Setup (as postgres): two teachers, and a helper that builds what the app sends ──────────────────────────
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000b1', 'save-teacher@example.com', '{"first_name": "Save", "last_name": "Teacher"}'),
  ('00000000-0000-4000-8000-0000000000b2', 'save-other@example.com', '{"first_name": "Save", "last_name": "Other"}');

-- The details the app sends with every save (presentationSchema), plus the given slides and overrides.
create function pg_temp.pres(title text, slides jsonb, extra jsonb default '{}')
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'id', 'test-save-a', 'title', title, 'description', '', 'grades', '[]'::jsonb, 'subject', '', 'term', '',
    'week', '', 'day', '', 'curriculum', '', 'learningCompetency', '', 'author', '', 'referenceLinks', '[]'::jsonb,
    'tags', '[]'::jsonb, 'transition', 'slide', 'transitionSpeed', 3, 'isPublished', false, 'fromAdmin', false,
    'createdAt', 1790000000000, 'slides', slides
  ) || extra;
$$;

-- ─── As the teacher ───────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000b1', 'role', 'authenticated', 'aal', 'aal2')::text, true);

-- A new presentation with three slides. The save time is kept as the next save's base.
select set_config('test.saved_at', public.save_presentation(
  presentation => pg_temp.pres('Save A', '[
    {"id": "s1", "type": "blank", "elements": [], "question": "One"},
    {"id": "s2", "type": "blank", "elements": [], "question": "Two"},
    {"id": "s3", "type": "blank", "elements": [], "question": "Three"}
  ]'),
  slide_ids => array['s1', 's2', 's3'],
  base_updated_at => null::bigint,
  app_version => 0
)::text, true);

do $$
begin
  if (select string_agg(s.id || ':' || (s.data ->> 'question'), ',' order by s.position)
      from public.slides s where s.presentation_id = 'test-save-a') <> 's1:One,s2:Two,s3:Three' then
    raise exception 'FAIL: a new presentation''s slides weren''t saved in order';
  end if;
  if (select floor(extract(epoch from p.updated_at) * 1000)::bigint from public.presentations p where p.id = 'test-save-a')
    <> current_setting('test.saved_at')::bigint then
    raise exception 'FAIL: the returned save time isn''t the row''s updated_at';
  end if;
  if (select p.owner_id from public.presentations p where p.id = 'test-save-a') <> '00000000-0000-4000-8000-0000000000b1' then
    raise exception 'FAIL: the new presentation isn''t owned by the saver';
  end if;
end $$;

-- ─── QM409: a save made from an older copy is refused, and changes nothing ────────────────────────────────
-- No base at all (a tab that thinks the presentation is new).
do $$
begin
  perform public.save_presentation(
    presentation => pg_temp.pres('Overwritten', '[]'),
    slide_ids => array['s1'],
    base_updated_at => null::bigint
  );
  raise exception 'FAIL: a save without a base went through on an existing presentation';
exception when sqlstate 'QM409' then
  null;
end $$;

-- A base from before the last save (another tab or device saved since).
do $$
begin
  perform public.save_presentation(
    presentation => pg_temp.pres('Overwritten', '[]'),
    slide_ids => array['s1'],
    base_updated_at => current_setting('test.saved_at')::bigint - 1
  );
  raise exception 'FAIL: a save from an older copy went through';
exception when sqlstate 'QM409' then
  null;
end $$;

do $$
begin
  if (select p.title from public.presentations p where p.id = 'test-save-a') <> 'Save A'
    or (select count(*) from public.slides s where s.presentation_id = 'test-save-a') <> 3 then
    raise exception 'FAIL: a refused save (QM409) still changed the presentation or its slides';
  end if;
end $$;

-- ─── A partial save: only the changed slide is sent, the others keep their data and get their new place ───
select set_config('test.saved_at', public.save_presentation(
  presentation => pg_temp.pres('Save A2', '[{"id": "s2", "type": "blank", "elements": [], "question": "Two!"}]',
    '{"createdAt": 1700000000000}'),
  slide_ids => array['s3', 's1', 's2'],
  base_updated_at => current_setting('test.saved_at')::bigint
)::text, true);

do $$
begin
  if (select string_agg(s.id || ':' || (s.data ->> 'question'), ',' order by s.position)
      from public.slides s where s.presentation_id = 'test-save-a') <> 's3:Three,s1:One,s2:Two!' then
    raise exception 'FAIL: a partial save didn''t keep the unsent slides or their new order';
  end if;
  if (select p.title from public.presentations p where p.id = 'test-save-a') <> 'Save A2' then
    raise exception 'FAIL: a partial save didn''t save the details';
  end if;
  if (select p.created_at from public.presentations p where p.id = 'test-save-a') <> to_timestamp(1790000000) then
    raise exception 'FAIL: a later save changed created_at';
  end if;
end $$;

-- Adding a slide: the new one is sent, the rest only listed.
select set_config('test.saved_at', public.save_presentation(
  presentation => pg_temp.pres('Save A2', '[{"id": "s4", "type": "blank", "elements": [], "question": "Four"}]'),
  slide_ids => array['s3', 's1', 's2', 's4'],
  base_updated_at => current_setting('test.saved_at')::bigint
)::text, true);

-- Deleting a slide: it's left out of the list.
select set_config('test.saved_at', public.save_presentation(
  presentation => pg_temp.pres('Save A2', '[]'),
  slide_ids => array['s3', 's1', 's4'],
  base_updated_at => current_setting('test.saved_at')::bigint
)::text, true);

do $$
begin
  if (select string_agg(s.id || ':' || s.position, ',' order by s.position)
      from public.slides s where s.presentation_id = 'test-save-a') <> 's3:0,s1:1,s4:2' then
    raise exception 'FAIL: adding then deleting a slide didn''t leave s3, s1, s4 in order';
  end if;
end $$;

-- ─── QM422: a listed slide that is neither sent nor saved refuses the whole save ──────────────────────────
-- The list has s9, which doesn't exist: nothing is saved, not even the delete of the slides left out (s1, s4).
do $$
begin
  perform public.save_presentation(
    presentation => pg_temp.pres('Save A3', '[]'),
    slide_ids => array['s3', 's9'],
    base_updated_at => current_setting('test.saved_at')::bigint
  );
  raise exception 'FAIL: a save listing a slide that doesn''t exist went through';
exception when sqlstate 'QM422' then
  null;
end $$;

do $$
begin
  if (select string_agg(s.id, ',' order by s.position) from public.slides s where s.presentation_id = 'test-save-a') <> 's3,s1,s4'
    or (select p.title from public.presentations p where p.id = 'test-save-a') <> 'Save A2' then
    raise exception 'FAIL: a refused save (QM422) still deleted slides or saved the details';
  end if;
end $$;

-- ─── Another device saved since (set up as postgres: a later updated_at) ──────────────────────────────────
reset role;
select set_config('request.jwt.claims', '', true);
update public.presentations set updated_at = updated_at + interval '1 second' where id = 'test-save-a';

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000b1', 'role', 'authenticated', 'aal', 'aal2')::text, true);

do $$
begin
  perform public.save_presentation(
    presentation => pg_temp.pres('Overwritten', '[]'),
    slide_ids => array['s3'],
    base_updated_at => current_setting('test.saved_at')::bigint
  );
  raise exception 'FAIL: a tab opened before another device''s save went through';
exception when sqlstate 'QM409' then
  null;
end $$;

-- The tab that knows the newer time saves.
select set_config('test.saved_at', public.save_presentation(
  presentation => pg_temp.pres('Save A4', '[]'),
  slide_ids => array['s3', 's1', 's4'],
  base_updated_at => current_setting('test.saved_at')::bigint + 1000
)::text, true);

do $$
begin
  if (select p.title from public.presentations p where p.id = 'test-save-a') <> 'Save A4'
    or (select count(*) from public.slides s where s.presentation_id = 'test-save-a') <> 3 then
    raise exception 'FAIL: the save from the newer base didn''t go through';
  end if;
end $$;

-- ─── The input checks (22023, like the zod checks in the app) ─────────────────────────────────────────────
do $$
declare
  bad record;
begin
  for bad in
    select * from (values
      ('no slides', '{}'::text[], '[]'::jsonb),
      ('too many slides', (select array_agg('x' || g) from generate_series(1, 101) g), '[]'::jsonb),
      ('a slide id used twice', array['s3', 's3'], '[]'::jsonb),
      ('a slide id as null', array['s3', null], '[]'::jsonb),
      ('a sent slide missing from slide_ids', array['s3'], '[{"id": "s8", "type": "blank", "elements": []}]'::jsonb)
    ) as t(name, ids, slides)
  loop
    begin
      perform public.save_presentation(
        presentation => pg_temp.pres('Save A4', bad.slides),
        slide_ids => bad.ids,
        base_updated_at => current_setting('test.saved_at')::bigint
      );
      raise exception 'FAIL: % went through', bad.name;
    exception when sqlstate '22023' then
      null;
    end;
  end loop;
end $$;

-- The table's own size checks reach a save too: a 121-character title.
do $$
begin
  perform public.save_presentation(
    presentation => pg_temp.pres(repeat('t', 121), '[]'),
    slide_ids => array['s3', 's1', 's4'],
    base_updated_at => current_setting('test.saved_at')::bigint
  );
  raise exception 'FAIL: a 121-character title was saved';
exception when check_violation then
  null;
end $$;

-- A teacher's presentation can't be saved as published (publishing makes a shared copy with share_presentation).
do $$
begin
  perform public.save_presentation(
    presentation => pg_temp.pres('Save A4', '[]', '{"isPublished": true}'),
    slide_ids => array['s3', 's1', 's4'],
    base_updated_at => current_setting('test.saved_at')::bigint
  );
  raise exception 'FAIL: a teacher saved their presentation as published';
exception when sqlstate '42501' then
  null;
end $$;

-- A teacher can't make a QuizMatter presentation (from_admin), published or not.
do $$
begin
  perform public.save_presentation(
    presentation => pg_temp.pres('Fake lesson', '[{"id": "s1", "type": "blank", "elements": []}]',
      '{"id": "test-save-fake", "fromAdmin": true, "isPublished": true}'),
    slide_ids => array['s1'],
    base_updated_at => null::bigint
  );
  raise exception 'FAIL: a teacher saved a presentation as QuizMatter''s';
exception when sqlstate '42501' then
  null;
end $$;

-- Saying fromAdmin on an existing one is refused too (the "Only admins save admin presentations" policy), so it
-- stays a teacher's, unpublished.
do $$
begin
  perform public.save_presentation(
    presentation => pg_temp.pres('Save A5', '[]', '{"fromAdmin": true, "isPublished": true}'),
    slide_ids => array['s3', 's1', 's4'],
    base_updated_at => current_setting('test.saved_at')::bigint
  );
  raise exception 'FAIL: a teacher saved their presentation as QuizMatter''s';
exception when sqlstate '42501' then
  null;
end $$;

do $$
begin
  if exists (select 1 from public.presentations p where p.id = 'test-save-a' and (p.from_admin or p.is_published)) then
    raise exception 'FAIL: a save with fromAdmin made a teacher''s presentation QuizMatter''s or published';
  end if;
end $$;

-- A plain save still works after those refusals.
select set_config('test.saved_at', public.save_presentation(
  presentation => pg_temp.pres('Save A5', '[]'),
  slide_ids => array['s3', 's1', 's4'],
  base_updated_at => current_setting('test.saved_at')::bigint
)::text, true);

-- ─── Another teacher can't save it ────────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000b2', 'role', 'authenticated', 'aal', 'aal2')::text, true);

-- With the right base, and a list that would delete two slides.
do $$
begin
  perform public.save_presentation(
    presentation => pg_temp.pres('Taken over', '[]'),
    slide_ids => array['s3'],
    base_updated_at => current_setting('test.saved_at')::bigint
  );
  raise exception 'FAIL: another teacher saved someone else''s presentation';
exception when sqlstate 'QM409' or sqlstate '42501' or unique_violation then
  null;
end $$;

-- As a "new" presentation with the same id.
do $$
begin
  perform public.save_presentation(
    presentation => pg_temp.pres('Taken over', '[{"id": "s3", "type": "blank", "elements": []}]'),
    slide_ids => array['s3'],
    base_updated_at => null::bigint
  );
  raise exception 'FAIL: another teacher saved over someone else''s presentation as a new one';
exception when sqlstate 'QM409' or sqlstate '42501' or unique_violation then
  null;
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

do $$
begin
  if not exists (
    select 1 from public.presentations p
    where p.id = 'test-save-a' and p.title = 'Save A5' and p.owner_id = '00000000-0000-4000-8000-0000000000b1'
  ) or (select string_agg(s.id, ',' order by s.position) from public.slides s where s.presentation_id = 'test-save-a') <> 's3,s1,s4' then
    raise exception 'FAIL: another teacher''s refused save still changed the presentation';
  end if;
end $$;

rollback;
