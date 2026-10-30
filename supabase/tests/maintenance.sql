-- Maintenance mode (supabase/migrations/20261219000000_maintenance.sql).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/maintenance.sql
-- Passes when it ends without an error. Everything is rolled back (the guard setting too).
begin;

-- ─── Setup (as postgres): m1 super admin, m2 plain admin, m3 teacher ──────────────────────────────────────────
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000e1', 'mnt-super@example.com', '{"first_name": "Mnt", "last_name": "Super"}'),
  ('00000000-0000-4000-8000-0000000000e2', 'mnt-admin@example.com', '{"first_name": "Mnt", "last_name": "Admin"}'),
  ('00000000-0000-4000-8000-0000000000e3', 'mnt-teacher@example.com', '{"first_name": "Mnt", "last_name": "Teacher"}');
insert into public.admins (user_id, is_super) values
  ('00000000-0000-4000-8000-0000000000e1', true),
  ('00000000-0000-4000-8000-0000000000e2', false);

-- Tries a step as a user; true when it was refused (any error).
create function pg_temp.refused(who uuid, step text) returns boolean language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
  -- The Admin log writes one row per transaction (log_admin_action's flag); in the app each step is its own.
  perform set_config('quizmatter.admin_logged', '', true);
  execute step;
  return false;
exception when others then
  return true;
end;
$$;

-- What the guard says for a role and user: 'ok' or the error's text.
create function pg_temp.guard(who uuid) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
  perform public.check_maintenance();
  return 'ok';
exception when others then
  return sqlerrm;
end;
$$;

grant execute on all functions in schema pg_temp to authenticated, anon;

-- ─── 1. Off: everyone passes, and only the super admin can turn it on ─────────────────────────────────────────
set local role authenticated;
do $$
begin
  if pg_temp.guard('00000000-0000-4000-8000-0000000000e3') <> 'ok' then
    raise exception 'FAIL: the guard refused a teacher while maintenance is off';
  end if;
  if not pg_temp.refused('00000000-0000-4000-8000-0000000000e3', 'select public.set_maintenance(true, '''')') then
    raise exception 'FAIL: a teacher turned maintenance on';
  end if;
  if not pg_temp.refused('00000000-0000-4000-8000-0000000000e2', 'select public.set_maintenance(true, '''')') then
    raise exception 'FAIL: a plain admin turned maintenance on';
  end if;
  if not pg_temp.refused('00000000-0000-4000-8000-0000000000e2',
    'select public.announce_maintenance(now() + interval ''1 day'', '''')') then
    raise exception 'FAIL: a plain admin announced maintenance';
  end if;
end;
$$;

-- ─── 2. Announce: a future time only, shown by maintenance_status ─────────────────────────────────────────────
do $$
begin
  if not pg_temp.refused('00000000-0000-4000-8000-0000000000e1',
    'select public.announce_maintenance(now() - interval ''1 hour'', '''')') then
    raise exception 'FAIL: maintenance was announced for a time already past';
  end if;
  if pg_temp.refused('00000000-0000-4000-8000-0000000000e1',
    'select public.announce_maintenance(now() + interval ''1 day'', ''About 30 minutes.'')') then
    raise exception 'FAIL: the super admin could not announce maintenance';
  end if;
  if (public.maintenance_status() ->> 'planned_at') is null
    or public.maintenance_status() ->> 'message' <> 'About 30 minutes.' then
    raise exception 'FAIL: maintenance_status does not show the announcement';
  end if;
end;
$$;

-- ─── 3. On: the guard is added, only the super admin and maintenance_status pass ──────────────────────────────
do $$
begin
  if pg_temp.refused('00000000-0000-4000-8000-0000000000e1', 'select public.set_maintenance(true, ''Fixing photos.'')') then
    raise exception 'FAIL: the super admin could not turn maintenance on';
  end if;
  if not (public.maintenance_status() ->> 'is_on')::boolean
    or public.maintenance_status() ->> 'message' <> 'Fixing photos.'
    or (public.maintenance_status() ->> 'planned_at') is not null then
    raise exception 'FAIL: maintenance_status is wrong after turning on';
  end if;
  if pg_temp.guard('00000000-0000-4000-8000-0000000000e1') <> 'ok' then
    raise exception 'FAIL: the guard refused the super admin';
  end if;
  if pg_temp.guard('00000000-0000-4000-8000-0000000000e2') not like '%QMMNT%' then
    raise exception 'FAIL: the guard let a plain admin through';
  end if;
  if pg_temp.guard('00000000-0000-4000-8000-0000000000e3') not like '%QMMNT%' then
    raise exception 'FAIL: the guard let a teacher through';
  end if;
  -- The maintenance page's own call passes.
  perform set_config('request.path', '/rpc/maintenance_status', true);
  if pg_temp.guard('00000000-0000-4000-8000-0000000000e3') <> 'ok' then
    raise exception 'FAIL: the guard refused maintenance_status';
  end if;
  perform set_config('request.path', '', true);
  if not pg_temp.refused('00000000-0000-4000-8000-0000000000e1',
    'select public.announce_maintenance(now() + interval ''1 day'', '''')') then
    raise exception 'FAIL: maintenance was announced while it is already on';
  end if;
end;
$$;

-- Logged out (anon) is refused too.
set local role anon;
do $$
begin
  perform public.check_maintenance();
  raise exception 'FAIL: the guard let a logged-out visitor through';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  if sqlerrm not like '%QMMNT%' then raise exception 'FAIL: wrong refusal for a logged-out visitor: %', sqlerrm; end if;
end;
$$;

reset role;
do $$
begin
  if not exists (
    select 1 from pg_db_role_setting s join pg_roles r on r.oid = s.setrole
    where r.rolname = 'authenticator' and 'pgrst.db_pre_request=public.check_maintenance' = any (s.setconfig)
  ) then
    raise exception 'FAIL: turning maintenance on did not add the guard setting';
  end if;
  -- No sign ups.
  if public.hook_before_user_created('{"user": {"email": "new@example.com"}}'::jsonb) -> 'error' ->> 'http_code' <> '503' then
    raise exception 'FAIL: the sign up hook let someone sign up during maintenance';
  end if;
end;
$$;

-- ─── 4. Off again: the guard setting is gone, everyone passes ─────────────────────────────────────────────────
set local role authenticated;
do $$
begin
  if pg_temp.refused('00000000-0000-4000-8000-0000000000e1', 'select public.set_maintenance(false, '''')') then
    raise exception 'FAIL: the super admin could not turn maintenance off';
  end if;
  if pg_temp.guard('00000000-0000-4000-8000-0000000000e3') <> 'ok' then
    raise exception 'FAIL: the guard still refuses a teacher after turning off';
  end if;
end;
$$;

reset role;
do $$
begin
  if exists (
    select 1 from pg_db_role_setting s join pg_roles r on r.oid = s.setrole
    where r.rolname = 'authenticator' and 'pgrst.db_pre_request=public.check_maintenance' = any (s.setconfig)
  ) then
    raise exception 'FAIL: turning maintenance off left the guard setting';
  end if;
  if (select count(*) from public.admin_actions
      where action in ('maintenance_on', 'maintenance_off', 'maintenance_announced')
        and admin_id = '00000000-0000-4000-8000-0000000000e1') <> 3 then
    raise exception 'FAIL: the Admin log does not have the three maintenance steps';
  end if;
  -- Nobody reads the row's other columns directly.
  begin
    set local role authenticated;
    perform m.message from public.maintenance m;
    raise exception 'FAIL: a teacher read the maintenance row directly';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;
rollback;
