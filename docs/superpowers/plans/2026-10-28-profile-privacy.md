# Profile Privacy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plain teachers choose Public or Private for their full name, educational background and bio on their
profile page.

**Architecture:** Three `boolean` columns on `user_settings` (default `true`). `teacher_profile(slug)` blanks a
private field for everyone but its owner, and treats editors as always public. The Account page saves the switches
with the other details; the profile page hides or marks fields from the flags the function returns.

**Tech Stack:** Supabase (Postgres SQL functions, row level security), Next.js app router, zod, sonner, Tailwind
classes from `globals.css`, Lucide icons.

**Spec:** `docs/superpowers/specs/2026-10-28-profile-privacy-design.md`

## Global Constraints

- **Before Task 1:** the editor profile photo work (another session, uncommitted:
  `supabase/migrations/20261214000000_profile_photos.sql`, `src/lib/profiles.ts`, `src/app/teachers/[slug]/page.tsx`,
  `src/app/account/page.tsx`) must be finished. This plan builds on its `teacher_profile` (with `photo_src`) and
  edits the same files. Check that no other session is busy on them (ListAgents, `git status`).
- Migration file: `supabase/migrations/20261215000000_profile_privacy.sql`.
- Column and returned-column names: `full_name_public`, `education_public`, `bio_public`. App names:
  `fullNamePublic`, `educationPublic`, `bioPublic`.
- Words (exact): switch label "Show on my profile"; owner tag "Only you can see this"; editor line "As an editor,
  your profile always shows your full name, educational background and bio."; display name warning "Your display
  name still shows your full name. You can change it in Profile above."; "Make editor" box adds "Their full name,
  educational background and bio will always show on their profile."
- zod before every save (root `CLAUDE.md`, "Saving Data"); design system classes only; the one `Spinner`; sonner
  toasts.
- SQL tests only on the local Docker database (root `CLAUDE.md`, "Tests").
- Ask the user before every commit to `main`.

## Review Focus

- A teacher calls `teacher_profile` directly for someone else's private profile → gets `''`, never the value
  (Task 1 test).
- A teacher updates another teacher's switches directly → 0 rows changed (Task 1 test).
- An editor whose role is taken away → their saved private choices apply again (Task 1 test).
- A teacher changes only a switch, no text → Save details turns on and saves (Task 3 step).
- Full name off and the display name auto-made from it ("Ria Santos 4821") → the warning shows (Task 3 step).

---

### Task 1: Database: the switches and `teacher_profile`

**Files:**
- Create: `supabase/migrations/20261215000000_profile_privacy.sql`
- Create: `supabase/tests/profile_privacy.sql`
- Modify: `supabase/migrations/CLAUDE.md` (Files: the teacher profiles line; the newest `teacher_profile` now lives
  in the new file, not `20261214000000_profile_photos.sql`)

**Interfaces:**
- Produces: `user_settings.full_name_public`, `.education_public`, `.bio_public` (`boolean not null default true`).
  `teacher_profile(slug text)` returns `display_name, first_name, last_name, education_level, education_field, bio,
  photo_src` (as before) plus `full_name_public, education_public, bio_public boolean`, each = "others see this"
  (the saved switch, or `true` when the teacher is in `editors`). `first_name` + `last_name` are `''` when
  `full_name_public` is false and the caller isn't the owner; `education_level` + `education_field` likewise with
  `education_public`; `bio` with `bio_public`.

- [ ] **Step 1: Write the failing test** `supabase/tests/profile_privacy.sql`, in the style of
  `supabase/tests/teacher_shared_presentations.sql` (`begin`; users through `auth.users` with
  `raw_user_meta_data` first/last name; switch users with `set_config('request.jwt.claims', …)`; each check a
  `do $$ … raise exception 'FAIL: …' $$`; ends `rollback`). Users: `pv-private` (teacher, "Pv Private"),
  `pv-viewer` (teacher), `pv-admin` (in `admins`), `pv-editor` (in `editors`, "Pv Editor"). Checks:
  1. Before any change, the viewer gets `pv-private`'s first name `'Pv'` and all three flags `true`.
  2. As `pv-private`: `update user_settings set full_name_public = false, education_public = false, bio_public =
     false, bio = 'My bio', education_field = 'English'` on their own row changes 1 row.
  3. As the viewer: `teacher_profile('pv-private')` gives `display_name = 'Pv Private'`, `first_name = ''`,
     `last_name = ''`, `education_level = ''`, `education_field = ''`, `bio = ''`, all three flags `false`.
  4. As the admin: the same blanks as check 3.
  5. As `pv-private`: their own `teacher_profile` gives `first_name = 'Pv'`, `bio = 'My bio'`,
     `education_field = 'English'`, flags `false`.
  6. As the viewer: `update user_settings set full_name_public = true where user_id = <pv-private>` changes 0 rows.
  7. `pv-editor` with all three switches `false` (set as postgres): the viewer gets `first_name = 'Pv'`, the bio,
     and all flags `true`.
  8. As postgres, `delete from editors where user_id = <pv-editor>`; then the viewer gets `first_name = ''` and
     `full_name_public = false`.

