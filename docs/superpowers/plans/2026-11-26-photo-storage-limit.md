# Photo Storage Limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each teacher can store at most 50 MB of photos they uploaded and still use (in "My photos" or on their own slides).

**Architecture:** A `photo_uploads` record table (who uploaded which file, its size) plus database functions that count, reserve and remove. The upload route reserves before storing the file in R2; the Photos panel shows a storage bar and warns when a removed photo is still on slides. The weekly cleanup fixes estimated sizes of old photos.

**Tech Stack:** Supabase Postgres (plpgsql), Next.js route handler, React + zustand, zod, Node test runner, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-26-photo-storage-limit-design.md`

## Global Constraints

- Limit: 50 MB = `52428800` bytes, in `photo_storage_limit()` and `PHOTO_STORAGE_LIMIT_BYTES` (same number).
- Refusal code: `QMSTO`. Message: "Your photo storage is full (50 MB). To free space, remove photos from My photos and from your slides."
- Toast after removing a still-used photo: "Removed from My photos. It still counts toward your storage until you remove it from your slides."
- Hold for an upload in progress: 10 minutes. Backfill estimate: 2097152 bytes.
- Admins (rows in `admins`) skip the limit. Nothing is ever deleted because of the limit.
- All DB testing on local Docker only (`npm run test:sql`). zod before every save. One `Spinner`, `ConfirmModal`, design-system classes only.
- Migration file: `supabase/migrations/20261231002600_photo_storage.sql`. After it: `npm run db:snapshot`.

## Review Focus

1. Same photo uploaded twice by the same teacher: the second upload must cost 0 (no double count, no refusal at the edge).
2. A teacher already over the limit after the backfill: they can still open, remove and present everything; only upload is refused.
3. Remove while the open presentation has the photo on an unsaved slide: must ask, never silently remove without the warning.
4. Two uploads at the same moment near the limit: the second must be refused (the advisory lock and the 10-minute hold).
5. A teacher calling `photo_uploads` insert/delete or `reserve_photo_upload` directly with their own token: refused.

---

### Task 1: Database: table, counting, reserve, remove, backfill, size fix

**Files:**
- Create: `supabase/migrations/20261231002600_photo_storage.sql`
- Create: `supabase/tests/photo_storage.sql`
- Modify (generated): `supabase/schema.sql`, `src/lib/database.types.ts` via `npm run db:snapshot`

**Interfaces:**
- Produces (SQL):
  - table `public.photo_uploads(user_id uuid, src text, bytes integer, size_known boolean, created_at timestamptz)`, pk `(user_id, src)`, RLS: authenticated `select` own rows only.
  - `photo_storage_limit() returns bigint` → 52428800 (granted to authenticated, service_role).
  - `photo_storage_used(target uuid) returns bigint` (service_role only; security definer).
  - `reserve_photo_upload(target uuid, target_src text, file_bytes integer) returns void` (service_role only).
  - `my_photo_storage() returns jsonb` → `{ "used": bigint, "limit": bigint | null }` (authenticated).
  - `remove_my_photo(target_src text, mode text) returns jsonb` → `{ "removed": bool, "uses": [{ "id", "title", "is_shared_copy", "slides": int[] }], "bytes": int | null, "used": bigint, "limit": bigint | null }` (authenticated). `mode` in `('if_unused','ask','remove')`, else `22023`.
  - `photo_uploads_unknown_sizes() returns setof text`, `set_photo_upload_sizes(sizes jsonb) returns void` (`sizes` = `{ "<src>": bytes }`; service_role only).

- [ ] **Step 1: Write the failing SQL test** `supabase/tests/photo_storage.sql` (style of `supabase/tests/profile_photos.sql`: `begin;` … `rollback;`, `do $$ … raise exception 'FAIL: …'`). Setup as postgres: teacher t1 (editor), teacher t2, admin a1 (`admins` row; claims `'aal','aal2'`). Files `F(x) = 'https://images.quizmatter.com/uploads/' || repeat(x, 64) || '.webp'`. Insert `photo_uploads` rows as postgres with `created_at = now() - interval '1 hour'` unless testing the hold. Cases (each its own `do` block):
  - `photo_storage_limit() = 52428800`.
  - t1 uploaded F(a) 1000 bytes, in t1 `photos` → `photo_storage_used(t1) = 1000`.
  - F(a) also on two t1 slides (insert a presentation owned by t1 + slides with the src in `data`) → still 1000.
  - removed from t1 `photos`, still on slides → 1000; slides deleted → 0.
  - t1's shared copy (presentation with `shared_from` set, `owner_id` t1) has it → counts.
  - t2's presentation has F(a) (copied) → `photo_storage_used(t2) = 0`, and t1 not in photos/slides → 0.
  - a row with `created_at = now()` and no use → counts (the hold).
  - `reserve_photo_upload(t1, F(b), 52428800)` when used = 1000 → `QMSTO`; `reserve_photo_upload(t1, F(a), 2000000)` when F(a) already counts → no error, used unchanged.
  - admin: `reserve_photo_upload(a1, F(c), 52428800)` twice with different files → no error.
  - as authenticated t1: `insert into photo_uploads` → refused (`42501`); `delete from photo_uploads` → 0 rows changed; `select public.reserve_photo_upload(...)` → `42501`; `select from photo_uploads` sees only t1's rows.
  - as t1: `my_photo_storage()` → `{used, limit: 52428800}`; as a1 → `limit` null.
  - `remove_my_photo(F(a), 'if_unused')` when on a t1 slide → `removed=false`, `uses[0].title`, `uses[0].slides = {2}` for a slide at position 1, photos row kept; `'ask'` with no slide use → `removed=false`, row kept; `'remove'` → `removed=true`, row gone, `used` returned; `'if_unused'` when unused → removed; mode `'x'` → `22023`; shared copy use → `is_shared_copy = true`.
  - `remove_my_photo` on a photo in a submitted presentation (`presentation_submissions` status `submitted`) → `QMPHL` (as in `supabase/tests/` existing editor-photo tests).
  - backfill: a `photos` row inserted before the migration can't be simulated in a transaction; instead call the backfill's logic through `set_photo_upload_sizes('{"<src>": 1234}')` on a `size_known=false` row → `bytes=1234, size_known=true`; `photo_uploads_unknown_sizes()` lists only `size_known=false` srcs; as authenticated both → `42501`.

- [ ] **Step 2: Run it to verify it fails**
  Run: `npm run test:sql -- photo_storage.sql`
  Expected: ERROR (relation `photo_uploads` / function does not exist).

- [ ] **Step 3: Write the migration** with the interfaces above. Notes the signatures don't settle:
  - `photo_storage_used`: `select coalesce(sum(u.bytes),0) from photo_uploads u where u.user_id = target and (u.created_at > now() - interval '10 minutes' or exists (photos p where p.user_id = target and p.src = u.src) or exists (slide_photos sp join presentations pr on pr.id = sp.presentation_id where sp.src = u.src and pr.owner_id = target))`.
  - `reserve_photo_upload`: `perform pg_advisory_xact_lock(hashtext('photo_storage:' || target::text))`; "already counts" = the row exists and the same `exists` conditions hold (in photos / own slides / within the hold); admin = `exists (select 1 from admins where user_id = target)`; upsert `on conflict (user_id, src) do update set bytes, size_known = true, created_at = now()`.
  - `remove_my_photo`: `security definer`, `set search_path = ''`, `auth.uid()` null → `42501`. `uses` = own presentations (`owner_id = auth.uid()`) joined to `slide_photos` on the src, slide numbers from `slides.position + 1` ordered, presentations ordered by title. Delete with `delete from public.photos where user_id = auth.uid() and src = target_src` (the `refuse_locked_photo_delete` trigger still runs).
  - Backfill: `insert into photo_uploads (user_id, src, bytes, size_known, created_at) select p.user_id, p.src, coalesce(sp.bytes, 2097152), sp.bytes is not null, p.created_at from photos p left join shared_photos sp on sp.src = p.src on conflict do nothing`.
  - Grants: `revoke all … from public`; table `grant select to authenticated`, `grant all to service_role`; functions per the Interfaces list.
  - Header comment: what it does, deploy order (paste before the app).

- [ ] **Step 4: Run the test and the whole SQL suite**
  Run: `npm run test:sql`
  Expected: every file ends with `ROLLBACK`, no `FAIL` / `ERROR`.

- [ ] **Step 5: Snapshot and commit**
  Run: `npm run db:snapshot`, then `git add supabase/migrations/20261231002600_photo_storage.sql supabase/tests/photo_storage.sql supabase/schema.sql src/lib/database.types.ts` and commit `feat: photo storage limit in the database (50 MB per teacher)`.

### Task 2: App helpers: limit, words, formatting

**Files:**
- Create: `src/lib/photoStorage.ts` (no imports)
- Create: `src/lib/photoStorage.test.ts`

**Interfaces:**
- Produces: `PHOTO_STORAGE_LIMIT_BYTES = 52428800`; `formatStorage(bytes: number): string`; `STORAGE_FULL_MESSAGE`; `STILL_COUNTS_TOAST`; `type PhotoStorage = { used: number; limit: number | null }`; `isStorageFull(s: PhotoStorage): boolean` (`limit !== null && used >= limit`).

- [ ] **Step 1: Write the failing test**: `PHOTO_STORAGE_LIMIT_BYTES === 52428800`; `formatStorage(0) === "0 MB"`; `formatStorage(1887437) === "1.8 MB"`; `formatStorage(47185920) === "45 MB"`; `formatStorage(52428800) === "50 MB"`; `formatStorage(10380902) === "10 MB"` (no decimal from 10 MB); `isStorageFull({used: 52428800, limit: 52428800}) === true`; `isStorageFull({used: 5, limit: null}) === false`.
- [ ] **Step 2: Run** `npm test` → FAIL (module not found).
- [ ] **Step 3: Implement** (MB = 1024 × 1024; under 10 MB one decimal rounded down, from 10 MB whole MB rounded; "0 MB" for 0). Messages exactly as in Global Constraints.
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat: photo storage helpers`.

