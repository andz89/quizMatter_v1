# Photo storage limit (50 MB per teacher)

Date: 2026-11-26. Status: approved in chat, ready for a plan.

## Why

Photos live in Cloudflare R2, which we pay for by size. Today a teacher who can upload is limited only by speed
(the `photo_upload` click limits: 30 a minute, 300 a day) and by file size (2 MB each). Nothing stops one account
from storing gigabytes over weeks. Like Canva, each teacher gets a storage total: **50 MB**.

Only editors and admins can upload their own photos today (`upload-image` refuses other teachers), so this matters
now for editors and is ready for when plain teachers can upload.

## The rule

A photo counts against a teacher only when **they uploaded it** and **they still use it**:

- it's in their "My photos" (`photos` row with their `user_id`), **or**
- it's on a slide of a presentation **they own** (`slide_photos` of a `presentations` row with their `owner_id`).
  This includes their published (shared) copy: `share_presentation` makes the copy with the same `owner_id`.

Each file counts **once** per teacher, however many places use it.

| Ana's photo (2 MB) | Counts for Ana? |
|---|---|
| In "My photos" only | Yes |
| On her slides only (removed from "My photos") | Yes |
| In "My photos" and on 5 slides | Yes, once |
| In her published copy only (she took it out of the original but didn't click "Update shared presentation") | Yes |
| In neither place | No |
| Ben copied her presentation, so it's on Ben's slides | Not for Ben (he didn't upload it) |

**Known gap (accepted):** Ana publishes, Ben copies, Ana deletes hers. The file stays in R2 (Ben uses it) but counts
for nobody. That's normal sharing, not abuse, and copies don't make new files.

- **Admins skip the limit** (like the 50-presentation limit). QuizMatter lessons are admin-owned anyway, so an
  editor's photo stops counting for them once it's only in a QuizMatter lesson (an approved submission's copy or a
  published review).
- **Nothing is ever deleted because of the limit.** Someone over 50 MB (e.g. after the first count) keeps every
  photo and just can't upload more until they're under.
- Photos in an editor's review draft (`presentation_reviews.draft`) don't count: the draft isn't their presentation.
  Editors are trusted; accepted.

## Goals / non-goals

- Goal: the real storage a teacher uses stays under 50 MB; the teacher always knows why and how to free space.
- Goal: no slower server: the usual remove is still 1 request; counting reads only that teacher's rows.
- Non-goal: who can upload (unchanged), shared photos (admins), Claude's photo uploads, announcement and profile
  photos (none of these count).
- Anti-goal: a teacher losing a photo from a slide because of the limit; charging a teacher for photos they only
  copied.

## Approaches considered

1. **Count "My photos" only (Canva's way).** Simple, but removing a photo from the list frees space while slides
   keep the file, so the real total can grow past the limit. Rejected by the user.
2. **Charge the uploader while anyone uses the file.** The uploader can't free space someone else's copy holds.
   Rejected.
3. **Charge the copier.** A teacher fills up just by copying lessons. Rejected (the user's first worry).
4. **Chosen: uploader, while it's in their "My photos" or on their own slides**, with an upload record that
   survives removal from "My photos".

## Database (one migration, `supabase/migrations/20261231002600_photo_storage.sql`)

**`photo_storage_limit()`** returns `52428800` (50 × 1024 × 1024). Same number as `PHOTO_STORAGE_LIMIT_BYTES` in
the app.

**Table `photo_uploads`** (the upload record):

| Column | |
|---|---|
| `user_id uuid` | the uploader, `references auth.users on delete cascade` |
| `src text` | the file, same check as `photos.src` |
| `bytes integer` | the file's size, `> 0 and <= 2097152` |
| `size_known boolean default true` | false = estimated by the backfill (see below) |
| `created_at timestamptz default now()` | when it was (last) uploaded |
| primary key `(user_id, src)` | |

RLS on. Teachers: `select` their own rows only. No insert / update / delete for `authenticated`: only the functions
below (security definer) and the secret key write it, so nobody can delete their own records to cheat.

**`photo_storage_used(target uuid) returns bigint`** (internal, not granted to teachers): the sum of `bytes` over
`photo_uploads` rows of `target` where the `src` is

- in `photos` with `user_id = target`, or
- in `slide_photos` joined to `presentations` with `owner_id = target`, or
- `created_at > now() - interval '10 minutes'` (holds the space while an upload is being stored, so two uploads at
  once can't both slip past; a failed upload's row stops counting after 10 minutes).

Uses existing indexes (`photos_user_id_src_key`, `slide_photos_src`, `presentations_owner_id_idx`).

**`reserve_photo_upload(target uuid, target_src text, file_bytes integer) returns void`**, granted to
`service_role` only (the upload route calls it with the secret key, after it has checked the login):

1. `pg_advisory_xact_lock` on the user, so one teacher's uploads are checked one at a time.
2. An admin (`admins` table, membership) skips the check, but still gets the record.
3. If this `src` already counts for them (`photo_storage_used` includes it), it costs nothing.
4. If `used + file_bytes > photo_storage_limit()`, raise `QMSTO`.
5. Upsert the row (`bytes = file_bytes, size_known = true, created_at = now()`).

**`my_photo_storage() returns jsonb`** (authenticated): `{ used, limit }` for `auth.uid()`; `limit` is null for an
admin (the panel hides the bar).

**`remove_my_photo(target_src text, mode text) returns jsonb`** (authenticated, security definer, everything filtered
by `auth.uid()`). `mode`:

- `'if_unused'` (the usual click): if the photo is on none of my own slides, delete my `photos` row; else don't.
- `'ask'`: never delete, just answer (the editor uses this when the open presentation has it on a slide that may not
  be saved yet).
- `'remove'`: delete my `photos` row (after the teacher confirmed).

The delete goes through the existing triggers (`refuse_locked_photo_delete` → `QMPHL` still works). Answer:
`{ removed, uses, bytes, used, limit }`:

- `uses`: my own presentations whose slides have it: `[{ id, title, is_shared_copy, slides: [1, 4] }]` (slide
  numbers = the slide's place in the list, `position + 1`; a shared copy is a row with `shared_from` set).
- `bytes`: this photo's size from my `photo_uploads` row (null if I never uploaded it, e.g. an old row an admin's
  "keep photo" added), so the warning can say what it costs.
- `used` / `limit`: my total after the call, so the panel's bar updates with no extra request.

**Backfill (in the migration):** one `photo_uploads` row per existing `photos` row, `bytes =
coalesce(shared_photos.bytes, 2097152)`, `size_known = shared_photos.bytes is not null`, `created_at` from the photos
row (older than 10 minutes, so it doesn't count as "uploading"). An estimate errs on the safe side (2 MB is the
cap).

**`photo_uploads_unknown_sizes() returns setof text`** and **`set_photo_upload_sizes(sizes jsonb)`**, both
`service_role` only: the weekly cleanup (`src/lib/cleanupPhotos.ts`) already lists every R2 file with its size; it
asks which `src`s still have `size_known = false`, and sends their real sizes (only those). After the first run it's
an empty list, so later runs cost one tiny query. Until then old photos count as 2 MB each.

## App

- **`src/lib/photoStorage.ts`** (no imports, tested by `photoStorage.test.ts`): `PHOTO_STORAGE_LIMIT_BYTES`
  (50 MB), `formatStorage(bytes)` ("0 MB", "1.8 MB", "45 MB", "50 MB": one decimal under 10 MB), the words:
  `STORAGE_FULL_MESSAGE` ("Your photo storage is full (50 MB). To free space, remove photos from My photos and from
  your slides."), `STILL_COUNTS_TOAST` ("Removed from My photos. It still counts toward your storage until you
  remove it from your slides.").
- **`upload-image` route**, own photo only, after the click-limit check and before `savePhotoFile`:
  `reserve_photo_upload(user, src, body.byteLength)` with the secret-key client (`src/lib/supabase/admin.ts`).
  `QMSTO` → 413 with `STORAGE_FULL_MESSAGE` (and `code: "QMSTO"` in the body). The answer gains `storage: { used,
  limit }` (from `my_photo_storage`, through the user's client) so the bar updates.
- **`src/lib/photos.tsx`**: `loadPhotoStorage()`, `removeMyPhoto(src, mode)` (calls `remove_my_photo`, zod-parses
  the answer), `uploadPhoto` passes the `storage` back.
- **Photos panel, "My Photos" tab** (`PhotosPanel.tsx`), for teachers who can upload and aren't admins:
  - under the Upload button: "Storage" label, a bar (`bg-accent` fill on `bg-accent-soft`, `bg-danger` when full),
    "20 MB of 50 MB", and "Counts photos in My photos and on your slides." Read when the tab first opens, updated
    from each upload / remove answer.
  - full (`used >= limit`): the bar is coral, `STORAGE_FULL_MESSAGE` shows, Upload is greyed out. A dropped file
    gets the route's 413 message as a toast.
  - **Removing:** if the open presentation (the store) has the photo on a slide, call with `'ask'`, else
    `'if_unused'`. If the answer says not removed and it's used, show `ConfirmModal`: "This photo is still on your
    slides", the list ("Weather Quiz (slides 1, 4)"; a shared copy: "Plants Quiz, published version (slide 3): open
    it and click Update shared presentation to take it out there too"; the open presentation if only the store has
    it: "This presentation (not saved yet)"), and "Removing it from My photos won't free storage. It still counts
    (1.8 MB) until it's gone from these slides too." Buttons: Cancel / Remove from My photos (→ `'remove'`, then
    `STILL_COUNTS_TOAST`). `QMPHL` keeps its message. Requests: 1 for the usual case, 2 when confirmed.
  - The tile's hover title changes to "Remove from my photos".
- Admins: no bar, no limit (`my_photo_storage` limit null).

## Privacy Policy

Add to "Your work": we keep a record of each photo you upload (which file and its size) to count your photo
storage (50 MB), until you delete your account. Bump `LEGAL_VERSION` to the deploy date.

## Tests (Docker only)

- `supabase/tests/photo_storage.sql`: counts My photos and own slides once; shared copy counts; a copied presentation
  doesn't count for the copier, and stops counting for the uploader once out of both; the 10-minute hold;
  `QMSTO` over the limit; same file again is free; admin skips; teachers can't insert / update / delete
  `photo_uploads`; `remove_my_photo` modes and its `uses` (titles, slide numbers, shared copy flag); `QMPHL` still
  refuses; backfill rows; size fix functions refuse `authenticated`.
- `src/lib/photoStorage.test.ts`: `formatStorage`, the limit equals 52428800.
- `e2e/photo-storage.mjs`: an editor sees the bar; removing a photo that's on a slide shows the warning; a full
  account sees the message and a greyed Upload.

## Deploy order

Database first, as usual: test on Docker → the user pastes the migration into the live SQL editor → push `dev`,
check the preview → PR to `main`. The weekly cleanup fixes the estimated sizes on its next Sunday run.

## Notes to update (same commit)

Root `CLAUDE.md` (a short "Photo storage" section: the rule, where it lives), `src/app/api/CLAUDE.md`
(`upload-image`), `src/lib/CLAUDE.md` (Photos group), `src/components/editor/CLAUDE.md` (Photos panel),
`supabase/migrations/CLAUDE.md`, `docs/photo-cleanup.md` (the size fix), `npm run db:snapshot`.

## Left to the builder

Exact component split inside `PhotosPanel`, the SQL test's layout, the `e2e` helper reuse (`e2e/lib.mjs`).
