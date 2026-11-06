# Forgot Password Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A teacher who forgot their password asks for a link by email, opens it and sets a new password; sign up's
"Check your email" stops promising an email was sent.

**Architecture:** All in the browser + one route, no database change. `/forgot-password` calls Supabase's
`resetPasswordForEmail`; the email's link opens `/auth/confirm?type=recovery`, which logs the teacher in and sends
them to `/set-password`, which calls `updateUser` then `signOut({ scope: "others" })`. The password rules move to a
small `src/lib/passwords.ts` so `npm test` can load them.

**Tech Stack:** Next.js (this repo's version: read `node_modules/next/dist/docs/` before writing pages), Supabase JS
(`@supabase/ssr` clients in `src/lib/supabase/`), zod, Playwright (e2e), Mailpit (local Supabase's mail catcher,
port 54324).

**Spec:** `docs/superpowers/specs/2026-11-06-forgot-password-design.md`

## Global Constraints

- Work on `dev`; commit per task; **do not push** (the user changes the live "Reset Password" email template first).
- Testing only on local Docker (`npx -y supabase@latest start`, `npm run e2e:dev`), never the live Supabase.
- Zod checks every input before it goes to Supabase.
- Design system only: `rounded-card`, `rounded-input`, `rounded-button bg-accent btn-press …` main button, Lucide
  icons with `size`, labels `text-[11px] font-bold tracking-[0.05em] text-text-header uppercase`. Copy the login
  page's look (`src/app/login/page.tsx`): same `inputClass`, card, button, Turnstile block.
- The one `Spinner`, the one `TopLoadingBar` while sending; `LinkPending` inside every `<Link>`.
- Plain English in every message. Exact words (from the spec):
  - Forgot page: heading "Forgot password", "Type your email", button "Send link", after send "Check your email" /
    "We sent a link to **{email}**." / "No email after a few minutes? Check your spam folder.", link "Back to log in".
  - Rate limit: "We can't send more emails right now. Please try again in an hour."
  - Bad reset link (login `?error=reset`): "This reset link has expired or was already used. Ask for a new one."
  - Set password: heading "Set a new password", labels "New password" / "Confirm password", button "Save password",
    toast "Password changed.", same password: "That's your current password. Pick a new one."
  - Sign up: "If **{email}** isn't used yet, we sent a link to it. Click it to finish making your account." and
    "Already have an account with this email? Log in, or reset your password."
- Every change updates its folder's `CLAUDE.md` notes in the same commit (see each task).

## Review Focus

1. Someone already logged in opens a reset link → home, never `/set-password` for the other account (Task 3 e2e).
2. The same reset link opened twice → `/login?error=reset` with its message (Task 3 e2e).
3. An email typed with spaces or capitals (" Tess@School.ph ") → trimmed and accepted (Task 1 unit test).
4. `/set-password` opened while logged out → login page (Task 3 e2e).
5. An email with no account → the same "Check your email" screen, no error (Task 2 e2e).

---

### Task 1: Password rules in `src/lib/passwords.ts`

**Files:**
- Create: `src/lib/passwords.ts`, `src/lib/passwords.test.ts`
- Modify: `src/lib/userSettings.ts:27-34` (move `PASSWORD_MIN_LENGTH`, `PASSWORD_MAX_LENGTH`, `passwordSchema` out;
  import them back from `./passwords` and re-export them so every current import keeps working)
- Modify: `src/lib/CLAUDE.md` (one line: password rules live in `passwords.ts`)

**Interfaces:**
- Produces (`src/lib/passwords.ts`, imports only `zod`):
  - `PASSWORD_MIN_LENGTH = 8`, `PASSWORD_MAX_LENGTH = 72`, `passwordSchema` (moved unchanged)
  - `resetEmailSchema`: `z.string().trim().toLowerCase().pipe(z.email("Enter a real email address."))`
  - `newPasswordSchema`: `z.object({ password: passwordSchema, confirmPassword: z.string() })` refined so they match,
    error "The two passwords don't match." on path `confirmPassword`
  - `SAME_PASSWORD_MESSAGE = "That's your current password. Pick a new one."`

- [ ] **Step 1: Write the failing tests** (`src/lib/passwords.test.ts`, `node:test` + `node:assert/strict`, like
  `src/lib/age.test.ts`):
  - `resetEmailSchema.parse(" Tess@School.ph ")` → `"tess@school.ph"`
  - `resetEmailSchema.safeParse("tess").success` → `false`
  - `newPasswordSchema.safeParse({ password: "abcdefgh", confirmPassword: "abcdefgh" }).success` → `true`
  - mismatch → `success false`, first issue path `["confirmPassword"]`, message "The two passwords don't match."
  - `"short"` (both boxes) → `success false`, path `["password"]`
- [ ] **Step 2:** `npm test` → FAIL (module `./passwords` not found).
- [ ] **Step 3:** Create `passwords.ts`, move the three items from `userSettings.ts`, add the new ones.
  `userSettings.ts`: `import { passwordSchema, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from "./passwords";` and
  `export { passwordSchema, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH };`.
- [ ] **Step 4:** `npm test` → all PASS; `npx tsc --noEmit` → no errors.
- [ ] **Step 5: Commit** `git add src/lib/passwords.ts src/lib/passwords.test.ts src/lib/userSettings.ts src/lib/CLAUDE.md`
  → `git commit -m "Password rules in their own file (for forgot password)"`

### Task 2: `/forgot-password` page, login link, local email template, Privacy Policy

**Files:**
- Create: `src/app/forgot-password/page.tsx` (client component, like login)
- Create: `supabase/templates/recovery.html`
- Create: `e2e/forgot-password.mjs` (part 1)
- Modify: `supabase/config.toml` (after the commented `[auth.email.template.invite]` block)
- Modify: `src/proxy.ts` (`isLoginPage` gets `/forgot-password`; update its doc comment)
- Modify: `src/app/login/page.tsx` ("Forgot password?" link)
- Modify: `src/app/(legal)/privacy/page.tsx:159`, `src/lib/legal.ts` (`LEGAL_VERSION = "2026-11-06"`)
- Modify: `src/app/CLAUDE.md` (login part), root `CLAUDE.md` (code map: `forgot-password/`; the proxy line's
  logged-out pages), `e2e/CLAUDE.md` (the new test)

**Interfaces:**
- Consumes: `resetEmailSchema` (Task 1).
- Produces: page at `/forgot-password`; `e2e/forgot-password.mjs` with helper
  `latestResetTokenHash(email): Promise<string>` (reads Mailpit) used again in Task 3.

- [ ] **Step 1: Write e2e part 1** (`e2e/forgot-password.mjs`, `lib.mjs` helpers; `makeTeacher` / `deleteTeacher`
  in `finally`):
  - `latestResetTokenHash(email)`: poll `http://127.0.0.1:54324/api/v1/search?query=to:"<email>"` up to 10 s, read
    the newest message (`/api/v1/message/<ID>`), return the `token_hash=` value from its HTML.
  - Check "forgot page shows Type your email": a fresh (logged-out) context opens `APP/forgot-password`.
  - Check "logged in goes home": `loggedIn(browser, teacher)` opening `/forgot-password` ends at `APP/`.
  - Check "login has the link": `/login` has a link named "Forgot password?" to `/forgot-password`.
  - Check "an email arrives": request a reset for the teacher — by the page when the Turnstile token arrives within
    15 s; otherwise `POST ${env.API_URL}/auth/v1/recover` with `{ email }` (local has no captcha) — then
    `latestResetTokenHash(teacher.email)` returns a non-empty string.
  - Check "unknown email, same screen": when the page path is used, an unknown `nobody-<time>@test.local` also shows
    "Check your email" (skip with a printed note when Turnstile didn't pass).
- [ ] **Step 2:** run it (`npm run e2e:dev` running, `node e2e/forgot-password.mjs`) → FAIL (page is 404 / goes to
  login).
- [ ] **Step 3: Template.** `supabase/templates/recovery.html`: a short "Reset your password" email with the link
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`. In `config.toml`:
  `[auth.email.template.recovery]`, `subject = "Reset your QuizMatter password"`,
  `content_path = "./supabase/templates/recovery.html"`. Restart local Supabase
  (`npx -y supabase@latest stop` then `start`) so it reads the template.
- [ ] **Step 4: Page.** States: `email`, `error`, `isSending`, `sentTo`, Turnstile (`captchaToken`, `captchaRound`,
  `captchaStatus`, and the `pageshow` reset, as login). Submit: `resetEmailSchema.safeParse` (error → show its first
  message) → `createClient().auth.resetPasswordForEmail(email, { captchaToken })` → success sets `sentTo`; error →
  `resetErrorMessage(error)` (in the page, like login's `loginErrorMessage`: `captcha_failed` or /captcha/ → "The
  security check expired. Please try again."; `over_email_send_rate_limit` → the rate-limit words;
  `over_request_rate_limit` → "Too many tries. Please wait a few minutes and try again."; retryable fetch → "Couldn't
  reach the server. Check your internet and try again."; else "Something went wrong. Please try again.") and a fresh
  Turnstile. `sentTo` screen: `MailCheckIcon` like sign up's, the spec's words, "Back to log in" link.
- [ ] **Step 5:** proxy (`isLoginPage`), login link (under the password box, right-aligned, `text-sm font-semibold
  text-accent hover:underline`, `LinkPending`), Privacy line "**Resend**: sends the sign up and password reset emails
  (from no-reply@quizmatter.com).", `LEGAL_VERSION`, the three notes files.
- [ ] **Step 6:** `node e2e/forgot-password.mjs` → all PASS; `npx tsc --noEmit`, `npm run lint` clean.
- [ ] **Step 7: Commit** all files above → `git commit -m "Forgot password page and reset email"`

### Task 3: Recovery link → `/set-password`

**Files:**
- Create: `src/app/set-password/page.tsx` (client component)
- Modify: `src/app/auth/confirm/route.ts` (types and destinations)
- Modify: `src/lib/userSettings.ts` (new helper next to `changePassword`)
- Modify: `src/app/login/page.tsx` (`?error=reset` message with a "Ask for a new one" link to `/forgot-password`)
- Modify: `e2e/forgot-password.mjs` (part 2)
- Modify: `src/app/CLAUDE.md` (`auth/confirm` link types, `set-password/`), root `CLAUDE.md` code map
  (`set-password/`)

**Interfaces:**
- Consumes: `newPasswordSchema`, `SAME_PASSWORD_MESSAGE` (Task 1); `latestResetTokenHash` (Task 2).
- Produces: `setNewPassword(fields: { password: string; confirmPassword: string }): Promise<void>` in
  `src/lib/userSettings.ts` — parses with `newPasswordSchema`, `auth.updateUser({ password })`, then
  `auth.signOut({ scope: "others" })`; throws the Supabase error.

- [ ] **Step 1: Write e2e part 2** (same file, after part 1, a new teacher):
  - Before the reset, take a session with `sessionCookies`-style login and keep its `refresh_token` ("other device").
  - Ask for a reset (`/auth/v1/recover`), open `APP/auth/confirm?token_hash=<hash>&type=recovery` in a fresh context
    → URL ends `/set-password`.
  - Mismatched boxes → "The two passwords don't match." shown, still on `/set-password`.
  - Same password as now (`teacher.password` twice) → "That's your current password. Pick a new one."
  - New password saved → URL `APP/`, toast "Password changed.".
  - Other device: `POST /auth/v1/token?grant_type=refresh_token` with the kept token → not OK (400).
  - Password grant with the new password → OK; with the old one → not OK.
  - Same link opened again → `/login?error=reset`, text "This reset link has expired or was already used. Ask for a
    new one."
  - A logged-in context (`loggedIn`) opening a fresh reset link for another teacher → ends at `APP/`, still the first
    teacher (the link is not used: opening it afterwards in a fresh context still reaches `/set-password`).
  - A logged-out context opening `/set-password` → ends at `/login`.
- [ ] **Step 2:** run it → part 2 FAILs (type `recovery` refused → `/login?error=confirm`).
- [ ] **Step 3: Route.** `typeSchema = z.enum(["email", "recovery"])`; after `verifyOtp` OK: `recovery` →
  `/set-password`, `email` → `/`; on failure: `recovery` → `/login?error=reset`, else `/login?error=confirm`. Keep the
  logged-in check first. Update the doc comment (both emails and their template links).
- [ ] **Step 4: `setNewPassword`** in `userSettings.ts`.
- [ ] **Step 5: Page.** Card like login's: heading, the two password inputs (`autoComplete="new-password"`), "Save
  password" with the Spinner while saving and `TopLoadingBar`. Submit: `newPasswordSchema.safeParse` (first issue's
  message) → `setNewPassword` → `toast.success("Password changed.")`, `router.push("/")`, `router.refresh()`. Errors:
  `same_password` → `SAME_PASSWORD_MESSAGE`; `weak_password` → "Please pick a stronger password."; retryable fetch →
  the no-internet words; else "Couldn't change your password. Please try again." Shown under the boxes in
  `text-danger-strong`, like login.
- [ ] **Step 6: Login** `?error=reset` message + link.
- [ ] **Step 7:** `node e2e/forgot-password.mjs` → all PASS; `npx tsc --noEmit`, `npm run lint` clean.
- [ ] **Step 8: Commit** → `git commit -m "Set a new password from the reset link"`

### Task 4: Sign up's "Check your email" text

**Files:**
- Modify: `src/app/signup/SignUpForm.tsx:102-114`
- Modify: `src/app/CLAUDE.md` (sign up part: why the screen doesn't say whether an email is used)

- [ ] **Step 1:** Replace the first line with the spec's words (email in `font-semibold`), keep the spam line, add
  "Already have an account with this email? <Link /login>Log in</Link>, or <Link /forgot-password>reset your
  password</Link>." (`font-semibold text-accent hover:underline`, `LinkPending` in each), remove the "Back to log in"
  link.
- [ ] **Step 2:** Check the screen: with Playwright on `npm run e2e:dev`, fill the sign up form for a new
  `@test.local` email and, if the Turnstile passes headless, submit and screenshot "Check your email" to
  `e2e/shots/`; if it doesn't pass, read the JSX against the spec's words and say so. `npx tsc --noEmit`,
  `npm run lint` clean.
- [ ] **Step 3: Commit** → `git commit -m "Sign up: don't promise an email was sent"`

### Task 5: Final check

- [ ] `npx tsc --noEmit`, `npm run lint`, `npm test`, `node e2e/forgot-password.mjs` → all pass.
- [ ] `git diff 363cff0..HEAD` read next to the spec: every spec line done, nothing extra, notes true, Privacy +
  `LEGAL_VERSION` changed together.
- [ ] Tell the user: what passed or failed, and the deploy order — change the live "Reset Password" template link
  to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery` **first**, then push `dev`.
