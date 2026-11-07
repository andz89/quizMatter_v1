# Password Reset Limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A teacher gets at most 3 reset emails a day, and one internet address at most 10 reset requests an hour, with
the same "Check your email" screen over either limit.

**Architecture:** A trigger on `auth.users` records each real reset email; `may_send_password_reset` (secret key only)
counts the address and the teacher; a server action asks it before the browser calls Supabase.

**Tech Stack:** Postgres (migration + SQL test on local Docker), Next.js server action, Playwright + Mailpit.

**Spec:** `docs/superpowers/specs/2026-11-07-password-reset-limit-design.md`

## Global Constraints

- Work on `dev`, commit per task, **do not push**. Local Docker only, never the live database.
- Numbers: 3 a day (Philippine time, `public.manila_today()`), 10 an hour per address. Same in the migration and
  `src/lib/passwords.ts`.
- Over a limit: the same "Check your email" screen. If the check can't run: allow.
- After the migration: `npm run test:sql`, then `npm run db:snapshot`; commit `supabase/schema.sql` and
  `src/lib/database.types.ts` with it.
- Notes stay true: `src/app/CLAUDE.md`, `src/lib/CLAUDE.md`, `e2e/CLAUDE.md`, Admin → Safety, the Privacy Policy.

## Review Focus

1. The trigger fails for any reason → the reset must still work (Task 1: `exception when others`; a test that a failed
   insert doesn't stop the update).
2. A browser calling `may_send_password_reset` directly with a made-up address → refused (Task 1 test: `anon` and
   `authenticated` have no `execute`).
3. An email typed with capitals or spaces finds the teacher (Task 1 test).
4. A teacher reaches 3 at 11 PM Philippine time → allowed again after midnight there, not after UTC midnight (Task 1
   test with a row from yesterday in Manila).
5. The check itself errors (migration not pasted yet) → the page still sends (Task 2: rpc error → true; checked by
   reading, since local always has the migration).

---

### Task 1: The migration and its SQL test

**Files:**
- Create: `supabase/migrations/20261231001000_password_reset_limit.sql`, `supabase/tests/password_reset_limit.sql`
- Modify: `supabase/schema.sql`, `src/lib/database.types.ts` (by `npm run db:snapshot`)

**Interfaces:**
- Produces: `public.may_send_password_reset(p_email text, p_ip text) returns boolean`; tables
  `public.password_reset_sends (user_id, sent_at)`, `public.password_reset_requests (ip, created_at)`.

- [ ] **Step 1:** Write `supabase/tests/password_reset_limit.sql` (header like `blocked_email_domains.sql`, run as
  supabase_admin, `begin … rollback`). As `service_role` where the function is called. Cases, each `raise exception
  'FAIL: …'`: updating `recovery_sent_at` adds a row; a repeat update with the same value adds none; 3 sends → false for
  that teacher, in capitals with spaces too; a row dated yesterday in Manila doesn't count; another teacher → true; an
  unknown email → true; 10 requests from `203.0.113.50` then false; `203.0.113.51` → true; `p_ip` null or `'not-an-ip'`
  → true and no row; `anon` and `authenticated` lack `execute` (`has_function_privilege`); deleting the user deletes
  its rows; renaming `password_reset_sends` for a moment (so the trigger's insert fails) still lets the update through.
- [ ] **Step 2:** `npm run test:sql -- password_reset_limit.sql` → FAIL (function doesn't exist).
- [ ] **Step 3:** Write the migration as in the spec. `count_password_reset_send`: `security definer`, `set search_path
  = ''`, `when (new.recovery_sent_at is not null and new.recovery_sent_at is distinct from old.recovery_sent_at)`,
  `revoke execute … from public, anon, authenticated`; delete that teacher's rows older than 2 days, then insert;
  `exception when others then return new`. `may_send_password_reset`: `revoke … from public, anon, authenticated`,
  `grant execute … to service_role`.
- [ ] **Step 4:** `npm run test:sql` → every test passes (the whole suite), then `npm run db:snapshot`.
- [ ] **Step 5: Commit** migration, test, `schema.sql`, `database.types.ts` →
  `git commit -m "Password reset limit: the database part"`

### Task 2: The page asks first

**Files:**
- Create: `src/app/forgot-password/actions.ts`
- Modify: `src/app/forgot-password/page.tsx`, `src/lib/passwords.ts`, `src/lib/cleanupAccounts.ts`,
  `e2e/forgot-password.mjs`, `src/app/admin/safety/page.tsx`, `src/app/(legal)/privacy/page.tsx`, `src/lib/legal.ts`,
  `src/app/CLAUDE.md`, `src/lib/CLAUDE.md`, `e2e/CLAUDE.md`

**Interfaces:**
- Consumes: `may_send_password_reset` (Task 1).
- Produces: `mayAskForReset(email: string): Promise<boolean>`; `RESETS_PER_DAY`, `RESET_REQUESTS_PER_ADDRESS`.

- [ ] **Step 1: e2e part** (a new teacher, `limited`; a context whose page's POST to `/forgot-password` gets a
  `cf-connecting-ip` header through `route.continue`): 3 sends through the page each bring one email (wait 1.1 s
  between, local's minimum); the 4th shows "Check your email" and no new email arrives in 2 seconds; a new address's
  11th request (rows put in by `psql`) doesn't reach `/auth/v1/recover` (a route counts calls); the line "or try again
  later." shows. The earlier "try again in an hour" check changes to the new words.
- [ ] **Step 2:** run → these FAIL.
- [ ] **Step 3:** `actions.ts`, then `page.tsx` (`mayAskForReset(checked.data).catch(() => true)`; false → `setSentTo`
  and stop), the constants, the cleanup (`password_reset_requests`, same cutoff as `sign_up_attempts`).
- [ ] **Step 4:** Privacy: safety records "The internet address you sign up or ask for a password reset from (to stop
  one person making many accounts or sending many emails)", table row "The internet address you signed up or asked
  for a password reset from: 1 day". Safety: the Forgot password item gets the two limits (from the constants) and the
  words on what a script can skip. Notes.
- [ ] **Step 5:** `node e2e/forgot-password.mjs`, `npm test`, `npx tsc --noEmit`, `npm run lint` → all pass.
- [ ] **Step 6: Commit** → `git commit -m "Forgot password: 3 resets a day, 10 requests an hour per address"`

### Task 3: Final check

- [ ] `npm run test:sql`, `npm test`, `npx tsc --noEmit`, `npm run lint`, `npx next build`, `node e2e/forgot-password.mjs`,
  `node e2e/proxy.mjs` → all pass.
- [ ] A fresh reviewer on the range since `c303967`; fix what needs fixing.
- [ ] Tell the user the deploy order: paste the migration into the live SQL editor, then push.