### Task 3: Upload route reserves; client calls

**Files:**
- Modify: `src/app/api/upload-image/route.ts` (own-photo branch, between the rate check and `savePhotoFile`, and the final answer)
- Modify: `src/lib/photos.tsx` (`sendPhoto`, `removeMyPhoto`, new `loadPhotoStorage`, `watchPhotoStorage`)
- Modify: `src/lib/schema.ts` (zod for the answers)

**Interfaces:**
- Consumes: Task 1 functions, Task 2 `PhotoStorage`, `STORAGE_FULL_MESSAGE`.
- Produces:
  - `photoStorageSchema` (zod: `{ used: number >= 0, limit: number | null }`), `removePhotoResultSchema` (zod for `remove_my_photo`'s answer) and `type PhotoUse = { id: string; title: string; is_shared_copy: boolean; slides: number[] }` in `schema.ts`.
  - `loadPhotoStorage(): Promise<PhotoStorage>` (calls `my_photo_storage`; throws on error).
  - `watchPhotoStorage(listener: (s: PhotoStorage) => void): () => void`: a tiny module-level listener set; `sendPhoto` and `removeMyPhoto` notify it with the totals their answers carry (so a photo dropped onto a slide updates the open panel too).
  - `removeMyPhoto(src: string, mode: "if_unused" | "ask" | "remove"): Promise<RemovePhotoResult>` (replaces the old one; throws the Supabase error so `isPhotoLocked` keeps working).
  - Route answer for an own photo: `{ ...photo, storage: { used, limit } }`; on `QMSTO`: status 413, `{ error: STORAGE_FULL_MESSAGE, code: "QMSTO" }`.

- [ ] **Step 1: Route.** Own photo only (`!shared`): `const admin = createAdminClient()`; none → 500 "Couldn't upload the photo. Please try again."; `admin.rpc("reserve_photo_upload", { target: data.claims.sub, target_src: photo.data.src, file_bytes: body.byteLength })`; `error?.code === "QMSTO"` → 413 as above; other error → 500. After the `photos` upsert: `supabase.rpc("my_photo_storage")`, parse with `photoStorageSchema`, add `storage` to the answer (if the read fails, answer without `storage`). Update the file's top comment.
- [ ] **Step 2: Client.** `sendPhoto`: if `result.storage` parses, notify listeners. A 413 with `code === "QMSTO"` throws `PhotoError(result.error)` (already the case through `result.error`). Add `loadPhotoStorage`, `watchPhotoStorage`, new `removeMyPhoto`.
- [ ] **Step 3: Verify** `npx tsc --noEmit` and `npm run lint` → no errors in changed files.
- [ ] **Step 4: Commit** `feat: upload route checks photo storage`.

### Task 4: Photos panel: storage bar and remove warning

**Files:**
- Create: `src/components/editor/PhotoStorageBar.tsx`
- Modify: `src/components/editor/PhotosPanel.tsx` (`handleRemove`, under the Upload button, Upload `disabled`)
- Modify: `src/components/editor/PhotoTile.tsx` only if `removeTitle` is a prop default (the panel passes "Remove from my photos")

**Interfaces:**
- Consumes: Task 2 (`formatStorage`, `isStorageFull`, messages), Task 3 (`loadPhotoStorage`, `watchPhotoStorage`, `removeMyPhoto`, `PhotoUse`), `ConfirmModal`, `checkIsAdmin`, the store's `presentation` (slides), `slide_photo_srcs`-style check in the browser: `JSON.stringify(slide).includes(src)`.
- Produces: `PhotoStorageBar({ storage }: { storage: PhotoStorage })`.

- [ ] **Step 1: Bar.** Label "Storage" (11–12px bold uppercase `text-text-header tracking-[0.05em]`), track `h-2 rounded-dropdown bg-accent-soft`, fill `bg-accent` (`bg-danger` when full), width `min(100, used/limit*100)%`, text "20 MB of 50 MB" (`text-xs text-text-secondary`), line "Counts photos in My photos and on your slides." Full: `STORAGE_FULL_MESSAGE` in `bg-danger-soft text-danger-strong` pill.
- [ ] **Step 2: Panel.** On first open of "My Photos" when `canUpload`: `loadPhotoStorage()` (in the same effect as `loadMyPhotos`, in parallel); subscribe with `watchPhotoStorage`. Show the bar only when `canUpload && storage && storage.limit !== null`. Upload `disabled` also when `isStorageFull(storage)`.
- [ ] **Step 3: Remove.** `usedHere` = the open presentation's slides contain the src. Call `removeMyPhoto(src, usedHere ? "ask" : "if_unused")` (keep the tile in the list until the answer comes back; show the Spinner on it meanwhile, or keep the old optimistic removal only for the `removed: true` path). If `removed`: drop it from the list. Else open `ConfirmModal` titled "This photo is still on your slides" listing `uses` ("Weather Quiz (slides 1, 4)"; shared copy: "Plants Quiz, published version (slide 3): open it and click Update shared presentation to take it out there too"; if `usedHere` and the open presentation's id isn't in `uses`: "This presentation (not saved yet)"), then "Removing it from My photos won't free storage. It still counts (1.8 MB) until it's gone from these slides too." (omit "(1.8 MB)" when `bytes` is null). Confirm label "Remove from My photos" → `removeMyPhoto(src, "remove")`, drop from list, toast `STILL_COUNTS_TOAST`. `QMPHL` → `PHOTO_LOCKED_MESSAGE` as today.
- [ ] **Step 4: Verify** `npx tsc --noEmit`, `npm run lint`.
- [ ] **Step 5: Commit** `feat: Photos panel shows photo storage and warns before removing a used photo`.

### Task 5: Weekly cleanup fixes estimated sizes

**Files:**
- Modify: `src/lib/cleanupPhotos.ts` (`cleanupPhotos`; `findUnusedPhotos` returns all sizes it saw)
- Modify: `src/lib/cleanupPhotos.test.ts`
- Modify: `docs/photo-cleanup.md`

**Interfaces:**
- Consumes: Task 1 `photo_uploads_unknown_sizes`, `set_photo_upload_sizes`.
- Produces: `findUnusedPhotos` result gains `sizes: Map<string, number>` (src → bytes, every file listed); `sizesToFix(unknown: string[], sizes: Map<string, number>): Record<string, number>` (exported, pure: only the unknown srcs that exist in R2).

- [ ] **Step 1: Failing test** in `cleanupPhotos.test.ts`: `sizesToFix(["a","b"], new Map([["a", 10], ["c", 5]]))` deep-equals `{ a: 10 }`; empty unknown → `{}`.
- [ ] **Step 2: Run** `npm test` → FAIL.
- [ ] **Step 3: Implement** `sizesToFix`, collect `sizes` in `findUnusedPhotos`, and in `cleanupPhotos` after the deletes: `rpc("photo_uploads_unknown_sizes")`; if non-empty, `rpc("set_photo_upload_sizes", { sizes: sizesToFix(...) })` (errors logged, not thrown: the deletes already happened). Note in `docs/photo-cleanup.md`.
- [ ] **Step 4: Run** `npm test` → PASS; `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat: photo cleanup fixes estimated upload sizes`.

### Task 6: Browser test

**Files:**
- Create: `e2e/photo-storage.mjs` (reuse `e2e/lib.mjs`: `makeTeacher`, `psql`, `loggedIn`, `check`, `finish`, `deleteTeacher`)

- [ ] **Step 1: Write the test.** An editor (`makeTeacher`, then `psql` insert into `editors`). Case A: open a presentation's editor → Photos → My Photos: "of 50 MB" shows. Case B: `psql` gives them a `photos` row + `photo_uploads` row for F(a) and a saved presentation whose slide has F(a); click its tile's remove → the "This photo is still on your slides" box lists the presentation; confirm → toast text `STILL_COUNTS_TOAST`. Case C: `psql` adds a `photo_uploads` row of 52428800 bytes in `photos` → reload: the full message shows and Upload is disabled. Clean up with `deleteTeacher`.
- [ ] **Step 2: Run** `npm run e2e:dev` (port 3100), then `node e2e/photo-storage.mjs` → every `check` passes.
- [ ] **Step 3: Commit** `test: photo storage browser test`.

### Task 7: Privacy Policy and notes

**Files:**
- Modify: `src/app/(legal)/privacy/page.tsx` ("Your work" paragraph: "We also keep a record of each photo you upload (which file and its size) to count your photo storage (50 MB). It's kept until you delete your account.")
- Modify: `src/lib/legal.ts` (`LEGAL_VERSION = "2026-11-26"`)
- Modify: `CLAUDE.md` (new "Photo Storage (50 MB per teacher)" section: the rule, migration, functions, test, panel; map line unchanged), `src/app/api/CLAUDE.md` (`upload-image` row), `src/lib/CLAUDE.md` (Photos group: `photoStorage.ts`, `removeMyPhoto` modes, `watchPhotoStorage`), `src/components/editor/CLAUDE.md` (Photos panel bar + warning), `supabase/migrations/CLAUDE.md` (the migration entry, apply before the app)

- [ ] **Step 1:** Write the changes above (plain English, short; read the code first).
- [ ] **Step 2: Verify** `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run test:sql`.
- [ ] **Step 3: Commit** `docs: photo storage notes and Privacy Policy`.
