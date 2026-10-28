-- Editors' profile photos (supabase/migrations/20261214000000_profile_photos.sql).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/profile_photos.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- ─── Setup (as postgres) ──────────────────────────────────────────────────────────────────────────────────────
-- e1 an editor (display name "Pp Editor", link name "pp-editor"), e2 a plain teacher, e3 an admin, e4 a banned
-- editor (made an editor first: check_editor_target refuses making a banned teacher one).
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000e1', 'pp-editor@example.com', '{"first_name": "Pp", "last_name": "Editor"}'),
  ('00000000-0000-4000-8000-0000000000e2', 'pp-teacher@example.com', '{"first_name": "Pp", "last_name": "Teacher"}'),
  ('00000000-0000-4000-8000-0000000000e3', 'pp-admin@example.com', '{"first_name": "Pp", "last_name": "Admin"}'),
  ('00000000-0000-4000-8000-0000000000e4', 'pp-banned@example.com', '{"first_name": "Pp", "last_name": "Banned"}');
insert into public.admins (user_id) values ('00000000-0000-4000-8000-0000000000e3');
insert into public.editors (user_id) values
  ('00000000-0000-4000-8000-0000000000e1'),
  ('00000000-0000-4000-8000-0000000000e4');
insert into public.banned_users (user_id, reason) values ('00000000-0000-4000-8000-0000000000e4', 'Test ban');

-- ─── As the editor: a wrong address is refused and doesn't count ──────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000e1', 'role', 'authenticated')::text, true);

do $$
begin
  perform public.set_profile_photo('https://example.com/x.webp');
  raise exception 'FAIL: a photo from another site was accepted';
exception when sqlstate '22023' then null;
end;
$$;

-- ─── 3 a day: 2, 1, 0 left, then refused ──────────────────────────────────────────────────────────────────────
do $$
declare
  prefix text := 'https://images.quizmatter.com/uploads/';
  left_a int := public.set_profile_photo(prefix || repeat('a', 64) || '.webp');
  left_b int := public.set_profile_photo(prefix || repeat('b', 64) || '.webp');
  left_c int := public.set_profile_photo(prefix || repeat('c', 64) || '.jpg');
begin
  if (left_a, left_b, left_c) is distinct from (2, 1, 0) then
    raise exception 'FAIL: expected 2, 1, 0 left, got %, %, %', left_a, left_b, left_c;
  end if;
end;
$$;

do $$
begin
  perform public.set_profile_photo('https://images.quizmatter.com/uploads/' || repeat('d', 64) || '.webp');
  raise exception 'FAIL: a 4th photo in one day was accepted';
exception when sqlstate 'QMPPL' then null;
end;
$$;

-- ─── Removing doesn't give a change back ──────────────────────────────────────────────────────────────────────
select public.remove_profile_photo();

do $$
begin
  perform public.set_profile_photo('https://images.quizmatter.com/uploads/' || repeat('d', 64) || '.webp');
  raise exception 'FAIL: remove + add again reset the daily count';
exception when sqlstate 'QMPPL' then null;
end;
$$;

do $$
declare
  photo_src text;
  left_today int;
begin
  select m.src, m.left_today into photo_src, left_today from public.my_profile_photo() m;
  if photo_src is distinct from '' or left_today is distinct from 0 then
    raise exception 'FAIL: expected no photo and 0 left, got % and %', photo_src, left_today;
  end if;
end;
$$;

-- ─── The editor can't write the table directly ────────────────────────────────────────────────────────────────
do $$
begin
  begin
    insert into public.profile_photos (user_id, src) values ('00000000-0000-4000-8000-0000000000e1', 'x');
    raise exception 'FAIL: an editor inserted a profile_photos row directly';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profile_photos set changes = 0;
    raise exception 'FAIL: an editor updated profile_photos directly';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.profile_photos;
    raise exception 'FAIL: an editor deleted profile_photos rows directly';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- ─── A new Philippine day allows 3 again ──────────────────────────────────────────────────────────────────────
reset role;
select set_config('request.jwt.claims', '', true);
update public.profile_photos set day = day - 1 where user_id = '00000000-0000-4000-8000-0000000000e1';

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000e1', 'role', 'authenticated')::text, true);

do $$
declare
  left_today int := public.set_profile_photo('https://images.quizmatter.com/uploads/' || repeat('d', 64) || '.webp');
