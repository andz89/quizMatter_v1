# Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every problem the 2026-10-24 deep review found: no lost work, plain-admin limits in the database, a
data version that can't be poisoned, safer Claude connection, and the rule/notes breaks.

**Architecture:** Database rules go in new migration files under `supabase/migrations/` (one per topic), each with a
SQL test script in `supabase/tests/` that runs inside `begin … rollback`. App fixes stay in the files that own them.
Pure logic gets Node's built-in test runner (no new package).

**Tech Stack:** Next.js 16, React 19, zustand, zod, Supabase (Postgres, RLS, plpgsql), Cloudflare Workers, Node 24 test runner.

**Spec:** `docs/superpowers/specs/2026-10-24-review-fixes-design.md` (section letters A–J below refer to it).

## Global Constraints

- Nothing that opens today may stop opening: a stricter zod rule gets a clean-up in `upgradeSlide` / `upgradePresentation`, and Admin → Data check must still say every presentation opens.
- New database changes go in new files named `20261210000N00_<topic>.sql` (the `data_version` and account-delete migrations are already live). The one exception is the D7 edit to `20261122000000_super_admin.sql`.
- **Never apply migrations to the live database and never commit.** The user's rule: ask "Commit to main?" before every commit; applying migrations also needs their yes. Instead of commits, each task ends with a snapshot (below).
- A function changed by a migration starts from its **newest** definition (grep all migrations, take the latest file).
- Database checks run as direct PostgREST writes use `current_user = 'authenticated'` to tell them apart from the database's own security definer functions (which run as the function owner), so reviews, submissions and account delete keep working.
- CLAUDE.md rules hold: zod right before every save; the one `Spinner`; `TopLoadingBar`/`LinkPending`/`loading.tsx`; design-system tokens only; sonner toast on every save; `ConfirmModal` for confirms; Lucide icons with `size`; plain English; the folder `CLAUDE.md` updated in the same task as the code.
- No new npm packages. If one becomes unavoidable: `npx -y npm@10.9.2 install …`.
- Snapshot instead of commit, at the end of every task (records the tree without touching the index or HEAD):
  `TMPIDX="$TEMP/qm-plan.idx"; cp .git/index "$TMPIDX"; GIT_INDEX_FILE="$TMPIDX" git add -A; GIT_INDEX_FILE="$TMPIDX" git write-tree` → note the printed tree id in the task's checkbox. A reviewer compares two snapshots with `git diff <before> <after>`.

## Review Focus

1. Leaving the editor fast and opening another presentation while the leave-save is still running: the old presentation must still be saved (or kept), and the new one must not be touched (Task 4 manual check 4).
2. A plain admin's everyday work after the policy change: hide a reported presentation, publish a review, approve a submission, edit and share their own QuizMatter presentation, delete their own (Task 6 SQL test "plain admin everyday flows").
3. Old saved presentations with unusual color strings must still open (Task 15: Data check + upgrade test).
4. A reviewer leaving the editor saves the review draft, never the live presentation; a locked presentation (`QMREV`) keeps the work in the browser (Task 4 manual checks 2–3).
5. The real Claude connect flow still works after the redirect allow-list (Task 10 test with Claude's real callback address, plus the user's own connect test).

---

### Task 1: Test runner and lint ignore

**Files:**
- Create: `scripts/test-resolve.mjs`
- Create: `src/lib/schema.test.ts`
- Modify: `package.json` (scripts), `eslint.config.mjs` (globalIgnores), `CLAUDE.md` (new short "Tests" section after "Code Style")

**Interfaces:**
- Produces: `npm test` = `node --no-warnings --import ./scripts/test-resolve.mjs --test "src/**/*.test.ts"`. Tests may import only `.ts` files whose imports are `.ts` too (no JSX, no JSON); `@/` maps to `src/`.

