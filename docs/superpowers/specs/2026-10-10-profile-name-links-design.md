# Profile Links by Display Name — Design

Date: 2026-10-10

Builds on `2026-10-09-teacher-profiles-design.md`.

## Goal

A teacher's profile link uses their display name instead of their account id: a teacher whose display name is
"Teacher Ria" gets `/teachers/teacher-ria` instead of `/teachers/3f9a2c1e-…`.

## What the user decided

- **The link comes from the display name only** (`user_settings.display_name`). The first and last name are never
  used, and there's no separate username to pick.
- **Display names must be unique.** Two display names that give the same link count as the same name: "Teacher Ria",
  "teacher ria" and "Teacher Ría!" all become `teacher-ria`, so only one teacher can have any of them.
- **Renaming breaks the old link.** The old link shows "not found", and the old name is free right away for someone
  else. No redirects, no name history.
- **No repair step for old data.** The app is still in development. If the dev database already has two clashing
  names, the migration stops with an error and they are renamed by hand.
- **The database makes the link name** (approach A). The app never builds a link name itself; it only reads it.

## Accepted trade-offs

- A name is easy to guess, so someone logged in can find a profile by trying `/teachers/<name>`. (The id link was
  unguessable.) Profiles only show public fields, so this was accepted.
- "That display name is taken" tells the person that some account uses that name. That's not new information: names
  are already public on profiles and presentations.

## Data

### Migration `20261112000000_profile_name_links.sql`

- **`public.profile_slug(name text) returns text`**, `language sql immutable`, `set search_path = ''`. The one rule
  for turning a name into its link form:
  1. `normalize(name, NFD)` splits accented letters into letter + accent mark (á → a + ´).
  2. `lower(...)`.
  3. `regexp_replace(..., '[^a-z0-9]+', '-', 'g')`: anything that isn't a–z or 0–9 (spaces, accent marks,
     punctuation, other alphabets) becomes `-`; runs of them become one `-`.
  4. `trim(both '-' from ...)`.

  Examples: "Teacher Ría!" → `teacher-ria`, "  Ms. Joy  " → `ms-joy`, "SirMark_23" → `sirmark-23`,
  "★★★" → `''`.
- **`user_settings.profile_slug`**: `text generated always as (public.profile_slug(display_name)) stored`. The
  database keeps it up to date by itself whenever `display_name` changes.
- **Unique index** `user_settings_profile_slug` on `(profile_slug) where profile_slug <> ''`. This is the real
  guard: two accounts can never have the same link, even if two people save at the same moment. Empty names are
  left out (they have no link).
- **Check constraint**: `display_name = '' or public.profile_slug(display_name) <> ''`. A name must be empty or
  have at least one letter or number a–z / 0–9 (after accents are removed). This is the same rule zod checks first.
- **`teacher_profile`** changes from `(profile_id uuid)` to `(slug text)`. It finds the account whose
  `profile_slug = slug`, and keeps everything else the same: the same columns, `profile_is_visible` decides
  (admins hidden from teachers), and it never returns the contact number or email. Drop the old one and create the
  new one; same grants (`authenticated` only).
- **`visible_profiles(profile_ids uuid[])`** now `returns table (id uuid, slug text)`: each visible account that has
  a non-empty `profile_slug`. Drop and re-create (the return type changes); same grants.
- **`profile_is_visible(uuid)`** is unchanged.
- **`public.display_name_taken(name text) returns boolean`**, `security definer`, `set search_path = ''`: true when
  another account's `profile_slug` equals `profile_slug(name)` (and it isn't `''`). An account whose email was never
  confirmed doesn't hold the name: its display name is cleared first, so a retry after a mistyped email works and
  throwaway sign ups can't hold names (added after the final review). Granted **only** to
  `supabase_auth_admin` (for the hook below), revoked from `anon`, `authenticated`, `public`.
- **`hook_before_user_created`** (already on in the dashboard): before the internet-address check, read
  `event -> 'user' -> 'user_metadata' ->> 'display_name'`. If `display_name_taken` says yes, refuse with
  `http_code 400` and the message `That display name is taken. Please pick another one.` It's checked first so a
  taken name doesn't use up one of the 10 sign ups per address. Re-create the function with `create or replace`,
  keeping the rest of it the same.

## App

### Zod — `src/lib/userSettings.ts`

- `displayNameSchema` gets one more rule: empty, or has a letter or number once accents are removed —
  `name === "" || /[a-z0-9]/.test(name.normalize("NFD").toLowerCase())`. Message: "Use at least one letter or
  number (a–z, 0–9) in your display name." Sign up already requires a non-empty name (`.min(1)`).
- New export `DISPLAY_NAME_TAKEN_MESSAGE = "That display name is taken. Please pick another one."`, the same words
  as the hook, so the sign-up page can recognize it.
- `saveDisplayName`: if Supabase answers with code `23505` (unique index), throw
  `new Error(DISPLAY_NAME_TAKEN_MESSAGE)`. The Account form shows it in its error toast.

### Sign up — `src/app/signup/page.tsx`

- `signUpErrorMessage`: if `error.message` includes `DISPLAY_NAME_TAKEN_MESSAGE`, show it (like the existing
  `SIGN_UP_ADDRESS_MESSAGE` line).

### Profile page — `src/app/teachers/[id]` → `src/app/teachers/[slug]`

- Rename the folder (`page.tsx`, `loading.tsx`). The page reads `slug` instead of `id`.
- `loadTeacherProfile(supabase, slug)` in `src/lib/profiles.ts`: zod-check the slug
  (`/^[a-z0-9]+(-[a-z0-9]+)*$/`, max 80) and return `null` (→ 404) if it doesn't match, then call
  `teacher_profile({ slug })`. Old id links fail this check or find nothing, so they show "not found".

### Links

- `profileHref(slug)` in `src/lib/profiles.ts` takes the link name.
- `loadVisibleProfiles` returns `Map<id, slug>` instead of `Set<id>` (empty map if the lookup fails: names stay plain
  text).
- `fetchPresentation.ts` passes `profileSlugs: Record<string, string>` (id → link name) instead of
  `visibleProfileIds`. `PresentationPreview.tsx`'s `ProfileName` links a name only when its id has a link name.
- `getAccount` (`src/lib/account.ts`) also reads `profile_slug` into `account.profileSlug`.
- Account page: non-admins with a link name get "View my profile" / "Copy profile link" as today. Non-admins with no
  display name instead see the line "Add a display name to get a profile link." Admins still get neither.

## Stays the same

- What the profile page shows, and who can open it (logged-in users only; admins hidden from teachers).
- Publisher and reviewer names, and `publisher_names`.

## Checks

- `npx tsc --noEmit` and `npm run lint`.
- The user tests in the browser: two accounts with the same name (sign up and Account), names with accents and
  punctuation, renaming (the old link shows "not found", the new one works), an old id link, a name like "★★★".