begin
  if left_today <> 2 then
    raise exception 'FAIL: expected 2 left on a new day, got %', left_today;
  end if;
end;
$$;

-- ─── As a plain teacher: no photo of their own, but they see the editor's on the profile ──────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000e2', 'role', 'authenticated')::text, true);

do $$
begin
  perform public.set_profile_photo('https://images.quizmatter.com/uploads/' || repeat('e', 64) || '.webp');
  raise exception 'FAIL: a plain teacher set a profile photo';
exception when sqlstate '42501' then null;
end;
$$;

do $$
begin
  if exists (select 1 from public.my_profile_photo()) then
    raise exception 'FAIL: my_profile_photo gave a row to a plain teacher';
  end if;
  if (select p.photo_src from public.teacher_profile('pp-editor') p)
     is distinct from 'https://images.quizmatter.com/uploads/' || repeat('d', 64) || '.webp' then
    raise exception 'FAIL: teacher_profile doesn''t return the editor''s photo';
  end if;
end;
$$;

do $$
begin
  perform public.admin_remove_profile_photo('00000000-0000-4000-8000-0000000000e1');
  raise exception 'FAIL: a plain teacher removed an editor''s photo';
exception when sqlstate '42501' then null;
end;
$$;

-- ─── As the banned editor: refused ────────────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000e4', 'role', 'authenticated')::text, true);

do $$
begin
  perform public.set_profile_photo('https://images.quizmatter.com/uploads/' || repeat('f', 64) || '.webp');
  raise exception 'FAIL: a banned editor set a profile photo';
exception when sqlstate 'QMBAN' then null;
end;
$$;

-- ─── The weekly cleanup keeps it ──────────────────────────────────────────────────────────────────────────────
reset role;
select set_config('request.jwt.claims', '', true);

do $$
begin
  if not ('https://images.quizmatter.com/uploads/' || repeat('d', 64) || '.webp' = any (public.used_photo_srcs())) then
    raise exception 'FAIL: used_photo_srcs leaves out a profile photo';
  end if;
end;
$$;

-- ─── As the admin: remove it, logged, count kept ──────────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000e3', 'role', 'authenticated')::text, true);

select public.admin_remove_profile_photo('00000000-0000-4000-8000-0000000000e1');

reset role;
select set_config('request.jwt.claims', '', true);

do $$
declare
  photo public.profile_photos;
begin
  select * into photo from public.profile_photos p where p.user_id = '00000000-0000-4000-8000-0000000000e1';
  if photo.src <> '' then
    raise exception 'FAIL: the admin''s remove left the photo';
  end if;
  if photo.changes <> 1 then
    raise exception 'FAIL: the admin''s remove changed the count (%)', photo.changes;
  end if;
  if (
    select count(*) from public.admin_actions a
    where a.action = 'profile_photo_removed' and a.target_id = '00000000-0000-4000-8000-0000000000e1'
  ) <> 1 then
    raise exception 'FAIL: the admin''s remove isn''t in the Admin log once';
  end if;
end;
$$;

-- ─── Taking the editor role away removes the row ──────────────────────────────────────────────────────────────
delete from public.editors where user_id = '00000000-0000-4000-8000-0000000000e1';

do $$
begin
  if exists (select 1 from public.profile_photos where user_id = '00000000-0000-4000-8000-0000000000e1') then
    raise exception 'FAIL: the photo stayed after the editor role was taken away';
  end if;
end;
$$;

-- ─── Deleting an editor's account removes their photo ─────────────────────────────────────────────────────────
insert into public.profile_photos (user_id, src, day, changes)
values ('00000000-0000-4000-8000-0000000000e4', 'https://images.quizmatter.com/uploads/' || repeat('f', 64) || '.webp', current_date, 1);
delete from auth.users where id = '00000000-0000-4000-8000-0000000000e4';

do $$
begin
  if exists (select 1 from public.profile_photos where user_id = '00000000-0000-4000-8000-0000000000e4') then
    raise exception 'FAIL: the photo stayed after the account was deleted';
  end if;
end;
$$;

-- ─── Logged-out callers can't use it ──────────────────────────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public.set_profile_photo(text)', 'execute') then
    raise exception 'FAIL: anon may call set_profile_photo';
  end if;
end;
$$;

rollback;
