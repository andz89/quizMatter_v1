-- Birthday, gender, province and town (supabase/migrations/20261220000000_age_gender_address.sql): sign up copies them
-- and leaves none in the login metadata, bad ones are refused, the birthday and gender stay private, the profile
-- shows the town and province unless hidden, and only admins get the counts.
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/age_gender_address.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- ─── Setup (as postgres) ──────────────────────────────────────────────────────────────────────────────────────
-- e1 a teacher with good details ("Ag Teacher", link name "ag-teacher"), e2 and e3 sign ups with bad details, e4
-- another teacher who opens profiles, e5 an admin.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000e1', 'ag-teacher@example.com',
    '{"first_name": "Ag", "last_name": "Teacher", "birth_date": "1990-06-15", "gender": "female",
      "province": "Metro Manila", "town": "  Quezon City "}'),
  ('00000000-0000-4000-8000-0000000000e2', 'ag-young@example.com',
    '{"first_name": "Ag", "last_name": "Young", "birth_date": "2020-01-01", "gender": "other",
      "province": "Cebu Prov.", "town": "Cebu City"}'),
  ('00000000-0000-4000-8000-0000000000e3', 'ag-baddate@example.com',
    '{"first_name": "Ag", "last_name": "Baddate", "birth_date": "not a date"}'),
  ('00000000-0000-4000-8000-0000000000e4', 'ag-viewer@example.com', '{"first_name": "Ag", "last_name": "Viewer"}'),
  ('00000000-0000-4000-8000-0000000000e5', 'ag-admin@example.com', '{"first_name": "Ag", "last_name": "Admin"}');
insert into public.admins (user_id) values ('00000000-0000-4000-8000-0000000000e5');

-- ─── 1. A sign up saves the details and leaves none in the metadata ───────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from public.user_settings
    where user_id = '00000000-0000-4000-8000-0000000000e1'
      and birth_date = '1990-06-15' and gender = 'female' and province = 'Metro Manila' and town = 'Quezon City'
      and town_public
  ) then
    raise exception 'FAIL: the sign up did not save the birthday, gender, province and town';
  end if;
  if (
    select coalesce(raw_user_meta_data, '{}'::jsonb) ?| array['birth_date', 'gender', 'province', 'town']
    from auth.users where id = '00000000-0000-4000-8000-0000000000e1'
  ) then
    raise exception 'FAIL: the new details stayed in the login metadata';
  end if;
end $$;

-- ─── 2. A sign up with bad details still makes the account, with them empty ───────────────────────────────────
do $$
begin
  if not exists (
    select 1 from public.user_settings
    where user_id = '00000000-0000-4000-8000-0000000000e2'
      and birth_date is null and gender = '' and province = '' and town = 'Cebu City'
  ) then
    raise exception 'FAIL: bad sign up details were not left empty';
  end if;
  if not exists (
    select 1 from public.user_settings where user_id = '00000000-0000-4000-8000-0000000000e3' and birth_date is null
  ) then
    raise exception 'FAIL: a sign up with a birthday that isn''t a date was not made';
  end if;
end $$;

-- ─── 3. The teacher's own writes follow the rules ─────────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000e1', 'role', 'authenticated')::text, true);

do $$
declare
  today date := (now() at time zone 'Asia/Manila')::date;
  n int;
begin
  begin
    update public.user_settings set birth_date = today - interval '18 years' + interval '1 day'
    where user_id = '00000000-0000-4000-8000-0000000000e1';
    raise exception 'FAIL: an under-18 birthday was saved';
  exception when sqlstate 'QMAGE' then null;
  end;

  begin
    update public.user_settings set birth_date = today - interval '101 years'
    where user_id = '00000000-0000-4000-8000-0000000000e1';
    raise exception 'FAIL: a 101-year-old birthday was saved';
  exception when sqlstate 'QMAGE' then null;
  end;

  begin
    update public.user_settings set birth_date = today + 1
    where user_id = '00000000-0000-4000-8000-0000000000e1';
    raise exception 'FAIL: a birthday in the future was saved';
  exception when sqlstate 'QMAGE' then null;
  end;

  update public.user_settings set birth_date = today - interval '18 years'
  where user_id = '00000000-0000-4000-8000-0000000000e1';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL: a teacher who is 18 today couldn''t save their birthday';
  end if;

  begin
    update public.user_settings set gender = 'other' where user_id = '00000000-0000-4000-8000-0000000000e1';
    raise exception 'FAIL: a wrong gender was saved';
  exception when check_violation then null;
  end;

  begin
    update public.user_settings set province = 'Cebu Prov.' where user_id = '00000000-0000-4000-8000-0000000000e1';
    raise exception 'FAIL: an unknown province was saved';
  exception when check_violation then null;
  end;

  begin
    update public.user_settings set town = repeat('a', 61) where user_id = '00000000-0000-4000-8000-0000000000e1';
    raise exception 'FAIL: a 61-character town was saved';
  exception when check_violation then null;
  end;

  -- Back to the sign up birthday for the counts below.
  update public.user_settings set birth_date = '1990-06-15' where user_id = '00000000-0000-4000-8000-0000000000e1';
