# Super admin and plain admins

## Why

Today every admin can do everything. The owner (andzrivero89@gmail.com) wants to add other admins who help with
day-to-day work (reviews, submissions, reports, editors, shared photos) but can't manage teachers, safety or the photo
cleanup.

## The two kinds of admin

- **Super admin:** andzrivero89@gmail.com. Can do everything admins can do today.
- **Plain admin:** every other row in `admins`. Still an admin (`is_admin()` stays true), with the limits below.

How it's stored:

- New column `admins.is_super boolean not null default false`. The migration sets it to true for the user whose
  email is andzrivero89@gmail.com (found in `auth.users`). No email is written in the app code.
- New database function `is_super_admin()`, built like `is_admin()` (security definer, only for logged-in users).
- `getAccount()` (`src/lib/account.ts`) gains `isSuperAdmin`.

## What plain admins can do

| Area | Plain admin |
|---|---|
| Admin → Photos | Yes, but only **their own** shared photos: they see, edit (details, category) and delete only photos they uploaded |
| Admin → Presentations | Yes. The list shows **only presentations they own** (the ones they made and the copies from submissions they approved), as the page already does for every admin. Under review and Submissions show every open round. **No "+ New presentation"** |
| Admin → Reports | Yes, all of it (hide, dismiss, delete) |
| Admin → Editors | Yes, all of it (remove an editor) |
| Admin → Teachers, Safety, Photo cleanup | **No.** Hidden from the menu; the page shows "page not found"; the server actions refuse |
| Reviews and submissions | Yes, all of it (publish, send back, cancel, open to all, approve) |
| Photo categories | Can **make** new ones (when uploading). Only the super admin renames or deletes them |
| Claude (MCP connector) | Yes, all tools: find and upload shared photos, send presentations and lessons |
| Making presentations | Every presentation they make (in the editor or with Claude) is a QuizMatter one, as today: Author and publisher "QuizMatter". They show in Admin → Presentations. Only the "+ New presentation" button there is hidden |
| "Move to QuizMatter" (home cards) | **No** |
| Their own photo uploads in the editor | Yes (like editors) |
| "Manage shared photos →" in the editor | Yes (they use the Photos page) |

## Shared photo owners

- New column `shared_photos.uploaded_by uuid references auth.users (id) on delete set null`.
- Existing photos: set to the super admin.
- Saved on every new shared photo:
  - `upload-image` (Admin → Photos): the logged-in admin.
  - `claude-photo`: the ticket's `ownerId` (the admin who called `prepare_photo_upload`).
- An upload of a photo that's **already shared by someone else** leaves that photo as it is (it's not moved or taken
  over), like `claude-photo` already does. The admin just gets it back to use.
- A photo whose uploader's account is gone (`uploaded_by` empty) is only managed by the super admin.

## Database rules (one new migration)

- `is_super_admin()` and the `is_super` column.
- `shared_photos`: everyone still reads all of them. Insert: any admin, with `uploaded_by` = themselves. Update and
  delete: the super admin, or the admin whose `uploaded_by` it is.
- `photo_categories`: insert: any admin. Update and delete: super admin only.
- `admin_used_photo_srcs()` (Photo cleanup): super admin only.
- `banned_users` policy ("Admins manage bans"): super admin only.
- **Speed limits skipped only by the super admin:** `count_write`, `count_click`, and the 30-day wait in
  `set_display_name`. Plain admins follow them like teachers, except that a click limit never bans a plain admin
  automatically (they only get the pause). (Share and publish clicks are already skipped for
  QuizMatter presentations, and the "title and content before publishing" check isn't a speed limit, so both stay.)
- **Still skipped by every admin:** the 50-presentation limit (`check_presentation_limit`), because approving a
  submission makes a copy the approving admin owns.
- Everything else that asks `is_admin()` (reviews, submissions, reports, editors, hiding, reading every
  presentation, saving QuizMatter presentations (`from_admin`), `publisher_names`, `profile_is_visible`, `review_status`, `submission_status`) stays as it is.

The functions are rewritten with `create or replace` from their newest version, changing only the admin check.

## App changes

- **`AdminMenu`:** takes `isSuperAdmin`; plain admins see Photos, Presentations, Reports, Editors.
- **Pages** `teachers/`, `safety/` (and `history/`), `cleanup/`: `notFound()` unless `isSuperAdmin`.
- **Server actions** in `teachers/actions.ts`, `safety/actions.ts`, `cleanup/actions.ts`, and the `delete-photo`
  route: refuse unless super admin. These use the master key (`createAdminClient`), so the app check is the rule.
- **Admin → Photos** (`page.tsx`, `AdminPhotos.tsx`): a plain admin's list and counts are filtered to
  `uploaded_by = me`; rename / delete category buttons only for the super admin.
- **`src/lib/photos.tsx`:** shared-photo uploads send nothing new (the server sets `uploaded_by`).
- **Admin → Presentations:** "+ New presentation" only for the super admin.
- **Home cards** (`src/app/(home)/cards.ts`): `canMoveToQuizMatter` only for the super admin, and the Move to
  QuizMatter action refuses plain admins. (App check only: it moves the admin's own presentation, and a plain admin's new
  presentations are QuizMatter ones anyway.)
- **MCP** (`src/pages/api/mcp.ts`): stays open to all admins (no change in who can connect).
- **OAuth consent:** stays "admins only" (no change).

## Notes to update

Root `CLAUDE.md` (a short "Super admin" section), `src/app/admin/CLAUDE.md` (who sees which page),
`src/app/api/CLAUDE.md` (`delete-photo`, `upload-image`, `claude-photo`), `supabase/migrations/CLAUDE.md`.

## Checks

`npx tsc --noEmit`, `npm run lint`, read the `git diff` against this spec. Live testing is left to the owner:
log in as a plain admin and check the menu, a blocked page by address, Photos showing only their own, and that
approving a submission still works.
