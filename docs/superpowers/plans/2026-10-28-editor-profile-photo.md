# Editors' Profile Photos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Editors upload a round profile photo (zoom + move before saving), shown on their profile page, at most 3
new photos a day; any admin can remove it; it goes when the editor role goes.

**Architecture:** A `profile_photos` table tied to `editors` (cascade), written only by `security definer` functions
that hold the daily count. A new `/api/profile-photo` route counts first, then stores the file in R2 like every other
photo. The browser crops to a 400 × 400 square with a hand-written zoom/move popup.

**Tech Stack:** Next.js (this repo's version: read `node_modules/next/dist/docs/` before writing route or page
code), Supabase (Postgres functions, RLS), Cloudflare R2, zod, sonner, lucide-react, Node's test runner.

**Spec:** `docs/superpowers/specs/2026-10-27-editor-profile-photo-design.md`

## Global Constraints

- 3 changes a day: `PROFILE_PHOTO_CHANGES_PER_DAY = 3` in `src/lib/constants.ts`; the SQL writes `3` with the
  comment "Same limit as PROFILE_PHOTO_CHANGES_PER_DAY in src/lib/constants.ts".
- The day is the `Asia/Manila` date: `(now() at time zone 'Asia/Manila')::date`.
- Stored photo: a 400 × 400 square, `PROFILE_PHOTO_SIZE = 400` in `src/lib/constants.ts`. WebP, or JPEG drawn on
  white where the browser can't make WebP.
- Zoom slider: 1× to 3×. No turn, no straighten.
- Refusal code for "none left today": `QMPPL`. Message: "You've changed your photo 3 times today. You can change it
  again tomorrow."
- Account box copy: "You can change your photo 3 times a day." + pill "N left today"; with none left the button is
  greyed out and the line reads "You can change it again tomorrow."
- Popup copy: title "Adjust your photo", hint "Drag the photo to move it.", label "Zoom", buttons Cancel / "Save
  photo". Toasts: "Profile photo saved." / "Profile photo removed." / the server's message.
- Admin log key `profile_photo_removed`, label "Removed a profile photo".
- Never touch `photos` ("My photos") or `shared_photos` for a profile photo. Not part of `click_limits`.
- Zod before every save (root `CLAUDE.md`, "Saving Data"); the one `Spinner`; `Modal` / `ConfirmModal`; design
  system classes only; Lucide icons with `size`; no new npm package.
- Database: only on the local Docker database (`npx -y supabase@latest db reset`, then
  `docker exec -i supabase_db_quizBuilder psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/<file>.sql`). If
  Docker is off, start `C:\Users\ACER\AppData\Local\Programs\DockerDesktop\Docker Desktop.exe` first.
- Work is on `main`. **No commit without asking the user first** (each time). The plan has one commit, at the end.
- Each task updates the `CLAUDE.md` notes of the folder it touches (root `CLAUDE.md`, "Every feature has notes").

## Review Focus

1. **Two tabs saving at once with 1 change left:** only one gets through. Pinned by the row lock in
   `set_profile_photo` (Task 1 test: the 4th call is refused, and the count is read under `for update`).
2. **A portrait or very wide photo:** at zoom 1 the short side fills the frame and dragging can't show an empty
   edge. Pinned in Task 2's `clampView` tests (tall and wide images).
3. **Remove then re-add on a day with none left:** still refused. Pinned in Task 1's test.
4. **The editor role taken away, then given back:** the old photo doesn't come back. Pinned in Task 1's test (row gone
   after deleting from `editors`).
5. **Account deleted:** the photo row goes and the account delete still works. Pinned by running
   `supabase/tests/account_delete.sql` (as `-U supabase_admin -d postgres`) in Task 1.

---

### Task 1: Database — table, functions, admin log, cleanup, profile read

