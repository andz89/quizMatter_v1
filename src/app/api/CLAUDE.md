# src/app/api (photo routes)

Photo files live in Cloudflare R2 (`PHOTO_URL_PREFIX` in `constants.ts`). Each file is named after its own
fingerprint, so the same photo is stored once however many times it's added. File saving: `src/lib/photoFiles.ts`.

| Route | Who | What it does |
|---|---|---|
| `upload-image/` | Logged-in teachers | Saves a photo the browser already shrunk, adds it to the teacher's "My photos", returns it |
| `fetch-image/` | Logged-in teachers | Downloads a photo from a pasted link and hands it to the browser (most sites block the browser from reading their images). Public addresses only |
| `claude-photo/` | Claude, with a ticket | Saves a photo Claude sends for the shared library. The one-time ticket (`src/lib/photoTickets.ts`, made by `prepare_photo_upload` in `/api/mcp`) holds its details, so no login is needed; the proxy lets it through |
| `delete-photo/` | Admins | Deletes an unused photo file now (Admin → Photo cleanup). A photo still in use is never deleted |

## How a teacher's photo gets added

1. The browser shrinks it (`src/lib/photos.tsx`: `uploadPhoto`, or `uploadPhotoFromLink` via `fetch-image`). Only
   WebP or JPEG files are kept (`readPhotoType`).
2. `upload-image` saves it to R2 and to "My photos".
3. `addPhotoToSlide` puts it on the slide.

Photos no list or slide uses anymore are deleted by the weekly cleanup (`src/lib/cleanupPhotos.ts`,
`docs/photo-cleanup.md`). If you add a new place that keeps photos, make the database's `used_photo_srcs` count it,
or the cleanup will delete them.
