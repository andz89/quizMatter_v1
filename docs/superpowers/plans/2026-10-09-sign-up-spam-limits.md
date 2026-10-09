# Sign Up Spam Limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Limit sign ups per internet address (Supabase hook) and per browser, limit wrong logins per browser, and
explain every sign up / login protection on Admin → Safety.

**Architecture:** A Postgres "Before User Created" hook counts new accounts per IP in `sign_up_attempts` and refuses
the 11th within an hour. One browser helper (`src/lib/browserLimits.ts`, localStorage) serves both the sign up lock
and the login lock. The Safety page gets a "Sign up and login" group built from the same constants.

**Tech Stack:** Supabase Postgres + Auth hooks, Next.js 16 client pages, Cloudflare Worker cron. No new packages.

**Spec:** `docs/superpowers/specs/2026-10-09-sign-up-spam-limits-design.md`

## Global Constraints

- Hook: 10 new accounts per IP per hour; message "Too many accounts were made from this internet connection. Please try again in an hour."
- Sign up lock: 3 within 1 hour → 1 hour; again within 24 hours → 24 hours. Message "You've made several accounts on this browser. Please try again after {time}."
- Login lock: 5 wrong within 15 minutes → 15 minutes; again within 24 hours → 1 hour. Message "Too many wrong tries on this browser. Please try again after {time}." Only `invalid_credentials` counts; success clears.
- Email limit message: "We can't send more sign up emails right now. Please try again in an hour."
- Storage blocked or broken → never lock. Design system classes only; plain English; no new packages.
- No test runner in the project: pure logic is checked with a throwaway Node script in the scratchpad; everything with `npx tsc --noEmit` + eslint on changed files.

## Review Focus

1. Storage blocked / corrupted JSON in localStorage → the page must still work (no lock, no crash).
2. A lock that ends tomorrow → message says "tomorrow, 3:45 PM", not a misleading "3:45 PM".
3. Hook with no IP in the payload → allow (never block everyone).
4. A login lock starting on the 5th wrong try → shows the lock message, not "Wrong email or password."
5. Sign up refused by the hook → its own message shown, not "Something went wrong".

---

### Task 1: Migration + cleanup of old address rows

**Files:** Create `supabase/migrations/20261108000000_sign_up_limit.sql`; Modify `src/lib/cleanupAccounts.ts`.

- [ ] Write the migration: table `public.sign_up_attempts (ip inet not null, created_at timestamptz not null default now())`, index `(ip, created_at)`, RLS on with no policies, `grant usage on schema public to supabase_auth_admin`, `grant select, insert on public.sign_up_attempts to supabase_auth_admin`, `revoke all … from anon, authenticated, public`; function `public.hook_before_user_created(event jsonb) returns jsonb language plpgsql set search_path = ''` (no security definer, per Supabase's advice) that allows when there's no IP, refuses with `{"error":{"http_code":429,"message":…}}` at ≥ 10 rows in the last hour, else inserts and returns `'{}'`; `grant execute` to `supabase_auth_admin`, `revoke execute` from `anon, authenticated, public`.
- [ ] `cleanupUnconfirmedAccounts` also deletes `sign_up_attempts` rows older than 1 day; export `KEEP_UNCONFIRMED_DAYS = 3`.
- [ ] tsc + eslint; commit.

### Task 2: `src/lib/browserLimits.ts`

**Produces:** `type BrowserLimit`, `SIGN_UP_LIMIT`, `LOGIN_LIMIT`, `SIGN_UPS_PER_ADDRESS = 10`, `SIGN_UP_ADDRESS_MESSAGE`, `lockedUntil(limit, now?) → number | null`, `recordTry(limit, now?) → number | null` (lock end if this try started one), `clearTries(limit)`, `tryAgainAfter(time, now?) → string`.

- [ ] Write a throwaway Node test (scratchpad) with a fake `localStorage`: 2 tries → not locked; 3rd → locked 1 h; after the lock, 3 more within 24 h → locked 24 h; login: 5th wrong try locks 15 min, repeat → 1 h; `clearTries` keeps the repeat; corrupted JSON → not locked; `localStorage` throwing → not locked, no crash; `tryAgainAfter` adds "tomorrow, " for another day. Run it → fails (no module).
- [ ] Write the module; run the test → passes.
- [ ] tsc + eslint; commit.

### Task 3: Sign up page

**Files:** Modify `src/app/signup/page.tsx`.

- [ ] Before sending: `lockedUntil(SIGN_UP_LIMIT)` → error "You've made several accounts on this browser. Please try again after {tryAgainAfter(until)}." and return (captcha pass not used).
- [ ] After `signUp` succeeds: `recordTry(SIGN_UP_LIMIT)`.
- [ ] `signUpErrorMessage`: message containing `SIGN_UP_ADDRESS_MESSAGE` → that message; `over_email_send_rate_limit` → the email message; `over_request_rate_limit` keeps "Too many tries…".
- [ ] tsc + eslint; commit.

### Task 4: Login page

**Files:** Modify `src/app/login/page.tsx`.

- [ ] Before sending: `lockedUntil(LOGIN_LIMIT)` → lock message, return.
- [ ] On `invalid_credentials`: `const until = recordTry(LOGIN_LIMIT)`; show the lock message if `until`, else "Wrong email or password."
- [ ] On success: `clearTries(LOGIN_LIMIT)`.
- [ ] tsc + eslint; commit.

### Task 5: Admin → Safety "Sign up and login" group

**Files:** Modify `src/app/admin/safety/page.tsx`.

- [ ] New `<Group title="Sign up and login">` between "Access" and "Outside the app"; move the "Login check" item into it; add items: Email must be confirmed, Throwaway emails refused (`BLOCKED_EMAIL_DOMAINS.size`), Sign ups per internet address (`SIGN_UPS_PER_ADDRESS`), Sign ups per browser (`SIGN_UP_LIMIT`), Wrong logins per browser (`LOGIN_LIMIT`), Unconfirmed accounts deleted (`KEEP_UNCONFIRMED_DAYS`), Supabase sign up and email limits (dashboard text). Each with `more` (what / example / scenario), using `duration()` for times.
- [ ] tsc + eslint; commit.

### Task 6: Final check

- [ ] Whole-change review by a fresh reviewer; fix Critical/Important; report; dashboard step (enable the hook) and migration offer to the user.
