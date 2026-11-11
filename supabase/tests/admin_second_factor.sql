-- Admins need a second factor (supabase/migrations/20261231001300_admin_second_factor.sql): is_admin() and
-- is_super_admin() are true only for a login that passed the second step (the token's aal is aal2), or for Claude's
-- connector token (it has a client_id) when the admin has a verified factor. admin_membership() says who is in the
-- admins table whatever the level (for the pages that send an admin to set up or verify the second step), and the
-- maintenance guard lets a super admin member through at aal1, so they can reach the verify page.
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/admin_second_factor.sql
-- Passes when it ends without an error. Everything is rolled back (the guard setting too).
begin;

-- ─── Setup (as postgres): f1 super admin, f2 plain admin, f3 teacher ──────────────────────────────────────────
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000a1', 'asf-super@example.com', '{"first_name": "Asf", "last_name": "Super"}'),
  ('00000000-0000-4000-8000-0000000000a2', 'asf-admin@example.com', '{"first_name": "Asf", "last_name": "Admin"}'),
  ('00000000-0000-4000-8000-0000000000a3', 'asf-teacher@example.com', '{"first_name": "Asf", "last_name": "Teacher"}');
insert into public.admins (user_id, is_super) values
  ('00000000-0000-4000-8000-0000000000a1', true),
  ('00000000-0000-4000-8000-0000000000a2', false);

-- Acts as a user with these extra claims (aal, client_id), as the authenticated role.
create function pg_temp.act(who uuid, extra jsonb) returns void language sql as $$
  select set_config('request.jwt.claims',
    (jsonb_build_object('sub', who, 'role', 'authenticated') || extra)::text, true);
$$;
-- What the maintenance guard says: 'ok' or the error's text.
create function pg_temp.guard() returns text language plpgsql as $$
begin
  perform public.check_maintenance();
  return 'ok';
exception when others then
  return sqlerrm;
end;
$$;
grant execute on all functions in schema pg_temp to authenticated, anon;

set local role authenticated;

-- ─── Without the second step (aal1, or no aal claim): a member, but not an admin ──────────────────────────────
do $$
begin
  perform pg_temp.act('00000000-0000-4000-8000-0000000000a2', '{}');
  if public.is_admin() then raise exception 'FAIL: an admin with no aal claim counts as an admin'; end if;
  if public.admin_membership() <> 'admin' then raise exception 'FAIL: admin_membership() is not admin: %', public.admin_membership(); end if;

  perform pg_temp.act('00000000-0000-4000-8000-0000000000a2', '{"aal": "aal1"}');
  if public.is_admin() then raise exception 'FAIL: an admin at aal1 counts as an admin'; end if;

  perform pg_temp.act('00000000-0000-4000-8000-0000000000a1', '{"aal": "aal1"}');
  if public.is_super_admin() or public.is_admin() then raise exception 'FAIL: the super admin at aal1 counts as an admin'; end if;
  if public.admin_membership() <> 'super' then raise exception 'FAIL: admin_membership() is not super: %', public.admin_membership(); end if;
end;
$$;

-- ─── With the second step (aal2) ──────────────────────────────────────────────────────────────────────────────
do $$
begin
  perform pg_temp.act('00000000-0000-4000-8000-0000000000a2', '{"aal": "aal2"}');
  if not public.is_admin() then raise exception 'FAIL: an admin at aal2 is not an admin'; end if;
  if public.is_super_admin() then raise exception 'FAIL: a plain admin at aal2 counts as the super admin'; end if;

  perform pg_temp.act('00000000-0000-4000-8000-0000000000a1', '{"aal": "aal2"}');
  if not (public.is_super_admin() and public.is_admin()) then raise exception 'FAIL: the super admin at aal2 is not an admin'; end if;

  perform pg_temp.act('00000000-0000-4000-8000-0000000000a3', '{"aal": "aal2"}');
  if public.is_admin() or public.is_super_admin() then raise exception 'FAIL: a teacher at aal2 counts as an admin'; end if;
  if public.admin_membership() <> 'none' then raise exception 'FAIL: a teacher''s admin_membership() is %', public.admin_membership(); end if;
end;
$$;

-- ─── Claude's connector token (client_id): counts once the admin has a verified factor ────────────────────────
do $$
begin
  perform pg_temp.act('00000000-0000-4000-8000-0000000000a2', '{"aal": "aal1", "client_id": "claude"}');
  if public.is_admin() then raise exception 'FAIL: a connector token counts without any factor'; end if;
end;
$$;

reset role;
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
values ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a2', 'phone 1', 'totp', 'unverified', now(), now());
set local role authenticated;
do $$
begin
  perform pg_temp.act('00000000-0000-4000-8000-0000000000a2', '{"aal": "aal1", "client_id": "claude"}');
  if public.is_admin() then raise exception 'FAIL: a connector token counts with only an unverified factor'; end if;
end;
$$;

reset role;
update auth.mfa_factors set status = 'verified' where id = '00000000-0000-4000-8000-0000000000b1';
set local role authenticated;
do $$
begin
  perform pg_temp.act('00000000-0000-4000-8000-0000000000a2', '{"aal": "aal1", "client_id": "claude"}');
  if not public.is_admin() then raise exception 'FAIL: a connector token does not count with a verified factor'; end if;
  -- A plain browser login at aal1 still doesn't count, factor or not.
  perform pg_temp.act('00000000-0000-4000-8000-0000000000a2', '{"aal": "aal1"}');
  if public.is_admin() then raise exception 'FAIL: a browser login at aal1 counts because a factor exists'; end if;
end;
$$;

-- ─── Maintenance: a super admin member gets through the guard at aal1 (to reach the verify page) ──────────────
do $$
begin
  perform pg_temp.act('00000000-0000-4000-8000-0000000000a1', '{"aal": "aal2"}');
  perform public.set_maintenance(true, 'Second factor test');
  perform pg_temp.act('00000000-0000-4000-8000-0000000000a1', '{"aal": "aal1"}');
  if pg_temp.guard() <> 'ok' then raise exception 'FAIL: the super admin at aal1 is stopped by maintenance: %', pg_temp.guard(); end if;
  perform pg_temp.act('00000000-0000-4000-8000-0000000000a2', '{"aal": "aal2"}');
  if pg_temp.guard() = 'ok' then raise exception 'FAIL: a plain admin gets through maintenance'; end if;
  perform pg_temp.act('00000000-0000-4000-8000-0000000000a1', '{"aal": "aal2"}');
  perform public.set_maintenance(false, '');
end;
$$;

-- ─── anon can't ask ───────────────────────────────────────────────────────────────────────────────────────────
reset role;
do $$
begin
  if has_function_privilege('anon', 'public.admin_membership()', 'execute') then
    raise exception 'FAIL: anon may call admin_membership()';
  end if;
end;
$$;

rollback;
