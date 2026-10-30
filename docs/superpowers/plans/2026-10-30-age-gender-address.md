# Age, Gender and Address at Sign Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New teachers give their birthday, gender, province and town at sign up (all required); the town and
province show on profiles, the birthday and gender stay private, and admins get counts.

**Architecture:** Five new `user_settings` columns, copied from the sign up metadata by `handle_new_user` (then
stripped), guarded by column checks and an age trigger. zod (`profileSchema`) checks the same rules in the app, with
the age math in a small importable `src/lib/age.ts` and the province list in `src/lib/provinces.ts`.
`teacher_profile` returns the town/province; a new `admin_teacher_breakdown()` gives the counts.

**Tech Stack:** Next.js (this repo's version), Supabase (Postgres, PostgREST), zod, Tailwind (design-system
classes), lucide-react, Node's test runner.

**Spec:** `docs/superpowers/specs/2026-10-30-age-gender-address-design.md`

## Global Constraints

- All database testing on the local Docker stack (`npx -y supabase@latest db reset`, then `docker exec -i
  supabase_db_quizBuilder psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/<file>.sql`). Never the live
  project: no `execute_sql` / `apply_migration` on it.
- zod checks everything right before it's saved (`signUp`, `saveProfile`).
- Ages: `MIN_AGE = 18`, `MAX_AGE = 100`, worked out on today's date in Philippine time (`Asia/Manila`), the same
  way in TypeScript and SQL: years between, minus 1 if today's (month, day) is before the birthday's (month, day).
  A 29 February birthday turns a year older on 1 March in non-leap years.
- `GENDERS = ["male", "female"]`, labels "Male" / "Female". `TOWN_MAX_LENGTH = 60`.
- Saved province values are the full names in `PROVINCES` (Task 2), exactly.
- Age error code: `QMAGE`.
- Design system only (`rounded-input`, `text-text-header`, `bg-accent`, …); Lucide icons with `size`; the one
  `Spinner`; no new packages.
- `LEGAL_VERSION` becomes `"2026-10-30"`.
- Each task updates the folder `CLAUDE.md` notes for what it changes, in the same commit. Commit only the files the
  task touches (`git commit -- <paths>`), never the unrelated uncommitted maintenance work.
