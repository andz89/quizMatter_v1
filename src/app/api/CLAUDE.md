# src/app/api (photo routes)

Photo files live in Cloudflare R2 (`PHOTO_URL_PREFIX` in `constants.ts`). Each file is named after its own
fingerprint, so the same photo is stored once however many times it's added. File saving: `src/lib/photoFiles.ts`.

| Route | Who | What it does |
|---|---|---|
| `upload-image/` | Editors and admins (for now; other teachers get 403) | Saves a photo the browser already shrunk, adds it to the teacher's "My photos", returns it. With `category`, an admin's shared photo instead (saves who uploaded it, `uploaded_by`; a plain admin's upload of a photo someone else shared is refused with 409 and the photo stays as it is) |
| `claude-photo/` | Claude, with a ticket | Saves a photo Claude sends for the shared library. The one-time ticket (`src/lib/photoTickets.ts`, made by `prepare_photo_upload` in `/api/mcp`) holds its details and who asked (saved as `uploaded_by`), so no login is needed; the proxy lets it through. When the file arrives, the one who asked must still be an admin and not banned (403). Like `upload-image`, only the super admin's ticket can make an editor's waiting photo public; a plain admin's gets 409 with the same message |
| `delete-photo/` | Super admin | Deletes an unused photo file now (Admin → Photo cleanup). A photo still in use is never deleted |

## How a teacher's photo gets added

1. The browser shrinks it (`src/lib/photos.tsx`: `uploadPhoto`). Only
   WebP or JPEG files are kept (`readPhotoType`).
2. `upload-image` saves it to R2 and to "My photos".
3. `addPhotoToSlide` puts it on the slide.

Photos no list or slide uses anymore are deleted by the weekly cleanup (`src/lib/cleanupPhotos.ts`,
`docs/photo-cleanup.md`). If you add a new place that keeps photos, make the database's `used_photo_srcs` count it,
or the cleanup will delete them.
