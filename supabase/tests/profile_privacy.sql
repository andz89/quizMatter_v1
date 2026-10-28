-- Profile privacy: a teacher's full name, educational background and bio can be private
-- (supabase/migrations/20261215000000_profile_privacy.sql).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/profile_privacy.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- ─── Setup (as postgres) ──────────────────────────────────────────────────────────────────────────────────────
-- f1 the teacher who goes private (display name "Pv Private", link name "pv-private"), f2 another teacher who opens
-- profiles, f3 an admin, f4 an editor whose switches are all off ("pv-editor").
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000f1', 'pv-private@example.com',
    '{"first_name": "Pv", "last_name": "Private", "education_level": "master", "education_field": "English"}'),
  ('00000000-0000-4000-8000-0000000000f2', 'pv-viewer@example.com', '{"first_name": "Pv", "last_name": "Viewer"}'),
  ('00000000-0000-4000-8000-0000000000f3', 'pv-admin@example.com', '{"first_name": "Pv", "last_name": "Admin"}'),
  ('00000000-0000-4000-8000-0000000000f4', 'pv-editor@example.com', '{"first_name": "Pv", "last_name": "Editor"}');
insert into public.admins (user_id) values ('00000000-0000-4000-8000-0000000000f3');
insert into public.editors (user_id) values ('00000000-0000-4000-8000-0000000000f4');
update public.user_settings
set full_name_public = false, education_public = false, bio_public = false, bio = 'Editor bio'
where user_id = '00000000-0000-4000-8000-0000000000f4';

-- ─── As the other teacher: everything shows before any change ─────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000f2', 'role', 'authenticated')::text, true);

do $$
declare p record;
begin
  select * into p from public.teacher_profile('pv-private');
  if p.first_name is distinct from 'Pv' or p.education_field is distinct from 'English'
     or not (p.full_name_public and p.education_public and p.bio_public) then
    raise exception 'FAIL: a new teacher''s profile isn''t public by default: %', row_to_json(p);
  end if;
end;
$$;

-- ─── As the teacher: turn all three off, with a bio ───────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000f1', 'role', 'authenticated')::text, true);

do $$
declare n int;
begin
  update public.user_settings
  set full_name_public = false, education_public = false, bio_public = false, bio = 'My bio'
  where user_id = '00000000-0000-4000-8000-0000000000f1';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL: the teacher couldn''t change their own switches';
  end if;
end;
$$;

-- The owner still gets everything, with the flags off (the page marks them "Only you can see this").
do $$
declare p record;
begin
  select * into p from public.teacher_profile('pv-private');
  if p.first_name is distinct from 'Pv' or p.last_name is distinct from 'Private'
     or p.education_level is distinct from 'master' or p.education_field is distinct from 'English'
     or p.bio is distinct from 'My bio'
     or p.full_name_public or p.education_public or p.bio_public then
    raise exception 'FAIL: the owner doesn''t get their own private fields: %', row_to_json(p);
  end if;
end;
$$;

-- ─── As the other teacher: only the display name is left ──────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000f2', 'role', 'authenticated')::text, true);

do $$
declare p record;
begin
  select * into p from public.teacher_profile('pv-private');
  if p.display_name is distinct from 'Pv Private'
     or p.first_name <> '' or p.last_name <> '' or p.education_level <> '' or p.education_field <> '' or p.bio <> ''
     or p.full_name_public or p.education_public or p.bio_public then
    raise exception 'FAIL: another teacher gets private fields: %', row_to_json(p);
  end if;
end;
$$;

-- Nor can they turn the switches back on for them.
do $$
declare n int;
begin
  update public.user_settings set full_name_public = true where user_id = '00000000-0000-4000-8000-0000000000f1';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL: a teacher changed another teacher''s switch';
  end if;
end;
$$;

-- An editor's fields always show, whatever their switches say.
do $$
declare p record;
begin
  select * into p from public.teacher_profile('pv-editor');
  if p.first_name is distinct from 'Pv' or p.bio is distinct from 'Editor bio'
     or not (p.full_name_public and p.education_public and p.bio_public) then
    raise exception 'FAIL: an editor''s fields are hidden: %', row_to_json(p);
  end if;
end;
$$;

-- ─── As the admin: the same blanks as any teacher ─────────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000f3', 'role', 'authenticated')::text, true);

do $$
declare p record;
begin
  select * into p from public.teacher_profile('pv-private');
  if p.first_name <> '' or p.last_name <> '' or p.education_level <> '' or p.education_field <> '' or p.bio <> '' then
    raise exception 'FAIL: an admin gets private fields: %', row_to_json(p);
  end if;
end;
$$;

-- ─── The editor role is taken away: their own choices apply again ─────────────────────────────────────────────
reset role;
delete from public.editors where user_id = '00000000-0000-4000-8000-0000000000f4';

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000f2', 'role', 'authenticated')::text, true);

do $$
declare p record;
begin
  select * into p from public.teacher_profile('pv-editor');
  if p.first_name <> '' or p.bio <> '' or p.full_name_public then
    raise exception 'FAIL: a former editor''s private fields still show: %', row_to_json(p);
  end if;
end;
$$;

rollback;