**Files:**
- Create: `supabase/migrations/20261214000000_profile_photos.sql`
- Create: `supabase/tests/profile_photos.sql`
- Modify: `supabase/migrations/CLAUDE.md` (new migration in "Where the big features live", `QMPPL` in "Refusal
  codes", newest `teacher_profile` and `used_photo_srcs` are now in this file)

**Interfaces:**
- Produces:
  - Table `public.profile_photos (user_id uuid primary key references public.editors (user_id) on delete cascade,
    src text not null default '', day date, changes int not null default 0, updated_at timestamptz not null default
    now())`. RLS on, no policies; `revoke all ... from anon, authenticated`.
  - `public.set_profile_photo(src text) returns int` (left today after this change). Errors: `42501` not logged in
    / not an editor; `QMBAN` banned (`public.is_banned()`); `22023` src not matching
    `^https://images\.quizmatter\.com/uploads/[0-9a-f]{64}\.(webp|jpg)$`; `QMPPL` none left. Upserts the row, takes
    it `for update`, resets `changes` to 0 when `day` isn't today (Manila), refuses at `changes >= 3`, else sets
    `src`, `day`, `changes + 1`, `updated_at`.
  - `public.remove_profile_photo() returns void`: the caller's own `src = ''`. Count unchanged.
  - `public.admin_remove_profile_photo(target uuid) returns void`: `is_admin()` else `42501`; sets that row's
    `src = ''`; if it had a photo, calls `log_admin_action('profile_photo_removed', 'user', target::text, <editor's
    display name, else email before "@">, null)`.
  - `public.my_profile_photo() returns table (src text, left_today int)`: the caller's photo (`''` if none) and how
    many changes are left today (3 when no row or `day` isn't today). Not an editor → no rows.
  - `public.teacher_profile(slug text)`: same as `20261112000000_profile_name_links.sql` plus a last column
    `photo_src text` (`coalesce(pp.src, '')`, left join). `drop function` + `create function`, same grants.
  - `public.used_photo_srcs()`: same as `20261019000000_presentation_reviews.sql` plus
    `select pp.src from public.profile_photos pp where pp.src <> ''`.
  - `admin_actions_action_check` dropped and re-added with `'profile_photo_removed'` added to the list from
    `20261208000000_admin_log.sql`.
  - All four new functions: `security definer`, `set search_path = ''`, `revoke execute ... from public, anon`,
    `grant execute ... to authenticated`.

- [ ] **Step 1: Write the failing SQL test** `supabase/tests/profile_photos.sql`, in the style of
  `supabase/tests/teacher_shared_presentations.sql` (`begin;` … `rollback;`, ids `00000000-0000-4000-8000-0000000000e1`
  editor with `raw_user_meta_data` `{"first_name": "Pp", "last_name": "Editor"}` (link name `pp-editor`), `…e2` plain
  teacher, `…e3` admin, `…e4` banned editor: add e4 to `editors` **before** `banned_users` (which needs a `reason`), since
  `check_editor_target` refuses making a banned teacher an editor). A valid src:
  `'https://images.quizmatter.com/uploads/' || repeat('a', 64) || '.webp'` (and `'b'`, `'c'`, `'d'` for others).
  Each check raises `FAIL: …` when wrong:
  - As e1: three `set_profile_photo` calls return 2, 1, 0; the 4th raises `QMPPL` (catch `when sqlstate 'QMPPL'`).
  - As e1: `remove_profile_photo()` then `set_profile_photo` still raises `QMPPL`; `my_profile_photo()` gives
    `('', 0)`.
  - As postgres: set e1's `day` to yesterday (Manila); as e1: `set_profile_photo` returns 2.
  - As e1: `set_profile_photo('https://example.com/x.webp')` raises `22023`.
  - As e2 (not an editor): `set_profile_photo` raises `42501`; `my_profile_photo()` returns no rows.
  - As e4 (an editor in `banned_users`): `set_profile_photo` raises `QMBAN`.
  - As e1: `insert`, `update` and `delete` on `profile_photos` directly all fail or touch 0 rows.
  - As e2: `teacher_profile('pp-editor')` returns e1's current src in `photo_src`.
  - As postgres: `used_photo_srcs()` contains e1's src.
  - As e2: `admin_remove_profile_photo(e1)` raises `42501`. As e3: it works, e1's `src` is `''`, `changes` unchanged,
    and one `admin_actions` row with `action = 'profile_photo_removed'` and `target_id = e1`.
  - As postgres: `delete from public.editors where user_id = e1` → no `profile_photos` row for e1.
  - `has_function_privilege('anon', 'public.set_profile_photo(text)', 'execute')` is false.

- [ ] **Step 2: Run it and see it fail**

Run: `npx -y supabase@latest db reset`, then
`docker exec -i supabase_db_quizBuilder psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/profile_photos.sql`
Expected: ERROR (function `set_profile_photo` does not exist).

- [ ] **Step 3: Write the migration** `supabase/migrations/20261214000000_profile_photos.sql` with everything in
  Interfaces, opening with a plain-English comment (what and why, spec path), section headers like the other files.

- [ ] **Step 4: Run it and see it pass**

Run: `npx -y supabase@latest db reset`, then the same psql command.
Expected: ends with `ROLLBACK`, no `FAIL`, no `ERROR`.

- [ ] **Step 5: Run the account delete test and the admin log neighbours**

Run: `docker exec -i supabase_db_quizBuilder psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < supabase/tests/account_delete.sql`,
then `database_fixes.sql` and `plain_admin_limits.sql` as `-U postgres`.
Expected: each ends with `ROLLBACK`, no `FAIL` / `ERROR`.

- [ ] **Step 6: Update `supabase/migrations/CLAUDE.md`** (the three spots in Files).

### Task 2: Crop math

**Files:**
- Create: `src/lib/photoCrop.ts`
- Create: `src/lib/photoCrop.test.ts`

**Interfaces:**
- Produces (no imports in this file, so the test can load it):
  - `export type CropView = { zoom: number; x: number; y: number }` — `x`, `y` = how far the photo's center is moved
    from the box's center, in screen px.
  - `export function clampView(image: { width: number; height: number }, box: number, view: CropView): CropView` —
    zoom kept in 1..3; then `x`, `y` kept so the photo covers the whole box.
  - `export function cropSource(image: { width: number; height: number }, box: number, view: CropView): { x: number;
    y: number; size: number }` — the square of the original photo (in its own px) inside the box.
  - Model: shown scale `s = box * zoom / min(width, height)`; `|x| <= (width * s - box) / 2`,
    `|y| <= (height * s - box) / 2`; `size = box / s`; `x = width / 2 - view.x / s - size / 2`,
    `y = height / 2 - view.y / s - size / 2`.

- [ ] **Step 1: Write the failing tests** (`node:test`, `assert/strict`, like `src/lib/dom.test.ts`):
  - `cropSource({width:800,height:600}, 300, {zoom:1,x:0,y:0})` deep-equals `{x:100, y:0, size:600}`.
  - `cropSource({width:800,height:600}, 300, {zoom:2,x:100,y:-50})` deep-equals `{x:150, y:200, size:300}`.
  - `clampView({width:800,height:600}, 300, {zoom:1,x:80,y:20})` deep-equals `{zoom:1, x:50, y:0}`.
  - Tall photo: `clampView({width:600,height:1200}, 300, {zoom:1,x:40,y:-500})` deep-equals `{zoom:1, x:0, y:-150}`.
  - Zoom bounds: `clampView(..., {zoom:5,...}).zoom === 3` and `{zoom:0.2}` → `1`.

- [ ] **Step 2: Run** `npm test` — Expected: FAIL (cannot find module `./photoCrop`).

- [ ] **Step 3: Implement** both functions in `src/lib/photoCrop.ts` (short comments in the repo's plain style).
  Clamp as `Math.max(-max, Math.min(max, value))`, which gives `0`, never `-0` (strict deep-equal tells them apart).

- [ ] **Step 4: Run** `npm test` — Expected: all pass.

### Task 3: Upload route

**Files:**
- Create: `src/app/api/profile-photo/route.ts`
- Modify: `src/lib/constants.ts` (add `PROFILE_PHOTO_SIZE = 400`, `PROFILE_PHOTO_CHANGES_PER_DAY = 3`)
- Modify: `src/lib/schema.ts` (add `profilePhotoSchema`)
- Modify: `src/app/api/CLAUDE.md` (table row for `profile-photo/`; note that `used_photo_srcs` counts profile photos)

**Interfaces:**
- Consumes: `set_profile_photo` (Task 1); `readPhotoType`, `photoFileName`, `savePhotoFile` (`src/lib/photoFiles.ts`);
  `MAX_STORED_PHOTO_BYTES`, `PHOTO_URL_PREFIX`.
- Produces:
  - `export const profilePhotoSchema = photoSchema.extend({ width: z.literal(PROFILE_PHOTO_SIZE), height:
    z.literal(PROFILE_PHOTO_SIZE) })` in `schema.ts`.
  - `POST /api/profile-photo?width=400&height=400`, body = the image. 200 → `{ src: string, leftToday: number }`.
    Errors `{ error: string }`: 401 not logged in; 413 too big; 415 not WebP/JPEG; 400 wrong size; 403 not an
    editor ("Only editors can add a profile photo.") or banned (same words as `upload-image`'s `banned()`); 429
    `QMPPL` (the Global Constraints message); 500 anything else ("Couldn't save the photo. Please try again.").

- [ ] **Step 1: Write the route** following `src/app/api/upload-image/route.ts` step for step (login, size header then
  body, type, file name, zod), then `rpc("set_profile_photo", { src })` **before** `savePhotoFile`. If
  `savePhotoFile` throws, return the 500 message (the editor sees the failure and can try again; the count stays
  used — say so in a comment).
- [ ] **Step 2: Run** `npx tsc --noEmit` and `npm run lint` — Expected: no errors in the changed files.
- [ ] **Step 3: Update `src/app/api/CLAUDE.md`.**

### Task 4: Account page — Profile photo box and the adjust popup

**Files:**
- Create: `src/lib/profilePhotos.ts` (browser helpers)
- Create: `src/app/account/ProfilePhotoForm.tsx` (the box, client)
- Create: `src/app/account/ProfilePhotoCropper.tsx` (the popup, client)
- Modify: `src/app/account/page.tsx` (read `my_profile_photo()` for editors, render the box first in the list)
- Modify: `src/lib/photos.tsx` (export `toBlob`)
- Modify: `src/app/CLAUDE.md` ("Account, profiles, sign up, login": the box), `src/lib/CLAUDE.md` ("Photos" line:
  `photoCrop.ts`, `profilePhotos.ts`)

**Interfaces:**
- Consumes: `clampView`, `cropSource`, `CropView` (Task 2); `POST /api/profile-photo` (Task 3); `remove_profile_photo`,
  `my_profile_photo` (Task 1); `PHOTO_TYPES`, `MAX_PHOTO_FILE_BYTES`, `PROFILE_PHOTO_SIZE`,
  `PROFILE_PHOTO_CHANGES_PER_DAY`.
- Produces:
  - `src/lib/profilePhotos.ts`:
    - `export async function makeProfilePhoto(bitmap: ImageBitmap, source: { x: number; y: number; size: number }):
      Promise<Blob>` — 400 × 400 canvas, `imageSmoothingQuality = "high"`, WebP at 0.85, else JPEG on white (as in
      `shrinkPhoto`).
    - `export async function uploadProfilePhoto(blob: Blob): Promise<{ src: string; leftToday: number }>` — parses
      the reply with zod; throws `Error(server message)` on failure.
    - `export async function removeProfilePhoto(): Promise<string | null>` — `null` worked, else a message.
  - `ProfilePhotoForm({ src, leftToday }: { src: string; leftToday: number })`.
  - `ProfilePhotoCropper({ file, onClose, onSaved }: { file: File; onClose: () => void; onSaved: (result: { src:
    string; leftToday: number }) => void })`.

- [ ] **Step 1: `profilePhotos.ts`** as in Interfaces.
- [ ] **Step 2: `ProfilePhotoCropper`** — `Modal` titled "Adjust your photo", `isBusy` while saving. A square box
  (about 280 px, smaller on phones) with the photo (an object URL of `file`, revoked on close) moved by CSS
  `transform` from the `CropView`; a round guide on top with the outside darkened (CSS only); pointer events
  (`setPointerCapture`) to drag, every change through `clampView`; a range input 1–3 for Zoom (`accent-accent`);
  footer Cancel + "Save photo" (main-button classes, `Spinner` while saving). Save: `createImageBitmap(file)` →
  `cropSource` → `makeProfilePhoto` → `uploadProfilePhoto` → `onSaved`, toast "Profile photo saved."; on error a
  toast with the message and the popup stays open. Files not in `PHOTO_TYPES` or over `MAX_PHOTO_FILE_BYTES` are
  refused before opening, with the same words as `shrinkPhoto`.
- [ ] **Step 3: `ProfilePhotoForm`** — a `rounded-card` box like `AccountForms`' `Card` (title "Profile photo",
  not a form): the round photo (`thumbnailUrl(src, 160)`) or an empty `bg-accent-soft` circle with a Lucide
  `UserIcon`; "Change photo" (main-button classes; a hidden file input, `accept={PHOTO_TYPES.join(",")}`; disabled
  when `leftToday === 0`) and "Remove" (only with a photo; `ConfirmModal`, then `removeProfilePhoto`, toast, `router.refresh()`);
  the 3-a-day line and pill from Global Constraints. After `onSaved`: keep the new `src` / `leftToday` in state and
  `router.refresh()`.
- [ ] **Step 4: `account/page.tsx`** — when `account.isEditor`, call `my_profile_photo` with the server client and
  render `<ProfilePhotoForm>` first in the column; on a failed read, render nothing (log it).
- [ ] **Step 5: Run** `npx tsc --noEmit`, `npm run lint`, `npm test` — Expected: no errors.
- [ ] **Step 6: Update the notes** listed in Files.

### Task 5: Profile page shows the photo

**Files:**
- Modify: `src/lib/profiles.ts` (`TeacherProfile.photoSrc: string`, read `photo_src`)
- Modify: `src/app/teachers/[slug]/page.tsx` (header)
- Modify: `src/app/CLAUDE.md` (profiles bullet)

**Interfaces:**
- Consumes: `teacher_profile(slug)`'s `photo_src` (Task 1); `thumbnailUrl` (`src/lib/constants.ts`).

- [ ] **Step 1:** Add `photoSrc` to `TeacherProfile` and `loadTeacherProfile`.
- [ ] **Step 2:** In the header, when `profile.photoSrc` is set, a round 88 px `<img src={thumbnailUrl(photoSrc,
  176)} alt="">` left of the name (`flex items-center gap-4`); otherwise the header is unchanged.
- [ ] **Step 3: Run** `npx tsc --noEmit` and `npm run lint` — Expected: no errors.
- [ ] **Step 4:** Update `src/app/CLAUDE.md`.

### Task 6: Admin → Editors → one editor: Remove photo

**Files:**
- Create: `src/app/admin/editors/actions.ts`
- Create: `src/app/admin/editors/[id]/ProfilePhotoPart.tsx` (client)
- Modify: `src/app/admin/editors/[id]/page.tsx` (read the photo; render the part above "Presentations")
- Modify: `src/lib/adminActions.ts` (`profile_photo_removed: "Removed a profile photo"`)
- Modify: `src/app/admin/CLAUDE.md` (Editors row)

**Interfaces:**
- Consumes: `admin_remove_profile_photo` (Task 1).
- Produces: `export async function removeEditorPhoto(userId: string): Promise<string | null>` — `"use server"`,
  `z.uuid()` first, `getAccount().isAdmin`, rpc with the server client, `refresh()`, `null` or "Couldn't remove the
  photo. Please try again." (`src/app/admin/CLAUDE.md`, "How an admin action is written").

- [ ] **Step 1:** `removeEditorPhoto` in `actions.ts`.
- [ ] **Step 2:** `page.tsx` adds `admin.from("profile_photos").select("src").eq("user_id", id).maybeSingle()` to its
  `Promise.all` (and to the error check), and passes `src` to the part.
- [ ] **Step 3:** `ProfilePhotoPart({ userId, src })` — `PartLabel`-style "Profile photo" label, the round photo
  (`thumbnailUrl(src, 160)`) with "Remove photo" (danger style, `ConfirmModal` with `danger`, Spinner while
  removing, toast "Profile photo removed." or the message), or "No profile photo." in the page's `Empty` style.
- [ ] **Step 4: Run** `npx tsc --noEmit` and `npm run lint` — Expected: no errors.
- [ ] **Step 5:** Update `src/app/admin/CLAUDE.md`.

### Task 7: Check everything, then ask to commit

- [ ] **Step 1:** `npx tsc --noEmit`, `npm run lint`, `npm test` — no errors.
- [ ] **Step 2:** `npx -y supabase@latest db reset`, then `profile_photos.sql`, `account_delete.sql` (as
  `supabase_admin`), `database_fixes.sql`, `plain_admin_limits.sql` — each ends with `ROLLBACK`, no `FAIL` / `ERROR`.
- [ ] **Step 3:** In the browser (`npm run dev`, local Supabase), as an editor: upload a tall and a wide photo,
  zoom, drag to each edge, save; see it on Account and on the profile page; the pill counts down 2 → 1 → 0 and the
  button greys out; Remove works and the count stays. As an admin: Remove photo on the editor's page; the Admin
  log shows "Removed a profile photo". Check at phone width too.
- [ ] **Step 4:** `git diff` next to the spec and this plan: every part done, nothing extra, notes true.
- [ ] **Step 5:** Show the user the files and a short summary and ask "Commit to main?". Only after a yes:

```bash
git add supabase/migrations/20261214000000_profile_photos.sql supabase/tests/profile_photos.sql supabase/migrations/CLAUDE.md src/lib/photoCrop.ts src/lib/photoCrop.test.ts src/lib/profilePhotos.ts src/lib/constants.ts src/lib/schema.ts src/lib/photos.tsx src/lib/profiles.ts src/lib/adminActions.ts src/lib/CLAUDE.md src/app/api/profile-photo/route.ts src/app/api/CLAUDE.md src/app/account/ src/app/teachers/[slug]/page.tsx src/app/admin/editors/ src/app/admin/CLAUDE.md src/app/CLAUDE.md docs/superpowers/plans/2026-10-28-editor-profile-photo.md
git commit -m "Editors' profile photos: upload with zoom and move, 3 a day, admin remove"
```

- [ ] **Step 6:** Remind the user: apply the migration to the live database **before** deploying the app.
