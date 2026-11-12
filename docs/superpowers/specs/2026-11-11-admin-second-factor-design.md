# Two-step login for admins (design, 2026-11-11)

## Why

The super admin can ban, delete, move and publish anything; a plain admin can hide, approve and publish. One
phished or reused password was enough to take that over. Admins now log in with their password **and** a 6-digit
code from an authenticator app (Google Authenticator, Authy, 1Password, …), Supabase's TOTP MFA.

## The rule lives in the database

- Supabase puts an `aal` claim in every login token: `aal1` after the password, `aal2` after a verified code.
- `is_admin()` and `is_super_admin()` are true only for a member of `admins` **and** `second_factor_ok()`:
  the token's `aal` is `aal2`, or the token is Claude's connector token (Supabase's OAuth server, a `client_id`
  claim) and the admin has a verified factor. Consent for that token can only be given in the app, which asks for
  the second step first, so the token itself was only obtainable after it.
- Everything that already uses those two functions (admin functions, policies, triggers, the maintenance guard,
  the Admin log) asks for the second step at once, so a direct API call with a stolen password gets nothing.
- `admin_membership()` ('super' / 'admin' / 'none') reads the `admins` table alone, whatever the level. It gives no
  power; the app uses it to route an admin to the set-up or verify step. `check_maintenance` lets a super admin
  member through at aal1 (so they can reach the verify page); every admin function still refuses them until aal2.

Migration: `supabase/migrations/20261231001300_admin_second_factor.sql`. Test:
`supabase/tests/admin_second_factor.sql`.

## In the app

- `getAccount()` gets `adminRole` (membership). `isAdmin` / `isSuperAdmin` stay the database's answer.
- `/account/two-step` (`TwoStepSetup.tsx`): admins only. Lists the factors: a verified one → "Two-step login is
  on". None → removes unfinished ones, enrolls a TOTP factor (QR code + the key), and the first right code
  (`challengeAndVerify`) turns it on; that also lifts the login to aal2, so Admin opens right after.
- `/login/verify`: the code after the password (`listFactors` → `challengeAndVerify`), then back to `?next=`
  (`safeNextPath`: this site only, never the verify page). An account without a factor is told there is nothing
  to check.
- The login page: after the password, an account with a verified factor goes to `/login/verify?next=…`.
- The admin layout: a member who isn't an admin yet goes to `/login/verify?next=/admin` (has a factor) or to
  `/account/two-step` (none). Teachers still get "page not found".
- Maintenance: the proxy and the login page let a super admin *member* through (`admin_membership`), and
  `/login/verify` stays open, so the super admin can type their code during maintenance.
- No in-app removal: a lost phone is fixed by the super admin in the Supabase dashboard (Authentication → Users →
  the account → remove the factor), then the admin sets it up again.

## Deploy order (the one exception to "database first")

1. Supabase dashboard: Authentication → Multi-Factor → turn on TOTP (enroll and verify).
2. Deploy the app. Nothing changes yet for anyone (`admin_membership` is missing on the old database; the app treats
   that as 'none', and the old `is_admin()` still answers by membership).
3. Each admin opens Account → Two-step login and sets it up.
4. Apply the migration. From then on a login without the code is not an admin.

Applied before step 2, every admin loses the admin pages until the app that sets up the second step is live.

## Tests

- SQL tests that act as an admin set `'aal', 'aal2'` in their claims.
- Browser tests: `makeTeacher({ superAdmin: true })` / `({ admin: true })` enroll a factor through Supabase's API and
  log in at aal2 (`e2e/lib.mjs`: `enrollSecondFactor`, `loginSession`, `totpCode`, a 6-digit TOTP made in Node).
  `e2e/second-factor.mjs` walks through set-up, the verify page, the login page and a teacher.
- Local Supabase has TOTP on in `supabase/config.toml` (`[auth.mfa.totp]`).
