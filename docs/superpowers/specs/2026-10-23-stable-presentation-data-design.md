# Stable presentation data (safe to add features)

Date: 2026-10-23. Status: built (migration `20261209000000_data_version.sql`).

## Why

Teachers' presentations must survive every new feature. Today two things can hurt them:

1. **An old browser tab can quietly erase new data.** After a deploy, an editor tab that was already open keeps
   running the old code. zod drops fields it doesn't know, so if that tab saves a presentation that newer code
   already saved with a new field, the new field is gone. No error. (It already bit once: "an old app tab's
   'published' save is refused", `20261125000000_shared_copy_fixes.sql`, but that fix covered only that one case.)
2. **One slide in an old shape stops the whole presentation from opening.** `loadPresentation` runs
   `presentationSchema.parse`, which throws if any slide doesn't match today's schema. A future change that renames a
   field or removes a value would lock teachers out of their own work. Old-shape fixes exist, but scattered
   (`withGrades`, `.default("")` on term/week/day).

## Goals

- An old tab can never save over data written by newer code. It's refused, and the teacher's unsaved work is kept
  and given back after the reload.
- Every place that reads a saved presentation or slide turns older shapes into today's shape first, through one
  upgrade step in one place.
- Before a deploy, the user can see which saved presentations (if any) the new code can't read.
- Written rules for changing the data shape, so future changes follow them.

## Non-goals

- No history / restore of older saves (`presentation_versions`). Maybe later.
- No tests or test framework now. Maybe later.
- Claude's drafts (D1) aren't versioned: they live a day and are built by today's import code.
- No automatic reload of old tabs. They're only stopped when they try to save.

## Anti-goals (a failure even if it works)

- A teacher loses edits because of the new refusal.
- A teacher is refused when nothing newer was saved (e.g. every open tab refused right after any deploy).
- Two ways of upgrading old data, or upgrade code spread across files again.

## How it works

### 1. The data version (old tabs can't save over newer data)

- `DATA_VERSION` (a whole number, starts at `0`, the same as tabs from before this change) in `src/lib/schema.ts`. Bump it whenever the saved shape of a
  presentation or slide changes (rules below). Most deploys don't bump it, so most deploys refuse nobody.
- `presentations.data_version` (int, not null, default `0`): the highest version that has saved this presentation.
- `save_presentation` gets one more input, `app_version int default 0` (the default keeps tabs from before this
  change working; they count as version 0). Order of checks: the version check comes **before** the `QM409`
  conflict check. If `app_version < data_version` → refuse with a new code **`QMOLD`**. Otherwise save, and set
  `data_version = greatest(data_version, app_version)`.
- The same for review drafts: `save_review_draft` gets `app_version int default 0`, and
  `presentation_reviews.draft_version` keeps the draft's version, with the same `QMOLD` refusal.
  `publish_review` copies the draft's version onto the presentation (`greatest`), since the draft becomes the
  presentation.
- Database functions that copy a presentation (`approve_submission`'s copy, `share_presentation`'s shared copy) give
  the copy the source's `data_version`; `start_review` gives the new draft the presentation's version. Make a copy
  goes through `save_presentation`, so it gets the app's version like any save.
- The app sends `DATA_VERSION` in `savePresentationToDb` (`src/lib/presentations.ts`) and in `src/lib/reviews.ts`.
- `QMOLD` goes in `REFUSALS` and in the refusal-code list in `supabase/migrations/CLAUDE.md`.

### 2. Keeping the teacher's work when refused

In the tab that was refused (`QMOLD`):

1. The editor saves its current unsaved presentation (the whole presentation object as the store has it, plus its
   base `updatedAt` and whether it was a review draft) in `localStorage` under one key per presentation:
   `qm-unsaved:<presentation id>`. Wrapped in try/catch: if storage fails, it still shows the message.
2. It shows a message that stays until clicked (the app's `ConfirmModal` style, not a toast that fades):
   "QuizMatter was updated. Reload to keep editing. Your changes are safe." with one button, **Reload**.
3. The beforeunload "Leave site?" warning must not block that reload.

After the reload (new code):

4. When the editor opens a presentation, it looks for `qm-unsaved:<id>`. If found, it parses it with
   `presentationSchema` (which runs the upgrade step, so it becomes today's shape), puts it in the editor as unsaved
   changes on top of the freshly loaded one, and shows a toast: "Your changes from before the update are back. Save
   to keep them." Then it deletes the key at once (the "Leave site?" warning protects the unsaved changes from then
   on).
5. The restored copy keeps its own base `updatedAt`. If nobody else saved since, Save just works. If another tab
   did save since, Save gets the normal `QM409` conflict, which is right: two tabs really did change it.
6. If the kept copy can't be parsed even after upgrading, it's left in storage (not deleted) and nothing is
   restored; the editor opens normally. (Rare; the data check below should catch shape problems first.)
7. A kept copy only restores into the same mode it came from (the owner's editor or the review draft), and only for
   the same user (store the user id with it).

Known gap: none at first ship (version 0 refuses nobody). By the first real bump, open tabs will be running this
code, so they keep their work.

### 3. One upgrade step

- In `src/lib/schema.ts`: `upgradeSlide(data)` and `upgradePresentation(data)`. Each takes saved data of any older
  shape and returns today's shape. They're hooked into the schemas themselves with `z.preprocess`
  (`slideSchema = z.preprocess(upgradeSlide, …)`, `presentationSchema = z.preprocess(upgradePresentation, …)`), so
  every parse anywhere upgrades automatically: `loadPresentation`, review drafts (`edit/page.tsx`,
  `admin/presentations/reviews/[id]/page.tsx`), `parseSlide` (cards, Presentations panel, lesson week), slide drag
  (`Workspace.tsx`), the restored kept copy.
- `withGrades` and the term/week/day defaults move into `upgradePresentation` (one place). Today's behavior must not
  change.
- Each upgrade recognizes the old shape by looking at it (like `withGrades` does: "has `grade`, no `grades`"), not by
  a version number inside the JSON. That's enough as long as the rules below are followed (fields are added or
  renamed, never given a new meaning). Each step gets a one-line comment: what old shape, from when.

### 4. Data check before a deploy

- A super-admin-only admin page, **Admin → Data check** (`src/app/admin/data-check/`, `superOnly` in `AdminMenu`).
  It reads every presentation with its slides and every open review draft, parses each with the current
  `presentationSchema`, and lists the ones that fail: title, owner, which slide number, and zod's message. When all
  pass it says so, with the number checked.
- How it's used before a deploy: run `npm run dev` locally (it uses the live Supabase from `.env.local`), open
  Admin → Data check, fix the upgrade step until the list is empty, then deploy. It works on the live site too.
- It only reads. Reading every presentation needs the secret-key client (`createAdminClient`) or a super-admin
  database function; builder's choice. Read in pages so it doesn't load everything at once.

### 5. Written rules

A new section "Changing the saved shape" in `src/lib/CLAUDE.md`, and a short pointer in the root `CLAUDE.md`
(under "Saving Data"):

- A new field is optional or has a default (old slides don't have it).
- Never rename or remove a field, or a value from a list (shape types, transitions…): add the new one, and turn the
  old into the new in `upgradeSlide` / `upgradePresentation`.
- Never give an existing field a new meaning: add a new field.
- Never lower a limit without first fixing the saved data over it (a migration).
- Bump `DATA_VERSION` whenever the saved shape changes. Run Admin → Data check before deploying.

## Constraints

- Follow the root `CLAUDE.md`: zod before saving, `ConfirmModal` for the message, sonner toast, design system,
  newest version of each database function (search the latest migration), notes updated in the same commit.
- New migration: `supabase/migrations/20261209000000_data_version.sql` (after `20261205000000`).
- No new packages.

## My calls (please check)

- The version lives on the presentation row, not inside each slide's JSON, and upgrades recognize old shapes by
  looking at them.
- Old tabs from before this ship count as version 0, the same as the new code, so this change itself refuses nobody.
  The first refusals come only after the first real shape change bumps `DATA_VERSION` to 1.
- The data check is an admin page (super admin only), used locally before deploying, not a command-line script.
- The kept copy is deleted as soon as it's restored into the editor, not after the next save.
- Starting `DATA_VERSION` is 0; no data changes shape in this work, so nothing needs a bump yet.
- Built differently from the text above: `start_review` is unchanged (a draft's check compares the app's version
  with both the draft's and the live presentation's, `check_review_version`); `share_presentation` is unchanged (no
  editor tab writes a shared copy); kept work isn't tied to a user id (only the owner or reviewer can save it
  anyway); the "updated" box is the app's `ConfirmModal`, so it also has Cancel (the work stays kept); a review's
  Submit keeps the work too; slideSchema's older short-answer fix stays in its transform.
- Deploy order: the migration must be live before the app code (the app sends `app_version`; old code still works
  against the new database).

## Left to the builder

- Exact names of the store fields/actions for the kept copy, and where in `Editor` / `store.loadPresentation` the
  restore check runs.
- Secret-key client vs a database function for the data check, and its page size.