- [ ] **Step 2: Run it and see it fail**

Run: `npx -y supabase@latest db reset`, then
`docker exec -i supabase_db_quizBuilder psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/profile_privacy.sql`
Expected: ERROR, column `full_name_public` does not exist.

- [ ] **Step 3: Write the migration.** `alter table public.user_settings add column …` × 3. Then `drop function
  public.teacher_profile(text)` + `create function` (returned columns change), copied from the newest version in
  `20261214000000_profile_photos.sql` (same `security definer`, `set search_path = ''`, `profile_is_visible`,
  `left join profile_photos`), with the rules in Interfaces. "The owner" = `s.user_id = (select auth.uid())`;
  "an editor" = `exists (select 1 from public.editors e where e.user_id = s.user_id)`. Same grants: `revoke execute
  … from anon, public`, `grant execute … to authenticated`. A short header comment in the repo's plain style says
  what changes and why.

- [ ] **Step 4: Run it and see it pass**, plus the neighbours that call `teacher_profile`

Run: `npx -y supabase@latest db reset`, then the docker command for `profile_privacy.sql`, `profile_photos.sql`
and `teacher_shared_presentations.sql`.
Expected: each ends with `ROLLBACK`, no `FAIL`, no `ERROR`.

- [ ] **Step 5: Update `supabase/migrations/CLAUDE.md`**: add the migration next to "Teacher profiles", say what
  the three columns do, and move "Newest `teacher_profile`" to it.

### Task 2: The profile page hides and marks private fields

**Files:**
- Modify: `src/lib/profiles.ts` (`TeacherProfile`, `loadTeacherProfile`)
- Modify: `src/app/teachers/[slug]/page.tsx`

**Interfaces:**
- Consumes: Task 1's `teacher_profile` columns.
- Produces: `TeacherProfile` gains `fullNamePublic: boolean; educationPublic: boolean; bioPublic: boolean`.

- [ ] **Step 1: Add the three flags** to `TeacherProfile`, the `maybeSingle<…>` row type and the returned object
  in `loadTeacherProfile`. Update the comment above `TeacherProfile` (private fields come back empty for others).

- [ ] **Step 2: Use them on the page.**
  - Full name line: shown as today (non-empty and different from the heading); add the tag when
    `!profile.fullNamePublic`.
  - Educational background: shown as today when `education` is non-empty; tag when `!profile.educationPublic`.
  - Bio: the section shows only when `profile.bioPublic || profile.bio` (so "No bio yet." only for a public, empty
    bio); tag when `!profile.bioPublic`.
  - The tag: a small neutral pill with `LockIcon` (`size={12}`) and "Only you can see this", e.g. `inline-flex
    items-center gap-1 rounded-dropdown border border-border-default px-2 py-0.5 text-[11px] font-semibold
    text-text-secondary`, written once in the page (a const or a tiny component) and used three times.
  - Update the page's top comment.

- [ ] **Step 3: Check**

Run: `npx tsc --noEmit` and `npm run lint`. Expected: no errors in these files.

### Task 3: The Account page switches, the "Make editor" box, notes