end $$;

-- ─── 4. Another teacher can't read the birthday or gender ─────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000e4', 'role', 'authenticated')::text, true);

do $$
begin
  if exists (select 1 from public.user_settings where user_id = '00000000-0000-4000-8000-0000000000e1') then
    raise exception 'FAIL: another teacher can read the settings row';
  end if;
end $$;

-- ─── 5. The profile shows the town and province unless hidden; never the birthday or gender ───────────────────
do $$
declare p record;
begin
  select * into p from public.teacher_profile('ag-teacher');
  if p.town is distinct from 'Quezon City' or p.province is distinct from 'Metro Manila' or not p.town_public then
    raise exception 'FAIL: the profile doesn''t show the town and province: %', row_to_json(p);
  end if;
  if pg_get_function_result('public.teacher_profile(text)'::regprocedure) ~ '(birth_date|gender)' then
    raise exception 'FAIL: teacher_profile hands out the birthday or gender';
  end if;
end $$;

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000e1', 'role', 'authenticated')::text, true);
update public.user_settings set town_public = false where user_id = '00000000-0000-4000-8000-0000000000e1';

-- The owner still sees them, marked not public.
do $$
declare p record;
begin
  select * into p from public.teacher_profile('ag-teacher');
  if p.town is distinct from 'Quezon City' or p.town_public then
    raise exception 'FAIL: the owner doesn''t see their hidden town: %', row_to_json(p);
  end if;
end $$;

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000e4', 'role', 'authenticated')::text, true);

do $$
declare p record;
begin
  select * into p from public.teacher_profile('ag-teacher');
  if p.town <> '' or p.province <> '' or p.town_public then
    raise exception 'FAIL: a hidden town and province still show: %', row_to_json(p);
  end if;
end $$;

-- An editor's always show.
reset role;
insert into public.editors (user_id) values ('00000000-0000-4000-8000-0000000000e1');
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000e4', 'role', 'authenticated')::text, true);

do $$
declare p record;
begin
  select * into p from public.teacher_profile('ag-teacher');
  if p.town is distinct from 'Quezon City' or not p.town_public then
    raise exception 'FAIL: an editor''s town doesn''t show: %', row_to_json(p);
  end if;
end $$;

-- ─── 6. Only admins get the counts ────────────────────────────────────────────────────────────────────────────
do $$
begin
  begin
    perform * from public.admin_teacher_breakdown();
    raise exception 'FAIL: a teacher got the counts';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Every teacher, counted as postgres (an admin reads only their own settings row).
reset role;
create temp table ag_everyone as select count(*) as total from public.user_settings;
grant select on ag_everyone to authenticated;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000e5', 'role', 'authenticated')::text, true);

do $$
declare
  age int := public.age_on('1990-06-15', public.manila_today());
  e1_group text := case when age < 25 then '18–24' when age < 35 then '25–34' when age < 45 then '35–44'
    when age < 55 then '45–54' else '55+' end;
begin
  if not exists (select 1 from public.admin_teacher_breakdown() where kind = 'gender' and label = 'female' and total >= 1) then
    raise exception 'FAIL: the counts have no female teacher';
  end if;
  if not exists (select 1 from public.admin_teacher_breakdown() where kind = 'age' and label = e1_group and total >= 1) then
    raise exception 'FAIL: the counts miss the teacher''s age group %', e1_group;
  end if;
  if (select sum(total) from public.admin_teacher_breakdown() where kind = 'age') <> (select total from ag_everyone) then
    raise exception 'FAIL: the age counts don''t add up to every teacher';
  end if;
end $$;

rollback;
