-- Throwaway emails refused by the database (supabase/migrations/20261210000400_blocked_email_domains.sql).
-- Supabase Auth runs the sign up hook as the role supabase_auth_admin, so the hook is called here as that role: a
-- "permission denied" there would stop every sign up.
-- Run on a local database with every migration applied, as supabase_admin (only it may switch to
-- supabase_auth_admin):
--   psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < supabase/tests/blocked_email_domains.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

-- ─── 1. The sign up hook, as Supabase Auth runs it ────────────────────────────────────────────────────────────
set local role supabase_auth_admin;

-- A throwaway email (in any letter case, with or without an internet address) is refused with the sign up page's
-- words, and isn't counted against its internet address.
do $$
declare
  answer jsonb;
begin
  answer := public.hook_before_user_created(
    '{"metadata": {"ip_address": "203.0.113.90"}, "user": {"email": "test123@mailinator.com"}}');
  if answer -> 'error' ->> 'message' is distinct from
    'Please use your real email address (school or personal), not a throwaway one.' then
    raise exception 'FAIL: a mailinator.com sign up wasn''t refused with the sign up page''s words: %', answer;
  end if;
  if answer -> 'error' ->> 'http_code' is distinct from '400' then
    raise exception 'FAIL: the throwaway refusal has the wrong http_code: %', answer;
  end if;

  answer := public.hook_before_user_created(
    '{"metadata": {"ip_address": "203.0.113.90"}, "user": {"email": "Ben@YopMail.COM"}}');
  if answer -> 'error' is null then
    raise exception 'FAIL: a sign up at YopMail.COM (capital letters) wasn''t refused: %', answer;
  end if;

  answer := public.hook_before_user_created('{"metadata": {}, "user": {"email": "x@guerrillamail.com"}}');
  if answer -> 'error' is null then
    raise exception 'FAIL: a throwaway sign up with no internet address wasn''t refused: %', answer;
  end if;

  if exists (select 1 from public.sign_up_attempts a where a.ip = '203.0.113.90') then
    raise exception 'FAIL: a refused throwaway sign up was counted against its internet address';
  end if;
end $$;

-- A real email, a look-alike domain, and a sign up with no email (a phone) are allowed and counted, as before.
do $$
declare
  answer jsonb;
begin
  answer := public.hook_before_user_created(
    '{"metadata": {"ip_address": "203.0.113.91"}, "user": {"email": "ana.cruz@gmail.com"}}');
  if answer <> '{}'::jsonb then
    raise exception 'FAIL: a gmail.com sign up was refused: %', answer;
  end if;

  answer := public.hook_before_user_created(
    '{"metadata": {"ip_address": "203.0.113.91"}, "user": {"email": "ana@notmailinator.com"}}');
  if answer <> '{}'::jsonb then
    raise exception 'FAIL: a sign up at notmailinator.com (not on the list) was refused: %', answer;
  end if;

  answer := public.hook_before_user_created(
    '{"metadata": {"ip_address": "203.0.113.91"}, "user": {"email": "", "phone": "639171234567"}}');
  if answer <> '{}'::jsonb then
    raise exception 'FAIL: a sign up with no email was refused: %', answer;
  end if;

  if (select count(*) from public.sign_up_attempts a where a.ip = '203.0.113.91') <> 3 then
    raise exception 'FAIL: the allowed sign ups weren''t counted against their internet address';
  end if;
end $$;

-- The limit per internet address still works: after 10 sign ups in an hour, a real email is refused too.
insert into public.sign_up_attempts (ip) select '203.0.113.92' from generate_series(1, 10);

do $$
declare
  answer jsonb;
begin
  answer := public.hook_before_user_created(
    '{"metadata": {"ip_address": "203.0.113.92"}, "user": {"email": "ana.cruz@gmail.com"}}');
  if answer -> 'error' ->> 'http_code' is distinct from '429' then
    raise exception 'FAIL: the 11th sign up from one internet address wasn''t refused: %', answer;
  end if;
end $$;

-- ─── 2. Reading the list: anyone may, nobody changes it through the API ─────────────────────────────────────
reset role;
set local role anon;

do $$
begin
  if not exists (select 1 from public.blocked_email_domains b where b.domain = 'mailinator.com') then
    raise exception 'FAIL: a logged-out visitor (the sign up page) can''t read the blocked email domains';
  end if;
end $$;

do $$
begin
  insert into public.blocked_email_domains (domain) values ('example.org');
  raise exception 'FAIL: a logged-out visitor added a blocked email domain';
exception when insufficient_privilege then
  null;
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);

do $$
begin
  if not exists (select 1 from public.blocked_email_domains b where b.domain = 'yopmail.com') then
    raise exception 'FAIL: a logged-in teacher can''t read the blocked email domains';
  end if;
end $$;

do $$
begin
  delete from public.blocked_email_domains where domain = 'yopmail.com';
  raise exception 'FAIL: a logged-in teacher removed a blocked email domain';
exception when insufficient_privilege then
  null;
end $$;

-- ─── 3. The list itself ───────────────────────────────────────────────────────────────────────────────────────
reset role;
select set_config('request.jwt.claims', '', true);

do $$
begin
  -- The 43 domains of the old src/lib/blockedEmailDomains.ts.
  if (select count(*) from public.blocked_email_domains) <> 43 then
    raise exception 'FAIL: the list doesn''t have the 43 domains of the old app list';
  end if;
end $$;

-- A domain with capital letters or spaces would never match (the hook compares in small letters): refused.
do $$
begin
  insert into public.blocked_email_domains (domain) values ('Spam.Example');
  raise exception 'FAIL: a blocked domain with capital letters was added';
exception when check_violation then
  null;
end $$;

rollback;