**Files:**
- Modify: `src/lib/userSettings.ts` (new schema, `saveProfile`)
- Modify: `src/lib/account.ts` (`Account.visibility`, the select)
- Modify: `src/app/account/AccountForms.tsx` (`PersonalDetailsForm`)
- Modify: `src/app/account/page.tsx` (pass the new props)
- Modify: `src/app/admin/teachers/AdminTeachers.tsx:119` (the "Make editor" message)
- Modify: `src/app/admin/safety/page.tsx` (the "Profiles show only public details" item)
- Modify: `src/app/CLAUDE.md` (Account, profiles), `src/app/admin/CLAUDE.md` (Teachers row: the box's new line)

**Interfaces:**
- Consumes: Task 1's columns.
- Produces: in `userSettings.ts`, `profileVisibilitySchema = z.object({ fullNamePublic: z.boolean(),
  educationPublic: z.boolean(), bioPublic: z.boolean() })`, `type ProfileVisibility = z.infer<…>`, and
  `saveProfile(fields: ProfileFields, visibility: ProfileVisibility): Promise<void>`. In `account.ts`,
  `Account.visibility: ProfileVisibility` (`true` for each when the row has none yet). `PersonalDetailsForm({
  profile, visibility, displayName, isEditor })`.

- [ ] **Step 1: `userSettings.ts`.** Add the schema and type. `saveProfile` parses both with zod and sends the three
  columns in the same upsert (one request = one `settings` click). `profileSchema` and `signUpSchema` don't change
  (sign up asks nothing about this; the columns' defaults apply).

- [ ] **Step 2: `account.ts`.** Add the three columns to the select and fill `visibility` (`?? true`).

- [ ] **Step 3: `PersonalDetailsForm`.**
  - Holds `visibility` in its own state; `isChanged` is also true when a switch differs, so changing only a switch
    turns Save details on.
  - Not an editor: a checkbox row "Show on my profile" (`h-4 w-4 accent-accent`, like `DetailsModal.tsx`) under the
    first/last name grid, under Field or major, and under the bio's help text. An editor: no checkboxes, and the
    editor line (Global Constraints) under the bio.
  - The display name warning (exact words above) under the name checkbox when it's off and the display name, in
    small letters, contains both the first and the last name in small letters (trimmed, and both non-empty). Shown
    as `rounded-dropdown bg-highlight-soft px-3 py-2 text-xs text-text-primary`.
  - The bio help text becomes "Optional, up to {BIO_MAX_LENGTH} characters. Your contact number and email never
    show on your profile."
  - Save sends `saveProfile(fields, visibility)`; toasts and the pause handling stay as they are.

- [ ] **Step 4: `account/page.tsx`** passes `visibility`, `displayName` and `isEditor` from `getAccount()`.

- [ ] **Step 5: The "Make editor" box** message adds the exact sentence from Global Constraints after the current
  one. **Admin → Safety:** the "Profiles show only public details" item's `rule` and `what` say that a teacher can
  make their full name, educational background and bio private (editors' always show), and that `teacher_profile`
  leaves private fields out for everyone but the owner.

- [ ] **Step 6: Notes.** `src/app/CLAUDE.md`: Account (the three switches, the warning, editors) and
  `teachers/[slug]/` (private fields hidden, "Only you can see this" for the owner). `src/app/admin/CLAUDE.md`:
  the Teachers row's "Make editor" box.

- [ ] **Step 7: Check**

Run: `npx tsc --noEmit`, `npm run lint`, `npm test`. Expected: no errors in changed files; tests pass.
Then in the browser (`npm run dev`, local database): as a plain teacher turn all three off and save (toast
"Details saved."); open the profile as that teacher (three tags) and as another teacher (only the display name and
presentations); change only one switch and see Save details turn on; as an editor see no checkboxes and the editor
line.

- [ ] **Step 8: Review the diff** against the spec and this plan (`git diff`), then ask the user before committing:

```bash
git add supabase/migrations/20261215000000_profile_privacy.sql supabase/tests/profile_privacy.sql \
  supabase/migrations/CLAUDE.md src/lib/profiles.ts "src/app/teachers/[slug]/page.tsx" src/lib/userSettings.ts \
  src/lib/account.ts src/app/account/AccountForms.tsx src/app/account/page.tsx \
  src/app/admin/teachers/AdminTeachers.tsx src/app/admin/safety/page.tsx src/app/CLAUDE.md src/app/admin/CLAUDE.md \
  docs/superpowers/specs/2026-10-28-profile-privacy-design.md docs/superpowers/plans/2026-10-28-profile-privacy.md
git commit -m "Profile privacy: teachers can hide their full name, educational background and bio"
```

**Deploying:** apply the migration before the app deploys (the profile page reads the new columns).
