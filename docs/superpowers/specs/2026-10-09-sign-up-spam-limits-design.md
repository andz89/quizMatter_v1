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
3. **Login, per browser:** **5 wrong logins within 15 minutes** lock the login page on that browser for
   **15 minutes**; if it gets locked again within **24 hours**, for **1 hour**. Only "wrong email or password" counts;
   a correct login resets the count. (Supabase's server-side "Password Verification Attempt" hook would be stronger,
   but it is only on the Team and Enterprise plans.)
4. **Clearer message** when Supabase runs out of sign up emails for the hour.
5. **Admin → Safety:** a new "Sign up and login" group that explains all of it.

The sign up limits never count logins, and the login lock never counts sign ups.

## 1. Per internet address: the Before User Created hook

### Migration `20261108000000_sign_up_limit.sql`

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

## 2. Per browser: `src/lib/browserLimits.ts`

One small helper for both browser locks (sign up and login), since they follow the same rule.

- `type BrowserLimit = { key: string; max: number; withinMs: number; firstLockMs: number; repeatLockMs: number; repeatWithinMs: number }`
- `SIGN_UP_LIMIT`: key `qm-sign-up-limit`, max 3, within 1 hour, first lock 1 hour, repeat lock 24 hours, repeat within 24 hours.
- `LOGIN_LIMIT`: key `qm-login-limit`, max 5, within 15 minutes, first lock 15 minutes, repeat lock 1 hour, repeat within 24 hours.
- `SIGN_UPS_PER_ADDRESS = 10` (the hook's number, for the Safety page; keep it the same as the migration).
- Stored in `localStorage` under the limit's key: `{ times: number[], lockedUntil: number, lastLockAt: number }`.
  Every read and write is in try/catch; bad or missing data counts as empty, and if storage is blocked the lock is
  simply skipped (never blocks a real teacher by mistake).
- `lockedUntil(limit): number | null` — the time the lock ends, or null if not locked.
- `recordTry(limit)` — keeps the times within `withinMs`, adds now; at `max`, locks: `repeatLockMs` if `lastLockAt`
  is less than `repeatWithinMs` ago, else `firstLockMs`; sets `lastLockAt = now` and clears `times`.
- `clearTries(limit)` — empties `times` (keeps `lastLockAt`, so a repeat still counts as a repeat).
- `tryAgainAfter(time): string` — "3:45 PM", or "tomorrow, 3:45 PM" when it's on another day.

### Sign up page (`src/app/signup/page.tsx`)

- On "Create account", before anything is sent: if `lockedUntil(SIGN_UP_LIMIT)`, show under the form "You've made
  several accounts on this browser. Please try again after {tryAgainAfter}." and stop. Checked on click, not on page
  load, so the server and browser draw the same page.
- After `signUp` succeeds: `recordTry(SIGN_UP_LIMIT)`, then the "Check your email" screen as now.

### Login page (`src/app/login/page.tsx`)

- On "Log in", before anything is sent: if `lockedUntil(LOGIN_LIMIT)`, show "Too many wrong tries on this browser.
  Please try again after {tryAgainAfter}." and stop (the Turnstile pass isn't used up).
- Supabase answers `invalid_credentials`: `recordTry(LOGIN_LIMIT)`. If that try started a lock, show the lock message
  instead of "Wrong email or password."
- Login succeeds: `clearTries(LOGIN_LIMIT)`.
- Every other error (network, captcha, banned, not confirmed) doesn't count.
- Error messages:
  - The hook's refusal: show its message (the one above).
  - `over_email_send_rate_limit`: "We can't send more sign up emails right now. Please try again in an hour."
  - `over_request_rate_limit` keeps "Too many tries. Please wait a few minutes and try again."

## 3. Admin → Safety: new "Sign up and login" group

Between "Access" and "Outside the app", in the same `Item` style (name, where, rule, teacher sees, More: what /
example / scenario), using the constants so the page stays true when a number changes:

| Item | Where |
|---|---|
| Email must be confirmed | Supabase |
| Throwaway emails refused | App (sign up form) |
| Sign ups per browser (3 an hour → 1 hour, then 24 hours) | Browser |
| Sign ups per internet address (10 an hour) | Database (Supabase hook) |
| Unconfirmed accounts deleted after 3 days | Cloudflare timer, daily |
| Wrong logins per browser (5 in 15 min → 15 min, then 1 hour) | Browser |
| Supabase sign up and email limits (30 sign ups and logins per 5 min per address; emails per hour) | Supabase dashboard |

The existing "Login check" item (Turnstile) moves from "Access" into this group.

The 3-day cleanup and the blocked domain count come from their files (`KEEP_UNCONFIRMED_DAYS` exported from
`cleanupAccounts.ts`, `BLOCKED_EMAIL_DOMAINS.size`). The Supabase dashboard numbers are written as text with "set in
the Supabase dashboard", like the Cloudflare item.

## Not included

Per-device fingerprinting, invite codes, admin approval, Sign in with Google, a server-side login limit (needs the
Team plan), "Forgot password".

## Checking

`npx tsc --noEmit`, `npm run lint` on changed files, re-read the diff. Live testing and the dashboard step are left
to the user.