- **Before Task 1:** the uncommitted maintenance work must be committed first (the user's call). Four notes files
  this plan edits (`src/app/CLAUDE.md`, `src/app/admin/CLAUDE.md`, `src/lib/CLAUDE.md`,
  `supabase/migrations/CLAUDE.md`) already hold maintenance changes, and `git commit -- <file>` takes the whole
  file. The new migration (`20261220…`) also runs after the maintenance one (`20261219…`).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A birthday typed by hand that isn't a real date (e.g. `2001-02-30`) → refused with "Enter your real birthday."
  (Task 1 test `isAllowedBirthDate refuses impossible dates`).
- A birthday in the future or someone turning 18 tomorrow → refused; turning 18 today → allowed (Task 1 edge tests;
  Task 2 SQL section 3).
- The form's date picker limits on 29 February of a leap year (18 years back has no 29 February) → the limit falls
  on 28 February, not an invalid date (Task 1 test `birthDateRange on 29 February`).
- A town of only spaces → refused (zod trims, then `min(1)`; Task 3 step checks it with `npx tsc` + a manual try in
  Task 4) and the database stores it trimmed (Task 2 SQL section 1 sends `"  Quezon City "`).
- An admin-made account with no details opens Account → Personal details → the four boxes are empty and Save asks
  for them, with no crash on a `null` birthday (Task 3 maps `null` to `""`; Task 5 manual check).

---

### Task 1: Age math (`src/lib/age.ts`)

**Files:**
- Create: `src/lib/age.ts`
- Test: `src/lib/age.test.ts`

**Interfaces:**
- Produces:
  - `MIN_AGE = 18`, `MAX_AGE = 100`
  - `ageOn(birthDate: string, today: string): number` (both `YYYY-MM-DD`)
  - `isAllowedBirthDate(birthDate: string, today: string): boolean` (a real calendar date, not after today, age
    between `MIN_AGE` and `MAX_AGE`)
  - `birthDateRange(today: string): { min: string; max: string }` (`max` = the latest birthday that is 18 today,
    `min` = the earliest that is still 100 today; a 29 February that doesn't exist in the target year becomes
    28 February for `max` and 1 March for `min`)
  - `todayInManila(): string` (`Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" })`)

- [ ] **Step 1: Write the failing tests** in `src/lib/age.test.ts` (`node:test` + `node:assert/strict`, like
  `photoCrop.test.ts`):
  - `ageOn counts whole years`: `ageOn("1990-06-15", "2026-06-14") === 35`, `("1990-06-15", "2026-06-15") === 36`,
    `("1990-06-15", "2026-06-16") === 36`.
  - `ageOn with a 29 February birthday`: `ageOn("2008-02-29", "2026-02-28") === 17`,
    `("2008-02-29", "2026-03-01") === 18`, `("2008-02-29", "2028-02-29") === 20`.
  - `isAllowedBirthDate edges`: today `"2026-10-30"`: `"2008-10-30"` true (18 today), `"2008-10-31"` false,
    `"1926-10-31"` true (100), `"1925-10-30"` false (101), `"2026-11-01"` false (future).
  - `isAllowedBirthDate refuses impossible dates`: `"2001-02-30"`, `"2001-13-01"`, `"2001-1-1"`, `""`, `"abc"` all
    false.
  - `birthDateRange`: today `"2026-10-30"` → `{ min: "1925-10-31", max: "2008-10-30" }`.
  - `birthDateRange on 29 February`: today `"2028-02-29"` → `max === "2010-02-28"`, `min === "1927-03-01"`.

- [ ] **Step 2: Run to see them fail**

  Run: `npm test`
  Expected: FAIL (`Cannot find module` for `./age.ts`).

- [ ] **Step 3: Implement `src/lib/age.ts`** with the interfaces above; no imports (so tests can load it).
  A real date check: matches `/^\d{4}-\d{2}-\d{2}$/` and survives a round trip through
  `new Date(Date.UTC(y, m - 1, d))`. Short comments in the repo's plain-English style.

- [ ] **Step 4: Run to see them pass**

  Run: `npm test`
  Expected: PASS, all tests, including the old ones.

- [ ] **Step 5: Commit**

  `git add src/lib/age.ts src/lib/age.test.ts` and commit "Age math for the sign up birthday".

---

### Task 2: Database, province list and their tests

**Files:**
- Create: `src/lib/provinces.ts`, `src/lib/provinces.test.ts`
- Create: `supabase/migrations/20261220000000_age_gender_address.sql`
- Create: `supabase/tests/age_gender_address.sql`
- Modify: `supabase/migrations/CLAUDE.md` (the new migration), `src/lib/CLAUDE.md` (`provinces.ts`, `age.ts`)

**Interfaces:**
- Consumes: the age rule from Global Constraints (same math in SQL).
- Produces:
  - `PROVINCES` (a `const` array) and `type Province = (typeof PROVINCES)[number]` from `src/lib/provinces.ts`
  - `user_settings.birth_date date null`, `gender text not null default ''`, `province text not null default ''`,
    `town text not null default ''`, `town_public boolean not null default true`
  - `teacher_profile(slug)` returns, after `bio_public`: `town text`, `province text`, `town_public boolean`
  - `admin_teacher_breakdown()` returns `table (kind text, label text, total bigint)`; `kind` ∈ `'province' |
    'age' | 'gender'`; age labels `'18–24'`, `'25–34'`, `'35–44'`, `'45–54'`, `'55+'`; `''` = not given
  - error `QMAGE` (message "Enter your real birthday. You must be 18 to 100 years old.")

`PROVINCES`, in this order (alphabetical, Metro Manila in place, the last one at the end):

```
Abra, Agusan del Norte, Agusan del Sur, Aklan, Albay, Antique, Apayao, Aurora, Basilan, Bataan, Batanes,
Batangas, Benguet, Biliran, Bohol, Bukidnon, Bulacan, Cagayan, Camarines Norte, Camarines Sur, Camiguin, Capiz,
Catanduanes, Cavite, Cebu, Cotabato, Davao de Oro, Davao del Norte, Davao del Sur, Davao Occidental,
Davao Oriental, Dinagat Islands, Eastern Samar, Guimaras, Ifugao, Ilocos Norte, Ilocos Sur, Iloilo, Isabela,
Kalinga, La Union, Laguna, Lanao del Norte, Lanao del Sur, Leyte, Maguindanao del Norte, Maguindanao del Sur,
Marinduque, Masbate, Metro Manila, Misamis Occidental, Misamis Oriental, Mountain Province, Negros Occidental,
Negros Oriental, Northern Samar, Nueva Ecija, Nueva Vizcaya, Occidental Mindoro, Oriental Mindoro, Palawan,
Pampanga, Pangasinan, Quezon, Quirino, Rizal, Romblon, Samar, Sarangani, Siquijor, Sorsogon, South Cotabato,
Southern Leyte, Sultan Kudarat, Sulu, Surigao del Norte, Surigao del Sur, Tarlac, Tawi-Tawi, Zambales,
Zamboanga del Norte, Zamboanga del Sur, Zamboanga Sibugay, Outside the Philippines
```

(82 provinces + Metro Manila + Outside the Philippines = 84.)

- [ ] **Step 1: Write the failing Node test** `src/lib/provinces.test.ts`:
  - `PROVINCES has 84 unique names`: `PROVINCES.length === 84`, `new Set(PROVINCES).size === 84`.
  - `the migration checks the same provinces`: read
    `supabase/migrations/20261220000000_age_gender_address.sql` with `node:fs`, take the text between the markers
    `-- provinces:start` and `-- provinces:end`, pull every `'…'` literal (doubling `''` for quotes isn't needed: no
    name has one), and `assert.deepEqual` the sorted list with the sorted `PROVINCES`.

- [ ] **Step 2: Write the failing SQL test** `supabase/tests/age_gender_address.sql`, same shape as
  `supabase/tests/terms_consent.sql` (`begin;` … `rollback;`, `do $$ … raise exception 'FAIL: …' … $$`, ids
  `00000000-0000-4000-8000-0000000000e1`…), sections:
  1. A sign up with `birth_date "1990-06-15"`, `gender "female"`, `province "Metro Manila"`, `town "  Quezon City "`
     fills the columns (`town = 'Quezon City'`), and the metadata has none of the four keys.
  2. A sign up with bad values (`birth_date "2020-01-01"`, `"gender": "other"`, `"province": "Cebu Prov."`,
     `"birth_date": "not a date"` in a second account) still makes both accounts, with those columns empty
     (`birth_date is null`, `gender = ''`, `province = ''`).
  3. As `authenticated` (the owner, like terms_consent section 3): an update to an under-18 birthday
     (`(now() at time zone 'Asia/Manila')::date - interval '18 years' + interval '1 day'`) fails with `QMAGE`; one
     exactly 18 today passes; 101 fails; `gender = 'other'` fails (check violation); `province = 'Cebu Prov.'`
     fails; a 61-character town fails. Use `begin … exception when … end` blocks inside `do $$`.
  4. As another teacher: `select birth_date, gender from public.user_settings where user_id = <e1>` returns no row.
  5. `teacher_profile(<e1's slug>)` as another teacher: `town`/`province` filled; after the owner sets
     `town_public = false`: both `''`, `town_public = false`; after inserting e1 into `public.editors`: filled again.
     The function's result has no `birth_date` / `gender` column (check `pg_get_function_result`).
  6. `admin_teacher_breakdown()` as a plain teacher fails; as an admin (insert a row into `public.admins`, like
     `admin_overview_counts.sql` does) it returns a `('gender', 'female', n ≥ 1)` row, the `'age'` totals add up to
     `count(*)` of `user_settings`, and e1's group (`age_on('1990-06-15', manila_today())` mapped to its label) has
     `total ≥ 1` (so the test works on any date).

- [ ] **Step 3: Run both to see them fail**

  Run: `npm test` → Expected: FAIL (`./provinces.ts` missing).
  Run: `npx -y supabase@latest db reset` then
  `docker exec -i supabase_db_quizBuilder psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/age_gender_address.sql`
  → Expected: ERROR (column `birth_date` does not exist).

- [ ] **Step 4: Write `src/lib/provinces.ts`** (the list above, a short header comment saying the migration's
  check must match and the test keeps them equal).

- [ ] **Step 5: Write the migration** `20261220000000_age_gender_address.sql` (header comment in the repo's style:
  what, why, design link, test file):
  1. `alter table public.user_settings add column …` (the five columns; `province` check `in (…)` with the list
     between `-- provinces:start` / `-- provinces:end` lines; `town` check `char_length(town) <= 60`;
     `gender in ('', 'male', 'female')`).
  2. `public.age_on(birth date, today date) returns int` (`immutable`, the Global Constraints math) and
     `public.manila_today() returns date` (`stable`, `(now() at time zone 'Asia/Manila')::date`).
  3. `check_birth_date()` trigger function (`before insert or update of birth_date`): non-null birthday after today,
     or `age_on` outside 18–100 → `raise exception … using errcode = 'QMAGE'`.
  4. `handle_new_user`: the body from `20261218000000_terms_consent.sql`, plus the four values. Read
     `birth_date` safely: only if it matches `^\d{4}-\d{2}-\d{2}$`, cast inside a `begin … exception when others
     then null end` block, and keep it only if `age_on` is 18–100. `gender` / `province` kept only if in the
     allowed lists (else `''`); `town` trimmed and cut to 60 (`left(…, 60)`). Add `'birth_date', 'gender',
     'province', 'town'` to the removed-keys array.
  5. `strip_sign_up_details`: same body plus the four keys.
  6. `teacher_profile`: `drop function` + `create function` (body from `20261215000000_profile_privacy.sql`), adding
     `town`, `province` (blank unless `v.town or v.mine`) and `town_public` (`s.town_public or e.is_editor`).
     Same `revoke` / `grant`.
  7. `admin_teacher_breakdown()`: `security definer`, `stable`, `set search_path = ''`; refuses unless
     `public.is_admin()` (`raise exception 'Admins only.' using errcode = '42501'`); three `union all` groups over
     `public.user_settings`. Grant to `authenticated` only.
  8. `revoke execute` on `check_birth_date`, `handle_new_user`, `strip_sign_up_details` from `public, anon,
     authenticated`.

- [ ] **Step 6: Run both to see them pass**

  Run: `npm test` → Expected: PASS.
  Run: `npx -y supabase@latest db reset`, then the SQL test → Expected: ends with `ROLLBACK`, no `FAIL`/`ERROR`.
  Also re-run `supabase/tests/terms_consent.sql` and `supabase/tests/profile_privacy.sql` → Expected: still pass.

- [ ] **Step 7: Update notes** in `supabase/migrations/CLAUDE.md` (the migration, `QMAGE`, newest `handle_new_user`
  / `strip_sign_up_details` / `teacher_profile`) and `src/lib/CLAUDE.md` (`age.ts`, `provinces.ts` kept equal to
  the migration by the test).

- [ ] **Step 8: Commit** the six files: "Database for birthday, gender, province and town".

---

### Task 3: zod rules, saving and loading (`userSettings.ts`, `account.ts`)

**Files:**
- Modify: `src/lib/userSettings.ts` (`profileSchema`, `profileVisibilitySchema`, `signUp`, `saveProfile`, new
  constants)
- Modify: `src/lib/account.ts` (`getAccount` select and mapping)

**Interfaces:**
- Consumes: `isAllowedBirthDate`, `todayInManila` (Task 1); `PROVINCES` (Task 2).
- Produces:
  - `GENDERS = ["male", "female"] as const`, `type Gender`, `GENDER_LABELS: Record<Gender, string>`,
    `TOWN_MAX_LENGTH = 60`
  - `profileSchema` keys added: `birthDate`, `gender`, `province`, `town` (so `ProfileFields` and `SignUpFields`
    gain four strings)
  - `profileVisibilitySchema` key added: `townPublic: boolean`
  - `Account.profile.birthDate` etc. (`""` when not set), `Account.visibility.townPublic` (default `true`)

- [ ] **Step 1: Add to `profileSchema`**:
  - `birthDate: z.string().refine((d) => isAllowedBirthDate(d, todayInManila()), "Enter your real birthday. You
    must be 18 to 100 years old.")`
  - `gender: z.enum(GENDERS, { error: "Pick your gender." })`
  - `province: z.enum(PROVINCES, { error: "Pick your province." })`
  - `town: z.string().trim().min(1, "Enter your city or town.").max(TOWN_MAX_LENGTH, "Use at most 60 characters
    for your city or town.")`
  - `profileVisibilitySchema`: `townPublic: z.boolean()`.

- [ ] **Step 2: Send and save them**: `signUp` metadata gets `birth_date`, `gender`, `province`, `town`;
  `saveProfile`'s upsert gets `birth_date`, `gender`, `province`, `town`, `town_public`. Update the two doc
  comments (the trigger strips the new keys too).

- [ ] **Step 3: Load them** in `getAccount`: add `birth_date, gender, province, town, town_public` to the select;
  map `birthDate: settings?.birth_date ?? ""`, …, `townPublic: settings?.town_public ?? true`.

- [ ] **Step 4: Check types**

  Run: `npx tsc --noEmit`
  Expected: errors only in `SignUpForm.tsx` / `AccountForms.tsx` (`emptyFields` and the visibility state miss the
  new keys); fixed in Tasks 4–5. No errors in `userSettings.ts` or `account.ts`.

- [ ] **Step 5: Commit** together with Task 4 (the app doesn't build between them): no separate commit.

---

### Task 4: Sign up form

**Files:**
- Modify: `src/app/signup/SignUpForm.tsx`
- Modify: `src/app/CLAUDE.md` ("Account, profiles, sign up, login" → `signup/`)

**Interfaces:**
- Consumes: Task 3's schema and constants; `birthDateRange`, `todayInManila` (Task 1); `PROVINCES` (Task 2).

- [ ] **Step 1: Fields.** `emptyFields` gets `birthDate: "", gender: "", province: "", town: ""`. After the Contact
  number `Field`, in the same grid: Birthday (`type="date"`, `required`, `autoComplete="bday"`, `min`/`max` from
  `birthDateRange(todayInManila())`), Gender (a `select` with a disabled "Pick one" then `GENDERS` →
  `GENDER_LABELS`), Province (a `select`, "Pick one" then `PROVINCES`), City or town (`type="text"`, `required`,
  `maxLength={TOWN_MAX_LENGTH}`, `autoComplete="address-level2"`, placeholder "e.g. Quezon City"). Then a hint
  across both columns (`-mt-2 text-xs text-text-secondary sm:col-span-2`): "Your birthday and gender are private.
  Your town and province show on your profile." Reuse `Field` and `inputClass`.
- [ ] **Step 2: Agree box** text: "…, including how QuizMatter keeps and shows my personal details."
- [ ] **Step 3: Notes**: `src/app/CLAUDE.md` `signup/` bullet: the four new fields, private vs shown, the age rule.
- [ ] **Step 4: Verify**

  Run: `npx tsc --noEmit` → Expected: errors only in `AccountForms.tsx` (Task 5).
  Run the app (`npm run dev`, local Docker Supabase) and sign up: a birthday 17 years ago and a town of spaces each
  show their zod message; a good form shows "Check your email"; in the local database (`docker exec …
  psql -c "select birth_date, gender, province, town from public.user_settings where first_name = '<the name typed>'"`)
  the row has the values.

- [ ] **Step 5: Commit** `src/lib/userSettings.ts src/lib/account.ts src/app/signup/SignUpForm.tsx src/app/CLAUDE.md`
  together with Task 5 (types need both).

---

### Task 5: Account page

**Files:**
- Modify: `src/app/account/AccountForms.tsx` (`PersonalDetailsForm`)
- Modify: `src/app/CLAUDE.md` (`account/` bullet)

**Interfaces:**
- Consumes: Task 3's `ProfileFields` / `ProfileVisibility` with the new keys.

- [ ] **Step 1:** After Contact number: Birthday, Gender, then Province and City or town side by side
  (`grid gap-4 sm:grid-cols-2`), same inputs as Task 4 but with the page's `labelClass` / `inputClass`. Under the
  town: hint "Your birthday and gender are private." and, for plain teachers,
  `<ShowOnProfile checked={shown.townPublic} onChange={show("townPublic")} />`. Change the editor line to "As an
  editor, your profile always shows your full name, educational background, bio, and town and province."
- [ ] **Step 2: Notes**: `src/app/CLAUDE.md` `account/` and profile privacy bullets mention the town switch.
- [ ] **Step 3: Verify**

  Run: `npx tsc --noEmit` and `npm run lint` → Expected: no errors.
  In the app: an account made in the local Studio (no details) opens Account; the four boxes are empty; Save
  says "Enter your real birthday…"; filling them saves ("Details saved.").

- [ ] **Step 4: Commit** Tasks 3–5's files: "Sign up and Account page ask for birthday, gender, province and town".

---

### Task 6: Town and province on the profile

**Files:**
- Modify: `src/lib/profiles.ts` (`TeacherProfile`, `loadTeacherProfile`)
- Modify: `src/app/teachers/[slug]/page.tsx`
- Modify: `src/app/CLAUDE.md` (`teachers/[slug]/` bullet)

**Interfaces:**
- Consumes: `teacher_profile`'s `town`, `province`, `town_public` (Task 2).
- Produces: `TeacherProfile.town: string`, `.province: string`, `.townPublic: boolean`.

- [ ] **Step 1:** Map the three columns in `loadTeacherProfile`.
- [ ] **Step 2:** On the page, under the heading block: `joinParts([town, province])` (from `@/lib/format`) with
  `<MapPinIcon size={14} />` in `text-sm text-text-secondary`, `flex items-center gap-2`; nothing when empty;
  `{!profile.townPublic && <OnlyYouTag />}` like the full name.
- [ ] **Step 3: Notes** in `src/app/CLAUDE.md`.
- [ ] **Step 4: Verify**: `npx tsc --noEmit`; in the app, another account sees "Quezon City, Metro Manila"; after
  unticking "Show on my profile" it's gone for them and tagged "Only you can see this" for the owner.
- [ ] **Step 5: Commit** "Town and province on the profile page".

---

### Task 7: Admin → Teachers line and Admin → Overview counts

**Files:**
- Modify: `src/app/admin/teachers/page.tsx` (select, `Settings` type, `detailsLine`)
- Create: `src/app/admin/TeacherBreakdown.tsx`
- Modify: `src/app/admin/page.tsx` (call `admin_teacher_breakdown`, render the section)
- Modify: `src/app/admin/CLAUDE.md`

**Interfaces:**
- Consumes: `ageOn`, `todayInManila` (Task 1); `GENDER_LABELS` (Task 3); `admin_teacher_breakdown()` (Task 2).
- Produces: `TeacherBreakdown({ rows }: { rows: BreakdownRow[] })`, `type BreakdownRow = { kind: "province" |
  "age" | "gender"; label: string; total: number }` (server component, no client code).

- [ ] **Step 1: Teachers.** Add `birth_date, gender, province, town` to the select and `Settings`.
  `detailsLine` → `joinParts([name, age, gender label, joinParts([town, province]), contact, education])`, the age
  as `String(ageOn(birth_date, todayInManila()))` only when `birth_date` is set. Update its doc comment example.
- [ ] **Step 2: Overview.** In `page.tsx`'s `Promise.all`, add `supabase.rpc("admin_teacher_breakdown")`; throw
  on error like the others. After "Activity", a `<section>` with `<h2 className={sectionLabel}>Teachers</h2>` and
  `<TeacherBreakdown rows={…} />`: three cards (`rounded-card border border-border-default bg-bg-surface px-5
  py-4`, `grid gap-4 sm:grid-cols-3`) titled "By province", "By age group", "By gender". Each row: label ("Not
  given" for `''`; gender via `GENDER_LABELS`), a bar (`h-2 rounded-dropdown bg-accent-soft` track, `bg-accent`
  fill, width `total / biggest × 100%`), the count. Province: the 10 biggest, then "Others" (the rest summed),
  then "Not given". Age: in the order 18–24 … 55+, then "Not given". Total `bigint` comes back as a number or a
  string: `Number(row.total)`.
- [ ] **Step 3: Notes** in `src/app/admin/CLAUDE.md` (Overview's Teachers section and its function; Teachers'
  details line).
- [ ] **Step 4: Verify**: `npx tsc --noEmit`, `npm run lint`; as the super admin in the app: Overview shows the three
  cards with the test accounts; Teachers shows "… · 36 · Female · Quezon City, Metro Manila · …"; as a plain
  admin the Overview cards show too.
- [ ] **Step 5: Commit** "Admin: teachers' age, gender and town; Overview counts".

---

### Task 8: Privacy Policy and `LEGAL_VERSION`

**Files:**
- Modify: `src/app/(legal)/privacy/page.tsx` (sections 2, 4, 7)
- Modify: `src/lib/legal.ts`

- [ ] **Step 1: Section 2** "What we collect and why": a list item "**Your birthday and gender**: to know who uses
  QuizMatter and to count teachers by age group and gender. Only you and QuizMatter's admins see them." and one
  "**Your province and city or town**: shown on your profile (you can hide it, unless you're an editor), and used to
  count teachers by province." The consent line: "Section 13(a) for your educational background, age and gender".
- [ ] **Step 2: Section 4** "Who can see your information": other teachers see your town and province (you can hide
  them, unless you're an editor); nobody but you and the admins sees your birthday or gender; admins see the counts
  without names. Add birthday, gender and town to the admins' list.
- [ ] **Step 3: Section 7** "How long we keep it": the four are kept with your other personal details until you
  delete your account. Match the section's existing wording and list.
- [ ] **Step 4:** `LEGAL_VERSION = "2026-10-30"`.
- [ ] **Step 5: Verify**: `npx tsc --noEmit`; `/privacy` shows "Last updated" with the new date; the wording matches
  Tasks 2–7 (read the code, not this plan, if they differ).
- [ ] **Step 6: Commit** "Privacy Policy: birthday, gender, province and town".

---

### Task 9: Final check

- [ ] **Step 1:** `npm test`, `npx tsc --noEmit`, `npm run lint` → all pass.
- [ ] **Step 2:** `npx -y supabase@latest db reset`, then every file in `supabase/tests/` (the two `supabase_admin`
  ones as their first lines say) → each ends with `ROLLBACK`, no `FAIL`/`ERROR`.
- [ ] **Step 3:** `git diff f79865d -- <this feature's files>` next to the spec: every goal done, nothing extra, the
  `CLAUDE.md` notes true, the Privacy Policy true.
- [ ] **Step 4:** Tell the user what was checked, what passed and what failed. Remind them: apply the migration to
  the live project (their usual way) before deploying the app, and delete the test accounts.
