# Age, gender and address at sign up

## Why

The user wants every new teacher to give their **age, gender and address** when they sign up, all required. They
are for three things (the user's answers):

- **Know who signs up:** the super admin sees them in Admin → Teachers.
- **Stats and charts:** Admin → Overview counts teachers by province, age group and gender.
- **Show on profiles:** the town and province show on the teacher's profile page.

The app is still in development: the user will delete the test accounts, so nothing asks old accounts for the new
details.

## Goals

- Sign up asks for four new things, all required:
  - **Birthday** (a date picker). The app works out the age from it each day, so it never goes stale. The teacher
    must be **18 to 100 years old** on the day it's saved.
  - **Gender**: a dropdown with **Male** and **Female** only (the user's choice).
  - **Province**: a dropdown of the Philippine provinces, plus **Metro Manila** and **Outside the Philippines**.
  - **City or town**: a text box, at most 60 characters.
- No street, barangay or house number: the province and town are enough for the charts and the profile, and there
  is no full address to protect.
- **Birthday and gender are private:** only the teacher and QuizMatter's admins ever see them (the super admin in
  Admin → Teachers; every admin only as counts in Admin → Overview). Other teachers and editors never get them, not
  even from the database.
- **Town and province show on the profile** as "Town, Province" (e.g. "Quezon City, Metro Manila"), with a "Show on
  my profile" checkbox on the Account page (on by default), like the full name, education and bio. Editors get no
  checkbox: their details always show, so their town and province always show too.
- The teacher can change all four on the Account page (Personal details), with the same rules.
- Admin → Teachers shows each teacher's **age**, **gender** and **town and province** in their details line.
- Admin → Overview gets a **Teachers** section: three bar lists, counts only (no names):
  - **By province**: the 10 biggest, then "Others", then "Not given".
  - **By age group**: 18–24, 25–34, 35–44, 45–54, 55+, "Not given".
  - **By gender**: Male, Female, "Not given".
- The Privacy Policy says what is collected, who sees it, how long it's kept and why, and `LEGAL_VERSION` changes.

## Non-goals

- No box or page asking old accounts for the new details (development stage; the user deletes test accounts).
  An account with no details (e.g. one made in the Supabase dashboard) shows "Not given" to admins, and its
  Account page needs all four the next time Save details is pressed.
- No "Other" or "Prefer not to say" gender choice (the user picked Male and Female only).
- No barangay or city lists, no street address.
- No export of the counts, no chart package.
- Not a new click limit: saving details is a `user_settings` write, so it already counts toward the `settings`
  click limits.

## Data (one migration: `20261220000000_age_gender_address.sql`)

New columns in `public.user_settings`:

| Column | Type | Rule |
|---|---|---|
| `birth_date` | `date`, empty allowed | 18 to 100 years old on the day it's saved (a trigger, since a column check can't use today's date) |
| `gender` | `text not null default ''` | `''`, `'male'` or `'female'` |
| `province` | `text not null default ''` | `''` or a name from the province list (a column check with the same list as `src/lib/provinces.ts`) |
| `town` | `text not null default ''` | trimmed, at most 60 characters |
| `town_public` | `boolean not null default true` | "Show on my profile" for the town and province |

- **The age trigger** (`check_birth_date`, before insert or update of `birth_date`): refuses a birthday that makes
  the teacher under 18 or over 100 on today's date (Philippine time), with error code `QMAGE`. An empty birthday is
  allowed (dashboard-made accounts).
- **The province list** is saved as the full name (e.g. `'Metro Manila'`, `'Cebu'`, `'Outside the Philippines'`),
  so the charts and the profile need no lookup.
- **Sign up** (`handle_new_user`, same as `20261218000000_terms_consent.sql` plus the new values): copies
  `birth_date`, `gender`, `province` and `town` from the sign up metadata. A bad value (not a date, under 18, a
  wrong gender, an unknown province) is saved as empty instead, so a broken script can't stop the account from
  being made; the form's zod check stops bad values before they're sent. `handle_new_user` and
  `strip_sign_up_details` add the four keys to the list they remove from `auth.users.raw_user_meta_data`, so only
  one copy is kept (the Privacy Policy promises this).
- **Profile** (`teacher_profile`, newest in `20261215000000_profile_privacy.sql`): also returns `town` and
  `province`, empty for others when `town_public` is off (unless the teacher is an editor), and
  `town_public` for the owner's "Only you can see this" tag. It never returns `birth_date` or `gender`.
- **Counts** (`admin_teacher_breakdown()`, new, `security definer`, `is_admin()` only, else refused): returns rows
  of `(kind, label, total)`, where `kind` is `'province'`, `'age'` or `'gender'`. The age group is worked out from
  `birth_date` and today's date (Philippine time). Empty values come back as the label `''` ("Not given" in the
  app). It counts every row in `user_settings` (admins included, since they're teachers too). The province "top 10
  + Others" is done in the app, so the function stays simple.
- `revoke execute` on the new trigger function from `public, anon, authenticated`, like the other trigger helpers.

## App

- **`src/lib/provinces.ts`** (new): `PROVINCES`, the one list (as a `const` array) the form, zod and the test use.
- **`src/lib/age.ts`** (new, no imports, so `npm test` can load it): `MIN_AGE = 18`, `MAX_AGE = 100`,
  `ageOn(birthDate, today)` (the age in whole years from two `YYYY-MM-DD` dates) and `todayInManila()` (today's
  date in Philippine time, like the database). Used by zod, the form's date limits and Admin → Teachers.
  (`userSettings.ts` can't be loaded by the tests: it imports `svgLibrary`, which isn't a plain `.ts` file.)
- **`src/lib/userSettings.ts`**:
  - `profileSchema` gets `birthDate` (an ISO date `YYYY-MM-DD`, 18–100 years old on today's date, via `ageOn`),
    `gender` (`z.enum(GENDERS)`), `province` (`z.enum(PROVINCES)`) and `town` (trimmed, 1–60 characters). Sign up
    and the Account page share them.
  - New: `GENDERS = ["male", "female"]`, `GENDER_LABELS`, `TOWN_MAX_LENGTH = 60`.
  - `profileVisibilitySchema` gets `townPublic`.
  - `signUp` sends `birth_date`, `gender`, `province`, `town` in the metadata; `saveProfile` saves the four plus
    `town_public`.
- **Sign up form** (`src/app/signup/SignUpForm.tsx`): after Contact number, Birthday (a date input whose `min` and
  `max` follow the 18–100 range) and Gender (a dropdown, "Pick one" first), then Province (a dropdown) and City or
  town (a text box). A hint under them: "Your birthday and gender are private. Your town and province show on your
  profile." It reuses `Field` and `inputClass` (no new styles). The agree box says "…including how QuizMatter keeps
  and shows my personal details" instead of "my educational background".
- **Account page** (`src/app/account/AccountForms.tsx`, `src/lib/account.ts`): the same four boxes in Personal
  details; a "Show on my profile" checkbox under the town for plain teachers (editors get none, like today).
  `getAccount` reads the new columns.
- **Profile** (`src/app/teachers/[slug]/`, `src/lib/profiles.ts`): "Town, Province" under the name with a Lucide
  `MapPinIcon` (size 14, `text-text-secondary`). Nothing shows when both are empty. The owner sees a hidden one
  with the "Only you can see this" tag.
- **Admin → Teachers** (`src/app/admin/teachers/`, super admin only, as today): each teacher's details line
  (`detailsLine` in `page.tsx`, e.g. "Ana Cruz · +63 917 123 4567 · Master's degree in English") also gets the age
  (from `ageOn`), the gender and "Town, Province": "Ana Cruz · 34 · Female · Quezon City, Metro Manila · …". A
  missing one is left out of the line, like the other parts today.
- **Admin → Overview** (`src/app/admin/page.tsx`, a new `TeacherBreakdown.tsx` next to `OverviewCharts.tsx`): a
  "Teachers" section with three cards (`rounded-card`), each a list of labels with a plain bar
  (`bg-accent-soft` track, `bg-accent` fill, width = share of the biggest row) and the count. One call to
  `admin_teacher_breakdown()`, alongside `admin_overview`.

## Privacy Policy (`src/app/(legal)/privacy/page.tsx`) and `LEGAL_VERSION`

- **2. What we collect and why:** add your birthday and gender (to know who uses QuizMatter and count teachers by
  age group and gender) and your province and city or town (shown on your profile, and to count teachers by
  province). Under the Philippine Data Privacy Act, age and gender are *sensitive personal information*, like
  education, so the legal basis line lists them under consent (Section 13(a)) next to the educational background.
- **4. Who can see your information:** other teachers see your town and province on your profile (you can hide
  them, unless you're an editor); nobody but you and QuizMatter's admins sees your birthday and gender; admins see
  them in Admin → Teachers and only as counts in the charts.
- **7. How long we keep it:** kept until you delete your account (the same as the other personal details).
- `LEGAL_VERSION` (`src/lib/legal.ts`) becomes `"2026-10-30"`.

## Testing (all on local Docker, never the live database)

- **SQL test `supabase/tests/age_gender_address.sql`** (rolls back):
  - a sign up with good metadata fills the four columns, and the metadata no longer has the four keys;
  - a sign up with bad values (under 18, `'other'` gender, unknown province, not a date) still makes the account,
    with those values empty;
  - a teacher's own write of an under-18 or over-100 birthday is refused (`QMAGE`); a wrong gender or province is
    refused by the column checks;
  - `teacher_profile` hides the town and province from another teacher when `town_public` is off, still shows them
    for an editor, and never returns the birthday or gender;
  - another teacher can't read someone's `birth_date` or `gender` from `user_settings`;
  - `admin_teacher_breakdown()` is refused for a plain teacher and returns the right counts for an admin.
- **Node tests** (`npm test`):
  - `src/lib/provinces.test.ts`: every name in `PROVINCES` appears in the migration's province check, and the
    counts match (so the two lists can't drift apart);
  - `src/lib/age.test.ts`: `ageOn` the day before, on and after a birthday, a 29 February birthday, and the 18 and
    100 edges.
- `npx tsc --noEmit`, `npm run lint`.

## Notes to update (same commit)

- `src/app/CLAUDE.md`: sign up, Account page and profile (the new fields, who sees them, the town checkbox).
- `src/app/admin/CLAUDE.md`: Admin → Overview's Teachers section, Admin → Teachers' new columns.
- `src/lib/CLAUDE.md`: `provinces.ts` (the province list, kept equal to the migration) and `age.ts`.
- `supabase/migrations/CLAUDE.md`: the new migration.
- Root `CLAUDE.md` code map: nothing new to map (the files sit in folders already listed).
