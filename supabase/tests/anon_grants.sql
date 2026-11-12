-- A logged-out visitor (the anon role) may only do what the app's logged-out pages need
-- (supabase/migrations/20261231001400_anon_grants.sql): read the throwaway email services (sign up) and the
-- maintenance guard's two columns, and call maintenance_status and check_maintenance. Everything else is refused by
-- the grants themselves, not only by the row rules. A new table, view, sequence or function must not open to anon
-- either (this test lists it by name).
-- Run on a local database with every migration applied:
--   psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/anon_grants.sql
-- Passes when it ends without an error. Everything is rolled back.
begin;

do $$
declare
  found text;
begin
  -- Tables and views: no right at all, but SELECT on blocked_email_domains.
  select string_agg(c.relname || ' (' || priv || ')', ', ' order by c.relname, priv) into found
  from pg_class c, unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) priv
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p')
    and has_table_privilege('anon', c.oid, priv)
    and not (c.relname = 'blocked_email_domains' and priv = 'select');
  if found is not null then raise exception 'FAIL: anon has rights on: %', found; end if;

  -- Columns: only the maintenance guard's two (and blocked_email_domains, by its table grant).
  select string_agg(c.relname || '.' || a.attname, ', ' order by c.relname, a.attname) into found
  from pg_attribute a join pg_class c on c.oid = a.attrelid
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p') and a.attnum > 0 and not a.attisdropped
    and (has_column_privilege('anon', a.attrelid, a.attnum, 'select') or has_column_privilege('anon', a.attrelid, a.attnum, 'insert')
      or has_column_privilege('anon', a.attrelid, a.attnum, 'update') or has_column_privilege('anon', a.attrelid, a.attnum, 'references'))
    and c.relname <> 'blocked_email_domains'
    and not (c.relname = 'maintenance' and a.attname in ('id', 'is_on'));
  if found is not null then raise exception 'FAIL: anon has column rights on: %', found; end if;
  if has_column_privilege('anon', 'public.maintenance', 'is_on', 'update') then
    raise exception 'FAIL: anon may change maintenance.is_on';
  end if;

  -- Sequences: none.
  select string_agg(c.relname, ', ' order by c.relname) into found
  from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind = 'S'
    and (has_sequence_privilege('anon', c.oid, 'usage') or has_sequence_privilege('anon', c.oid, 'select') or has_sequence_privilege('anon', c.oid, 'update'));
  if found is not null then raise exception 'FAIL: anon has rights on sequences: %', found; end if;

  -- Functions: only the two the maintenance stop needs. (A trigger function can't be called at all: Postgres
  -- refuses to run one outside its trigger, so those aren't listed.)
  select string_agg(p.oid::regprocedure::text, ', ' order by p.proname) into found
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prorettype <> 'trigger'::regtype
    and has_function_privilege('anon', p.oid, 'execute')
    and p.proname not in ('maintenance_status', 'check_maintenance');
  if found is not null then raise exception 'FAIL: anon may run: %', found; end if;

  -- What it needs is still there.
  if not has_table_privilege('anon', 'public.blocked_email_domains', 'select') then
    raise exception 'FAIL: anon can no longer read blocked_email_domains (sign up needs it)';
  end if;
  if not (has_function_privilege('anon', 'public.maintenance_status()', 'execute') and has_function_privilege('anon', 'public.check_maintenance()', 'execute')) then
    raise exception 'FAIL: anon can no longer call maintenance_status / check_maintenance';
  end if;

  -- Logged-in teachers and the secret key lost nothing they use.
  if not (has_table_privilege('authenticated', 'public.presentations', 'select') and has_table_privilege('service_role', 'public.presentations', 'insert')) then
    raise exception 'FAIL: authenticated / service_role lost rights on presentations';
  end if;
  if not (has_function_privilege('authenticated', 'public.age_on(date, date)', 'execute') and has_function_privilege('supabase_auth_admin', 'public.age_on(date, date)', 'execute')
    and has_function_privilege('supabase_auth_admin', 'public.manila_today()', 'execute')) then
    raise exception 'FAIL: the birthday helpers were taken from a role that uses them';
  end if;
end;
$$;

-- ─── As a logged-out visitor ──────────────────────────────────────────────────────────────────────────────────
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

do $$
declare
  status jsonb;
begin
  perform count(*) from public.blocked_email_domains;
  perform public.check_maintenance();
  status := public.maintenance_status();
  if status is null then raise exception 'FAIL: maintenance_status gave nothing to a logged-out visitor'; end if;

  begin
    perform count(*) from public.presentations;
    raise exception 'FAIL: anon read presentations';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.folders (owner_id, name) values ('00000000-0000-4000-8000-0000000000a1', 'x');
    raise exception 'FAIL: anon wrote a folder';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.manila_today();
    raise exception 'FAIL: anon ran manila_today';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
rollback;
