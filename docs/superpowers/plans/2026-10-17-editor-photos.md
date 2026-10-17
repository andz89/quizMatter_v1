# Editor Photos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every editor upload becomes a waiting shared photo that admins can edit, hidden from teachers and Claude until a live QuizMatter presentation uses it; photos in anything waiting for approval can't be deleted.

**Architecture:** All rules live in one migration (a column, a category, triggers, an updated read policy, an updated search function and views). The app only reads the new `is_public` column, adds a Waiting pill/filter in Admin → Photos and a Status column on the editor profile, keeps Claude's photo check to public photos, and turns the new refusal `QMPHL` into a message.

**Tech Stack:** Supabase Postgres (plpgsql triggers, RLS), Next.js app (server pages + client components), sonner toasts.

**Spec:** `docs/superpowers/specs/2026-10-17-editor-photos-design.md`

## Global Constraints

- Functions: `set search_path = ''`, full names (`public.…`); triggers that must pass table rules are `security definer`.
- Don't edit applied migrations; start each changed function/view from its newest version (`20261114000000_shuffle_photo_search.sql` for `search_shared_photos`, `20261122000000_super_admin.sql` for both views and the write policies, `20260928020000_shared_photos.sql` / `20261026000000_remove_photo_review.sql` for the read policy "Everyone reads shared photos").
- A view only gets new columns **at the end** (`create or replace view`).
- New refusal code `QMPHL`, message: "This photo is in a presentation waiting for QuizMatter, so it can't be removed yet."
- Category name: "From editors". Waiting pill: `bg-highlight-soft text-highlight-strong`, label "Waiting".
- No test runner in this repo: the database is checked with SQL in a transaction that ends in `rollback`
  (Supabase MCP `execute_sql`); the app with `npx tsc --noEmit`, `npx eslint <files>` and the browser.
- Applying the migration to the live project and committing to `main` need the user's OK each time.

## Review Focus

- An editor upload where the photo is already a shared photo (same src) → nothing changes, the upload still works (`on conflict do nothing`). Task 1, check B.
- A non-editor teacher or an admin uploading to "My photos" → no shared row is made. Task 1, check A.
- An admin hides (`hidden_at`) a QuizMatter presentation, or keeps it as a draft → its waiting photos stay waiting. Task 1, check D.
- A review sent back / canceled with a photo in its draft → photo stays waiting; a `reviewing` round never locks deletes. Task 1, checks E and F.
- Claude (`find_photos`, slide photo check) with a waiting photo → not found / refused. Task 1, check G; Task 2 step 1.

---

### Task 1: The migration

**Files:**
- Create: `supabase/migrations/20261126000000_editor_photos.sql`

**Interfaces:**
- Produces: column `shared_photos.is_public boolean not null default true`; views `shared_photos_search` (+ `is_public` last) and `shared_photo_counts` (+ `waiting integer` last, = `count(*) filter (where not is_public)`); function `public.photo_waiting_for_approval(target_src text) returns boolean`; refusal `QMPHL`; category row named `From editors`.

- [ ] **Step 1: Write the migration**, in this order, each part with a plain-English comment:
  1. `alter table public.shared_photos add column is_public boolean not null default true;`
  2. `insert into public.photo_categories (name) values ('From editors') on conflict do nothing` (check the table's unique key first; if there's none, insert only when no row has that name).
  3. `photo_waiting_for_approval(target_src text)` (stable, security definer, no grants to anon/public): true if `exists` a `slide_photos` row with that src whose `presentation_id` has a `presentation_submissions` row with `status = 'submitted'`, **or** a `presentation_reviews` row with `status = 'submitted'` and `target_src = any(public.slide_photo_srcs(draft))`.
  4. Before-delete triggers on `public.photos` and on `public.shared_photos`: `if public.photo_waiting_for_approval(old.src) then raise exception '…message…' using errcode = 'QMPHL'`.
  5. After-insert trigger on `public.photos` (security definer): when `new.src like '%.webp'` and `exists (select 1 from public.editors e where e.user_id = new.user_id)`, insert into `shared_photos (src, width, height, category_id, uploaded_by, is_public)` with the "From editors" id and `false`, `on conflict (src) do nothing`; wrap in `begin … exception when others then null; end` so an upload never fails because of it. Then run the "going public" check for that src (a photo uploaded into an already-live slide).
  6. After-delete trigger on `public.photos`: `delete from public.shared_photos where src = old.src and not is_public and uploaded_by = old.user_id`.
  7. Helper `public.publish_waiting_photos(target_presentation text)` (security definer, no grants): `update public.shared_photos set is_public = true where not is_public and src in (select src from public.slide_photos where presentation_id = target_presentation)` **only if** that presentation is `from_admin and is_published and hidden_at is null`.
  8. After-insert trigger on `public.slide_photos` → `publish_waiting_photos(new.presentation_id)`. After-update trigger on `public.presentations` `of is_published, hidden_at` → same, for `new.id`.
  9. Replace the read policy "Everyone reads shared photos" with one `using (is_public or (select public.is_admin()))`.
  10. `search_shared_photos`: newest body, plus `where sp.is_public and (m.hits > 0 or trim(query) = '')`.
  11. Both views from `20261122000000_super_admin.sql`, plus `sp.is_public` / `waiting` at the end.
  12. Backfill: insert waiting rows for every editor's WebP `photos` row (same insert as part 5, `on conflict do nothing`); then `update … set is_public = true` for waiting photos used by any live QuizMatter presentation (`slide_photos` join `presentations` with `from_admin and is_published and hidden_at is null`).

