# Profile privacy (teachers choose what their profile shows)

## Why

A teacher's profile page (`/teachers/<link name>`) shows their full name, educational background and bio to every
logged-in user, with no way to hide them. The user wants plain teachers to choose, for each of these, **Public** or
**Private**. The display name is not part of it: it always shows (it makes the profile link).

The user skipped the questions ("go now"), so every choice below marked **(Claude's call)** is for them to check.

## Goals

- Three switches on the Account page, in Personal details, each "Show on my profile":
  - **Full name** (first + last name together)
  - **Educational background** (the degree and the field together, one switch) **(Claude's call)**
  - **Bio**
- Every switch starts **on (Public)**, for new teachers and for every teacher who already has an account, so no
  profile changes until a teacher turns one off **(Claude's call)**.
- A private field never leaves the database for anyone but its owner: not other teachers, not editors, not admins
  (Admin → Teachers already shows names and education from its own read; nobody sees a private bio)
  **(Claude's call)**.
- The owner, opening their own profile, still sees their private fields, each marked "Only you can see this", so
  they can check what others see.
- A private field's whole section is gone for others (no "No bio yet." for a private bio).
- **Editors' fields always show** **(Claude's call)**: the user asked for plain teachers, and an editor's name is
  already public as the Author of their QuizMatter lessons. The editor's switches are hidden on their Account page,
  with the line "As an editor, your profile always shows your full name, educational background and bio." Their
  saved choices stay: if the role is taken away, the choices apply again. Admin → Teachers' "Make editor" box says
  so before the role is given.
- **The display name warning:** sign up makes the display name from the first + last name ("Ria Santos",
  `/teachers/ria-santos`), so hiding the full name alone hides nothing. When Full name is off and the display name
  has both the first and the last name in it, the Account page says: "Your display name still shows your full
  name. You can change it in Profile above." Nothing changes automatically, and the 30-day wait stays.

## Non-goals

- No switch for the display name, contact number or email (the last two never show anyway).
- No "hide my whole profile" switch.
- No change to names shown elsewhere (cards' Publisher, Reviewer, Author): those use the display name.
- Not a click limit of its own: saving the switches is a `user_settings` write, so it already counts toward the
  `settings` click limit, once per Save.

## Anti-goals (a failure even if it works)

- A private field reaches another user by any route (page, direct `teacher_profile` call, direct table read).
- One teacher changes another teacher's switches.
- An existing teacher's profile changes on deploy.

## How it works

- **Database** (new migration after `20261214000000_profile_photos.sql`): three columns on `user_settings`,
  `full_name_public`, `education_public`, `bio_public`, `boolean not null default true`. The owner writes them
  through the existing "Own settings" policy, in the same upsert as the other details. `teacher_profile(slug)`
  (newest: `20261214000000_profile_photos.sql`) returns three more columns, the same names, each meaning "others
  see this": the saved switch, or `true` for an editor. Each private field comes back `''` unless the caller is the
  owner.
- **App:** `saveProfile` sends the switches with the details (zod first). `getAccount` reads them. The profile page
  hides or marks the fields from the flags.

## Notes to update

`src/app/CLAUDE.md` (Account, profiles), `supabase/migrations/CLAUDE.md` (the migration, newest
`teacher_profile`), `src/app/admin/CLAUDE.md` (the "Make editor" box), and the "Profiles show only public details"
item on Admin → Safety (`src/app/admin/safety/page.tsx`).