- [ ] **Step 1:** Write `scripts/test-resolve.mjs`: a `registerHooks` (node:module) `resolve` hook that maps `@/x` to `src/x` and tries `""`, `.ts`, `/index.ts` for relative or `src` paths, then calls `next`. (A working prototype exists; keep it this small.)
- [ ] **Step 2:** Write `src/lib/schema.test.ts`, test `upgradePresentation runs twice with the same result`: take a presentation built with `createBlankSlide`-free plain JSON (one blank slide), assert `deepEqual(upgradePresentation(upgradePresentation(x)), upgradePresentation(x))`.
- [ ] **Step 3:** Add the `test` script; add `".claude/**"` to `globalIgnores`; add the CLAUDE.md "Tests" section (2–3 lines: `npm test`, where tests live, the import limit above).
- [ ] **Step 4:** Run `npm test` → `pass 1`. Run `npm run lint` → no errors. Run `npx tsc --noEmit` → exit 0.
- [ ] **Step 5: Local test database** (for every `supabase/tests/*.sql` from Task 2 on). Ask the user to start Docker Desktop. Then `npx -y supabase@latest init` (only if there's no `supabase/config.toml`), `npx -y supabase@latest start -x gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor`, `npx -y supabase@latest db reset` (replays every migration). Run a test file with `docker exec -i supabase_db_<project_id> psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/<file>.sql` (no output with `FAIL` = pass). If the replay breaks on `20261122000000_super_admin.sql`, that's D7: do Task 7 Step 3's edit to that file now. If it breaks on another old migration, stop and report it instead of editing history. If Docker can't run, mark every SQL test step "not run" and say so at the end.
- [ ] **Step 6:** Snapshot.

### Task 2: Data version cap (spec C, and the database side of B9)

**Files:**
- Create: `supabase/migrations/20261210000000_data_version_cap.sql`, `supabase/tests/data_version_cap.sql`
- Modify: `src/lib/CLAUDE.md` ("Changing the saved shape"), `supabase/migrations/CLAUDE.md`

**Interfaces:**
- Produces: `public.current_data_version() returns int` (immutable, `search_path = ''`, returns 0); triggers `cap_presentation_data_version` and `cap_review_draft_version` capping `presentations.data_version` and `presentation_reviews.draft_version` at it on insert/update; `save_presentation` refuses `QMOLD` when it inserts a new row whose `copied_from` source has `data_version > app_version`.

- [ ] **Step 1: Write the failing test** `supabase/tests/data_version_cap.sql` (`begin; … rollback;`, assertions as `do $$ … raise exception 'FAIL: …' $$`): make a teacher in `auth.users`, act as them (`set local role authenticated` + `request.jwt.claims`), call `save_presentation(…, app_version => 2147483647)`; assert stored `data_version = 0`; `update presentations set data_version = 99` directly → stays 0; a review draft saved with `app_version => 99` keeps `draft_version = 0`. Copy refusal: as postgres, `alter table public.presentations disable trigger cap_presentation_data_version`, set a source row's `data_version = 1`, enable it again; then as the teacher save a new presentation with `copiedFrom` = that source and `app_version => 0` → raises `QMOLD`.
- [ ] **Step 2:** Run it (Task 1 Step 5) → FAIL.
- [ ] **Step 3:** Write the migration: the function, two `before insert or update` triggers using `least(new.x, public.current_data_version())`, and `save_presentation` copied from `20261209000000_data_version.sql` with the copy check added before the insert. Revoke the trigger functions from public/anon/authenticated.
- [ ] **Step 4:** Notes: "Changing the saved shape" gets two lines: bump `current_data_version()` in a migration and apply it **before** deploying the app with the new `DATA_VERSION`; rolling the app back after a bump makes older tabs' saves refuse. `migrations/CLAUDE.md`: newest `save_presentation` is now this file.
- [ ] **Step 5:** Run the test → PASS. Snapshot.

### Task 3: Kept work fixes (spec B1–B8)

**Files:**
- Modify: `src/lib/keptWork.ts`, `src/lib/store.ts:559-625`, `src/components/editor/Editor.tsx:114-121,175-195`, `src/components/editor/ShareButton.tsx:147,176-180`, `src/lib/schema.ts:380-383`, `src/lib/CLAUDE.md`, `docs/superpowers/specs/2026-10-23-stable-presentation-data-design.md` ("Built differently")
- Create: `src/lib/keptWork.test.ts`

**Interfaces:**
- Produces: `keepUnsavedWork({ presentation, savedPresentation, isReview }): boolean` (true = stored, or nothing worth keeping); `KeptWork` gains `savedSlideIds: string[]`; store state `keptInBrowser: boolean`; store action `keepWorkNow(): boolean` (keeps `get().presentation` again); restore toast text: "Your unsaved changes are back. Saving them replaces what was saved since."

- [ ] **Step 1: Write failing tests** in `keptWork.test.ts` (stub `globalThis.localStorage` with a Map-backed object; a throwing stub for the failure case):
  - `keepUnsavedWork returns false when storage throws`
  - `keepUnsavedWork stores nothing and returns true when nothing changed`
  - `restore keeps slides the newer save added` — saved `[a,b]`, tab has `[a,b']`, loaded `[a,b,c]` → result ids `[a,b,c]` with `b'`
  - `restore drops untouched slides the newer save deleted` — saved `[a,b]`, tab `[a',b]`, loaded `[a]` → `[a']`
  - `restore keeps a deleted slide this tab changed` — saved `[a,b]`, tab `[a,b']`, loaded `[a]` → `[a,b']`
  - `restore keeps this tab's deletes` — saved `[a,b]`, tab `[a]` (edited a'), loaded `[a,b]` → `[a']`
- [ ] **Step 2:** `npm test` → those FAIL.
- [ ] **Step 3:** Implement in `keptWork.ts`. Merge rule for `takeKeptWork`: walk the kept slides in order — a slide in `unchangedSlideIds` becomes the loaded one, or is dropped if the loaded presentation no longer has it; a changed/new slide stays. Then each loaded slide whose id is in neither `savedSlideIds` nor the kept slides goes in right after the nearest earlier loaded slide that is in the result (or first). Return null when the result equals `loaded` (nothing to restore).
- [ ] **Step 4:** Store/Editor: on a `QMOLD` refusal set `keptInBrowser` from `keepUnsavedWork`'s result; the outdated box says "your changes are safe" only when `keptInBrowser`, else "Couldn't keep your changes in this browser. Copy anything you need before reloading." and the `beforeunload` guard stays on; Reload calls `keepWorkNow()` before reloading and has no `autoFocus`. Restore toast uses the new text.
- [ ] **Step 5:** `ShareButton`: when `setPublished` / the submit call returns `""`, close its own confirm box. `schema.ts`: move the "lesson" → "blank" step into `upgradeSlide`; add a test `upgradeSlide turns an old "lesson" slide into "blank"` to `schema.test.ts`.
- [ ] **Step 6:** Notes: `src/lib/CLAUDE.md` kept-work section (merge rule, returns false when storage fails); stable-data spec "Built differently": kept copy stays until a save works; the merge rule.
- [ ] **Step 7:** `npm test` → PASS; `npx tsc --noEmit` → 0. Snapshot.

### Task 4: Leaving the editor saves the work (spec A)

**Files:**
- Modify: `src/lib/store.ts` (new action near `savePresentation`), `src/components/editor/Editor.tsx`, `src/components/editor/EditorTopBar.tsx:77-118`, `src/components/editor/CLAUDE.md`

**Interfaces:**
- Consumes: `keepUnsavedWork(...) : boolean` (Task 3).
- Produces: store action `saveBeforeLeaving(): Promise<boolean>` (true = saved, nothing to save, or kept in the browser; false = neither); exported `waitForLeavingSave(id: string): Promise<void>` from `store.ts`.

- [ ] **Step 1:** `saveBeforeLeaving`: nothing unsaved → true. Else run `savePresentation()` (its normal toast); on false and not already kept, `keepUnsavedWork` with the latest presentation; on success show `toast.error("Couldn't save. Your changes are kept in this browser and come back when you open this presentation again.")` and return true; if keeping failed too, `toast.error("Couldn't save your changes.")` and return false. Record the running promise per presentation id for `waitForLeavingSave`.
- [ ] **Step 2:** `Editor.tsx`: an unmount-only effect calls `useEditorStore.getState().saveBeforeLeaving()` (fire and forget; a dev double-mount has nothing unsaved). In the load effect, when `waitForLeavingSave(presentation.id)` is pending, show the Spinner, wait, then load whichever is newer: the store's just-saved copy of that id or the page's `presentation`.
- [ ] **Step 3:** `EditorTopBar.tsx` `BackToPresentationsLink`: no `ConfirmModal`; when unsaved, `preventDefault`, show the Spinner in the button, `await saveBeforeLeaving()`, then `router.push(href)` if true, stay if false.
- [ ] **Step 4:** Notes: `src/components/editor/CLAUDE.md` gets a short "Leaving the editor" paragraph (Back/links/arrow save; tab close asks; failures kept in the browser).
- [ ] **Step 5:** `npx tsc --noEmit`, `npm run lint` → clean.
- [ ] **Step 6: Manual checks** (in the browser, as admin on a presentation the user names as safe to change; ask before saving on the live database):
  1. Edit the title, press browser Back → "Presentation saved." toast, reopen shows the new title.
  2. As a reviewer (if the user logs in as the editor): edit, Back → "Draft saved…" toast; the live presentation unchanged.
  3. Offline (DevTools → Network → Offline): edit, Back → kept toast; back online, reopen → "Your unsaved changes are back."
  4. Edit, Back, and at once open another presentation → the first is saved, the second opens untouched.
  5. Close the tab with unsaved edits → the browser's "Leave page?" still asks.
- [ ] **Step 7:** Snapshot.

### Task 5: Old tabs can't copy newer data (spec B9, app side)

**Files:**
- Modify: `src/lib/fetchPresentation.ts` (return `dataVersion`), `src/app/presentation/[id]/PresentationPreview.tsx:~132` (Make a copy), the Presentations panel's insert-slides path in `src/components/editor/` (find the call that loads another presentation's slides), `src/lib/CLAUDE.md`

**Interfaces:**
- Consumes: `presentations.data_version` and the `QMOLD` copy refusal (Task 2).
- Produces: `isNewerThanApp(dataVersion: number): boolean` in `src/lib/schema.ts` (`dataVersion > DATA_VERSION`).

- [ ] **Step 1: Failing test** in `schema.test.ts`: `isNewerThanApp(DATA_VERSION + 1) === true`, `isNewerThanApp(DATA_VERSION) === false`.
- [ ] **Step 2:** Implement; Make a copy and insert-slides check it first and show `toast.error(REFUSALS.QMOLD)` (or the existing outdated message) instead of copying; select `data_version` wherever those paths load the source.
- [ ] **Step 3:** `npm test`, `npx tsc --noEmit` → pass. Notes line in `src/lib/CLAUDE.md`. Snapshot.

### Task 6: Plain-admin limits and the editor role (spec D1–D4, H2, H3)

**Files:**
- Create: `supabase/migrations/20261210000100_plain_admin_limits.sql`, `supabase/tests/plain_admin_limits.sql`
- Modify: `src/app/admin/teachers/actions.ts:53-65`, `src/app/admin/teachers/AdminTeachers.tsx:~100`, `src/app/admin/presentations/actions.ts:14-31`, `src/app/admin/reports/actions.ts:44-61`, `src/app/admin/CLAUDE.md`, `CLAUDE.md` (Super Admin section: these rules now live in the database)

**Interfaces:**
- Produces (database): policies — admins **read** every presentation; the super admin manages every presentation; admins may **update** any presentation but a trigger `guard_admin_presentation_update` lets a non-owner who isn't the super admin change only `hidden_at` on direct writes; admins **delete** a presentation they don't own only when it is hidden or has a report; a restrictive delete policy refuses `from_admin` rows to non-admins (former admins). `editors`: insert only `is_super_admin()`, and never for an admin or a banned user; delete any admin. `share_presentation` refuses a presentation whose `copied_from` source has a hidden shared copy (same error text style as other refusals).

- [ ] **Step 1: Write the failing test** `plain_admin_limits.sql`. Users: super admin, plain admin, teacher, former admin (owns a `from_admin` row, not in `admins`). Assert, acting as each:
  - plain admin: change a teacher's `owner_id` / `from_admin` / `title` → refused; set `hidden_at` → ok; delete an unreported, unhidden teacher presentation → 0 rows; delete a reported one → 1 row; insert into `editors` → refused; delete from `editors` → ok.
  - plain admin everyday flows: update and delete their **own** presentation → ok; `save_presentation` of their own QuizMatter presentation → ok; with a submitted review round and a submitted submission set up as postgres, `publish_review` and `approve_submission` → ok.
  - super admin: change owner / `from_admin` → ok; insert an editor → ok; insert an admin as editor → refused.
  - former admin: delete their `from_admin` row → 0 rows.
  - teacher: share a copy whose source's shared copy is hidden → refused.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Write the migration (drop "Admins manage every presentation" and "Admins manage editors"; new policies; the guard trigger per Global Constraints; restrictive delete policy replaced; `share_presentation` from its newest definition plus the check). Revoke trigger functions from public/anon/authenticated.
- [ ] **Step 4:** App: `setEditor` — giving needs `isSuperAdmin`, refuses admins/banned (message); `AdminTeachers` hides "Make editor" on admin and banned rows and opens `ConfirmModal` before giving: title "Make <name> an editor?", message "Their published presentations are removed from other teachers' lists, with their bookmarks and reports." `setShared` adds `.eq("owner_id", account.id)` unless super admin and errors when no row changed. `deleteReportedPresentation` refuses unless the presentation is hidden or reported.
- [ ] **Step 5:** Run the test → PASS; `npx tsc --noEmit`, `npm run lint` → clean. Notes updated. Snapshot.

### Task 7: Database fixes — delete, log, drafts, replay, category (spec D5–D8, D10)

**Files:**
- Create: `supabase/migrations/20261210000200_database_fixes.sql`, `supabase/tests/database_fixes.sql`
- Modify: `supabase/migrations/20261122000000_super_admin.sql:14-20`, `supabase/migrations/CLAUDE.md`

**Interfaces:**
- Produces: `check_hidden_copy_delete` skips when `auth.uid() is null` or `pg_trigger_depth() > 1`; the admin-log triggers for hide, presentation delete and shared-photo delete log every row (clear the "already logged" flag per row the way `log_presentation_delete` does); `check_review_draft` also checks tags ≤ 10, grades ≤ 14, `transition` in the table's list, `transition_speed` 1–5; the "From editors" category row can't be renamed or deleted (trigger, error text "This category holds editors' photos, so it can't be renamed or deleted.").

- [ ] **Step 1: Failing test** `database_fixes.sql`: deleting (as postgres, no `auth.uid()`) a teacher in `auth.users` who has a hidden shared copy whose row is older than the original → succeeds; a plain admin hiding 3 presentations in one `update … where id in (…)` → 3 log rows; `save_review_draft` with 11 tags → refused with the draft-check error; renaming "From editors" → refused.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Write the migration (each function from its newest definition). In `20261122000000_super_admin.sql`, wrap the "super admin must exist" raise: when `not exists (select 1 from auth.users)`, `raise notice` and skip.
- [ ] **Step 4:** Run → PASS. Notes: `migrations/CLAUDE.md` gets the new file, the newest-definition pointers (`save_presentation` and `publish_review` → `20261209000000_data_version.sql`, then Task 2's file), and the trigger-revoke wording fixed (security-invoker trigger functions aren't revoked; Postgres refuses calling them directly). Snapshot.

### Task 8: Limits on direct table writes and small speed fixes (spec D9, D11, D12)

**Files:**
- Create: `supabase/migrations/20261210000300_direct_write_limits.sql`, `supabase/tests/direct_write_limits.sql`
- Modify: `supabase/migrations/CLAUDE.md`

**Interfaces:**
- Produces: triggers on direct writes (`current_user = 'authenticated'`): `photos` insert → `count_write`, ban check, the same per-teacher row cap the app uses (find it in `src/lib/constants.ts` / the photos code; if none exists, stop and ask); `slides` insert → refused past 100 per presentation; `presentation_reports`, `user_settings`, `folder_items` insert/update → ban check; `check_folder_limit` takes `pg_advisory_xact_lock` on the user before counting. `admin_actions` select policy wraps `(select public.is_super_admin())`; `create index on public.admin_actions (target_id)`. `revoke execute … from anon` on `search_shared_photos`, `grades_from`, `profile_slug`, `tags_text`, `slide_photo_srcs` (first grep the app for anon callers; keep any that a logged-out page needs).

- [ ] **Step 1: Failing test**: a teacher inserting a 101st slide directly → refused; a banned teacher inserting a report → refused; anon calling `slide_photo_srcs` → permission denied.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Write the migration. **Step 4:** Run → PASS; notes; snapshot.

### Task 9: Throwaway emails refused by the database (spec D13)

**Files:**
- Create: `supabase/migrations/20261210000400_blocked_email_domains.sql`, `supabase/tests/blocked_email_domains.sql`
- Modify: the signup page (`src/app/signup/page.tsx`) and `src/lib/userSettings.ts:~84`; Delete: `src/lib/blockedEmailDomains.ts` (after moving its list into the migration's seed)
- Modify: `src/lib/CLAUDE.md`, `src/app/CLAUDE.md`, the Safety page text if it names the list's place

**Interfaces:**
- Produces: table `public.blocked_email_domains (domain text primary key)` readable by anon and authenticated; the newest `hook_before_user_created` also refuses an email whose domain is in it (same message the page shows). In the app, the signup schema becomes a function `signUpSchema(blockedDomains: string[])` (or the check takes the list) and the signup page reads the table on the server.

- [ ] **Step 1: Failing test**: calling the hook function with a payload whose email is on the list → returns the refusal; a normal domain → allowed.
- [ ] **Step 2–4:** Run → FAIL; write; run → PASS. `npx tsc --noEmit`, lint clean. Notes. Snapshot.

### Task 10: Claude connection and Claude photos (spec E1–E3)

**Files:**
- Create: `src/app/oauth/consent/allowedApps.ts`, `src/app/oauth/consent/allowedApps.test.ts`
- Modify: `src/app/oauth/consent/page.tsx`, `src/app/oauth/consent/actions.ts`, `src/pages/api/mcp.ts:~319-347`, `src/app/api/claude-photo/route.ts:~55-93`, `src/app/api/CLAUDE.md`, `src/pages/api/CLAUDE.md`

**Interfaces:**
- Produces: `isAllowedRedirect(url: string): boolean` — true only for `https:` URLs whose host is exactly `claude.ai` or `claude.com` (constant `ALLOWED_REDIRECT_HOSTS`).

- [ ] **Step 1: Failing test**: true for `https://claude.ai/api/mcp/auth_callback` and `https://claude.com/api/mcp/auth_callback`; false for `http://claude.ai/x`, `https://claude.ai.evil.com/x`, `https://evil.example/cb`, `not a url`.
- [ ] **Step 2:** `npm test` → FAIL. Implement → PASS.
- [ ] **Step 3:** Consent page shows "It will send you back to <host>." (read the redirect field the supabase-js `getAuthorizationDetails` type really has); when not allowed, Allow is replaced by the message "This app isn't Claude, so it can't connect to QuizMatter." `answerConsent` fetches the details again and refuses the same way before approving.
- [ ] **Step 4:** `checkLogin`: if the `is_banned` call errors, return null. Move its doc comment above it (spec I).
- [ ] **Step 5:** `claude-photo`: when `existing` isn't public and the ticket owner isn't the super admin → 409 with upload-image's message; before saving, check (admin client) the ticket owner is still in `admins` and not in `banned_users`, else 403.
- [ ] **Step 6:** Notes rows updated; `npx tsc --noEmit`, lint clean. Snapshot.

### Task 11: Claude's drafts are checked like saves (spec E4)

**Files:**
- Modify: `src/lib/schema.ts` (new helper), `src/lib/importPresentation.ts` (`buildSlides`), `src/lib/schema.test.ts`, `src/pages/api/CLAUDE.md`

**Interfaces:**
- Produces: `slideProblems(slides: unknown[]): string[]` in `schema.ts` — one plain message per failing slide, e.g. `Slide 3: the question is too long (at most 5000 characters).` (use the zod issue path and message). `buildSlides` returns `{ errors }` when it is non-empty.

- [ ] **Step 1: Failing test**: a slide whose question is 5,001 characters → one message starting `Slide 1:`; a valid blank slide → `[]`.
- [ ] **Step 2–3:** Implement; `npm test` → PASS; tsc clean. Notes line. Snapshot.

### Task 12: Login check and email links (spec F1, F2)

**Files:**
- Modify: `src/proxy.ts:~47`, `src/app/auth/confirm/route.ts`, `src/app/CLAUDE.md`

- [ ] **Step 1:** Proxy matcher: skip only `_next/static`, `_next/image`, the favicon/icon files and paths under the public folder's real files — not any path ending in `.png` etc. (read `node_modules/next/dist/docs` for the proxy `matcher` rules first).
- [ ] **Step 2:** `auth/confirm`: parse `type` with `z.enum([...the types the app's emails use])`; if a user is already logged in, redirect home without verifying.
- [ ] **Step 3: Check** (logged-out fetch from a `127.0.0.1:3000` tab, as in the review): `/teachers/x.png` and `/presentation/<id>.png` now redirect to login; `/icon.svg` still loads. tsc/lint clean. Notes. Snapshot.

### Task 13: Home pages read only what they show (spec F3)

**Files:**
- Modify: `src/app/(home)/cards.ts:~236`, `src/app/(home)/liked/page.tsx`, `src/app/(home)/quizmatter/page.tsx`, `src/app/(home)/quizmatter/QuizMatterPresentations.tsx` (if its props change), `src/app/CLAUDE.md`

- [ ] **Step 1:** `loadCardContext` reads likes with `.in("presentation_id", <shown ids>)`.
- [ ] **Step 2:** Liked tab pages like Other teachers (`PAGE_SIZE`, `ShowMore`).
- [ ] **Step 3:** From QuizMatter: per subject, fetch the 5 shown (+ the exact count for "See all") instead of every presentation.
- [ ] **Step 4:** Browser check as admin: From QuizMatter shows the same rows and counts as before. tsc/lint clean. Notes. Snapshot.

### Task 14: Errors, toasts and loading (spec F4–F6)

**Files:**
- Create: `src/app/error.tsx`, `src/app/presentations/loading.tsx`
- Modify: `src/app/presentation/[id]/LikeButton.tsx`, `src/app/LikeCardButton.tsx`, `src/app/SaveCardButton.tsx`, `src/app/(home)/layout.tsx:~87`, `src/app/PresentationCardMenu.tsx:72,88`, `src/app/presentations/PresentationList.tsx:95,251`, `src/components/editor/Editor.tsx:~106`, `src/app/presentation/new/page.tsx:46`, `src/app/admin/data-check/DataCheckList.tsx:89`, `src/app/CLAUDE.md`

- [ ] **Step 1:** `error.tsx` (client): a design-system card "Something went wrong" + a "Try again" main button (`reset()`) + a link home with `LinkPending`.
- [ ] **Step 2:** Like/save buttons: `try/finally` around the action; a thrown error → `toast.error("Couldn't change it. Please try again.")` and the spinner stops. Home layout: a failed count logs and shows 0 instead of throwing.
- [ ] **Step 3:** Every `alert()` above → `toast.error(...)`; Claude draft errors in `Editor.tsx` → the `Modal` with the error list. Deleting shows `toast.success("Presentation deleted.")` (match the existing wording if one exists).
- [ ] **Step 4:** `presentations/loading.tsx` like `(home)/loading.tsx`; `LinkPending` in the two links.
- [ ] **Step 5:** `grep -rn "alert(" src --include=*.tsx --include=*.ts` → none left. tsc/lint clean. Notes. Snapshot.

### Task 15: Ctrl+V and Ctrl+Z inside text fields (spec G1, G2)

**Files:**
- Modify: `src/lib/dom.ts`, `src/lib/useEditorShortcuts.ts:40-65`, `src/components/editor/CLAUDE.md`
- Create: `src/lib/dom.test.ts`

**Interfaces:**
- Produces: `isTextFieldOrDialog(target: EventTarget | null): boolean` in `dom.ts` — `isTypingTarget(target)` or the target is inside `[role="dialog"]`.

- [ ] **Step 1: Failing test** with plain fake elements (`{ tagName, isContentEditable, closest }`): INPUT → true; a DIV inside a dialog (`closest('[role="dialog"]')` returns an object) → true; a plain DIV → false; null → false.
- [ ] **Step 2:** Implement → PASS.
- [ ] **Step 3:** In `useEditorShortcuts`, element paste runs only when `!isTextFieldOrDialog(e.target)`; Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z return early (no `preventDefault`) when `isTypingTarget(e.target)` and the target is an INPUT or TEXTAREA (rich text keeps the store's undo, as today). Update the comment above the paste block.
- [ ] **Step 4: Manual check:** copy an element, then paste a link into the embed slide's link box and into the Details title → the text pastes; Ctrl+Z in a search box undoes typing only. tsc/lint clean. Notes. Snapshot.

### Task 16: Slide colors only take colors (spec G3)

**Files:**
- Modify: `src/lib/schema.ts:61` (`colorSchema`) and `upgradeSlide`, `src/lib/slideBackground.ts`, `src/components/presentation/SlideStaticView.tsx:48-65`, `src/components/editor/ElementSvg.tsx:20-22`, `src/lib/CLAUDE.md`
- Modify: `src/lib/schema.test.ts`

**Interfaces:**
- Produces: `isSafeColor(value: string): boolean` in `schema.ts` — a hex color (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`), `rgb(...)`/`rgba(...)` with only numbers, commas, dots, spaces and `%`, `transparent`, `DIAGRAM_NONE`, or `GRADIENT_PREFIX` / `MESH_PREFIX` / `RADIAL_PREFIX` followed by such colors separated by commas. First grep every writer of these fields (`color`, `borderColor`, `shapeBoxFill`, `shapeBoxBorder`, `background`) and add any other format they write.

- [ ] **Step 1: Failing tests**: `isSafeColor` true for `#6B3DF5`, `gradient:#fff,#000`, `radial:#F0FFF7,#F0A3E9,#D3BFFF`, `rgba(0,0,0,0.35)`, `none`; false for `gradient:#fff,#fff), url(https://x.example/a.png` and `url(x)`. `upgradeSlide` replaces an unsafe `background` with no background (field removed) and an unsafe element `color` with the default text color.
- [ ] **Step 2:** Implement: `colorSchema` refines with `isSafeColor`; `upgradeSlide` cleans unsafe values; `slideBackgroundCss` / `toCssBackground` return the plain color fallback when `!isSafeColor`.
- [ ] **Step 3:** `npm test` → PASS; tsc/lint clean.
- [ ] **Step 4: Data check:** Admin → Data check → "All N presentations and review drafts can be opened." (N = the number before, 21 on 2026-10-24.) Notes. Snapshot.

### Task 17: Design tokens and the dev counter (spec G4, I; editor notes J)

**Files:**
- Modify: `src/components/editor/EmbedSlide.tsx:43`, `src/components/editor/SlideToolbar.tsx:66,154`, `src/components/editor/Workspace.tsx:318`, `src/components/editor/ElementContextMenu.tsx:60`, `src/components/presentation/PresentationView.tsx:249`, `src/components/editor/AnswerArea.tsx:78`, `src/components/editor/ArrangePanel.tsx:133`, `src/components/DevRequestCounter.tsx`, `src/app/globals.css` and `CLAUDE.md` design section (only if a new token is truly needed), `src/components/editor/CLAUDE.md:33`, `src/components/editor/PhotosPanel.tsx:26`

- [ ] **Step 1:** `bg-[#111111]` → `bg-text-primary` (ink) unless the embed needs true black — then add `--bg-embed` to `globals.css` + CLAUDE.md. Shadows: remove (design system: almost none); if a floating menu needs one to be visible, add one `--shadow-float` token and use it everywhere. `rounded-[6px]` → `rounded-dropdown`.
- [ ] **Step 2:** Dev counter: its `z-index` below the account menu's (or it starts lower on the page) so the menu covers it.
- [ ] **Step 3:** Fix the stale editor note (no link box) and the `PhotosPanel` comment (one file at a time).
- [ ] **Step 4:** `grep -rnE "\[#[0-9a-fA-F]{3,8}\]|rounded-\[|shadow-\[" src/components src/app` → only slide-content colors are left. Visual check of the editor top bar, slide toolbar and context menu. tsc/lint clean. Snapshot.

### Task 18: Admin actions and pages (spec H1, H4, H5, H8, H9, H10)

**Files:**
- Modify: `src/app/admin/photos/AdminPhotos.tsx:~759-769,1026-1031`, `src/app/admin/teachers/actions.ts:29-40`, `src/app/admin/reports/actions.ts:29-37` (+ its caller to pass the newest shown time), `src/app/admin/safety/page.tsx:70-71`, `src/app/admin/activity/page.tsx:~104`, `src/app/admin/data-check/` (page + `DataCheckList.tsx`), `src/app/admin/CLAUDE.md`

- [ ] **Step 1:** Photo ✕ opens `ConfirmModal` ("Remove this photo from the library?" / "Teachers can't add it to slides anymore. It stays on slides that already use it."); on failure the photo goes back at its old index.
- [ ] **Step 2:** Ban: read whether a `banned_users` row existed before the upsert; roll back only when it didn't; a ban by hand sets `is_automatic = false`.
- [ ] **Step 3:** Dismiss: the client passes the newest `created_at` it shows; the action deletes reports `<=` it (zod: ISO date string).
- [ ] **Step 4:** Safety text: "Plain admins follow the speed limits too; only the super admin skips them." Admin log filter: `next/form` `Form`.
- [ ] **Step 5:** Data check: the button and action work only when `process.env.NODE_ENV === "development"`; otherwise the page says "Run this on your computer (npm run dev)." A review-draft row links to `/admin/presentations/reviews/<id>` (check the real route) with `LinkPending`.
- [ ] **Step 6:** Browser check as admin: each page loads; tsc/lint clean. Notes (Library list includes Data check). Snapshot.

### Task 19: Admin reads and Overview counts (spec H6, H7)

**Files:**
- Create: `supabase/migrations/20261210000500_admin_overview_counts.sql`
- Modify: `src/app/admin/editors/page.tsx:25-47`, `src/app/admin/editors/[id]/page.tsx:56-61`, `src/app/admin/teachers/page.tsx:28-36`, `src/app/admin/page.tsx`, `src/app/admin/layout.tsx`, `src/app/admin/AdminMenu.tsx`, `src/app/admin/presentations/page.tsx`, `src/app/admin/OverviewCharts.tsx` (texts), `src/app/admin/CLAUDE.md`

- [ ] **Step 1:** Editors page: user settings `.in("user_id", editorIds)`, counts with `{ count: "exact", head: true }` per editor (or one rpc), emails with `auth.admin.getUserById` per editor instead of listing every account. Teachers page: read user settings in chunks of ≤ 1,000 ids (or paged), never one capped read.
- [ ] **Step 2:** Editor page photos: look up shared-photo details by the editor's id (`uploaded_by` / `photos.user_id`), not a long `.in("src", …)`.
- [ ] **Step 3:** Overview migration: "Reviews submitted" counts a round once it was submitted, even after a send-back (keep a first-submitted date, or read `activity_events` if it records submits — check first); charts that count only rows that still exist say so in their caption. `admin_todo_counts` is wrapped in React `cache` and called once per request. The menu's "Under review" and the Presentations page's "Under review (N)" count the same rounds (the ones waiting for an admin).
- [ ] **Step 4:** Browser check: Overview, Editors, Teachers, an editor page show the same numbers as before (except the fixed ones). tsc/lint clean. Notes. Snapshot.

### Task 20: Cleanups, notes sweep, final checks

**Files:**
- Modify: `src/lib/search.ts:40-48`, `src/lib/sharing.ts:15`, `src/lib/CLAUDE.md` (`PRESENTATION_COLUMNS`, `rowToPresentationInput`, likes in `fetchPresentation`, `refusalFromCode`), `src/app/CLAUDE.md` (only the super admin gets Move to QuizMatter), `CLAUDE.md` (review migrations list + `20261209000000_data_version.sql` and this plan's files; Tests section)

- [ ] **Step 1:** Move `contains`'s doc comment; `sharing.ts` uses `refusalFromCode`.
- [ ] **Step 2:** Notes sweep: read each CLAUDE.md touched by this plan against the code; fix anything untrue.
- [ ] **Step 3: All database tests again:** `npx -y supabase@latest db reset`, then every file in `supabase/tests/` (Task 1 Step 5) → no `FAIL`.
- [ ] **Step 4:** `npm test`, `npx tsc --noEmit`, `npm run lint` → all clean. `git diff` read against the spec, section by section.
- [ ] **Step 5:** Tell the user what passed or failed, then ask: (a) apply the 6 new migrations to the live database? (b) commit to main (list the files)? (c) log in as the teacher and editor at `http://127.0.0.1:3000` (after `npx wrangler login` and a dev-server restart) for the browser checks in Tasks 4 and 15.
