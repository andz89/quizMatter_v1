-- The password reset limit (supabase/migrations/20261231001000_password_reset_limit.sql): 3 reset emails a day per
-- teacher, 10 requests an hour per internet address.
-- Run on a local database with every migration applied, as supabase_admin (only it may change auth.users here):
--   psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < supabase/tests/password_reset_limit.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

insert into auth.users (id, email, instance_id, aud, role) values
  ('00000000-0000-0000-0000-00000000a001', 'ria.reset@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000a002', 'ben.reset@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

-- ─── 1. Who may call it ───────────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public.may_send_password_reset(text, text)', 'execute') then
    raise exception 'FAIL: anon may call may_send_password_reset (a browser could pass a made-up address)';
  end if;
  if has_function_privilege('authenticated', 'public.may_send_password_reset(text, text)', 'execute') then
    raise exception 'FAIL: authenticated may call may_send_password_reset';
  end if;
  if not has_function_privilege('service_role', 'public.may_send_password_reset(text, text)', 'execute') then
    raise exception 'FAIL: service_role may not call may_send_password_reset';
  end if;
  -- The daily cleanup deletes with the secret key.
  if not has_table_privilege('service_role', 'public.password_reset_sends', 'delete')
     or not has_table_privilege('service_role', 'public.password_reset_requests', 'delete') then
    raise exception 'FAIL: the cleanup can''t delete old rows';
  end if;
  if has_table_privilege('anon', 'public.password_reset_sends', 'select')
     or has_table_privilege('authenticated', 'public.password_reset_requests', 'select') then
    raise exception 'FAIL: teachers can read the limit''s tables';
  end if;
end $$;

-- ─── 2. Real emails are counted by the trigger ────────────────────────────────────────────────────────────────
do $$
declare
  ria constant uuid := '00000000-0000-0000-0000-00000000a001';
  sent timestamptz := now();
begin
  update auth.users set recovery_sent_at = sent where id = ria;
  if (select count(*) from public.password_reset_sends s where s.user_id = ria) <> 1 then
    raise exception 'FAIL: a reset email wasn''t counted';
  end if;
  -- The same value again, or another column, isn't an email.
  update auth.users set recovery_sent_at = sent where id = ria;
  update auth.users set raw_app_meta_data = '{}' where id = ria;
  if (select count(*) from public.password_reset_sends s where s.user_id = ria) <> 1 then
    raise exception 'FAIL: an update with no new email was counted';
  end if;
  -- Clearing it isn't an email either.
  update auth.users set recovery_sent_at = null where id = ria;
  if (select count(*) from public.password_reset_sends s where s.user_id = ria) <> 1 then
    raise exception 'FAIL: clearing recovery_sent_at was counted';
  end if;
end $$;

-- ─── 3. Per teacher: 3 a day, Philippine time ─────────────────────────────────────────────────────────────────
do $$
declare
  ria constant uuid := '00000000-0000-0000-0000-00000000a001';
begin
  update auth.users set recovery_sent_at = now() + interval '1 second' where id = ria;
  if not public.may_send_password_reset('ria.reset@test.local', null) then
    raise exception 'FAIL: 2 emails today were refused';
  end if;
  update auth.users set recovery_sent_at = now() + interval '2 seconds' where id = ria;
  if public.may_send_password_reset('ria.reset@test.local', null) then
    raise exception 'FAIL: a 4th email today was allowed';
  end if;
  if public.may_send_password_reset('  RIA.Reset@Test.Local ', null) then
    raise exception 'FAIL: capitals and spaces skipped the limit';
  end if;
  if not public.may_send_password_reset('ben.reset@test.local', null) then
    raise exception 'FAIL: another teacher''s emails were counted';
  end if;
  if not public.may_send_password_reset('nobody.reset@test.local', null) then
    raise exception 'FAIL: an email with no account was refused';
  end if;

  -- Yesterday in Manila doesn't count, even if it's still "today" in UTC: move all three to just before midnight there.
  update public.password_reset_sends s
    set sent_at = ((public.manila_today()::timestamp) - interval '1 minute') at time zone 'Asia/Manila'
    where s.user_id = ria;
  if not public.may_send_password_reset('ria.reset@test.local', null) then
    raise exception 'FAIL: yesterday''s emails (Philippine time) were counted';
  end if;
end $$;

-- ─── 4. Per internet address: 10 an hour ──────────────────────────────────────────────────────────────────────
do $$
begin
  for i in 1..10 loop
    if not public.may_send_password_reset('nobody.reset@test.local', '203.0.113.50') then
      raise exception 'FAIL: request % from one address was refused', i;
    end if;
  end loop;
  if public.may_send_password_reset('nobody.reset@test.local', '203.0.113.50') then
    raise exception 'FAIL: an 11th request from one address was allowed';
  end if;
  if not public.may_send_password_reset('nobody.reset@test.local', '203.0.113.51') then
    raise exception 'FAIL: another address was refused';
  end if;

  -- An hour later they count no more.
  update public.password_reset_requests r set created_at = now() - interval '61 minutes' where r.ip = '203.0.113.50';
  if not public.may_send_password_reset('nobody.reset@test.local', '203.0.113.50') then
    raise exception 'FAIL: requests older than an hour were counted';
  end if;

  -- No address, or one Postgres can't read: allowed, and nothing is saved.
  delete from public.password_reset_requests;
  if not public.may_send_password_reset('nobody.reset@test.local', null)
     or not public.may_send_password_reset('nobody.reset@test.local', '')
     or not public.may_send_password_reset('nobody.reset@test.local', 'not-an-ip') then
    raise exception 'FAIL: a request with no readable address was refused';
  end if;
  if exists (select 1 from public.password_reset_requests) then
    raise exception 'FAIL: a request with no readable address was saved';
  end if;
end $$;

-- ─── 4b. IPv6: one network has many addresses, so the whole /64 counts as one ─────────────────────────────────
do $$
begin
  for i in 1..10 loop
    if not public.may_send_password_reset('nobody.reset@test.local', '2001:db8:1:2::' || to_hex(i)) then
      raise exception 'FAIL: IPv6 request % from one network was refused', i;
    end if;
  end loop;
  if public.may_send_password_reset('nobody.reset@test.local', '2001:db8:1:2:aaaa:bbbb:cccc:dddd') then
    raise exception 'FAIL: an 11th request from one IPv6 network was allowed';
  end if;
  if not public.may_send_password_reset('nobody.reset@test.local', '2001:db8:1:3::1') then
    raise exception 'FAIL: another IPv6 network was refused';
  end if;
  -- An IPv4 address stays whole.
  if (select count(*) from public.password_reset_requests r where family(r.ip) = 4 and masklen(r.ip) <> 32) <> 0 then
    raise exception 'FAIL: an IPv4 address was shortened';
  end if;
end $$;

-- ─── 5. The address is counted even when the teacher is over the limit ────────────────────────────────────────
do $$
declare
  ben constant uuid := '00000000-0000-0000-0000-00000000a002';
begin
  insert into public.password_reset_sends (user_id) select ben from generate_series(1, 3);
  if public.may_send_password_reset('ben.reset@test.local', '203.0.113.52') then
    raise exception 'FAIL: a teacher over the limit was allowed';
  end if;
  if (select count(*) from public.password_reset_requests r where r.ip = '203.0.113.52') <> 1 then
    raise exception 'FAIL: a refused request wasn''t counted against its address';
  end if;
end $$;

-- ─── 6. A failure in the trigger never stops the update (it would leave the teacher with a dead link) ─────────
do $$
declare
  ben constant uuid := '00000000-0000-0000-0000-00000000a002';
begin
  alter table public.password_reset_sends rename to password_reset_sends_away;
  update auth.users set recovery_sent_at = now() + interval '3 seconds' where id = ben;
  alter table public.password_reset_sends_away rename to password_reset_sends;
  if (select recovery_sent_at from auth.users where id = ben) is null then
    raise exception 'FAIL: the update didn''t go through';
  end if;
end $$;

-- ─── 7. A teacher's rows go with the account ──────────────────────────────────────────────────────────────────
do $$
declare
  ria constant uuid := '00000000-0000-0000-0000-00000000a001';
begin
  delete from auth.users where id = ria;
  if exists (select 1 from public.password_reset_sends s where s.user_id = ria) then
    raise exception 'FAIL: a deleted account''s rows stayed';
  end if;
end $$;

rollback;
