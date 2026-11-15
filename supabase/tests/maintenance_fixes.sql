-- Maintenance fixes (supabase/migrations/20261231001600_maintenance_fixes.sql).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/maintenance_fixes.sql
-- Passes when it ends without an error. Everything is rolled back (the guard setting too).
-- 1. Turning on while already on changes nothing and logs nothing; off twice logs once; null is refused.
-- 2. Another pre-request hook is never overwritten or wiped.
begin;

-- ─── Setup (as postgres): the super admin ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000e7', 'mntfix-super@example.com', '{"first_name": "Mntfix", "last_name": "Super"}');
insert into public.admins (user_id, is_super) values ('00000000-0000-4000-8000-0000000000e7', true);

-- Runs a step as the super admin, like the app (each step its own Admin log row). The error's text, or 'ok'.
create function pg_temp.step(sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-4000-8000-0000000000e7', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('quizmatter.admin_logged', '', true);
  execute sql;
  return 'ok';
exception when others then
  return sqlerrm;
end;
$$;

-- The authenticator role's pre-request setting (null = none).
create function pg_temp.pre_request() returns text language sql as $$
  select substr(c, length('pgrst.db_pre_request=') + 1)
  from pg_db_role_setting s join pg_roles r on r.oid = s.setrole, unnest(s.setconfig) c
  where r.rolname = 'authenticator' and s.setdatabase = 0 and c like 'pgrst.db_pre_request=%';
$$;

create function pg_temp.logged(what text) returns int language sql as $$
  select count(*)::int from public.admin_actions
  where action = what and admin_id = '00000000-0000-4000-8000-0000000000e7';
$$;

grant execute on all functions in schema pg_temp to authenticated;

-- ─── 1. Twice on, twice off, and null ─────────────────────────────────────────────────────────────────────────
do $$
declare
  first_start timestamptz;
  result text;
begin
  result := pg_temp.step('select public.set_maintenance(null, '''')');
  if result = 'ok' then
    raise exception 'FAIL: set_maintenance(null) was taken';
  end if;

  result := pg_temp.step('select public.set_maintenance(true, ''First note.'')');
  if result <> 'ok' then
    raise exception 'FAIL: could not turn maintenance on: %', result;
  end if;
  select m.started_at into first_start from public.maintenance m where m.id;

  -- A second tab turns it on again a moment later, with another note.
  update public.maintenance set started_at = started_at - interval '5 minutes' where id;
  select m.started_at into first_start from public.maintenance m where m.id;
  result := pg_temp.step('select public.set_maintenance(true, ''Second note.'')');
  if result <> 'ok' then
    raise exception 'FAIL: turning on again was refused: %', result;
  end if;
  if (select m.started_at from public.maintenance m where m.id) is distinct from first_start
    or (select m.message from public.maintenance m where m.id) <> 'First note.' then
    raise exception 'FAIL: turning on again changed the start time or the note';
  end if;
  if pg_temp.logged('maintenance_on') <> 1 then
    raise exception 'FAIL: turning on again logged another maintenance_on';
  end if;

  result := pg_temp.step('select public.set_maintenance(false, '''')');
  result := pg_temp.step('select public.set_maintenance(false, '''')');
  if result <> 'ok' then
    raise exception 'FAIL: turning off again was refused: %', result;
  end if;
  if pg_temp.logged('maintenance_off') <> 1 then
    raise exception 'FAIL: turning off twice logged two maintenance_off';
  end if;
  if pg_temp.pre_request() is not null then
    raise exception 'FAIL: the guard setting is still there after turning off';
  end if;
end $$;

-- Off while off still clears a leftover guard setting (the way out if it ever gets stuck).
alter role authenticator set pgrst.db_pre_request = 'public.check_maintenance';
do $$
begin
  if pg_temp.step('select public.set_maintenance(false, '''')') <> 'ok' or pg_temp.pre_request() is not null then
    raise exception 'FAIL: turning off did not clear a leftover guard setting';
  end if;
end $$;

-- ─── 2. Another pre-request hook stays ────────────────────────────────────────────────────────────────────────
alter role authenticator set pgrst.db_pre_request = 'public.some_other_hook';
do $$
declare result text;
begin
  result := pg_temp.step('select public.set_maintenance(true, '''')');
  if result not like '%public.some_other_hook%' then
    raise exception 'FAIL: turning on over another pre-request hook wasn''t refused by name: %', result;
  end if;
  if (select m.is_on from public.maintenance m where m.id) then
    raise exception 'FAIL: maintenance is on without its guard';
  end if;
  result := pg_temp.step('select public.set_maintenance(false, '''')');
  if result <> 'ok' then
    raise exception 'FAIL: turning off was refused: %', result;
  end if;
  if pg_temp.pre_request() is distinct from 'public.some_other_hook' then
    raise exception 'FAIL: turning off wiped another pre-request hook (now %)', pg_temp.pre_request();
  end if;
end $$;

rollback;
