# Editor photos wait in the shared library until QuizMatter uses them

## Why

Editors upload their own photos for the presentations they submit and the reviews they do. Today those photos stay
in the editor's "My photos" only: an admin can't name, tag or sort them, and they never reach the shared library.
The user wants every editor upload to show up in Admin → Photos at once, where an admin can fill in its file name,
category, description, tags and source, **but stay hidden from teachers (and Claude) until QuizMatter approves a
presentation that uses it.**

## Goals

- Every photo an editor uploads also becomes a **waiting** shared photo (uploaded_by = the editor).
- Admin → Photos lists waiting photos with the others, marked **Waiting**, editable like any shared photo, with a
  **Waiting** filter.
- Teachers' Photos panel ("Shared" photos) and Claude's `find_photos` never show a waiting photo.
- A waiting photo becomes a normal (public) shared photo, for good, the moment a **live QuizMatter presentation uses
  it**. In practice: an admin approves the editor's submission (`approve_submission`), or publishes their review
  (`publish_review`).
- The editor profile page (`/admin/editors/<id>`) shows each photo's Waiting / Public state.

## Non-goals

- No change for teachers who aren't editors, or for admins' own uploads (admin uploads to "My photos" stay private;
  admin shared-photo uploads are public at once, as now).
- No approve button for photos. Going public only follows a presentation.
- No change to the editor's own "My photos": the photo stays there as now.

## Anti-goals (would make this a failure even if it works)

- A waiting photo shows in any teacher's shared library or in Claude's search before its presentation is approved.
- An editor's upload fails because the waiting copy couldn't be made.

## How it works

### Database (one migration, `20261126000000_editor_photos.sql`)

1. `shared_photos.is_public boolean not null default true`. Every photo already shared stays public.
2. A category **"From editors"** is created (`photo_categories`), since every shared photo needs a category. Waiting
   photos start there; the admin moves them.
3. **Trigger on `photos` insert** (security definer): if the uploader is in `editors` and the file is WebP, insert a
   `shared_photos` row: same src, width, height; category "From editors"; `uploaded_by` = the editor;
   `is_public = false`; `on conflict (src) do nothing` (a photo that's already shared stays as it is). It must never
   make the upload fail.
4. **Locked while waiting for approval** (the user's rule): `photo_waiting_for_approval(src)` is true when the photo
   is on a slide of a presentation whose submission is `submitted`, or in the draft of a review round that is
   `submitted` (`slide_photo_srcs(draft)`). While it's true, **nobody** can delete it: a before-delete trigger on
   `photos` (the editor's "My photos") and one on `shared_photos` (an admin's ✕ in Admin → Photos) raise `QMPHL`.
   A round still `reviewing` doesn't lock (the reviewer can still change the draft).
5. **Deleting otherwise** only removes the photo from that list. The file stays in storage while any slide or review
   draft uses it: the weekly cleanup already keeps every used photo (`used_photo_srcs`), and slides keep showing it.
   When the editor deletes a photo from "My photos" while its shared row is still **waiting**, the waiting row goes
   too (it was never public). A public one stays. (So a waiting photo deleted this way, then submitted later, won't
   join the library on approval; its slides still show it.)
6. **Going public**, two triggers (security definer), both with one rule: *a waiting photo used by a live QuizMatter
   presentation (`from_admin`, `is_published`, not hidden) becomes public*.
   - After insert on `slide_photos` (filled by `sync_slide_photos` whenever slides are saved, so it covers
     `approve_submission`'s copy and `publish_review`'s new slides).
   - After update of `is_published` / `hidden_at` on `presentations` (a QuizMatter draft that uses one is shared
     later).
   A photo added during a review stays waiting until that review is **published**: the draft isn't a live
   presentation, so sent back, canceled or stopped changes nothing.
7. **Reading rules**: the teachers' read policy on `shared_photos` becomes `using (is_public or is_admin())`.
   `search_shared_photos` (Claude's `find_photos` calls it with the secret key, which skips the rules) gets
   `where sp.is_public`. The `shared_photos_search` and `shared_photo_counts` views get `is_public` (added last, so
   `create or replace` works), and the counts a `waiting` number.
8. **Backfill**: every editor's existing WebP photos in `photos` get a waiting row, the same way as step 3. Those
   already used in a live QuizMatter presentation become public at once.

### App

- `src/pages/api/mcp.ts`: the photo check on Claude's slides only accepts public shared photos (`is_public`).
- Admin → Photos (`src/app/admin/page.tsx`, `AdminPhotos.tsx`, `photoSearch.ts`): load `is_public`; a **Waiting**
  pill (`bg-highlight-soft text-highlight-strong`) on waiting photos, in list and grid; a **Waiting** filter with its
  count. Editing works as now.
- Editors' Photos panel: the database hides waiting photos. Removing a photo from "My photos" and the admin's ✕
  show `QMPHL` as "This photo is in a presentation waiting for QuizMatter, so it can't be removed yet." (sonner
  toast; the photo is put back in the list).
- `/admin/editors/[id]`: a Status column, Waiting or Public, on each photo.
- Notes: `supabase/migrations/CLAUDE.md`, `src/app/admin/CLAUDE.md`, `src/lib/CLAUDE.md` (photos), and the root
  `CLAUDE.md` (Submit to QuizMatter + Reviews: approving or publishing makes the editor's photos public).

## Calls I made (the user can change them)

- Both ways to QuizMatter count: approved submissions **and** published reviews.
- Waiting photos start in a new "From editors" category.
- Only the **super admin** sees and edits editors' photos in Admin → Photos. Plain admins see only their own uploads
  there (the existing `uploaded_by` rule), and the database only lets them change their own.
- A photo from Safari is JPEG, and shared photos must be WebP, so a JPEG editor upload gets no waiting copy. (Rare:
  Chrome, Edge and Firefox send WebP.)
- Removing the editor role leaves their waiting photos in place; an admin can remove them with ✕.

## Decided by the user

- A photo uploaded during a review goes public only when that review is published.
- Nobody (editor or admin) can delete a photo used in a presentation or review waiting for approval.
- After that, removing a photo only takes it off the list; its file stays while a presentation uses it.
