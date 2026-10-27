-- Limits on direct table writes (supabase/migrations/20261210000300_direct_write_limits.sql).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/direct_write_limits.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- ─── Setup (as postgres) ──────────────────────────────────────────────────────────────────────────────────────
-- e1 super admin, e2 teacher (slides; also does what the banned teacher can't), e3 banned teacher, e4 teacher
-- (photos straight to the table), e5 teacher (the app's photo upload, a new folder).
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000e1', 'dwl-super@example.com', '{"first_name": "Dwl", "last_name": "Super"}'),
  ('00000000-0000-4000-8000-0000000000e2', 'dwl-teacher@example.com', '{"first_name": "Dwl", "last_name": "Teacher"}'),
  ('00000000-0000-4000-8000-0000000000e3', 'dwl-banned@example.com', '{"first_name": "Dwl", "last_name": "Banned"}'),
  ('00000000-0000-4000-8000-0000000000e4', 'dwl-photos@example.com', '{"first_name": "Dwl", "last_name": "Photos"}'),
  ('00000000-0000-4000-8000-0000000000e5', 'dwl-upload@example.com', '{"first_name": "Dwl", "last_name": "Upload"}');
insert into public.admins (user_id, is_super) values ('00000000-0000-4000-8000-0000000000e1', true);
insert into public.banned_users (user_id, reason) values ('00000000-0000-4000-8000-0000000000e3', 'Test ban');

-- The super admin's shared QuizMatter lesson (to report), the teacher's empty presentation (slides go in below),
-- and the teachers' own presentation and folder (to move into it).
insert into public.presentations (id, owner_id, title, from_admin, is_published) values
  ('test-dwl-lesson', '00000000-0000-4000-8000-0000000000e1', 'Live lesson', true, true);
insert into public.presentations (id, owner_id, title) values
  ('test-dwl-many', '00000000-0000-4000-8000-0000000000e2', 'Many slides'),
  ('test-dwl-mine', '00000000-0000-4000-8000-0000000000e2', 'Teacher''s'),
  ('test-dwl-banned', '00000000-0000-4000-8000-0000000000e3', 'Banned teacher''s');
insert into public.folders (id, owner_id, name) values
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000e2', 'Week 1'),
  ('00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000e3', 'Week 1');

-- ─── 1. At most 100 slides per presentation, however they're written ──────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000e2', 'role', 'authenticated')::text, true);

-- The app's save (save_presentation runs as the teacher): a new presentation with 100 slides…
select public.save_presentation(
  presentation => jsonb_build_object(
    'id', 'test-dwl-full', 'title', 'Full', 'description', '', 'grades', '[]'::jsonb, 'subject', '', 'term', '',
    'week', '', 'day', '', 'curriculum', '', 'learningCompetency', '', 'author', '', 'referenceLinks', '[]'::jsonb,
    'tags', '["fractions"]'::jsonb, 'transition', 'slide', 'transitionSpeed', 3, 'isPublished', false,
    'fromAdmin', false, 'createdAt', 1790000000000,
    'slides', (select jsonb_agg(jsonb_build_object('id', 's' || n, 'type', 'blank') order by n) from generate_series(1, 100) as n)
  ),
  slide_ids => (select array_agg('s' || n order by n) from generate_series(1, 100) as n),
  base_updated_at => null::bigint
);

-- …saved again: every slide is already there, so none is "added".
select public.save_presentation(
  presentation => jsonb_build_object(
    'id', 'test-dwl-full', 'title', 'Full, again', 'description', '', 'grades', '[]'::jsonb, 'subject', '',
    'term', '', 'week', '', 'day', '', 'curriculum', '', 'learningCompetency', '', 'author', '',
    'referenceLinks', '[]'::jsonb, 'tags', '["fractions"]'::jsonb, 'transition', 'slide', 'transitionSpeed', 3,
    'isPublished', false, 'fromAdmin', false, 'createdAt', 1790000000000,
    'slides', (select jsonb_agg(jsonb_build_object('id', 's' || n, 'type', 'blank') order by n) from generate_series(1, 100) as n)
  ),
  slide_ids => (select array_agg('s' || n order by n) from generate_series(1, 100) as n),
  base_updated_at => (
    select floor(extract(epoch from p.updated_at) * 1000)::bigint from public.presentations p where p.id = 'test-dwl-full'
  )
);

do $$
begin
  if (select count(*) from public.slides s where s.presentation_id = 'test-dwl-full') <> 100
    or (select p.title from public.presentations p where p.id = 'test-dwl-full') <> 'Full, again' then
    raise exception 'FAIL: saving a presentation with 100 slides (new, then again) didn''t work';
  end if;
end $$;

