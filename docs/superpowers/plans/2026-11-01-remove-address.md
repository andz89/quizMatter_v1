# Remove the Address Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the province and town from sign up, the Account page, the profile, the admin pages and the
announcement filters, and drop their database columns (the saved values are deleted).

**Architecture:** One migration remakes the functions that use the address without it, then drops the columns and
the two helper functions. The app loses every field, filter, schema key and line of copy that used them. The Privacy
Policy, Terms and `LEGAL_VERSION` follow.

**Tech Stack:** Supabase Postgres (local Docker), Next.js, zod, Node's test runner.

**Spec:** `docs/superpowers/specs/2026-11-01-remove-address-design.md`

## Global Constraints

- All database testing runs on local Docker (`npm run test:sql`), never the live project. No `execute_sql` /
  `apply_migration` on live.
- Copy each function from its newest version in `supabase/schema.sql`; never edit `schema.sql` by hand (remake it
  with `npm run db:snapshot`).
- Functions: `set search_path = ''`, full names; a dropped-and-remade function gets its grants back exactly as
  `schema.sql` lists them.
- Birthday, gender, age filters and their charts don't change.
- `LEGAL_VERSION` becomes `"2026-11-01"`.
- Design system classes only; Lucide icons only (an unused `MapPinIcon` import is removed).
- **No commits.** The working tree already holds the user's uncommitted announcements work in some of the same files
  (`src/lib/announcements.ts`, the `CLAUDE.md` notes, …). Leave everything uncommitted for the user.
- Deploy order (for the notes): app first, then the migration.

## Review Focus

1. An old open sign up tab sends `province` / `town` in the metadata → the account is made and neither key stays in
   `auth.users.raw_user_meta_data`. (Task 1 test.)
2. An old admin tab or script sends `provinces` / `town_words` to `save_announcement` / `announcement_audience` →
   the keys are ignored (`jsonb_populate_record` skips unknown keys), the save works. (Task 1 test.)
3. Dropping a column doesn't break functions that read `public.announcements` rows: Postgres doesn't track function
   bodies, so a missed `a.provinces` only fails when called. Every announcement test must run, not only compile.
   (Task 1: full `npm run test:sql`.)
4. Admin → Overview with breakdown rows of only `age` and `gender` still renders both cards. (Task 2: `tsc` on the
   narrowed `BreakdownRow.kind`, then a look at the page in `npm run dev`.)
5. A profile of a teacher who had a town shows no empty place line or stray map pin. (Task 2: the place line code is
   removed, not hidden.)

---

### Task 1: Database migration and SQL tests

**Files:**
- Create: `supabase/migrations/20261227000000_remove_address.sql`
- Modify: `supabase/tests/age_gender_address.sql`, `supabase/tests/announcements.sql`,
  `supabase/tests/announcement_fast_counts.sql`, `supabase/tests/announcement_counts.sql`,
  `supabase/tests/announcement_modal_size.sql`, `supabase/tests/announcement_post.sql`,
  `supabase/tests/announcement_facebook.sql`
- Regenerate: `supabase/schema.sql`, `src/lib/database.types.ts`
- Notes: `supabase/migrations/CLAUDE.md`

**Interfaces:**
- Produces: `teacher_profile(slug)` returns `display_name, first_name, last_name, education_level, education_field,
  bio, photo_src, full_name_public, education_public, bio_public` (no `town`, `province`, `town_public`).
  `admin_teacher_breakdown()` rows have `kind` `'age'` or `'gender'` only. `admin_announcements()` has no
  `provinces`, `town_words`. `user_settings` has no `province`, `town`, `town_public`; `announcements` has no
  `provinces`, `town_words`. The regenerated `database.types.ts` reflects all of this (Task 2 builds on it).

- [ ] **Step 1: Rewrite `supabase/tests/age_gender_address.sql` for the new shape**

  Keep its birthday / gender / breakdown checks. Remove every province / town / `town_public` check (sections around
  lines 15–50, 106–113, 132–185) and the `province`, `town` keys from the "good" sign up's expectations. Add:
  - The sign up metadata still includes `"province": "Metro Manila", "town": "Quezon City"`; assert the account is
    made and `raw_user_meta_data ?| array['birth_date','gender','province','town']` is false.
  - `select count(*) from information_schema.columns where table_schema = 'public' and ((table_name = 'user_settings'
    and column_name in ('province','town','town_public')) or (table_name = 'announcements' and column_name in
    ('provinces','town_words')))` = 0, else `FAIL: an address column is still there`.
  - `to_regprocedure('public.is_province(text)') is null and to_regprocedure('public.announcement_provinces_ok(text[])')
    is null`, else `FAIL: an address helper function is still there`.
  - `admin_teacher_breakdown()` as an admin returns no row with `kind = 'province'`.
  - Rename its header comment to say it covers the birthday and gender, and that the address was removed in
    `20261227000000_remove_address.sql`.

- [ ] **Step 2: Run it and see it fail**

  Run: `npm run test:sql -- age_gender_address.sql`
  Expected: `FAIL: an address column is still there` (or the metadata/helper check).

