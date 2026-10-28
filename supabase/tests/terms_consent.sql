-- The agree box at sign up (supabase/migrations/20261218000000_terms_consent.sql): the account saves which version of
-- the Terms and Privacy Policy was agreed to and when; a teacher can't change that record; and the sign up details
-- (names, contact number, educational background, the version) don't stay in the login record's metadata.
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/terms_consent.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- ─── 1. A sign up saves the consent and leaves no details in the metadata ─────────────────────────────────────
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000d1', 'tcs-teacher@example.com',
   '{"first_name": "Tcs", "last_name": "Teacher", "contact_number": "09171234567", "education_level": "master",
     "education_field": "English", "terms_version": "2026-10-28"}');

do $$
begin
  if not exists (
    select 1 from public.user_settings
    where user_id = '00000000-0000-4000-8000-0000000000d1'
      and terms_version = '2026-10-28'
      and terms_accepted_at is not null
      and education_level = 'master'
      and first_name = 'Tcs'
  ) then
    raise exception 'FAIL: the sign up did not save the consent and the details';
  end if;
  if (
    select coalesce(raw_user_meta_data, '{}'::jsonb) ?| array['first_name', 'last_name', 'contact_number',
      'education_level', 'education_field', 'display_name', 'terms_version']
    from auth.users where id = '00000000-0000-4000-8000-0000000000d1'
  ) then
    raise exception 'FAIL: the sign up details stayed in the login metadata';
  end if;
end $$;

-- ─── 2. An account added from the dashboard (no agree box) has no consent record ──────────────────────────────
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000d2', 'tcs-invited@example.com', '{"first_name": "Tcs", "last_name": "Invited"}');

do $$
begin
  if not exists (
    select 1 from public.user_settings
    where user_id = '00000000-0000-4000-8000-0000000000d2' and terms_version is null and terms_accepted_at is null
  ) then
    raise exception 'FAIL: an invited account got a consent record';
  end if;
end $$;

-- ─── 3. A teacher can't change their consent record, but other columns still change ───────────────────────────
create temp table tcs_before as
  select terms_accepted_at from public.user_settings where user_id = '00000000-0000-4000-8000-0000000000d1';
grant select on tcs_before to authenticated;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000d1', 'role', 'authenticated')::text, true);

update public.user_settings set terms_version = 'fake', terms_accepted_at = '2020-01-01', bio = 'Hi'
where user_id = '00000000-0000-4000-8000-0000000000d1';

reset role;

do $$
begin
  if not exists (
    select 1 from public.user_settings s, tcs_before b
    where s.user_id = '00000000-0000-4000-8000-0000000000d1'
      and s.terms_version = '2026-10-28'
      and s.terms_accepted_at = b.terms_accepted_at
      and s.bio = 'Hi'
  ) then
    raise exception 'FAIL: a teacher changed their consent record (or the bio did not save)';
  end if;
end $$;

-- ─── 4. The Account page's upsert, and a new row, can't set a consent record either ───────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000d1', 'role', 'authenticated')::text, true);

insert into public.user_settings (user_id, terms_version, terms_accepted_at)
values ('00000000-0000-4000-8000-0000000000d1', 'fake', now())
on conflict (user_id) do update set terms_version = excluded.terms_version,
  terms_accepted_at = excluded.terms_accepted_at;

reset role;

do $$
begin
  if not exists (
    select 1 from public.user_settings s, tcs_before b
    where s.user_id = '00000000-0000-4000-8000-0000000000d1'
      and s.terms_version = '2026-10-28'
      and s.terms_accepted_at = b.terms_accepted_at
  ) then
    raise exception 'FAIL: the upsert changed the consent record';
  end if;
end $$;

-- A teacher can't delete their own row (guard_display_name), so the row is removed here as postgres, and the teacher
-- writes a new one straight through the API.
delete from public.user_settings where user_id = '00000000-0000-4000-8000-0000000000d2';

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000d2', 'role', 'authenticated')::text, true);

insert into public.user_settings (user_id, terms_version, terms_accepted_at)
values ('00000000-0000-4000-8000-0000000000d2', 'fake', now());

reset role;

do $$
begin
  if not exists (
    select 1 from public.user_settings
    where user_id = '00000000-0000-4000-8000-0000000000d2' and terms_version is null and terms_accepted_at is null
  ) then
    raise exception 'FAIL: a new row written by the teacher kept a consent record';
  end if;
end $$;

-- ─── 5. Auth writing the metadata back later doesn't bring the details back ───────────────────────────────────
update auth.users set raw_user_meta_data = '{"education_level": "master", "keep": "x"}'
where id = '00000000-0000-4000-8000-0000000000d1';

do $$
begin
  if (select raw_user_meta_data from auth.users where id = '00000000-0000-4000-8000-0000000000d1')
    <> '{"keep": "x"}'::jsonb then
    raise exception 'FAIL: an update put sign up details back in the login metadata';
  end if;
end $$;

rollback;
