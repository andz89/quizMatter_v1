# Display Name Rules — Design

Date: 2026-10-10

Builds on `2026-10-10-profile-name-links-design.md` (display names are unique and make the profile link).

## Goal

Make display names harder to abuse now that they are unique and make the profile link:

- Sign up no longer asks for a display name: it's made from the first and last name.
- On the Account page, a teacher confirms a new name in a modal, and can change it only once every 30 days.
- Saving a name is limited to 5 tries in 5 minutes, so nobody can test which names are taken.

## What the user decided

- **Sign up has no display name box.** The display name is the first + last name ("Maria" + "Santos" →
  "Maria Santos"). Under the name boxes: "This is your display name. You can change it once later on the Account
  page."
- **Taken at sign up → add 3 random letters/digits:** "Maria Santos k3f" (`/teachers/maria-santos-k3f`). The email
  is never used.
- **Once every 30 days:** the name from sign up can be changed once right away. After any change on the Account page,
  the next change waits 30 days.
- **A confirm modal on Save name** (Account page only): "Is this display name final? If "Teacher Ria" is available,
  it will be your display name, and you'll have to wait 30 days to change it." [Cancel] [Continue]. Continue checks
  and saves in one step; a taken name changes nothing and starts no wait.
- **No Check button.** Instead, **Save name is limited to 5 in 5 minutes, then paused 5 minutes**, with the existing
  click-limit system. A normal teacher never sees it.
- **No sign-up name checks** (no limit by internet address, no browser lock for names): there's nothing to check at
  sign up.

## Assumptions

- A name with no a–z/0–9 at all (e.g. first + last "王 老师") becomes "Teacher" + 3 random letters/digits
  ("Teacher x7p"), since it would make no link.
- Clearing the name also counts as a change (starts the 30 days).
- Admins skip the 30 days and the click limit (the click-limit system already skips admins).
- Accounts whose email was never confirmed don't hold a name (as in the profile-links spec): their name is cleared
  when someone else needs it.
- A teacher added by hand (no first/last name) gets "Teacher" + 3 random letters/digits.

## Data

### Migration `20261113000000_display_name_rules.sql`

- **`user_settings.display_name_changed_at timestamptz`** (null = never changed on the Account page).
- **`public.claim_display_name(slug text, me uuid) returns boolean`**, `security definer`, not callable by users:
  clears the display name of any **unconfirmed** account (other than `me`) whose `profile_slug = slug`, then returns
  true if no other account has that slug. Used by the two functions below. (Replaces `display_name_taken`, which is
  dropped.)
- **`hook_before_user_created`**: back to the version in `20261108000000_sign_up_limit.sql` (no name check: the
  person no longer types a name).
- **`handle_new_user`** (`create or replace`): the display name is no longer read from the metadata. It's:
  1. `trim(first_name || ' ' || last_name)`; if `profile_slug` of it is `''`, the base is `Teacher` and it always
     gets letters.
  2. If `claim_display_name` says the slug is free, use it.
  3. Otherwise try `base || ' ' || <3 random characters from 'abcdefghijkmnpqrstuvwxyz23456789'>`, up to 20 times,
     until one is free. (With 32³ = 32,768 endings, 20 misses in a row won't happen in practice; if it ever does,
     the insert fails on the unique index and the sign up fails, like any other bad value.)
  4. `display_name_changed_at` stays null (the first change is free).
- **Click limit row:** `insert into click_limits (feature, label, max_clicks, per_seconds, first_pause_minutes,
  repeat_pause_minutes, repeat_within_hours, ban_after_pauses) values ('display_name', 'Display name', 5, 300, 5, 5,
  24, null)`. Admin → Safety lists it by itself (it reads `click_limits`).