-- A 101st slide written straight to the table is refused.
do $$
begin
  insert into public.slides (presentation_id, id, position, data)
  values ('test-dwl-full', 's101', 100, '{"id": "s101", "type": "blank"}');
  raise exception 'FAIL: a 101st slide was added straight to the table';
exception when invalid_parameter_value then
  if sqlerrm not like 'A presentation can have at most 100 slides%' then
    raise exception 'FAIL: the 101st slide was refused for another reason: %', sqlerrm;
  end if;
end $$;

-- Changing a slide that's already there still works.
insert into public.slides (presentation_id, id, position, data)
values ('test-dwl-full', 's1', 0, '{"id": "s1", "type": "blank", "question": "Changed"}')
on conflict (presentation_id, id) do update set data = excluded.data;

-- 101 slides in one insert: the rows before it in the same insert count too.
do $$
begin
  insert into public.slides (presentation_id, id, position, data)
  select 'test-dwl-many', 's' || n, n - 1, jsonb_build_object('id', 's' || n, 'type', 'blank')
  from generate_series(1, 101) as n;
  raise exception 'FAIL: 101 slides were added in one insert';
exception when invalid_parameter_value then
  if sqlerrm not like 'A presentation can have at most 100 slides%' then
    raise exception 'FAIL: the 101 slides were refused for another reason: %', sqlerrm;
  end if;
end $$;

-- 100 in one insert are fine.
insert into public.slides (presentation_id, id, position, data)
select 'test-dwl-many', 's' || n, n - 1, jsonb_build_object('id', 's' || n, 'type', 'blank')
from generate_series(1, 100) as n;

-- Moving a slide into a full presentation (changing its presentation_id) is refused too.
insert into public.slides (presentation_id, id, position, data)
values ('test-dwl-mine', 'moved', 0, '{"id": "moved", "type": "blank"}');

do $$
begin
  update public.slides set presentation_id = 'test-dwl-many' where presentation_id = 'test-dwl-mine' and id = 'moved';
  raise exception 'FAIL: a slide was moved into a presentation with 100 slides';
exception when invalid_parameter_value then
  if sqlerrm not like 'A presentation can have at most 100 slides%' then
    raise exception 'FAIL: moving the slide was refused for another reason: %', sqlerrm;
  end if;
end $$;

-- ─── 2. A banned teacher can't report, change settings, file presentations or add photos ──────────────────────
-- First the same steps by a teacher who isn't banned, so a refusal below is the ban, not the setup.
insert into public.presentation_reports (presentation_id, reason) values ('test-dwl-lesson', 'spam');
update public.user_settings set favorite_element_categories = '{}' where user_id = '00000000-0000-4000-8000-0000000000e2';
insert into public.folder_items (presentation_id, folder_id)
values ('test-dwl-mine', '00000000-0000-4000-8000-0000000000f2');
update public.folder_items set folder_id = '00000000-0000-4000-8000-0000000000f2' where presentation_id = 'test-dwl-mine';

do $$
begin
  if not exists (select 1 from public.user_settings s where s.user_id = '00000000-0000-4000-8000-0000000000e2') then
    raise exception 'FAIL: setup: the teacher has no settings row';
  end if;
end $$;

-- As the banned teacher.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000e3', 'role', 'authenticated')::text, true);

do $$
declare
  step text;
begin
  foreach step in array array[
    $s$insert into public.presentation_reports (presentation_id, reason) values ('test-dwl-lesson', 'spam')$s$,
    $s$update public.user_settings set favorite_element_categories = '{}'
       where user_id = '00000000-0000-4000-8000-0000000000e3'$s$,
    $s$insert into public.user_settings (user_id, favorite_element_categories)
       values ('00000000-0000-4000-8000-0000000000e3', '{}')
       on conflict (user_id) do update set favorite_element_categories = excluded.favorite_element_categories$s$,
    $s$insert into public.folder_items (presentation_id, folder_id)
       values ('test-dwl-banned', '00000000-0000-4000-8000-0000000000f3')$s$,
    $s$insert into public.photos (src, width, height)
       values ('https://images.quizmatter.com/uploads/test-dwl-banned.webp', 10, 10)$s$
  ] loop
    begin
      execute step;
      raise exception 'FAIL: a banned teacher''s write went through: %', step;
    exception when sqlstate 'QMBAN' then
      null;
    end;
  end loop;
end $$;

-- A folder item already there can't be moved either (set up as postgres, which passes).
reset role;
insert into public.folder_items (presentation_id, folder_id, owner_id)
values ('test-dwl-banned', '00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000e3');
set local role authenticated;

do $$
begin
  update public.folder_items set folder_id = '00000000-0000-4000-8000-0000000000f3' where presentation_id = 'test-dwl-banned';
  raise exception 'FAIL: a banned teacher moved a folder item';
exception when sqlstate 'QMBAN' then
  null;
