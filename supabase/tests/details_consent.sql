-- Consent for the sensitive details (supabase/migrations/20261231002500_details_consent.sql): saving the birthday,
-- gender or educational background on the Account page keeps the Privacy Policy version and the time; a save that
-- doesn't change them keeps the record (a teacher can't rewrite it); clearing them all clears it.
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/details_consent.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000e1', 'dcs-teacher@example.com', '{"first_name": "Dcs", "last_name": "Teacher"}');

create temp table dcs_seen (step text, version text, at timestamptz);
grant all on dcs_seen to authenticated;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000e1', 'role', 'authenticated', 'aal', 'aal2')::text, true);

-- ─── 1. A sign up row (names only) has no record; saving with no details and a version keeps none ───────────────
update public.user_settings set bio = 'Hi', details_consent_version = '2026-11-21', details_consent_at = '2020-01-01'
where user_id = '00000000-0000-4000-8000-0000000000e1';
insert into dcs_seen select '1', details_consent_version, details_consent_at from public.user_settings
where user_id = '00000000-0000-4000-8000-0000000000e1';

-- ─── 2. Adding a gender keeps the version and the database's time (not the one sent) ────────────────────────────
update public.user_settings set gender = 'female', details_consent_version = '2026-11-21', details_consent_at = '2020-01-01'
where user_id = '00000000-0000-4000-8000-0000000000e1';
insert into dcs_seen select '2', details_consent_version, details_consent_at from public.user_settings
where user_id = '00000000-0000-4000-8000-0000000000e1';

-- ─── 3. A save without a change to them can't rewrite the record ────────────────────────────────────────────────
update public.user_settings set bio = 'Hello', details_consent_version = 'fake', details_consent_at = '2020-01-01'
where user_id = '00000000-0000-4000-8000-0000000000e1';
insert into dcs_seen select '3', details_consent_version, details_consent_at from public.user_settings
where user_id = '00000000-0000-4000-8000-0000000000e1';

-- ─── 4. Changing the birthday without sending a version keeps the old version and stamps a new time ────────────
update public.user_settings set birth_date = '1990-05-05'
where user_id = '00000000-0000-4000-8000-0000000000e1';
insert into dcs_seen select '4', details_consent_version, details_consent_at from public.user_settings
where user_id = '00000000-0000-4000-8000-0000000000e1';

-- ─── 5. Clearing them all clears the record ──────────────────────────────────────────────────────────────────────
update public.user_settings set birth_date = null, gender = '', education_level = '', education_field = ''
where user_id = '00000000-0000-4000-8000-0000000000e1';
insert into dcs_seen select '5', details_consent_version, details_consent_at from public.user_settings
where user_id = '00000000-0000-4000-8000-0000000000e1';

reset role;

do $$
begin
  if exists (select 1 from dcs_seen where step = '1' and (version is not null or at is not null)) then
    raise exception 'FAIL: a row without the details got a consent record';
  end if;
  if not exists (select 1 from dcs_seen where step = '2' and version = '2026-11-21' and at = now()) then
    raise exception 'FAIL: adding a gender did not keep the version with the database''s time';
  end if;
  if not exists (select 1 from dcs_seen where step = '3' and version = '2026-11-21' and at = now()) then
    raise exception 'FAIL: a save without a change rewrote the consent record';
  end if;
  if not exists (select 1 from dcs_seen where step = '4' and version = '2026-11-21' and at = now()) then
    raise exception 'FAIL: a birthday change without a version lost the record';
  end if;
  if exists (select 1 from dcs_seen where step = '5' and (version is not null or at is not null)) then
    raise exception 'FAIL: clearing every detail kept the consent record';
  end if;
end $$;

-- ─── 6. Sign up (handle_new_user, from an older open tab that still sends details) is left alone ─────────────────
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000e2', 'dcs-old-tab@example.com',
   '{"first_name": "Dcs", "last_name": "Old", "gender": "male", "terms_version": "2026-11-20"}');

do $$
begin
  if not exists (
    select 1 from public.user_settings
    where user_id = '00000000-0000-4000-8000-0000000000e2' and gender = 'male' and details_consent_version is null
  ) then
    raise exception 'FAIL: an older sign up tab''s details were not saved as before';
  end if;
end $$;

rollback;