- **`public.set_display_name(name text) returns jsonb`**, `security definer`, granted to `authenticated` only. The
  one way to change your display name:
  1. Not logged in → error.
  2. `perform public.count_click('display_name')`: refuses with `QMBLK` while paused. Done first and never undone,
     because every outcome below **returns** instead of raising, so the count is kept even for a taken name.
  3. Trim the name. Same name as now → `{"status": "saved"}` (nothing to do, no wait starts).
  4. Not an admin and `display_name_changed_at > now() - interval '30 days'` →
     `{"status": "wait", "until": <changed_at + 30 days, Unix ms>}`.
  5. Non-empty name whose slug isn't free (`claim_display_name`) → `{"status": "taken"}`.
  6. Upsert the caller's row with `display_name = name, display_name_changed_at = now()`; a `unique_violation` (two
     people at the same moment) → `{"status": "taken"}`. The table's checks (length ≤ 80, has a letter/number)
     still apply; zod checks them first.
  7. → `{"status": "saved"}`.
- **Guard trigger** `user_settings_display_name_guard`, `before insert or update of display_name`: when the caller is
  the row's owner (`auth.uid() = new.user_id`) and the display name changes (on insert: is not `''`), refuse unless
  `set_display_name` set the transaction flag `qm.set_display_name = 'on'` (`set_config(..., true)`). So the 30 days
  and the click limit can't be skipped by writing the table directly. The sign-up trigger and the unconfirmed-name
  clearing run without a logged-in owner, so they pass.

## App

### `src/lib/userSettings.ts`

- `signUpSchema`: drop `displayName`. `signUp` stops sending `display_name`.
- `saveDisplayName(name)` now calls `set_display_name` (after `displayNameSchema.parse`) and returns
  `{ status: "saved" } | { status: "taken" } | { status: "wait"; until: number }`. A `QMBLK` error throws as before
  (the caller reads it with `pausedUntilFromError`).
- `DISPLAY_NAME_TAKEN_MESSAGE` stays (now only for the Account page).
- `DISPLAY_NAME_CHANGE_DAYS = 30` (same as the migration), for the modal and the hint.

### `src/lib/clickLimits.ts`

- `CLICK_FEATURES.display_name = { pausedText: "Changing your display name" }`.

### `src/lib/account.ts`

- Read `display_name_changed_at`; add `nextNameChangeAt: number | null` (Unix ms; null when the name can be changed
  now, and always null for admins).

### Account page — `src/app/account/AccountForms.tsx`, `page.tsx`

- `ProfileForm` gets `nextNameChangeAt`.
- **Save name** checks the name with zod, then opens the existing `ConfirmModal`
  (`src/components/editor/ConfirmModal.tsx`):
  - title: `Is this display name final?`
  - message: `If "<name>" is available, it will be your display name, and you'll have to wait 30 days to change it.`
  - confirm label: `Continue`
- Continue → `saveDisplayName`, with the Spinner on the button while it works:
  - `saved` → toast "Name saved.", `router.refresh()`.
  - `taken` → toast `DISPLAY_NAME_TAKEN_MESSAGE`; the old name stays.
  - `wait` → toast "You can change your display name again on <date>."
  - `QMBLK` → `pauseFeature("display_name", until)`; the notice at the bottom shows by itself.
  - anything else → toast "Couldn't save your name. Please try again."
- While `nextNameChangeAt` is in the future, the box and Save are disabled and the hint says "You can change your
  display name again on <date>." While paused (`useIsPaused("display_name")`), Save is disabled.
- Hint under the box (otherwise): "Your profile link is made from it. You can change it once every 30 days."

### Sign up — `src/app/signup/page.tsx`

- Remove the Display name field (and its state and import).
- Under the first and last name boxes: "This is your display name. You can change it once later on the Account
  page."

## Stays the same

- Unique names and the link rule (`profile_slug`), the profile page, and the existing sign-up limits (3 per browser,
  10 per internet address, captcha).

## Checks

- `npx tsc --noEmit` and `npm run lint`.
- The user tests in the browser: sign up twice with the same first/last name (second gets letters), sign up with a
  name like "王 老师", change the name once (modal, saved), try again (disabled with the date), a taken name (toast,
  no wait starts), 5 quick saves of taken names (paused 5 minutes, notice shows).