- [ ] **Step 3: Write `supabase/migrations/20261227000000_remove_address.sql`**

  Header comment in the style of the files before it (what and why, spec path, test path, "apply after the app
  deploys"). Then, **functions first, columns after** (so no function is ever left pointing at a gone column):
  1. `handle_new_user`: copy from `schema.sql`; drop `given_province`, its `is_province` check, and `province`,
     `town` from the insert. Keep `'province', 'town'` in the metadata key list it removes.
  2. `strip_sign_up_details`: not touched (its key list already removes `province` and `town`, which is what old
     tabs need).
  3. `teacher_profile`: `drop function public.teacher_profile(text);` then create it without the three columns and
     without `town` in the `lateral` block; `revoke … from anon, public; grant … to authenticated`.
  4. `admin_teacher_breakdown`: `create or replace` without the `'province'` union branch.
  5. `announcement_count`, `announcement_matches`: `create or replace` without the two province / town lines.
  6. `save_announcement`: `create or replace` without `provinces`, `town_words` in the insert and update.
  7. `admin_announcements`: drop and create again without `provinces`, `town_words` in the return table and select;
     restore its grants as `schema.sql` lists them.
  8. `alter table public.user_settings drop column province, drop column town, drop column town_public;`
     `alter table public.announcements drop column provinces, drop column town_words;`
  9. `drop function public.announcement_provinces_ok(text[]); drop function public.is_province(text);`
  10. Re-revoke `handle_new_user` from `public, anon, authenticated`.

  Before writing, `grep -n "provinces\|town_words\|\.province\|\.town\b\|is_province" supabase/schema.sql` and make
  sure every hit is covered by one of the steps above.

- [ ] **Step 4: Run it and see it pass**

  Run: `npm run test:sql -- age_gender_address.sql`
  Expected: ends with `ROLLBACK`, no `FAIL` / `ERROR`.

- [ ] **Step 5: Clean the announcement tests**

  - `announcements.sql`: remove `province`, `town` from the two `update public.user_settings` lines (34, 37); remove
    the four province / town filter cases (170–173); remove `'{"provinces": ["Cebu"]}', '{"town_words": ["a"]}'` from
    the list at 199. Replace the `'{"provinces": ["Atlantis"]}'` bad-input case (338) with a check that a save whose
    jsonb still has `"provinces": ["Cebu"], "town_words": ["x"]` succeeds (old tabs' keys are ignored).
  - `announcement_fast_counts.sql`: remove `province`, `town` from the setup updates (23, 26, 31); remove the cases
    at 54–57; drop `"provinces": ["Cebu"]` from the cases at 67–68 (keep their names honest: `'female master 1+'`,
    and make `'nobody'` `{"genders": ["male"], "education_levels": ["master"]}` or another set that still matches
    nobody — check against the setup rows).
  - `announcement_counts.sql`, `announcement_modal_size.sql`, `announcement_post.sql`, `announcement_facebook.sql`:
    remove `"provinces": [], "town_words": [],` from the sample jsonb.

- [ ] **Step 6: Run every SQL test**

  Run: `npm run test:sql`
  Expected: every file ends with `ROLLBACK`, no `FAIL` / `ERROR`.

- [ ] **Step 7: Remake the snapshot**

  Run: `npm run db:snapshot`
  Expected: `supabase/schema.sql` and `src/lib/database.types.ts` no longer contain `province`, `town_words`,
  `is_province` (`grep -ci "province\|town" ` on both = 0).

- [ ] **Step 8: Update `supabase/migrations/CLAUDE.md`**

  Add a "Remove the address" entry for the new file (what it drops, newest `handle_new_user`, `teacher_profile`,
  `admin_teacher_breakdown`, `announcement_count`, `announcement_matches`, `save_announcement`,
  `admin_announcements`; deploy the app first, then this). Rewrite the "Birthday, gender, province and town" entry and
  the announcements entries so they no longer describe `province`, `town`, `town_public`, `provinces`, `town_words`,
  `is_province`, `announcement_provinces_ok` as current (say "removed in `20261227000000_remove_address.sql`"). In
  "Deploying", add that this migration is the exception: app first.

---

### Task 2: App, legal pages and notes

**Files:**
- Delete: `src/lib/provinces.ts`, `src/lib/provinces.test.ts`
- Modify: `src/lib/userSettings.ts`, `src/lib/account.ts`, `src/lib/profiles.ts`, `src/lib/announcements.ts`,
  `src/lib/announcements.test.ts`, `src/lib/legal.ts`, `src/app/signup/SignUpForm.tsx`,
  `src/app/account/AccountForms.tsx`, `src/app/teachers/[slug]/page.tsx`, `src/app/admin/teachers/page.tsx`,
  `src/app/admin/teachers/AdminTeachers.tsx`, `src/app/admin/TeacherBreakdown.tsx`, `src/app/admin/page.tsx`,
  `src/app/admin/announcements/AnnouncementForm.tsx`, `src/app/admin/announcements/actions.ts`,
  `src/app/admin/safety/page.tsx`, `src/app/(legal)/privacy/page.tsx`, `src/app/(legal)/terms/page.tsx`
- Notes: root `CLAUDE.md`, `src/app/CLAUDE.md`, `src/app/admin/CLAUDE.md`, `src/lib/CLAUDE.md`

**Interfaces:**
- Consumes: the regenerated `database.types.ts` from Task 1.
- Produces: `profileSchema` without `province`, `town`; `profileVisibilitySchema` without `townPublic`;
  `TOWN_MAX_LENGTH` and `placeLine` removed; `TeacherProfile` without `town`, `province`, `townPublic`;
  `announcementSchema` without `provinces`, `town_words`; `BreakdownRow.kind: "age" | "gender"`.

- [ ] **Step 1: Update the app test first**

  `src/lib/announcements.test.ts`: remove `provinces: []`, `town_words: []` from the sample (lines 48–49).
  Run: `npx tsc --noEmit`
  Expected: errors in `announcements.test.ts` that the sample is missing `provinces` / `town_words` (schema not yet
  changed) — this is the failing check.

- [ ] **Step 2: Remove the address from `src/lib`**

  - `announcements.ts`: drop the `PROVINCES` import and the `provinces`, `town_words` keys.
  - `userSettings.ts`: drop the `PROVINCES` import, `TOWN_MAX_LENGTH` (and its comment), `province` / `town` in
    `profileSchema`, `townPublic` in `profileVisibilitySchema`, and the keys in `signUp` / `saveProfile`; fix the
    doc comment near line 190.
  - `account.ts`: drop `province, town, town_public` from the select and the returned object; fix the comment at
    13–14.
  - `profiles.ts`: drop `town`, `province`, `townPublic` (type, raw row, mapping) and `placeLine`; fix the comment at
    21.
  - Delete `provinces.ts` and `provinces.test.ts`.

- [ ] **Step 3: Remove the address from the pages**

  - `SignUpForm.tsx`: drop the import, the two initial fields, the Province and City or town `Field`s. Hint text:
    `Your birthday and gender are private.` Agree box: `…, including how QuizMatter keeps my birthday and gender
    (private) and my educational background (shown on my profile).`
  - `AccountForms.tsx`: drop the import, `TOWN_MAX_LENGTH`, the two boxes and the `townPublic` `ShowOnProfile`; fix
    the doc comment (136–137); editor note: `As an editor, your profile always shows your full name, educational
    background and bio.`
  - `teachers/[slug]/page.tsx`: drop the place line block, `placeLine` and `MapPinIcon` imports; fix the doc comment
    (17–18).
  - `admin/teachers/page.tsx`: drop `province, town` from the select, the row type and `placeLine(...)` in the
    details line. `AdminTeachers.tsx`: confirm text `Their full name, educational background and bio will always
    show on their profile.`
  - `TeacherBreakdown.tsx`: `kind: "age" | "gender"`, remove `TOP_PROVINCES`, the Others code and the province card;
    fix the comment. `admin/page.tsx`: comment at 28 says age group and gender.
  - `AnnouncementForm.tsx`: drop the import, the two defaults, `townText`, `provinceFilter`, `shownProvinces`, the
    keys in `input` and the count payload, and the Provinces list + town words box (around 323–350).
    `actions.ts`: drop the two keys (88–89).
  - `safety/page.tsx` (395): drop "town and province" (twice) from the rule text.

- [ ] **Step 4: Legal pages**

  - `privacy/page.tsx`: remove the "Your province and city or town." item (around 61–63) and the address from lines
    84, 131, 139, 143–144 ("count teachers by age group and gender"), 211 ("with your birthday and gender").
  - `terms/page.tsx` (101): `Your full name, educational background and bio always show on your profile page.`
  - `legal.ts`: `LEGAL_VERSION = "2026-11-01"`.
  - Check: `grep -rni "province\|town" src --include=*.ts --include=*.tsx | grep -v database.types` returns only
    `DetailsModal.tsx`'s `ownGrade` (a false match).

- [ ] **Step 5: Run the checks**

  Run: `npx tsc --noEmit` → no errors. `npm run lint` → no errors in changed files. `npm test` → all pass.

- [ ] **Step 6: Look at the pages**

  `npm run dev` with the local Docker stack: open `/signup`, `/account`, a `/teachers/<slug>` profile, Admin →
  Overview (two Teachers cards: age group, gender), Admin → Teachers, Admin → Announcements (no Provinces / town
  filter; "Count teachers" still works, a save works).

- [ ] **Step 7: Update the notes**

  - `src/app/CLAUDE.md` (91–95, 113–114, 129–130): sign up and Account page fields without province / town, no town
    checkbox, profile without the place line.
  - `src/app/admin/CLAUDE.md` (29, 35, 41): Overview's Teachers section = age group and gender; Teachers' details
    line without the place; Announcements' filters without provinces / town.
  - `src/lib/CLAUDE.md` (94–95): remove the `provinces.ts` entry.
  - Root `CLAUDE.md`: check the Announcements section for any province / town mention and remove it.

- [ ] **Step 8: Final review**

  `git diff` next to the spec: every spec item done, nothing extra, notes true, Privacy Policy and `LEGAL_VERSION`
  changed. Report what was checked and the results. Leave everything uncommitted.
