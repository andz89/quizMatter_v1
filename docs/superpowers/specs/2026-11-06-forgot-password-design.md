# Forgot password

A teacher who forgot their password gets a link by email and sets a new one. Also: the sign up "Check your email"
screen stops promising an email was sent.

## Why

There is no way to reset a password today: a teacher who forgets it has to email support. And sign up always says
"We sent a link", even when the email already has an account (Supabase then sends nothing, on purpose, so nobody can
find out which emails have accounts). The teacher waits for an email that never comes.

## What the teacher sees

1. **Login** (`src/app/login/page.tsx`): a "Forgot password?" link under the password box → `/forgot-password`.
2. **`/forgot-password`** (new page): the heading "Forgot password", the words "Type your email", an email box, the
   Turnstile check and a "Send link" button. After Send it shows "Check your email. We sent a link to **x@y.com**."
   and "No email after a few minutes? Check your spam folder." It shows that for every email, also one with no
   account (Supabase answers the same and sends nothing then), so the page never tells who has an account.
   A "Back to log in" link.
3. **The email** (Supabase's "Reset Password" email, sent by Resend) has a link to
   `/auth/confirm?token_hash=…&type=recovery`.
4. **`/auth/confirm`** checks the link, logs the teacher in and opens `/set-password`. An old, used or broken reset
   link opens `/login?error=reset`: "This reset link has expired or was already used. Ask for a new one." (with a
   link to `/forgot-password`). If someone is already logged in it does nothing and opens home (as today).
5. **`/set-password`** (new page, needs a login): "Set a new password", New password + Confirm password, "Save
   password". Same rules as the Account page (`passwordSchema`, the two must match). On save: the new password is
   saved, **every other device is logged out**, a toast says "Password changed.", and home opens.
6. **Sign up's "Check your email"** (`src/app/signup/SignUpForm.tsx`): "If **x@y.com** isn't used yet, we sent a link
   to it. Click it to finish making your account." + the spam line + "Already have an account with this email? Log
   in, or reset your password." ("Log in" → `/login`, "reset your password" → `/forgot-password`). The old "Back to
   log in" link goes, since "Log in" is in the sentence.

## How it works

- **`/forgot-password`** (`src/app/forgot-password/page.tsx`, client): zod checks the email, then
  `supabase.auth.resetPasswordForEmail(email, { captchaToken })` from the browser client (like login). No
  `redirectTo`: the link comes from the email template. Errors in plain words, like login's: the check expired
  (`captcha_failed`), "We can't send more emails right now. Please try again in an hour."
  (`over_email_send_rate_limit`, which also covers Supabase's one-email-per-60-seconds rule), too many tries
  (`over_request_rate_limit`), no internet. A failed try gets a fresh Turnstile, like login. Spinner on the button and
  the top line while sending.
- **No new speed bump.** Turnstile plus Supabase's own limits are enough; nothing is added to `browserLimits.ts`.
- **`/auth/confirm`** (`src/app/auth/confirm/route.ts`): the allowed types become `email` and `recovery`. After
  `verifyOtp`: `recovery` → `/set-password`, `email` → `/` (as today). A failure → `/login?error=reset` for `recovery`,
  `/login?error=confirm` for anything else (as today).
- **`/set-password`** (`src/app/set-password/page.tsx`, client): zod checks the two boxes (`passwordSchema` + match),
  then `supabase.auth.updateUser({ password })`, then `supabase.auth.signOut({ scope: "others" })`. `others` ends every
  other login's refresh token, so another device is logged out at its next refresh (within the hour, when its
  current access token runs out). The helper goes in `src/lib/userSettings.ts` next to `changePassword` (e.g.
  `setNewPassword`), reusing `passwordSchema`. Errors: a weak password, the same password as before
  (`same_password`: "That's your current password. Pick a new one."), no internet.
- **Proxy** (`src/proxy.ts`): `/forgot-password` joins `/login` and `/signup` (open while logged out; a logged-in
  visitor goes home). `/set-password` needs a login like every other page. During maintenance both are closed like
  every page (only the super admin gets in; they can reset in the Supabase dashboard).
- **Login page**: the "Forgot password?" link, and the `error=reset` message.

## Supabase email template

- **Live (the user, in the dashboard, before the code is pushed to `dev`):** Authentication → Emails → "Reset
  Password": the link becomes
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`. Until then the email's link uses Supabase's
  default flow, which the app can't finish.
- **Local Docker:** `supabase/config.toml` gets `[auth.email.template.recovery]` with
  `content_path = "./supabase/templates/recovery.html"` (a new file with the same link), so the local flow matches the
  live one.

## Privacy Policy

Resend now also sends password reset emails: the line becomes "**Resend**: sends the sign up and password reset
emails (from no-reply@quizmatter.com)." and `LEGAL_VERSION` (`src/lib/legal.ts`) becomes the day of the change.
Nothing new is collected or kept.

## Notes

- `src/app/CLAUDE.md`: the sign up / login part gets forgot password, set password, the two link types in
  `auth/confirm`, and why sign up's screen doesn't say whether an email is used.
- Root `CLAUDE.md` code map: `forgot-password/`, `set-password/` next to `login/`, `signup/`; the proxy line's list of
  logged-out pages.
- `e2e/CLAUDE.md`: the new test.

## Testing

- `e2e/forgot-password.mjs` on local Docker (`npm run e2e:dev`):
  - `/forgot-password` shows "Type your email"; while logged in it goes home.
  - Ask for a reset for a test teacher. Through the page if Turnstile passes in the headless browser; otherwise the
    test calls local Supabase's `/auth/v1/recover` directly (local has no captcha) and checks the page's form only.
  - Read the email in Mailpit (port 54324), take the token hash, open `APP/auth/confirm?token_hash=…&type=recovery`
    (local `site_url` is port 3000, the test app is 3100) → lands on `/set-password`.
  - A mismatched confirm box is refused; save a new password → home, toast.
  - A second browser logged in before the reset is logged out (its refresh token no longer works).
  - Log in with the new password works; the old one doesn't.
  - The same link opened again → `/login?error=reset` with its message.
- Sign up's "Check your email" text: checked by eye on local Docker.
- `npx tsc --noEmit`, `npm run lint`, `npm test`.

## Not in this change

- No database migration.
- No change to the Account page's password change (it doesn't log out other devices).
- No "password changed" notification email.
