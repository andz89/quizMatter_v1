-- A logged-out visitor (the anon role) keeps only the rights the app's logged-out pages use.
--
-- Supabase gives anon every right on every new table, sequence and function in public. The row rules (RLS) have no
-- policy for anon on those tables, so nothing was readable, but one table made without RLS, or one loose policy,
-- would have opened it to everyone on the internet. Now the grants themselves say no.
--
-- What a logged-out visitor still needs:
--   - blocked_email_domains (SELECT): the sign up page reads the throwaway email services.
--   - maintenance (SELECT id, is_on) and check_maintenance(): the maintenance guard runs before every API request.
--   - maintenance_status(): the proxy and the login page ask it.
-- Nothing changes for logged-in teachers (authenticated), the secret key (service_role) or the sign up hook
-- (supabase_auth_admin).

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Every function anon could still run (by its own grant or by PUBLIC's), but trigger functions: Postgres refuses to
-- run those outside their trigger, and they stay as they are. The roles that use one of them get their own grant
-- first, so taking PUBLIC's away changes nothing for them.
do $$
declare
  fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prorettype <> 'trigger'::regtype
      and has_function_privilege('anon', p.oid, 'execute')
  loop
    execute format('grant execute on function %s to authenticated, service_role, supabase_auth_admin', fn);
    execute format('revoke execute on function %s from public, anon', fn);
  end loop;
end;
$$;

grant select on public.blocked_email_domains to anon;
grant select (id, is_on) on public.maintenance to anon;
grant execute on function public.maintenance_status() to anon;
grant execute on function public.check_maintenance() to anon;

-- New tables, sequences and functions no longer open to anon by themselves. (A new function is still open to
-- PUBLIC, Postgres's own default, so it keeps its "revoke execute … from public, anon";
-- supabase/tests/anon_grants.sql fails, naming it, when one is forgotten.)
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon;
