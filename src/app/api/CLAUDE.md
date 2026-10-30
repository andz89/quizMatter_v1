# src/app/api (photo routes)

Photo files live in Cloudflare R2 (`PHOTO_URL_PREFIX` in `constants.ts`). Each file is named after its own
fingerprint, so the same photo is stored once however many times it's added. File saving: `src/lib/photoFiles.ts`.

| Route | Who | What it does |
|---|---|---|
| `upload-image/` | Editors and admins (for now; other teachers get 403) | Saves a photo the browser already shrunk, adds it to the teacher's "My photos", returns it. With `category`, an admin's shared photo instead (saves who uploaded it, `uploaded_by`; a plain admin's upload of a photo someone else shared is refused with 409 and the photo stays as it is). Counted before the file is stored: an own photo by `count_photo_upload` (the `photo_upload` and `photo_upload_daily` click limits; paused = 429, and the browser's `checkPauses` shows the notice; a banned teacher gets 403 first, `is_banned`), a shared photo by `count_write('photos')` (30 a minute, never paused) |
| `claude-photo/` | Claude, with a ticket | Saves a photo Claude sends for the shared library. The one-time ticket (`src/lib/photoTickets.ts`, made by `prepare_photo_upload` in `/api/mcp`) holds its details and who asked (saved as `uploaded_by`), so no login is needed; the proxy lets it through. When the file arrives, the one who asked must still be an admin and not banned (403). Like `upload-image`, only the super admin's ticket can make an editor's waiting photo public; a plain admin's gets 409 with the same message. During maintenance only the super admin's ticket goes through (503) |
| `announcement-image/` | Super admin | Saves a picture for an announcement's modal (Admin → Announcements; the browser shrinks it with `uploadAnnouncementPhoto` in `src/lib/photos.tsx`). A GIF is the one exception: sent as it is so it keeps moving (2 MB and `PHOTO_MAX_SIDE` at most, checked in the browser and by the route's limits), stored as `.gif`; only this route takes GIFs (`readAnnouncementImageType`). R2 only: no photo list or table row. Counted by `count_write('photos')` (30 a minute, 429). Returns `{ src }`. The cleanup keeps it while an announcement's `modal_html` uses it (`used_photo_srcs`); one uploaded but never saved is deleted by the weekly cleanup after 7 days |
| `delete-photo/` | Super admin | Deletes an unused photo file now (Admin → Photo cleanup). A photo still in use is never deleted |
| `profile-photo/` | Editors | Saves an editor's profile photo: the 400 × 400 square the account page's popup made (`profilePhotoSchema`). The database's `set_profile_photo` checks and counts it first (editors only, not banned, 3 a day: `QMPPL` = 429), then the file is stored like any photo. Never added to "My photos" or the shared photos. Returns `{ src, leftToday }` |

## How a teacher's photo gets added

1. The browser shrinks it (`src/lib/photos.tsx`: `uploadPhoto`). Only
   WebP or JPEG files are kept (`readPhotoType`).
2. `upload-image` saves it to R2 and to "My photos".
3. `addPhotoToSlide` puts it on the slide.

Photos no list or slide uses anymore are deleted by the weekly cleanup (`src/lib/cleanupPhotos.ts`,
`docs/photo-cleanup.md`). If you add a new place that keeps photos, make the database's `used_photo_srcs` count it,
or the cleanup will delete them. Editors' profile photos are counted (`20261214000000_profile_photos.sql`).
