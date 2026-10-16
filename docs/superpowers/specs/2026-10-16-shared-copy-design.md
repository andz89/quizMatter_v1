# Shared copy: publishing makes a copy

## Why

Today "Published" is only a switch (`is_published`) on the teacher's own presentation. Other teachers open that very
presentation, so every save a teacher makes shows up for them at once, even half-finished work.

From now on, publishing makes a **shared copy**. The teacher keeps editing their own presentation (the original) in
private. Other teachers only see the copy. The copy changes only when the teacher clicks **Update shared
presentation**.

## Scope

- **Teachers only.** Admins' QuizMatter presentations (`from_admin`) keep today's Draft / Shared switch, unchanged.
  Reviews and submissions rely on that and are not touched.
- **Existing data:** this is the development stage. The migration **deletes every teacher presentation that is
  published today** (`from_admin = false and is_published = true`), with their slides, bookmarks and reports (they
  go by `on delete cascade`). Admin presentations are not touched.

## What the teacher sees

- **Share card** (`src/components/editor/ShareButton.tsx`): Private / Published, as today.
  - **Private → Published:** the "Continue?" box says a copy is made, and that later edits stay private until
    *Update shared presentation*. Continue saves unsaved edits, then makes the copy.
  - **While published:** the card shows one of:
    - "The shared copy is up to date." (no button), or
    - "You have changes the shared copy doesn't have." + an **Update shared presentation** button (main button
      style). It saves unsaved edits first, then updates the copy. Spinner on the button while it works; sonner toast
      on success and on failure.
  - **Copy link** copies the shared copy's link (`/presentation/<copy id>`).
  - **Published → Private:** the box says the copy is removed: it leaves Home, other teachers' Saved lists, and its
    link stops working. Copies other teachers made with "Make a copy" stay with them.
- **Deleting the original** also deletes its shared copy (the delete confirm box says so when it is published).
- **My own lists** (My presentations cards, the "See all" table, folders, search in "mine", the tab counts) never
  show the copy. The original shows the "Published" badge when it has a copy.
- **Opening my own copy** at `/presentation/<copy id>/edit` sends me to the original's editor. On the view page
  `/presentation/<copy id>` I see it like any published presentation.
- Other teachers: nothing changes. They find the copy on Home ("Other teachers"), in search, in Saved, in the
  editor's Presentations panel; they can Make a copy, bookmark and report it.

"Behind" (has changes the copy doesn't have) = the original's `updated_at` is later than the copy's `shared_at`.

## Data

New columns on `public.presentations`:

- `shared_from text unique references public.presentations (id) on delete cascade`: set only on a shared copy; the
  original's id. `unique` = at most one copy per original. The cascade deletes the copy (and its slides, bookmarks
  and reports) when the original goes.
- `shared_at timestamptz`: on a copy, when it was last copied from the original (made or updated).

A shared copy is: same `owner_id` as the original, `from_admin = false`, `is_published = true`, `shared_from` set.
Its slides are normal rows in `public.slides` with the same slide ids as the original (the key is
`(presentation_id, id)`, so the same ids can be used again).

An original (any presentation with `shared_from is null` and `from_admin = false`) is always `is_published = false`.
In the app, a teacher presentation's `isPublished` means "it has a shared copy".

## Database (the real guard)

One migration, `20261123000000_shared_copy.sql`.

- **Delete today's published teacher presentations** (see Scope), then add the two columns.
- **`share_presentation(target_id text) returns text`** (security definer; returns the copy's id). Used for both
  Publish and Update shared presentation:
  - Refuses (`42501`) unless the caller owns `target_id`, it is not `from_admin`, and it is not itself a copy.
  - Refuses (`QMREV`) if `is_review_locked(target_id)` (a waiting submission).
  - Refuses (`QMPUB`) unless `has_publishable_content(target_id)`.
  - Counts `count_click('share')`; on the first publish (no copy yet) also `count_click('publish')`. Same limits as
    today.
  - No copy yet: inserts a new row (`gen_random_uuid()::text`) with the original's details and copies its slides.
    Copy exists: overwrites the copy's details (title, description, grades, subject, term, week, day, curriculum,
    learning competency, author, reference links, tags, transition, transition speed) and replaces its slides. The
    copy keeps its id, `created_at`, `hidden_at`, bookmarks and reports.
  - Sets `shared_at = now()` and `updated_at = now()` on the copy.
- **`unshare_presentation(target_id text)`** (security definer): same owner / not-QuizMatter checks, counts
  `count_click('share')`, deletes the copy. Nothing to delete = nothing happens.
- **Copies can't be changed directly:** a trigger on `presentations` (update) and on `slides` (insert, update,
  delete) refuses changes to a copy (`42501`) unless the session setting `quizmatter.sharing` is `yes`, which only
  the two functions above set. Deleting the copy's row by cascade from the original still works. Admin hiding
  (`hidden_at`) still works: the trigger lets a change to only `hidden_at` through.
- **Teachers can't publish an original:** `save_presentation` (start from its newest version,
  `20261118000000_presentation_term.sql`) and the `count_share_clicks` trigger refuse `is_published = true` on a
  non-`from_admin` row with `shared_from is null` (`42501`). Admin presentations keep working as today. The share
  trigger stops counting teacher saves (the new functions count instead).
- **The 50-presentation limit** does not count copies (`shared_from is not null`).

## App

- **`src/lib/sharing.ts`** (new): `shareCopy(id)` and `unshareCopy(id)` call the two functions. Their input is the
  presentation id, checked with zod first. Refusals become messages through `REFUSALS`; a click-limit pause goes
  through `pausedUntilFromError` / `pauseFeature`, as today.
- **Store** (`src/lib/store.ts`): the presentation keeps `isPublished`. A new `sharedAt` (copy's last copy time,
  or null) and `sharedCopyId` come from `fetchPresentation`. `setPublished(value)` for a teacher: save unsaved
  edits (quiet), then `shareCopy` / `unshareCopy`, then set `isPublished`, `sharedCopyId`, `sharedAt` without
  making it an unsaved change. New `updateSharedCopy()`: the same save + `shareCopy`. Admins keep today's path
  (the flag saved with the presentation).
- **`fetchPresentation`**: for a teacher's original, reads its copy (`id, shared_at`) and sets `isPublished`,
  `sharedCopyId`, `sharedAt`. If the opened id is the caller's own copy, the edit page redirects to the original.
- **Lists:** every query of "my own" presentations adds `shared_from is null`: `(home)/cards.ts` users, the
  layout's counts, `presentations/page.tsx`, folders, search "mine". The badge reads the copy through the
  `shared_from` link. Lists of other teachers' published ones need no change (copies are published rows;
  originals never are).
- **`ShareButton.tsx`:** new confirm text, the up-to-date / behind line and the Update button, Copy link uses
  `sharedCopyId`. Uses `Spinner`, sonner, the design-system classes and Lucide icons (e.g. `RefreshCwIcon`).

## Notes to update (same commit)

- `src/app/CLAUDE.md` "Sharing and publishing": the copy, the two functions, the Update button, "behind".
- `supabase/migrations/CLAUDE.md`: the new migration under "Where the big features live".
- `src/components/editor/CLAUDE.md` and `src/lib/CLAUDE.md`: the Share card and `sharing.ts`.

## Checks

`npx tsc --noEmit` and `npm run lint`; re-read the diff against this spec. Live testing in the browser is left to the
user.