- [ ] **Step 2: Ask the user to OK applying it**, then apply with Supabase MCP `apply_migration` (name `editor_photos`).

- [ ] **Step 3: Run the checks**, each as `begin; … rollback;` with `execute_sql` (pick a real editor id and a non-editor id from `editors` / `auth.users`; insert test rows with srcs like `https://images.quizmatter.com/uploads/<64 hex>.webp`):
  - A: insert a `photos` row for a non-editor → no `shared_photos` row with that src.
  - B: insert a `photos` row for the editor → one `shared_photos` row, `is_public = false`, category "From editors", `uploaded_by` = editor; insert the same src for a second editor → still one row, no error.
  - C: give that waiting src a slide in a `from_admin, is_published` presentation (insert presentation + slide with the src in `data`) → `is_public = true`.
  - D: same but `is_published = false` → stays `false`; then `update presentations set is_published = true` → becomes `true`; with `hidden_at` set → stays `false`.
  - E: a `presentation_submissions` row `status = 'submitted'` for a presentation whose slide uses the src → `delete from photos` and `delete from shared_photos` for that src both fail with `QMPHL`; change status to `approved` → both deletes work.
  - F: a `presentation_reviews` row with the src in `draft`: `status = 'submitted'` → delete fails `QMPHL`; `status = 'reviewing'` → delete works and the waiting shared row goes with it.
  - G: `select * from public.search_shared_photos('')` → no row with `is_public = false` srcs.
  Expected: every check as described; all end in `rollback`.

- [ ] **Step 4: Ask the user to OK the commit**, then commit `supabase/migrations/20261126000000_editor_photos.sql` ("Editor photos: wait in the shared library until QuizMatter uses them").

### Task 2: The app

**Files:**
- Modify: `src/pages/api/mcp.ts` (photo check, ~line 289)
- Modify: `src/app/admin/photoSearch.ts` (`MISSING`), `src/app/admin/page.tsx` (counts + query), `src/app/admin/AdminPhotos.tsx` (pill, chip, ✕ error)
- Modify: `src/lib/schema.ts` or the admin page row type: carry `is_public` to `SharedPhotoItem` (admin page only; don't add it to `SHARED_PHOTO_COLUMNS`, which the editor panel uses)
- Modify: `src/components/editor/PhotosPanel.tsx` (remove error), `src/app/admin/editors/[id]/page.tsx` (Status column)

**Interfaces:**
- Consumes: Task 1's `is_public`, `waiting` count, `QMPHL`.
- Produces: `PHOTO_LOCKED_MESSAGE` exported from `src/lib/photos.tsx` = the QMPHL message; `isPhotoLocked(error: unknown): boolean` (true when `error.code === "QMPHL"`).

- [ ] **Step 1:** `mcp.ts`: the slide photo check selects only `.eq("is_public", true)` rows, so a waiting photo gets the existing "isn't a shared photo" answer.
- [ ] **Step 2:** `MISSING` gets `{ id: "waiting", label: "Waiting" }`; `page.tsx` adds `.eq("is_public", false)` for it, sums `waiting` into `counts.waiting` (add to `PhotoCounts`), and selects `is_public` with `bytes`.
- [ ] **Step 3:** `AdminPhotos.tsx`: a "Waiting" chip next to the missing chips (Sunny, same style) with `counts.waiting`, shown only when > 0; a "Waiting" pill on waiting photos in list (next to the file name) and grid (over the picture's corner) views, title "Teachers can't see it until a QuizMatter presentation that uses it is live".
- [ ] **Step 4:** ✕ and "My photos" remove: on `isPhotoLocked(error)` show `toast.error(PHOTO_LOCKED_MESSAGE)` (photo put back, as now); other errors keep today's message. `removeMyPhoto` / `removeSharedPhoto` rethrow the Supabase error unchanged.
- [ ] **Step 5:** `/admin/editors/[id]`: select `is_public` from `shared_photos_search`; add a "Status" column before "Uploaded": "Waiting" pill, "Public" pill (`bg-success-soft text-success-strong`), or "—" for a photo with no shared row (JPEG, or already removed).
- [ ] **Step 6:** Run `npx tsc --noEmit` and `npx eslint` on the changed files. Expected: no errors.
- [ ] **Step 7:** Browser check (dev server, logged in as super admin): Admin → Photos shows the backfilled editor photos with "Waiting" and the Waiting chip filters them; editing a waiting photo's tags saves; the editor profile shows Status.

### Task 3: Notes and final check

**Files:**
- Modify: `supabase/migrations/CLAUDE.md` (QMPHL in Refusal codes; editor photos under "Where the big features live"), `src/app/admin/CLAUDE.md` (Photos row: waiting photos), `src/lib/CLAUDE.md` (photos: editor uploads), root `CLAUDE.md` (Submit to QuizMatter and Reviews: approving / publishing makes the editor's waiting photos public; photos in anything waiting can't be deleted).

- [ ] **Step 1:** Write the notes from the real code (plain English, short).
- [ ] **Step 2:** `git diff` next to the spec: every spec point done, nothing extra.
- [ ] **Step 3:** Ask the user to OK the commit, then commit Task 2 + 3 files ("Editor photos: Waiting in Admin → Photos, can't remove while waiting").
