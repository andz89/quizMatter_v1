# Remove the Photo Review (Claude's uploads are always approved)

## Goal

Every photo an admin adds through Claude (`prepare_photo_upload` → `/api/claude-photo`) goes into the shared photo
library ready to use, from a zip or not. There's no "waiting for review" step anywhere any more.

This replaces the `for_presentation` flag from `2026-10-07-zip-to-presentation-design.md`: with every Claude upload
approved, the flag has no job. The zip instructions for Claude stay.

## What goes away

### Database — new migration `supabase/migrations/20261026000000_remove_photo_review.sql`

Undoes `20261005000000_photo_review.sql`:

1. The photos waiting now become normal photos — nothing to do: dropping the column keeps every row.
2. Policy: drop "Everyone reads approved shared photos"; recreate "Everyone reads shared photos"
   `for select to authenticated using (true)` (as in `20260928020000_shared_photos.sql`).
3. Views: `drop view` and `create view` again (a view can't lose columns with `create or replace`), the same as
   in the photo-review migration minus `sp.approved` (`shared_photos_search`) and minus `waiting`
   (`shared_photo_counts`). Both keep `with (security_invoker = true)`.
4. `search_shared_photos`: `create or replace` without `sp.approved and` in the `where`.
5. `alter table public.shared_photos drop column approved`.

Order inside the migration: policy and function first (they use the column), then drop the views, drop the
column, create the views.

### Claude upload (`src/app/api/claude-photo/route.ts`, `src/lib/photoTickets.ts`, `src/pages/api/mcp.ts`)

- Tickets go back to `{ ownerId, details }`: `createPhotoTickets(ownerId, photos)`, no `approved`. A ticket made
  before this change that still has `approved` in its JSON is fine: `claudePhotoSchema` drops the extra key.
- The route inserts without `approved`. The existing-photo case still returns `src`, `width`, `height` (selects
  `file_name, width, height`) and says "Nothing was changed"; the approve-on-existing branch goes.
- Success answer: `Added "…" (… px, … KB) to "…". It can go on slides now.`
- `prepare_photo_upload`: no `for_presentation` input. Description keeps the zip sentence and says the photos are
  ready for slides at once. The closing text: tell the user which photos were added; to put one on a slide use
  `{ "asset": "photo", "photo": { "src", "width", "height" } }` copied from its upload answer. The zip line at the top stays.
- `checkPhotos`: no `.eq("approved", true)`; message: "isn't a shared photo. Only use photos from find_photos, or
  ones you uploaded with prepare_photo_upload."

### Claude's notes (`src/lib/importPresentation.ts`, "Real photos")

- "…or ones you just uploaded with prepare_photo_upload (copy "src", "width" and "height" from its upload answer)…"
- The zip bullet stays, without `"for_presentation": true`.

### Admin and editor app

- `src/app/admin/photoSearch.ts`: remove the `review` filter ("Waiting for review").
- `src/app/admin/page.tsx`: stop selecting `approved` and `waiting`; drop `waitingSrcs`, `counts.waiting`, the
  `missing === "review"` query line; update the comment.
- `src/app/admin/AdminPhotos.tsx`: remove `waiting` from `PhotoCounts`, the `waitingSrcs` prop, the
  "Waiting for review" filter button, `approvingSrcs` / `handleApprove` / approve-all box, and the photo row's
  `isWaiting` / `isApproving` / `onApprove`, Waiting pill and Approve button. Remove imports that become unused
  (`approveSharedPhotos`, maybe `CheckIcon`).
- `src/lib/photos.tsx`: remove `approveSharedPhotos`; `loadPhotoCategoriesInUse` selects `category_id, photos`
  and keeps categories with `photos > 0`; the page loader drops `.eq("approved", true)`.
- `src/app/api/upload-image/route.ts`: the admin upload's upsert no longer sends `approved: true`; comment updated.

### Docs

- Add a line at the top of `2026-10-07-zip-to-presentation-design.md`: replaced by this spec for approval
  (`for_presentation` removed; every Claude upload is approved).

## Deploy order

The code must go live **before** the migration runs: the old code reads `approved` and `waiting`, and would break
once they're gone. The new code doesn't use them, so it works with the column still there (it defaults to
`true`). So: push → Cloudflare deploy finishes → apply the migration.

## Not doing

- No change to the shared library's other filters (no description / no source), editing, or deleting.
- No change to who can upload through Claude (admins only).

## Testing

`npx tsc --noEmit`, `npm run lint`, and a search for leftover `approved` / `waiting` / `approveSharedPhotos`
outside migrations (only the presentation-review `approved` words, which are a different feature, may remain).
Live test by the user: Admin → Photos has no "Waiting for review"; a photo uploaded through Claude (new chat after
reconnecting) shows up for teachers at once and can go on slides.
