# Privacy Policy, Terms of Use and Sign Up Consent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real Privacy Policy and Terms of Use pages under Philippine law, an agree box at sign up that saves the
version and time, no hidden copy of sign up details in the login record, 1-year deletion of safety records, and
Claude's connector limited to what it should read.

**Architecture:** One migration adds the consent columns and their guard, a new `handle_new_user`, and a trigger on
`auth.users` that keeps sign up details out of the login metadata. The sign up form sends `LEGAL_VERSION` (from a
new `src/lib/legal.ts`) after zod checks the box. The daily cleanup in `cleanupAccounts.ts` deletes old
`click_history` and `admin_actions` rows. The two pages are static server components sharing three small layout
parts.

**Tech Stack:** Next.js (this repo's version: read `node_modules/next/dist/docs/` before writing page code),
Supabase (Postgres triggers, Auth), zod, Cloudflare Workers timers, Tailwind design-system classes.

**Spec:** `docs/superpowers/specs/2026-10-27-privacy-and-terms-design.md` (read it whole: the page outlines, the
facts and the user's decisions live there, not here).

## Global Constraints

- **Start only after editors' profile photos is committed** (spec, "Build order"). Task 0 checks it.
- `LEGAL_VERSION` = the date the pages go in, `"YYYY-MM-DD"` (planned `"2026-10-28"`). Pages show it with
  `formatDay` from `src/lib/format.ts` ("Oct 28, 2026").
- The Privacy Policy names **Andrew Rivero**; the Terms say "run by its founder". Location: "Philippines" only.
- Exact copy:
  - Agree box: "I agree to the Terms of Use and Privacy Policy, including how QuizMatter keeps and shows my
    educational background." ("Terms of Use" and "Privacy Policy" are links, new tab.)
  - Unticked refusal: "Please agree to the Terms of Use and Privacy Policy to make an account."
  - Education hint (sign up and Account page): "Shows on your profile page, so teachers can see who made the lessons
    they use."
  - Page titles: "Privacy Policy · QuizMatter", "Terms of Use · QuizMatter".
- Every sign up field stays required. Educational background is not made optional.
- The keys removed from login metadata: `first_name`, `last_name`, `contact_number`, `education_level`,
  `education_field`, `display_name`, `terms_version`.
- Safety records: `KEEP_SAFETY_RECORDS_DAYS = 365`, counted from each row's `created_at`, for every row.
- Numbers on the pages: age 18+, privacy replies within 15 days, liability cap ₱1,000, shut-down notice 30 days,
  dispute talk 30 days, breach notice within 72 hours.
- Plain English on the pages: short words and sentences; a legal term gets a plain meaning right after it.
- Design system only (root `CLAUDE.md`): `text-text-primary`, `text-text-secondary`, `text-text-header`,
  `bg-accent-soft`, `border-border-default`, `rounded-button`, `rounded-card`, `text-accent`, h1/h2
  `font-extrabold`; no hard-coded colors; Lucide icons with `size` if any; no new npm package.
- Zod before every save. The one `Spinner` / `TopLoadingBar` (already in the sign up form; nothing new needs one).
- Database work only on the local Docker database: `npx -y supabase@latest db reset`, then
  `docker exec -i supabase_db_quizBuilder psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/<file>.sql`. If
  Docker is off, start `C:\Users\ACER\AppData\Local\Programs\DockerDesktop\Docker Desktop.exe` first. Never apply to
  the live database without asking the user.
- Never sign up on the live site to test (it makes a real account).
- Work is on `main`. **No commit without asking the user first.** One commit, at the end (Task 6).
- Each task updates the `CLAUDE.md` notes of the folders it touches (root `CLAUDE.md`, "Every feature has notes").

## Review Focus

1. **A teacher clicks "Terms of Use" in the agree box and loses the filled form.** The links must open a new tab.
   Checked in Task 2, Step 6.
2. **Supabase Auth writes the metadata back after the account is made** (it may update the whole user row, or on a
   repeat sign up of an unconfirmed email). The `auth.users` update trigger must strip the keys every time. Tested in
   Task 1 (`update auth.users …` case) and against real local Auth (Task 1, Step 6).
3. **A teacher fakes consent through the API**, by updating `user_settings` or by deleting their row and inserting a
   new one. Both must leave the consent columns as the database set them. Tested in Task 1.
4. **A logged-out visitor, or a phone, opens the pages.** `/privacy` and `/terms` must open without logging in, with
   no sideways scroll at 375 px (tables included). Checked in Task 5, Step 5.
5. **The cleanup deletes too much or too little.** A 366-day-old row goes, a 364-day-old one stays, in both tables.
   Checked in Task 3, Step 4.

---

### Task 0: Wait for editors' profile photos

**Files:** none.

- [ ] **Step 1: Check it's committed**

Run: `git log --oneline -10` and `git status --short`
Expected: a commit that builds editors' profile photos (after `f8a1bc4 Design: editors' profile photos`), and no
uncommitted photo files. If not there yet, stop and tell the user.

- [ ] **Step 2: Note what the photo work added**

Run: `ls supabase/migrations | tail -3`, and read the committed photo code (its migration, `/api/profile-photo`
route, the profile page) for: who can add a photo, who sees it, who can remove it, and when the R2 file is deleted.
Expected: the newest migration name (Task 1 names its file one day later), and the facts Task 5 writes.

---

### Task 1: The database (consent columns, guard, no hidden copy)

**Files:**
- Create: `supabase/migrations/<newest + 1 day>000000_terms_consent.sql` (e.g. `20261215000000_terms_consent.sql`
  if the photo migration is `20261214000000`)
- Create: `supabase/tests/terms_consent.sql`
- Modify: `supabase/migrations/CLAUDE.md` (add the migration where sign up is described, near the sign up hook
  notes)

**Interfaces:**
- Produces: `user_settings.terms_version text` (null or ≤ 20 characters) and `user_settings.terms_accepted_at
  timestamptz`, set only by `handle_new_user` from the sign up metadata key `terms_version`. Task 2 sends that key.

- [ ] **Step 1: Write the failing test `supabase/tests/terms_consent.sql`**

Same shape as `supabase/tests/save_photo_click_limits.sql`: `begin;` … `rollback;`, each check a `do $$ … raise
exception 'FAIL: …' … $$`, teacher steps under `set local role authenticated;` with `request.jwt.claims` set to the
teacher's `sub`, `reset role;` between parts. Ids like `00000000-0000-4000-8000-0000000000d1`. Cases:

1. Insert a user with `raw_user_meta_data` = `{"first_name": "Tcs", "last_name": "Teacher", "contact_number":
   "09171234567", "education_level": "master", "education_field": "English", "terms_version": "2026-10-28"}`.
   FAIL unless `user_settings` has `terms_version = '2026-10-28'`, `terms_accepted_at` not null,
   `education_level = 'master'`, `first_name = 'Tcs'`; and FAIL unless the user's `raw_user_meta_data` has none of
   the seven keys (`raw_user_meta_data ?| array[…]` is false).
2. Insert a user with only `{"first_name": "Tcs", "last_name": "Invited"}` (a dashboard invite). FAIL unless the row
   exists with `terms_version` and `terms_accepted_at` both null.
3. As teacher 1: `update public.user_settings set terms_version = 'fake', terms_accepted_at = '2020-01-01', bio =
   'Hi'`. Then (as postgres) FAIL unless `terms_version = '2026-10-28'`, `terms_accepted_at` unchanged, and
   `bio = 'Hi'` (other columns still change).
4. As teacher 1: delete their own `user_settings` row, then insert one with `terms_version = 'fake'`,
   `terms_accepted_at = now()`. FAIL unless both are null afterwards.
5. As postgres: `update auth.users set raw_user_meta_data = '{"education_level": "master", "keep": "x"}'` for user
   1. FAIL unless it reads back as `{"keep": "x"}`.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx -y supabase@latest db reset`, then
`docker exec -i supabase_db_quizBuilder psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/terms_consent.sql`
Expected: ERROR, column `terms_version` does not exist.

- [ ] **Step 3: Write the migration**

A plain-English header comment (what and why, pointing at the spec). Then:
- `alter table public.user_settings add column terms_version text check (char_length(terms_version) <= 20), add
  column terms_accepted_at timestamptz;`
- `public.keep_terms_consent()`, `security invoker`, `set search_path = ''`, a `before insert or update` row trigger
  on `user_settings`: only when `current_user = 'authenticated'` (a direct API write): on insert set both columns
  null, on update set them to `old`'s. `handle_new_user` is `security definer`, so its insert gets past.
- `public.handle_new_user()`: copy the newest body from `20261113000000_display_name_rules.sql` exactly, add the two
  columns to the insert (`nullif(trim(coalesce(new.raw_user_meta_data ->> 'terms_version', '')), '')`, and `now()`
  when that is not null, else null), then end with `update auth.users set raw_user_meta_data =
  raw_user_meta_data - array[<the seven keys>] where id = new.id;`. Keep it `security definer`; repeat the `revoke
  execute … from public, anon, authenticated` line from `20261206000000_revoke_trigger_helpers.sql`.
- `public.strip_sign_up_details()`, `security invoker`, `set search_path = ''`, a `before update` row trigger on
  `auth.users`: `new.raw_user_meta_data := new.raw_user_meta_data - array[<the seven keys>]` (when not null).

- [ ] **Step 4: Run the test to make sure it passes**

Run: the same `db reset` + `psql` commands as Step 2.
Expected: ends with `ROLLBACK`, no `FAIL`, no `ERROR`.

- [ ] **Step 5: Run the other SQL tests that make users**

Run each of `account_delete.sql` (as `-U supabase_admin -d postgres`, per its first lines), `save_photo_click_limits.sql`,
`database_fixes.sql`.
Expected: each ends with `ROLLBACK`, no `FAIL` or `ERROR`.

- [ ] **Step 6: Check it against real local Auth**

Run `npx -y supabase@latest status` for the local API URL and anon key, then:
`curl -s -X POST http://127.0.0.1:54321/auth/v1/signup -H "apikey: <anon key>" -H "Content-Type: application/json" -d '{"email":"tcs-real@example.com","password":"Testing-1234","data":{"first_name":"Tcs","last_name":"Real","contact_number":"09171234567","education_level":"master","education_field":"English","terms_version":"2026-10-28"}}'`
then `docker exec -i supabase_db_quizBuilder psql -U postgres -c "select raw_user_meta_data from auth.users where email = 'tcs-real@example.com'"`
and the same for `select terms_version, terms_accepted_at, education_level from public.user_settings s join auth.users u on u.id = s.user_id where u.email = 'tcs-real@example.com'`.
Expected: the metadata has none of the seven keys (local Auth may add its own, like `email_verified`); the settings
row has `2026-10-28`, a time, `master`. Then run the curl again (a repeat sign up) and check the metadata is still
clean. Local only; `db reset` clears it.

- [ ] **Step 7: Update `supabase/migrations/CLAUDE.md`**

One short entry: the consent columns (set only at sign up, guarded by `keep_terms_consent`), and that sign up
details never stay in `auth.users.raw_user_meta_data` (`handle_new_user` + `strip_sign_up_details`).

---

### Task 2: The agree box and the education hint

**Files:**
- Create: `src/lib/legal.ts`
- Modify: `src/lib/userSettings.ts` (`signUpSchema`, `SignUpFields`, `signUp`)
- Modify: `src/app/signup/SignUpForm.tsx`
- Modify: `src/app/account/AccountForms.tsx` (the education fields, ~lines 204–228)
- Modify: `src/lib/CLAUDE.md`, `src/app/CLAUDE.md` ("Account, profiles, sign up, login")

**Interfaces:**
- Consumes: the metadata key `terms_version` (Task 1).
- Produces: `export const LEGAL_VERSION: string` in `src/lib/legal.ts` (Task 5 uses it);
  `export const AGREE_TERMS_MESSAGE: string` in `userSettings.ts`;
  `SignUpFields = { [K in Exclude<keyof z.input<ReturnType<typeof signUpSchema>>, "agreeTerms">]: string } & { agreeTerms: boolean }`.

- [ ] **Step 1: Add `src/lib/legal.ts`**

`LEGAL_VERSION` (Global Constraints), with a comment: the version of the Terms and Privacy Policy; saved with each
new account (`user_settings.terms_version`); change it whenever either page changes.

- [ ] **Step 2: Change `src/lib/userSettings.ts`**

`signUpSchema` gets `agreeTerms: z.literal(true, { error: AGREE_TERMS_MESSAGE })`. `SignUpFields` as in
Interfaces. `signUp` keeps its signature and sends `terms_version: LEGAL_VERSION` in `options.data` with the other
keys (after the parse, so only a ticked box gets here).

- [ ] **Step 3: Change `src/app/signup/SignUpForm.tsx`**

`emptyFields.agreeTerms = false`. `update` takes `Exclude<keyof SignUpFields, "agreeTerms">`. Below the grid and
above `<Turnstile>`: a checkbox (`id="agreeTerms"`, `required`, `checked`/`onChange` → `agreeTerms:
e.target.checked`, class `accent-accent`) with its label in `text-sm text-text-primary`, the agree text from Global
Constraints; the two names are `Link`s to `/terms` and `/privacy` with `target="_blank"` and
`rel="noopener noreferrer"`, class `font-semibold text-accent hover:underline`. After the two education fields, a
`<p className="-mt-2 text-xs text-text-secondary sm:col-span-2">` with the education hint (like the display name
note above it).

- [ ] **Step 4: Change `src/app/account/AccountForms.tsx`**

After the Field or major input's `div`, the education hint in `mt-1 text-xs text-text-secondary` (matching the
page's other hints). Fields stay `required`.

- [ ] **Step 5: Type check and lint**

Run: `npx tsc --noEmit` and `npm run lint`
Expected: no errors in the changed files.

- [ ] **Step 6: Check the form in the browser (local, never submit on live)**

Run `npm run dev`, open `/signup` logged out. Fill every field but leave the box empty and click Create account (if
the Turnstile check blocks it, a required-box browser message is enough). Expected: the account is not sent; the
refusal shows. Click "Terms of Use": it opens in a new tab and the form keeps what was typed. Don't submit with the
box ticked against the live database.

- [ ] **Step 7: Update the notes**

`src/lib/CLAUDE.md`: `legal.ts` (`LEGAL_VERSION`), and in `userSettings.ts` the `agreeTerms` field and
`terms_version`. `src/app/CLAUDE.md`, the `signup/` line: the agree box, what it saves, the new-tab links.

---

### Task 3: Delete safety records after 1 year

**Files:**
- Modify: `src/lib/cleanupAccounts.ts`
- Modify: `worker.ts` (its top comment only)
- Modify: `src/app/admin/safety/page.tsx` (~line 196, and a new `Item` after "Unconfirmed accounts deleted" ~line 586)
- Modify: `src/app/admin/safety/history/page.tsx` (~line 48)
- Modify: root `CLAUDE.md` ("Click Limits", the `click_history` sentence), `src/lib/CLAUDE.md` (Timers),
  `src/app/admin/CLAUDE.md` (the Safety row)

**Interfaces:**
- Produces: `export const KEEP_SAFETY_RECORDS_DAYS = 365` in `cleanupAccounts.ts` (the Safety page shows it).

- [ ] **Step 1: Add the deletes**

In `cleanupUnconfirmedAccounts`, after the `sign_up_attempts` delete and in the same style: delete `click_history`
and `admin_actions` rows with `created_at` older than `KEEP_SAFETY_RECORDS_DAYS` days, each throwing its error.
Update the file's top comment (and `worker.ts`'s) to say it also deletes them.

- [ ] **Step 2: Update the Admin → Safety words**

Line ~196: "…with the teacher's name and email. It stays there for a year, even after the account is deleted."
History page: "Every pause, automatic ban and admin release, newest first. Kept for a year, also after an account is
deleted." New `Item`, same props as "Unconfirmed accounts deleted": name "Old safety records deleted", where
"Cloudflare timer", rule `` `Every day at 4:00 AM (UTC), Safety → History and Admin log rows older than ${KEEP_SAFETY_RECORDS_DAYS} days are deleted (src/lib/cleanupAccounts.ts)` ``,
sees "Nothing. The two lists show the last year.", and a `more` with `what` (why: the Privacy Policy promises it;
the law keeps data only as long as needed), `example` and `scenario` in the page's style.

- [ ] **Step 3: Type check and lint**

Run: `npx tsc --noEmit` and `npm run lint`
Expected: no errors in the changed files.

- [ ] **Step 4: Check the deletes on the local database**

After `db reset`: with psql, add a user, a `click_history` row with `created_at = now() - interval '366 days'` and
one with `364 days`, and the same two in `admin_actions` (fill its required columns, e.g. `action = 'editor_added'`,
`target_type = 'user'`). Write a scratch script in the scratchpad that imports `cleanupUnconfirmedAccounts` and
calls it with the local URL and the local secret key from `supabase status`; run it with
`node --no-warnings --import ./scripts/test-resolve.mjs <script>` from the repo root.
Expected: in both tables the 366-day row is gone and the 364-day row stays.

- [ ] **Step 5: Update the notes**

Root `CLAUDE.md`, Click Limits: "Each row keeps the email, so it stays after the account is deleted, for 1 year
(the daily cleanup deletes older rows)". `src/lib/CLAUDE.md` Timers: what `cleanupAccounts.ts` deletes.
`src/app/admin/CLAUDE.md`: Safety → History and the Admin log keep 1 year.

---

### Task 4: Claude reads only what it should

**Files:**
- Modify: `src/pages/api/mcp.ts` (`read_presentation`, ~lines 57–65)
- Modify: `src/pages/api/CLAUDE.md` (the `read_presentation` line)

- [ ] **Step 1: Add the check**

After `if (!result) { … }`: when `result.ownerId !== userId && !result.sharedFrom && !result.presentation.fromAdmin`,
return the same "no presentation with that link, or it's someone else's private one" answer. A comment: the admin
can read every presentation, but Claude reads only their own, other teachers' published copies and QuizMatter ones
(the Privacy Policy says so). The tool's name and description don't change, so no connector reconnect is needed.

- [ ] **Step 2: Type check and lint**

Run: `npx tsc --noEmit` and `npm run lint`
Expected: no errors.

- [ ] **Step 3: Update `src/pages/api/CLAUDE.md`**

The `read_presentation` line: what it reads and refuses, and why.

---

### Task 5: The two pages

**Files:**
- Create: `src/app/(legal)/LegalParts.tsx`
- Modify: `src/app/(legal)/privacy/page.tsx`, `src/app/(legal)/terms/page.tsx` (replace the placeholders)
- Modify: root `CLAUDE.md` (code map line for `(legal)/`, and the new Privacy rule), `src/app/CLAUDE.md` (the
  `(legal)/` line)

**Interfaces:**
- Consumes: `LEGAL_VERSION` (Task 2), `formatDay` (`src/lib/format.ts`), `SupportEmail`
  (`src/components/SupportEmail.tsx`), `FACEBOOK_URL` (`src/lib/support.ts`), the photo facts (Task 0).
- Produces (server components in `LegalParts.tsx`):
  `LegalTitle({ title }: { title: string })` — the h1 and "Last updated: <formatDay(LEGAL_VERSION)>";
  `ShortVersion({ children }: { children: ReactNode })` — the "The short version" box (`rounded-button
  bg-accent-soft`, a small uppercase label);
  `LegalSection({ title, children }: { title: string; children: ReactNode })` — an h2 and its body (text-sm, readable
  line height, lists with bullets).

- [ ] **Step 1: Collect the credits**

Run: `grep -rn -i -E "designed by|freepik|license|credit|attribution" src/lib/*.tsx src/lib/svgLibrary.tsx`
Expected: at least the gstudioimagen / Freepik line in `clipartKids.tsx`. Every credit found goes in the Terms'
Credits list.

- [ ] **Step 2: Write `LegalParts.tsx`**

The three parts above, design-system classes only.

- [ ] **Step 3: Write the Privacy Policy page**

Sections 1–13 of the spec's "The Privacy Policy" outline, in that order, every fact from the spec's "Facts" and
"decisions", plus the photo lines from the spec's "Build order" written from the committed photo code (Task 0). The
retention part is a small table that fits a phone (two columns, wraps). Metadata title from Global Constraints. The
contact part uses `SupportEmail`, the Facebook link (`target="_blank"`) and privacy.gov.ph.

- [ ] **Step 4: Write the Terms of Use page**

Sections 1–16 of the spec's "The Terms of Use" outline, in that order, with the Credits list from Step 1 and the
photo line for editors (spec, "Build order"). Link to `/privacy` where the Terms mention it.

- [ ] **Step 5: Check them in the browser**

Run `npm run dev`. Logged out, open `/privacy` and `/terms` (and from the footer links). Then at 375 px wide.
Expected: both open without logging in; the logo + Log in bar shows; no sideways scroll; the table fits; the dates
read "Last updated: Oct 28, 2026" (or the build date).

- [ ] **Step 6: Read both pages against the spec's anti-goals**

Expected: no promise the code doesn't keep (editors' emails show; some things stay after deletion; data is outside
the Philippines; educational background can't be removed without deleting the account); no ad, payment,
subscription or GDPR wording; each legal term has a plain meaning.

- [ ] **Step 7: Type check and lint**

Run: `npx tsc --noEmit` and `npm run lint`
Expected: no errors.

- [ ] **Step 8: Update the notes**

Root `CLAUDE.md` code map: "`(legal)/` Privacy and Terms (placeholders)" → "`(legal)/` the Privacy Policy and Terms
of Use (version in `src/lib/legal.ts`)". Add the rule from the spec's "Notes to update" (a change to what the app
collects, who sees it, how long it's kept, or which outside service holds it updates the Privacy Policy and
`LEGAL_VERSION` in the same commit). `src/app/CLAUDE.md`: the `(legal)/` line describes the real pages and
`LegalParts.tsx`.

---

### Task 6: Final check and commit

**Files:** none new.

- [ ] **Step 1: Run every check**

Run: `npx tsc --noEmit`, `npm run lint`, `npm test`, and `terms_consent.sql` once more after a `db reset`.
Expected: no errors in changed files; tests pass; the SQL test ends with `ROLLBACK` and no `FAIL`.

- [ ] **Step 2: Read the whole diff against the spec**

Run: `git diff` and `git status --short`
Expected: every spec goal done; nothing extra; every touched folder's notes are true; the next-dev `CLAUDE.md` block
untouched or left as `next dev` wrote it.

- [ ] **Step 3: Tell the user and ask before committing**

Report what was checked and what passed or failed. Ask before the one commit on `main` (message ends with the
attribution lines). Remind them: the migration must be applied to the live database (ask before doing it); a
Philippine lawyer should read the pages; ask a teacher before making them an editor.
