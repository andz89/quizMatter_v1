# Teacher Sign Up — Design

Date: 2026-10-09

## Goal

Today there is no sign up: teachers are added by hand in the Supabase dashboard. This adds a sign up page so a
teacher can make their own account, confirm their email, and start using QuizMatter. Their personal details are
saved, they can change them on the Account page, and admins see them in Admin → Teachers.

## What the user asked for

- A sign up form. **All fields are required:** display name, first name, last name, contact number, educational
  background, email, password, confirm password.
- Educational background = a dropdown (Bachelor's degree, Master's degree, Doctorate, Other) **plus** a short
  "Field or major" text box.
- The teacher must **confirm their email** before they can log in.
- The details show on the **Account page** (teacher can change them) and in **Admin → Teachers** (admin can read them).

## Assumptions

- Anyone can sign up. New teachers get the same rights as teachers added by hand (not admin, not editor).
- Teachers added by hand (now and before) keep working; their new details are simply empty until they fill them
  in on the Account page. Nobody is forced to fill them in.
- The sign up form uses the same Turnstile "are you human?" check as login (Supabase already requires it).

## Data

### Migration `20261103000000_teacher_sign_up.sql`

New columns on `public.user_settings` (all `text not null default ''`, with length checks matching zod):

| Column | Check |
|---|---|
| `first_name` | `length <= 60` |
| `last_name` | `length <= 60` |
| `contact_number` | `length <= 20` |
| `education_level` | `in ('', 'bachelor', 'master', 'doctorate', 'other')` |
| `education_field` | `length <= 100` |

A trigger function `public.handle_new_user()` (`security definer`, `set search_path = ''`) runs `after insert on
auth.users`. It inserts a `user_settings` row for the new user from `new.raw_user_meta_data`: `display_name`,
`first_name`, `last_name`, `contact_number`, `education_level`, `education_field`, each `coalesce(..., '')` and
trimmed. `on conflict (user_id) do nothing`. A user added by hand has no metadata, so their row gets empty fields.

Because the database checks are on the columns, bad metadata sent straight to the Supabase API (skipping the app)
makes the whole sign up fail, so nothing bad is saved. "Required" is checked by zod in the app; someone who skips
the app could sign up with empty details, which only means an empty "Personal details" card.

### Zod (`src/lib/userSettings.ts`)

One place for every limit:

- `NAME_MAX_LENGTH = 60`, `EDUCATION_FIELD_MAX_LENGTH = 100`, `CONTACT_NUMBER_MAX_LENGTH = 20`.
- `EDUCATION_LEVELS` — `[{ value: "bachelor", label: "Bachelor's degree" }, master, doctorate, other]`.
- `profileSchema` — `firstName`, `lastName` (trimmed, 1–60), `contactNumber` (trimmed, 7–20, only digits, spaces,
  `+ - ( )`, at least 7 digits), `educationLevel` (`z.enum`), `educationField` (trimmed, 1–100).
- `signUpSchema` — `profileSchema` plus `displayName` (trimmed, 1–80), `email` (`z.email()`), `password`
  (`passwordSchema`), `confirmPassword`, with a check that the two passwords match.
- `signUp(input, captchaToken)` — parses with `signUpSchema`, then calls `supabase.auth.signUp({ email, password,
  options: { captchaToken, data: { display_name, first_name, … } } })`. Throws if it fails.
- `saveProfile(input)` — parses with `profileSchema`, then upserts the user's `user_settings` row (like
  `saveDisplayName`). Throws if it fails.

`getAccount()` (`src/lib/account.ts`) also reads the five new columns, so the Account page gets them.

## Pages

### `/signup` (`src/app/signup/page.tsx`, client page)

- Same layout and card style as `/login` (Logo on top, white `rounded-card`, uppercase labels, `rounded-input`
  inputs). Heading "Create an account".
- Fields in order: Display name (hint "e.g. Ms. Cruz — shown as the Author of your presentations"), First name,
  Last name, Contact number, Educational background (dropdown) + Field or major, Email, Password, Confirm password.
  Each input has `required`, `maxLength` from the constants, and the right `autoComplete`.
- Turnstile check, then the main button ("Create account"), with the one `Spinner` while sending and the
  `TopLoadingBar` while waiting.
- Before sending, the form runs `signUpSchema.safeParse` and shows the first problem in plain words under the
  form (e.g. "The two passwords don't match.", "Enter a contact number with at least 7 digits.").
- Supabase errors become plain words (captcha expired, weak password, too many tries, no internet), like
  `loginErrorMessage`. After an error the Turnstile check starts over (a pass works only once).
- On success the card changes to "Check your email": "We sent a link to {email}. Click it to finish making your
  account." with a "Back to log in" link. Supabase answers the same way when the email already has an account, so
  strangers can't find out who has one.
- Link under the card: "Already have an account? Log in".

### `/auth/confirm` (`src/app/auth/confirm/route.ts`, route handler)

- The confirmation email links here: `?token_hash=…&type=email`.
- Calls `supabase.auth.verifyOtp({ type, token_hash })` with the server client (it sets the login cookies), then
  redirects to `/`.
- If the link is missing, old or already used: redirects to `/login?error=confirm`, and the login page shows "This
  link has expired or was already used. Try logging in, or sign up again."

### Login page (`src/app/login/page.tsx`)

- Remove the "No sign up" comment.
- Add "New to QuizMatter? Create an account" link to `/signup` under the form.
- New error message for `email_not_confirmed`: "Please confirm your email first. Check your inbox for the link."
- Shows the `?error=confirm` message above.

### Proxy (`src/proxy.ts`)

- Logged-out people may open `/login`, `/signup` and `/auth/confirm`.
- Logged-in people opening `/login` or `/signup` go to `/` (as today for `/login`). `/auth/confirm` always runs.

### Account page (`src/app/account`)

- New "Personal details" card (`PersonalDetailsForm` in `AccountForms.tsx`), between Profile and Password: First
  name, Last name, Contact number, Educational background + Field or major. All required. "Save details" button
  with the Spinner; sonner toast on success and on failure; disabled while nothing changed. Uses `saveProfile`.
- Page subtitle becomes "Your name, details and password."

### Admin → Teachers (`src/app/admin/teachers`)

- `page.tsx` also selects the five new columns and adds `details` to each row: `joinParts([full name, contact
  number, "Master's degree in English"])` ("" when all empty).
- It also adds `isConfirmed: Boolean(user.email_confirmed_at)`.
- `AdminTeachers.tsx` shows `details` as a line under the name, and a "Not confirmed" pill
  (`bg-highlight-soft text-highlight-strong`) for accounts that haven't confirmed their email.
- The comment "Teachers are added by hand, so one page of 1,000 is plenty" is updated (still 1,000 per page; more
  pages are a later change if ever needed).

## Supabase dashboard steps (done by the user, not code)

1. **Authentication → Sign In / Providers → Email:** turn on "Allow new users to sign up" and "Confirm email".
2. **Authentication → Emails → Confirm signup:** set the link to
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`.
3. **Authentication → URL Configuration:** Site URL = the live site address; add it (and
   `http://localhost:3000`) to Redirect URLs.
4. **Authentication → Emails → SMTP Settings:** set up your own email sender (e.g. Resend). Supabase's built-in
   sender only sends a few emails an hour, and only to your own team's addresses.
5. Run the new migration.

## Not included

- Admin approval of new teachers, phone number checks (SMS), "forgot password", and editing details for other
  teachers from Admin → Teachers.

## Checking

`npx tsc --noEmit` and `npm run lint`; read the diff against this spec. Live testing (real sign up, email link)
is left to the user.
