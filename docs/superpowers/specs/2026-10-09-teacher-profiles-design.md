# Teacher Profiles — Design

Date: 2026-10-09

## Goal

Every teacher (editor or not) can write a short bio. Other users can open a teacher's profile page and see their
display name, first and last name, educational background and bio.

## What the user decided

- **Who has a visible profile:** every teacher. Anyone **logged in** to QuizMatter who has the link can open it, so
  teachers can share their profile link. Someone logged out is sent to log in first (the proxy), then lands on it.
- **How to get there:** the shared link (`/teachers/<id>`); "View my profile" and "Copy profile link" on the Account
  page; and on the presentation page, the **Publisher** name and each **Reviewer** name link to that teacher's
  profile. Cards keep plain names (a card is already one big link; a link can't sit inside a link).
- **Privacy:** a database function returns only the public fields; it never returns the contact number or email.
  Teachers' own `user_settings` rows stay readable only by themselves.

## Assumptions

- The bio is plain text, optional, up to 300 characters, written on the Account page.
- The "Author" row stays plain text: it's typed by the teacher and isn't tied to an account.
- Admin accounts stay hidden from teachers (they show as "QuizMatter" today); admins can see every profile.
- Someone who signs up from a shared link lands on the home page after confirming their email (that's how the
  confirm link works); they can open the profile link again.

## Data

### Migration `20261110000000_teacher_profiles.sql`

- `alter table public.user_settings add column bio text not null default '' check (char_length(bio) <= 300);`
- `public.teacher_profile(profile_id uuid)` — `returns table (display_name text, first_name text, last_name text,
  education_level text, education_field text, bio text)`, `language sql stable security definer set search_path = ''`.
  Returns one row for any account in `auth.users` (fields from `user_settings`, `''` when it has no row yet), except
  an admin's account, which only that admin and other admins can see (teachers know admins only as "QuizMatter").
  No account, or a hidden admin → no row. Never returns the contact number, email or anything else.
- `grant execute ... to authenticated`; `revoke execute ... from anon, public`.
- The visibility rule lives in one function, `public.profile_is_visible(uuid)` (not callable by users), used by
  `teacher_profile` and by `public.visible_profiles(uuid[]) returns setof uuid`, which the presentation page uses to
  link only names whose profile the viewer may open (a hidden admin's name stays plain text).
- Presentation pages still show the publisher's and reviewers' email next to their name, as before; only the profile
  page leaves out the contact number and email.

### Zod (`src/lib/userSettings.ts`)

- `BIO_MAX_LENGTH = 300`; `profileSchema` gets `bio: z.string().trim().max(BIO_MAX_LENGTH, "Use at most 300 characters
  for your bio.")` (optional: empty is fine). `ProfileFields` gets `bio`.
- `saveProfile` also saves `bio`. `getAccount().profile` also reads `bio` (`src/lib/account.ts`).
- Sign up doesn't ask for a bio: `signUpSchema` keeps its fields (it extends `profileSchema`, so it uses
  `profileSchema.omit({ bio: true })`), and the trigger leaves `bio` empty.

### `src/lib/profiles.ts`

- `type TeacherProfile = { displayName; firstName; lastName; educationLevel; educationField; bio }`.
- `loadTeacherProfile(supabase, id): Promise<TeacherProfile | null>` — calls the function; null when no row or the id
  isn't a valid uuid.
- `profileHref(id) = "/teachers/" + id`.
- `educationLine(level, field)` — "Master's degree in English" (or just the field for "Other"); moved here from
  Admin → Teachers' `detailsLine` so both use it.

## Pages

### Profile page `src/app/teachers/[id]/page.tsx` (+ `loading.tsx`)

- Server page. `loadTeacherProfile`; none → `notFound()`. Heading: display name, else the full name, else
  "QuizMatter teacher".
- NavBar with a "Home" link (like the Account page). One `rounded-card` card: display name as the `h1` (or the full
  name when there's no display name), the full name under it, an "Educational background" label with the education
  line, and a "Bio" label with the bio (`whitespace-pre-line`; "No bio yet." in `text-text-secondary` when empty).
- `loading.tsx`: `TopLoadingBar` + `Spinner`, like the Account page's.

### Presentation page (`src/app/presentation/[id]/PresentationPreview.tsx`)

- `fetchPresentation` also returns `ownerId`; `loadReviewers` also returns `reviewerId` (`reviewer_id`, which teachers
  may read).
- The Publisher row: when it isn't "QuizMatter" (from an admin), the publisher name is a `Link` to
  `profileHref(ownerId)` with `LinkPending`. "Author" stays plain.
- Each Reviewer row: the reviewer's name is a `Link` to `profileHref(reviewerId)` with `LinkPending`.
- Link style: `font-semibold text-accent hover:underline`.

### Account page

- "Personal details" card: a **Bio** `textarea` (3 rows, `maxLength` 300, optional, hint "Shown on your profile. Up to
  300 characters."), saved with the rest by `saveProfile` (toast as now).
- In the page header: a "View my profile" link (to `profileHref(account.id)`, with `LinkPending`) and a "Copy profile
  link" button (copies the full address, sonner toast "Profile link copied." / "Couldn't copy the link.").

### Admin → Teachers

- `detailsLine` uses `educationLine` from `src/lib/profiles.ts` (no behavior change).

### Admin → Safety

- New item in "Access": **"Profiles show only public details"** — every teacher's profile can be opened by logged-in
  users with the link, what's shown, and that the contact number and email never are (the `teacher_profile` function,
  not a table rule); admin accounts stay hidden.

## Not included

Profile photos, profile links on cards, a list of the teacher's presentations on the profile, hiding your own profile,
profiles for people who aren't logged in.

## Checking

`npx tsc --noEmit`, `npm run lint` on changed files, re-read the diff, and run the migration's function inside a
rolled-back transaction to check what it returns. Live testing is left to the user.