end $$;

-- ─── 3. Photos written straight to the table: 30 in a minute pauses it (20261211000000) ──────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000e4', 'role', 'authenticated')::text, true);

insert into public.photos (src, width, height)
select 'https://images.quizmatter.com/uploads/test-dwl-' || n || '.webp', 10, 10
from generate_series(1, 30) as n;

do $$
begin
  insert into public.photos (src, width, height)
  values ('https://images.quizmatter.com/uploads/test-dwl-31.webp', 10, 10);
  raise exception 'FAIL: a 31st photo in one minute was added straight to the table';
exception when sqlstate 'QMBLK' then
  null;
end $$;

-- The app's upload (src/app/api/upload-image): count_photo_upload() before the file is stored, then the
-- row. Each counts once, in its own counter, so an upload isn't counted twice.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000e5', 'role', 'authenticated')::text, true);

select public.count_photo_upload();
insert into public.photos (user_id, src, width, height, created_at)
values ('00000000-0000-4000-8000-0000000000e5', 'https://images.quizmatter.com/uploads/test-dwl-app.webp', 10, 10, now())
on conflict (user_id, src) do update set created_at = excluded.created_at;

reset role;

do $$
begin
  if (select r.clicks from public.click_rate r
      where r.user_id = '00000000-0000-4000-8000-0000000000e5' and r.feature = 'photo_upload') is distinct from 1
    or (select r.clicks from public.click_rate r
      where r.user_id = '00000000-0000-4000-8000-0000000000e5' and r.feature = 'photo_rows') is distinct from 1 then
    raise exception 'FAIL: one app upload wasn''t counted once as an upload and once as a photo row';
  end if;
end $$;

-- ─── 4. A new folder is counted under a lock on its teacher ───────────────────────────────────────────────────
-- e5 made no presentation in this test, so the lock (the same one a new presentation takes) is the folder's.
set local role authenticated;

insert into public.folders (name) values ('Week 2');

reset role;

do $$
declare
  lock_key bigint := hashtext('00000000-0000-4000-8000-0000000000e5');
begin
  if not exists (
    select 1 from pg_locks l
    where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.objsubid = 1
      and l.classid = ((lock_key >> 32) & 4294967295)::oid and l.objid = (lock_key & 4294967295)::oid
  ) then
    raise exception 'FAIL: adding a folder didn''t lock its teacher before counting';
  end if;
end $$;

-- ─── 5. Helpers anon doesn't need ─────────────────────────────────────────────────────────────────────────────
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

do $$
declare
  call text;
begin
  foreach call in array array[
    $c$public.slide_photo_srcs('{}'::jsonb)$c$,
    $c$public.grades_from('{}'::jsonb)$c$,
    $c$public.profile_slug('Ms. Cruz')$c$,
    $c$public.tags_text(array['frog'])$c$,
    $c$public.search_shared_photos('frog')$c$
  ] loop
    begin
      execute 'select ' || call;
      raise exception 'FAIL: anon ran %', call;
    exception when insufficient_privilege then
      null;
    end;
  end loop;
end $$;

-- A logged-in teacher still can (saves fill in tags_text and profile_slug with them).
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000e2', 'role', 'authenticated')::text, true);

select public.slide_photo_srcs('{}'::jsonb), public.grades_from('{}'::jsonb), public.profile_slug('Ms. Cruz'),
  public.tags_text(array['frog']);

-- ─── 6. The admin log: is_super_admin() once per query, and an index for log_ban ─────────────────────────────
-- As the super admin: log a ban (log_ban looks up the teacher's earlier rows by target_id).
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000e1', 'role', 'authenticated')::text, true);

select public.log_ban(target => '00000000-0000-4000-8000-0000000000e3');

do $$
begin
  if not exists (select 1 from public.admin_actions a where a.target_id = '00000000-0000-4000-8000-0000000000e3') then
    raise exception 'FAIL: the super admin can''t read the admin log';
  end if;
end $$;

-- A teacher still reads nothing.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000e2', 'role', 'authenticated')::text, true);

do $$
begin
  if exists (select 1 from public.admin_actions) then
    raise exception 'FAIL: a teacher can read the admin log';
  end if;
end $$;

reset role;

do $$
begin
  if (select p.qual from pg_policies p
      where p.tablename = 'admin_actions' and p.policyname = 'Super admin reads the admin log')
    not like '%SELECT is_super_admin()%' then
    raise exception 'FAIL: the admin log''s read policy asks is_super_admin() for every row';
  end if;
  if not exists (
    select 1 from pg_indexes i
    where i.schemaname = 'public' and i.tablename = 'admin_actions' and i.indexdef like '%(target_id)'
  ) then
    raise exception 'FAIL: admin_actions has no index on target_id';
  end if;
end $$;

rollback;
