# Remove the address (province and town)

## Why

The user wants the address gone from QuizMatter: the Province and City or town at sign up, on the Account page and
on the profile, and the Provinces and Town filters in Announcements. The saved values are deleted from the database
too (the columns are dropped), so nothing about a teacher's address is kept.

This undoes the address half of `2026-10-30-age-gender-address-design.md`. The birthday and gender stay as they are.

## Goals

- Sign up no longer asks for Province or City or town.
- The Account page loses both boxes and the town's "Show on my profile" checkbox.
- The profile page no longer shows "Town, Province".
- Admin → Teachers' details line no longer has the town and province.
- Admin → Overview's Teachers section loses "By province" (age group and gender stay).
- Admin → Announcements loses the Provinces and "City or town has any of these words" filters.
- The database drops `user_settings.province`, `town`, `town_public` and `announcements.provinces`, `town_words`,
  with their checks and the functions only they used (`is_province`, `announcement_provinces_ok`). Every saved
  province and town is deleted for good (the user agreed).
- The Privacy Policy and Terms no longer mention the province or town, and `LEGAL_VERSION` changes.

## Non-goals

- Birthday, gender, age filters and their charts don't change.
- No "export before delete": the user agreed the saved values are simply dropped.

## Data (one migration: `20261227000000_remove_address.sql`)

Each function below is copied from its newest version in `supabase/schema.sql`, minus the address parts:

- **`handle_new_user`**: no `given_province`, no `province` / `town` in the insert. It still removes the
  `province` and `town` keys from `auth.users.raw_user_meta_data` (with the other sign up keys), and so does
  **`strip_sign_up_details`**, so an old open sign up tab that still sends them leaves nothing behind (the Privacy
  Policy promises sign up details aren't kept twice).
- **`teacher_profile`**: dropped and made again without `town`, `province`, `town_public` (its grants again:
  `authenticated` only).
- **`admin_teacher_breakdown`**: only the `age` and `gender` rows.
- **`announcement_matches`** and **`announcement_count`**: the province and town lines removed (still the same rule
  as each other; `announcement_fast_counts.sql` checks they agree).
- **`save_announcement`**: no `provinces`, `town_words`.
- **`admin_announcements`**: dropped and made again without `provinces`, `town_words` in its return table (its
  grants again).
- Any other function that names the two announcement columns (checked with a search of `schema.sql` while
  writing the migration) is made again without them.
- Then: `alter table public.user_settings drop column province, drop column town, drop column town_public;`
  `alter table public.announcements drop column provinces, drop column town_words;` (their checks go with them),
  then `drop function public.announcement_provinces_ok(text[]); drop function public.is_province(text);`.

## App

- **Delete** `src/lib/provinces.ts` and `src/lib/provinces.test.ts`.
- **`src/lib/userSettings.ts`**: `profileSchema` loses `province`, `town`; `profileVisibilitySchema` loses
  `townPublic`; `TOWN_MAX_LENGTH` goes; `signUp` and `saveProfile` stop sending them.
- **`src/lib/account.ts`**: `getAccount` stops reading `province`, `town`, `town_public`.
- **Sign up** (`src/app/signup/SignUpForm.tsx`): no Province or City or town. The hint becomes "Your birthday and
  gender are private." The agree box: "…including how QuizMatter keeps my birthday and gender (private) and my
  educational background (shown on my profile)."
- **Account page** (`src/app/account/AccountForms.tsx`): no Province, City or town, or their checkbox. The editor
  note: "…your full name, educational background and bio."
- **Profile** (`src/app/teachers/[slug]/page.tsx`, `src/lib/profiles.ts`): no place line; `placeLine` and the
  `town` / `province` / `townPublic` fields go.
- **Admin → Teachers** (`src/app/admin/teachers/page.tsx`): stops reading them; the details line has no place. The
  editor-role confirm text in `AdminTeachers.tsx` drops "town and province".
- **Admin → Overview** (`src/app/admin/TeacherBreakdown.tsx`, `src/app/admin/page.tsx`): no "By province" card
  (and no top-10 / Others code); `BreakdownRow.kind` is `"age" | "gender"`.
- **Announcements** (`src/lib/announcements.ts`, `src/app/admin/announcements/AnnouncementForm.tsx`, `actions.ts`):
  no `provinces` / `town_words` in `announcementSchema`, the form (the province list, its search box and the town
  words box) or the action's field map.
- **Admin → Safety** (`src/app/admin/safety/page.tsx`): the profile rule text drops "town and province".

## Privacy Policy, Terms and `LEGAL_VERSION`

- `src/app/(legal)/privacy/page.tsx`: remove the "Your province and city or town" item and every other mention
  (what profiles show, what admins see, the counts by province, announcement filters, the "kept until" table row).
- `src/app/(legal)/terms/page.tsx`: the editor line drops "province and city or town".
- `LEGAL_VERSION` (`src/lib/legal.ts`) becomes `"2026-11-01"`.

## Deploy order (reversed this time)

**Deploy the app first, then apply the migration right after.** The current app reads `province`, `town` and
`town_public` on every page (`getAccount`), so dropping the columns first would break every page. The new app works
with the old database, except saving an announcement (the old `save_announcement` needs the two filters it no
longer sends), so don't save one between the deploy and the migration.

## Testing (all on local Docker, never the live database)

- **`supabase/tests/age_gender_address.sql`**: remove the province and town checks; add: a sign up whose metadata
  still has `province` and `town` makes the account and leaves neither key in `raw_user_meta_data`;
  `user_settings` has no `province`, `town`, `town_public` columns and `announcements` no `provinces`, `town_words`
  (via `information_schema.columns`).
- **Announcement SQL tests** (`announcements.sql`, `announcement_fast_counts.sql`, `announcement_counts.sql`,
  `announcement_modal_size.sql`, `announcement_post.sql`, `announcement_facebook.sql`): drop the two keys and the
  province / town filter cases.
- **`src/lib/announcements.test.ts`**: drop the two keys from its sample.
- `npm run test:sql`, `npm test`, `npx tsc --noEmit`, `npm run lint`, then `npm run db:snapshot` (commit
  `supabase/schema.sql` and `src/lib/database.types.ts`).

## Notes to update (same commit)

- Root `CLAUDE.md`: Announcements' filters (if named) and nothing else; no map change.
- `src/app/CLAUDE.md`: sign up, Account page, profile.
- `src/app/admin/CLAUDE.md`: Overview's Teachers section, Teachers' details line, Announcements' filters.
- `src/lib/CLAUDE.md`: remove `provinces.ts`.
- `supabase/migrations/CLAUDE.md`: the new migration; the birthday/gender entry and announcement entries no longer
  describe province / town as current; the deploy order note.
