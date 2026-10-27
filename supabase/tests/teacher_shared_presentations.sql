-- A teacher's shared presentations on their profile (supabase/migrations/20261212000000_teacher_shared_presentations.sql).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/teacher_shared_presentations.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- ─── Setup (as postgres) ──────────────────────────────────────────────────────────────────────────────────────
-- d1 the teacher whose profile is opened (display name "Tsp Teacher", made from the first and last name, so link
-- name "tsp-teacher"), d2 another teacher who opens it, d3 an admin who hides a copy.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000d1', 'tsp-teacher@example.com', '{"first_name": "Tsp", "last_name": "Teacher"}'),
  ('00000000-0000-4000-8000-0000000000d2', 'tsp-viewer@example.com', '{"first_name": "Tsp", "last_name": "Viewer"}'),
  ('00000000-0000-4000-8000-0000000000d3', 'tsp-admin@example.com', '{"first_name": "Tsp", "last_name": "Admin"}');
insert into public.admins (user_id) values ('00000000-0000-4000-8000-0000000000d3');

-- t1 and t2 get shared below (t2's copy is then hidden), t3 stays private.
insert into public.presentations (id, owner_id, title) values
  ('test-tsp-t1', '00000000-0000-4000-8000-0000000000d1', 'Shared one'),
  ('test-tsp-t2', '00000000-0000-4000-8000-0000000000d1', 'Shared then hidden'),
  ('test-tsp-t3', '00000000-0000-4000-8000-0000000000d1', 'Private');
insert into public.slides (presentation_id, id, position, data)
select p.id, 's1', 0, '{"id": "s1", "type": "blank", "elements": [], "question": "What is 1 + 1?"}'::jsonb
from public.presentations p
where p.id in ('test-tsp-t1', 'test-tsp-t2', 'test-tsp-t3');

do $$
begin
  if exists (select 1 from public.user_settings where user_id = '00000000-0000-4000-8000-0000000000d1' and profile_slug = 'tsp-teacher') then
    return;
  end if;
  raise exception 'FAIL: setup: the teacher has no "tsp-teacher" link name';
end;
$$;

-- ─── As the teacher: publish t1 and t2 ────────────────────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000d1', 'role', 'authenticated')::text, true);

select public.share_presentation(target_id => 'test-tsp-t1');
select public.share_presentation(target_id => 'test-tsp-t2');

-- ─── As the admin: hide t2's copy (Admin → Reports) ───────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000d3', 'role', 'authenticated')::text, true);

do $$
declare n int;
begin
  update public.presentations set hidden_at = now() where shared_from = 'test-tsp-t2';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL: setup: the admin couldn''t hide t2''s shared copy';
  end if;
end;
$$;

-- ─── As the other teacher: only t1's copy is listed ───────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000d2', 'role', 'authenticated')::text, true);

do $$
declare
  ids text[] := array(select id from public.teacher_shared_presentations('tsp-teacher'));
  copy_id text := (select id from public.presentations where shared_from = 'test-tsp-t1');
begin
  if copy_id is null then
    raise exception 'FAIL: the other teacher can''t read t1''s shared copy';
  end if;
  if ids <> array[copy_id] then
    raise exception 'FAIL: expected only t1''s shared copy (%), got %', copy_id, ids;
  end if;
  if exists (select 1 from public.teacher_shared_presentations('')) then
    raise exception 'FAIL: an empty link name listed presentations';
  end if;
  if exists (select 1 from public.teacher_shared_presentations('nobody-here')) then
    raise exception 'FAIL: a link name nobody has listed presentations';
  end if;
end;
$$;

-- ─── An admin's profile is hidden from teachers, so their copies are too ──────────────────────────────────────
reset role;
select set_config('request.jwt.claims', '', true);
insert into public.admins (user_id) values ('00000000-0000-4000-8000-0000000000d1');

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000d2', 'role', 'authenticated')::text, true);

do $$
begin
  if exists (select 1 from public.teacher_shared_presentations('tsp-teacher')) then
    raise exception 'FAIL: a teacher saw an admin''s shared presentations';
  end if;
end;
$$;

-- ─── Logged-out callers can't use it ──────────────────────────────────────────────────────────────────────────
reset role;
select set_config('request.jwt.claims', '', true);
do $$
begin
  if has_function_privilege('anon', 'public.teacher_shared_presentations(text)', 'execute') then
    raise exception 'FAIL: anon may call teacher_shared_presentations';
  end if;
end;
$$;

rollback;
