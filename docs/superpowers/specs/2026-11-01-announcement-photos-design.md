# Announcement photos (a Photos tab on Admin → Announcements)

Date: 2026-11-01. Builds on `2026-10-31-announcement-post-design.md`.

## Why

Announcement pictures were only files in R2: nothing listed them, and the weekly cleanup deleted one as soon as no
announcement used it. The super admin wants a library: every announcement photo in one place, kept until they
delete it, with Upload, its address to copy, and a way to pick one again for a new announcement.

## Database (`20261229000000_announcement_photos.sql`)

- `announcement_photos`: `src` (primary key, our R2 address, checked by `announcement_picture_ok` with the size),
  `width`, `height` (empty only for rows copied from older announcements), `uploaded_by`, `created_at`. RLS on, no
  policies or grants: only the functions below.
- Super admin only (`42501`):
  - `add_announcement_photo(src, width, height)`: adds it (already listed = nothing changes). At most **500**
    (`22023`, "At most 500 announcement photos. Delete some first.").
  - `admin_announcement_photos()`: the list, newest first, with `used_by` (names of the announcements whose modal
    shows it).
  - `delete_announcement_photo(src)`: removes the row; refused while an announcement uses it (`22023`, naming it).
    The file itself is left to the weekly cleanup, which deletes it only if nothing else uses it (files are named by
    their fingerprint, so the same file can be in a slide or the shared library too).
- Newest `used_photo_srcs` keeps every listed photo.
- Photos the announcements use now are copied in.

## App

- `/api/announcement-image` (every announcement upload, from the form or the tab) saves the file, then
  `add_announcement_photo`. Over the limit it answers 409 with the database's words (the file is left for the
  cleanup). YouTube thumbnails stay out of the list.
- Admin → Announcements gets tabs (`AnnouncementTabs`): Announcements and Photos (`/admin/announcements/photos`).
- Photos tab: "+ Upload" (one or more photos or GIFs, `uploadAnnouncementPhoto`, one at a time, Spinner), and a grid
  (`AnnouncementPhotoGrid`): each photo with a GIF tag, "Used by …" / "Not used", its address with a Copy button
  ("Link copied."), and ✕ Delete (asks with `ConfirmModal`).
- The form's "Picture or GIF" opens "Choose a photo" (`Modal`): the same grid (click one to use it) and "Upload new"
  (uploads one and uses it). The list comes from a server action when the box opens.
- zod: `src` with `ourPhoto` before every call; the database checks again.

## Tests

`supabase/tests/announcement_photos.sql` (Docker): only the super admin; adding twice keeps one row; a bad address
refused; the 500 limit; `used_by`; delete refused while used, then works; `used_photo_srcs` keeps it, then not.

## Not changing

Teachers' side, the Privacy Policy (the admin's own pictures, no teacher data), the Admin log (uploads weren't
logged before either).
