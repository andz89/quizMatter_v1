# Password reset limit (3 a day per teacher, per internet address)

The user's rule: a teacher can reset their password 3 times a day, and reset emails are limited by internet address.
Follow-up to `2026-11-06-forgot-password-design.md`.

## What the Supabase row can't do

Supabase's "Rate limit for sending emails" counts the whole project, not an address or a person, so it stays as the
overall cap. Our limit is built next to it.

## Why it isn't a hard wall

`/auth/v1/recover` is public. Checked on local Docker: a trigger on `auth.users` that refuses the change to
`recovery_sent_at` doesn't stop the email. Supabase sends it first, then saves, so the teacher gets a dead link. The
only hard wall is Supabase's Send Email hook, which would move **every** email (sign up too) to our own code and
Resend key: too much risk for this limit. So the limit sits on our Forgot password page. A script calling Supabase
directly skips the check, but it needs a fresh Turnstile pass each time, gets one email per address a minute, and its
emails still count toward that teacher's 3.

## The rules

- **Per teacher:** at most 3 reset emails a day, the day being Philippine time (like the other daily limits). Only
  emails really sent count, read from Supabase itself, so made-up requests don't. Real ones do: someone who knows a
  teacher's email and passes Turnstile 3 times uses up that teacher's day (the review's finding; the owner's rule of 3
  per teacher stands, and the screen doesn't change).
- **Per internet address:** at most 10 reset requests an hour, like sign up's limit. Not 3: schools and mobile
  networks put many teachers behind one address. Every request on the page counts, also for an email with no account.
  On IPv6 the whole /64 counts as one address. It's counted before Turnstile, so a script on a shared connection can
  use up its 10 for an hour: accepted.
- **Over either limit:** the same "Check your email" screen, and no email is asked for. The page never says which limit,
  or that there is one, so it still doesn't tell who has an account.
- **The screen's last line** becomes "No email after a few minutes? Check your spam folder, or try again later."
- **If the check can't run** (the secret key isn't set, or the database refuses): allow the reset. Supabase's own
  limits still stand, and a teacher is never stuck by our mistake. The error is logged.

## How it works

- Migration `20261231001000_password_reset_limit.sql`:
  - `password_reset_sends` (`user_id` → `auth.users`, on delete cascade; `sent_at`): one row per reset email.
  - Trigger `count_password_reset_send`, after `recovery_sent_at` changes on `auth.users`, adds the row. It can never
    fail the update (`exception when others`, with a warning in the log): a failure there would leave the teacher
    with a dead link.
  - `password_reset_requests` (`ip`, `created_at`): one row per request on the page, same shape as `sign_up_attempts`.
  - `may_send_password_reset(p_email text, p_ip text) returns boolean`: `security definer`, only `service_role` may
    call it. It counts the address first (so every request counts, adds a row), then the teacher. An address Postgres
    can't read, or none, skips the address check. It takes the IP as an argument, which is why a browser must never
    be able to call it.
- `src/app/forgot-password/actions.ts`: `mayAskForReset(email): Promise<boolean>`: zod, the address from Cloudflare's
  `cf-connecting-ip` header, the rpc with the secret key (`createAdminClient`). False only when the database says so.
- `src/app/forgot-password/page.tsx`: after zod, asks `mayAskForReset`. False → shows the sent screen and stops. A
  failed call counts as allowed.
- `src/lib/passwords.ts`: `RESETS_PER_DAY = 3`, `RESET_REQUESTS_PER_ADDRESS = 10` for Admin → Safety; "Same limit as" the
  migration.
- `src/lib/cleanupAccounts.ts`: the daily cleanup also deletes both tables' rows older than a day, last, so a database
  without the migration still gets the other cleanups. A teacher's rows also go with the account.

## Privacy

The internet address of a reset request, and when a reset was asked for, are kept up to 2 days (one cleanup a day
deletes rows over a day old): the Privacy Policy's safety records and its table say so.
`LEGAL_VERSION` is the day of the change.

## Deploy order

The user pastes the migration into the live SQL editor **before** pushing. Without it the rpc fails and the check
allows every reset (logged), and the daily cleanup fails at its last step (logged). `SUPABASE_SECRET_KEY` must be set for the Worker (it already is for
Claude's connector and the cleanups); on the preview, previews keep their own secrets, and without it the limit is off.

## Testing

- `supabase/tests/password_reset_limit.sql`: a real send counts through the trigger; the 4th is refused; a row from
  yesterday (Philippine time) doesn't count; another teacher's rows don't count; an unknown email is allowed; the
  11th request from one address is refused and another address isn't; a bad address skips the check; only
  `service_role` may call it; deleting the account deletes its rows.
- `e2e/forgot-password.mjs` runs the page (the rules themselves are in the database, so there's no unit test): 3 real emails,
  then the 4th shows "Check your email" and no email arrives; the 11th request from one address (`cf-connecting-ip`
  added by the test on the page's request) doesn't reach Supabase; the last line's words.

## Not in this change

- Sign up emails: already limited per address.
- The Send Email hook (a hard wall): see above.
