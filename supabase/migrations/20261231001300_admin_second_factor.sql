-- Admins need a second factor (two-step login with an authenticator app, Supabase's TOTP MFA). A stolen or guessed
-- admin password alone is no longer enough: is_admin() and is_super_admin() are true only when the login passed the
-- second step, so every admin function, policy and the maintenance guard ask for it at once. Spec:
-- docs/superpowers/specs/2026-11-11-admin-second-factor-design.md. Test: supabase/tests/admin_second_factor.sql.
--
-- - A browser login: the token's aal claim must be 'aal2' (Supabase sets it after the code is verified; a token
--   without the claim is aal1).
-- - Claude's connector token (Supabase's OAuth server; it has a client_id claim): it counts when the admin has a
--   verified factor. Consent for it can only be given in the app, which asks for the second step first, so the
--   token itself was only obtainable after it.
-- - admin_membership(): 'super', 'admin' or 'none' from the admins table alone, whatever the level, for the pages
--   that send an admin to set up or verify the second step (the admin layout, the proxy during maintenance, the
--   login page). It gives no power: every real check still goes through is_admin() / is_super_admin().
-- - check_maintenance lets a super admin member through at aal1 (they must reach the verify page); every admin
--   function still refuses them until aal2.
--
-- DEPLOY ORDER (the one exception to "database first"): turn on TOTP in the Supabase dashboard (Authentication →
-- Multi-Factor), deploy the app, set up the second step in Account → Two-step login, THEN apply this. Applied
-- first, every admin loses the admin pages until the app that sets up the second step is live.

-- ─── 1. The second step check (private helper) ───────────────────────────────────────────────────────────────
create or replace function public.second_factor_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
    or (
      (select auth.jwt() ->> 'client_id') is not null
      and exists (
        select 1 from auth.mfa_factors f
        where f.user_id = (select auth.uid()) and f.status = 'verified'
      )
    );
$$;
revoke execute on function public.second_factor_ok() from public, anon, authenticated;

-- ─── 2. is_admin / is_super_admin ask for it ─────────────────────────────────────────────────────────────────
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()))
    and public.second_factor_ok();
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()) and is_super)
    and public.second_factor_ok();
$$;

-- ─── 3. Membership alone, for the pages that route an admin to the set-up or verify step ─────────────────────
create or replace function public.admin_membership()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select case when a.is_super then 'super' else 'admin' end
     from public.admins a where a.user_id = (select auth.uid())),
    'none');
$$;
revoke execute on function public.admin_membership() from public, anon;
grant execute on function public.admin_membership() to authenticated;

-- ─── 4. The maintenance guard lets a super admin member through, so they can verify ──────────────────────────
-- Same as 20261219000000_maintenance.sql, with admin_membership() in place of is_super_admin().
create or replace function public.check_maintenance()
returns void
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'service_role'
    or current_setting('request.path', true) = '/rpc/maintenance_status'
    or not (select m.is_on from public.maintenance m where m.id)
  then
    return;
  end if;
  -- Its own step: Postgres checks the right to call admin_membership() even when an "or" wouldn't need it, and
  -- anon has none.
  if current_user = 'authenticated' then
    if public.admin_membership() = 'super' then
      return;
    end if;
  end if;
  -- PostgREST turns this into the answer: HTTP 503 with {"code": "QMMNT", ...} (REFUSALS in
  -- src/lib/presentations.ts, and src/components/MaintenanceWatch.tsx sends the tab to /maintenance).
  raise sqlstate 'PGRST' using
    message = '{"code": "QMMNT", "message": "QuizMatter is under maintenance. Please try again later."}',
    detail = '{"status": 503, "headers": {"Retry-After": "600"}}';
end;
$$;
