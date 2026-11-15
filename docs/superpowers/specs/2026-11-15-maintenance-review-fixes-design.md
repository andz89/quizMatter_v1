# Maintenance review fixes (2026-11-15)

Findings 4, 5 and 9 of the sharing + maintenance `/code-review high` (2026-11-13). Migration
`20261231001600_maintenance_fixes.sql`, test `supabase/tests/maintenance_fixes.sql`.

## 5. Turning it on (or off) twice

Before: `set_maintenance(true)` while already on wrote a new start time, starter and note and logged a second
`maintenance_on` (two admin tabs, or a double click); `set_maintenance(null, …)` counted as off.

Now: `turn_on` null is refused (`22023`). On while already on changes nothing in the row and logs nothing (the
guard setting is put back, in case it went missing). Off while already off logs nothing, but still clears our guard
setting, so "off" always works as the way out.

## 9. Another pre-request hook

`pgrst.db_pre_request` on the `authenticator` role holds one function. Turning maintenance off ran
`alter role authenticator reset pgrst.db_pre_request`, which would wipe another hook if one is ever added.

Approaches:
- **Check before touching it** (picked): `set_maintenance` reads the setting (`pg_db_role_setting`). If it names a
  function other than `public.check_maintenance`, turning on is refused (`22023`, naming it) and turning off leaves
  it as it is. Keeps "nothing extra runs on normal days".
- A permanent pre-request function that returns at once when off: one more database read on every API request,
  forever, for a hook nobody has.

If another pre-request hook is ever needed, put its check inside `check_maintenance` and make that one permanent.

## 4. Supabase Auth during maintenance (known limit, no code)

Maintenance stops PostgREST (all app data), the proxy (pages, server actions, `/api/*`), Claude's connector, the
timers and sign up. Supabase Auth's own endpoints are not stopped: a direct call can still log in (the app logs the
person out again), refresh a token, change the account's own password or email, or ask for a reset email. None of
these reach app data, which stays behind the guard. Stopping them needs a Custom Access Token hook, and a bug there
would stop every login, the super admin's too, so it isn't worth it.
