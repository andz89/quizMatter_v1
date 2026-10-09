# Sign Up Spam Limits — Design

Date: 2026-10-09

## Goal

Make fake sign ups slow and harmless, and show every sign up protection on Admin → Safety.

Already built on the `account-cleanup` branch (this design only documents them): the throwaway email block
(`src/lib/blockedEmailDomains.ts`) and the daily cleanup of unconfirmed accounts (`src/lib/cleanupAccounts.ts`).

New:

1. **Per internet address (server):** at most **10 new accounts per hour** from one internet address. Checked by a
   Supabase "Before User Created" hook, so scripts and cleared browsers can't skip it, and no email is sent when it
   refuses.
2. **Per browser:** **3 sign ups within 1 hour** lock the sign up page on that browser for **1 hour**; if it gets
   locked again within **24 hours** of the last lock, for **24 hours**. A speed bump for a person clicking by hand.
3. **Clearer message** when Supabase runs out of sign up emails for the hour.
4. **Admin → Safety:** a new "Sign up" group that explains all of it.

Login is not affected by any of this.

## 1. Per internet address: the Before User Created hook

### Migration `20261105000000_sign_up_limit.sql`

- Table `public.sign_up_attempts (ip inet not null, created_at timestamptz not null default now())`, index on
  `(ip, created_at)`. Row level security on, no policies. `grant select, insert, delete` to `supabase_auth_admin`;
  `revoke all` from `anon, authenticated, public`.
- Function `public.hook_before_user_created(event jsonb) returns jsonb` (plpgsql, `set search_path = ''`):
  - `ip := nullif(event->'metadata'->>'ip_address', '')::inet`. No address → allow (`'{}'`).
  - Count rows for that `ip` with `created_at > now() - interval '1 hour'`.
  - `>= 10` → return `{"error": {"http_code": 429, "message": "Too many accounts were made from this internet
    connection. Please try again in an hour."}}`. Nothing is inserted, the account isn't made, no email is sent.
  - Otherwise insert a row for `ip` and return `'{}'`.
  - `grant execute` to `supabase_auth_admin`; `revoke execute` from `anon, authenticated, public`.
- The limit (10) and window (1 hour) are written in the function, with a comment pointing at
  `SIGN_UPS_PER_ADDRESS` in `src/lib/signUpLimit.ts` (the Safety page shows that constant; keep both the same).

### Cleanup

`cleanupUnconfirmedAccounts` (daily) also deletes `sign_up_attempts` rows older than 1 day, so the table stays small.

### Dashboard step (user)

Authentication → Hooks → **Before User Created** → Postgres → `public.hook_before_user_created` → enable.

### Notes

- It counts per address, so teachers on one school Wi-Fi share 10 an hour. 10 leaves room for a small group;
  a bigger training session would have to spread sign ups over more than an hour.
- A VPN or switching mobile data gives a new address (a fresh count). Turnstile is still needed for every try.
- It also runs when an admin adds a teacher in the dashboard (counted against the admin's address). That's fine.

## 2. Per browser: `src/lib/signUpLimit.ts`

- Constants: `SIGN_UPS_PER_BROWSER = 3`, `BROWSER_WINDOW_MS = 1 hour`, `FIRST_LOCK_MS = 1 hour`,
  `REPEAT_LOCK_MS = 24 hours`, `REPEAT_WITHIN_MS = 24 hours`, and `SIGN_UPS_PER_ADDRESS = 10` (for the Safety page).
- Stored in `localStorage` under `qm-sign-up-limit`: `{ times: number[], lockedUntil: number, lastLockAt: number }`.
  Every read and write is in try/catch; bad or missing data counts as empty, and if storage is blocked the lock is
  simply skipped (never blocks a real teacher by mistake).
- `signUpLockedUntil(): number | null` — the time the lock ends, or null if not locked.
- `recordSignUp()` — called after a sign up goes through. Keeps the times from the last hour, adds now; at 3, locks:
  24 hours if `lastLockAt` is less than 24 hours ago, else 1 hour; sets `lastLockAt = now` and clears `times`.

### Sign up page (`src/app/signup/page.tsx`)

- On "Create account", before anything is sent: if locked, show under the form "You've made several accounts on
  this browser. Please try again after 3:45 PM." (or "after tomorrow, 3:45 PM" when it ends on another day) and stop.
  Checked on click, not on page load, so the server and browser draw the same page.
- After `signUp` succeeds: `recordSignUp()`, then the "Check your email" screen as now.
- Error messages:
  - The hook's refusal: show its message (the one above).
  - `over_email_send_rate_limit`: "We can't send more sign up emails right now. Please try again in an hour."
  - `over_request_rate_limit` keeps "Too many tries. Please wait a few minutes and try again."

## 3. Admin → Safety: new "Sign up" group

Between "Access" and "Outside the app", in the same `Item` style (name, where, rule, teacher sees, More: what /
example / scenario), using the constants so the page stays true when a number changes:

| Item | Where |
|---|---|
| Email must be confirmed | Supabase |
| Throwaway emails refused | App (sign up form) |
| Sign ups per browser (3 an hour → 1 hour, then 24 hours) | Browser |
| Sign ups per internet address (10 an hour) | Database (Supabase hook) |
| Unconfirmed accounts deleted after 3 days | Cloudflare timer, daily |
| Supabase sign up and email limits (30 sign ups and logins per 5 min per address; emails per hour) | Supabase dashboard |

The 3-day cleanup and the blocked domain count come from their files (`KEEP_UNCONFIRMED_DAYS` exported from
`cleanupAccounts.ts`, `BLOCKED_EMAIL_DOMAINS.size`). The Supabase dashboard numbers are written as text with "set in
the Supabase dashboard", like the Cloudflare item.

## Not included

Per-device fingerprinting, invite codes, admin approval, Sign in with Google, extra login limits.

## Checking

`npx tsc --noEmit`, `npm run lint` on changed files, re-read the diff. Live testing and the dashboard step are left
to the user.
