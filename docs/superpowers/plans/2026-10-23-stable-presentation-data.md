# Stable Presentation Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Old editor tabs can't save over data written by newer code (their work is kept and given back after a
reload), every read upgrades old data shapes in one place, and a super-admin page lists saved data the code can't read.

**Architecture:** A `data_version` on each presentation (and each review draft), checked by `save_presentation`,
`save_review_draft` and `submit_review` against the app's `DATA_VERSION` (refusal code `QMOLD`). On `QMOLD` the
editor keeps its unsaved presentation in `localStorage` and asks for a reload; after the reload it restores it.
`upgradePresentation` / `upgradeSlide` run inside the zod schemas (`z.preprocess`), so every parse upgrades.

**Tech Stack:** Next.js (this repo's version, see `node_modules/next/dist/docs/`), zustand, zod, Supabase
(Postgres functions), sonner, Tailwind with the QuizMatter design system.

**Spec:** `docs/superpowers/specs/2026-10-23-stable-presentation-data-design.md`

## Global Constraints

- `DATA_VERSION = 0` to start. Tabs from before this change count as version 0, so this change refuses nobody.
- New refusal code: `QMOLD`. Message: "QuizMatter was updated. Reload the page to keep editing."
- Version check runs **before** the `QM409` conflict check.
- Kept copy key: `qm-unsaved:<presentation id>`; every `localStorage` read/write in try/catch.
- Restore toast: "Your changes from before the update are back. Save to keep them."
- Modal: title "QuizMatter was updated", message "Reload to keep editing. Your changes are safe.", confirm "Reload".
- Migration file: `supabase/migrations/20261209000000_data_version.sql`. Each changed function starts from its
  **newest** version (paths below) and is commented "same as before (<file>), plus …".
- Root `CLAUDE.md` rules: zod before saving, `ConfirmModal`, the one `Spinner`, design-system classes, notes updated.
- No new packages. No test framework (spec non-goal): verification is `npx tsc --noEmit`, `npm run lint`, a
  rolled-back SQL test, and a browser check.
- Commits: the user wants to be **asked before every commit to `main`**. Don't commit without asking.

## Review Focus

- A version-0 tab saving a presentation no newer code touched must still save (no refusal). → SQL test, Task 1.
- `localStorage` blocked (private window, full storage): the refusal still shows the modal, nothing crashes. → Task 4 step.
- A kept copy that fails to parse even after upgrading: the editor opens normally and the key is left. → Task 4 step.
- A kept review draft must not restore into the owner's editor, and the reverse. → Task 4 step.
- The data check on all presentations must not load everything in one request. → Task 5 (pages of 50).

---

### Task 1: Database: `data_version` and the `QMOLD` check

**Files:**
- Create: `supabase/migrations/20261209000000_data_version.sql`
- Modify: `supabase/migrations/CLAUDE.md` (refusal codes list + a "Data version" line under "Where the big features live")

**Interfaces:**
- Produces: `save_presentation(presentation jsonb, slide_ids text[], base_updated_at bigint, app_version int default 0)`,
  `save_review_draft(target_id text, review_draft jsonb, base_updated_at bigint, app_version int default 0)`,
  `submit_review(target_id text, review_draft jsonb, reviewed_on date, base_updated_at bigint, app_version int default 0)`.
  Refusal errcode `QMOLD`.

- [ ] **Step 1: Columns**

```sql
alter table public.presentations add column data_version int not null default 0;
alter table public.presentation_reviews add column draft_version int not null default 0;
```

- [ ] **Step 2: `save_presentation`** (newest: `20261201000000_editor_author_and_copy_source.sql` §3)

`drop function public.save_presentation(jsonb, text[], bigint);` then create it with the extra
`app_version int default 0`, body copied, plus:
- read `p.data_version` together with `p.updated_at` in the `for update` select;
- right after it, before the `QM409` check: `if found and app_version < saved_version then raise exception 'QuizMatter was updated. Reload the page.' using errcode = 'QMOLD'; end if;`
- insert `data_version` = `app_version`; on conflict `data_version = greatest(public.presentations.data_version, excluded.data_version)`.
Re-apply the same `revoke` / `grant execute` lines the original had, with the new argument list.

- [ ] **Step 3: `save_review_draft` and `submit_review`** (newest: `20261019000000_presentation_reviews.sql` §save_review_draft;
`20261102000000_review_auto_reviewer.sql` §submit_review)

Same pattern: drop, recreate with `app_version int default 0`; before their `QM409`-style check refuse with `QMOLD`
when `app_version < r.draft_version`; when writing `draft`, set `draft_version = greatest(draft_version, app_version)`.
Same grants with the new argument lists.

- [ ] **Step 4: Copies carry the version**

- `start_review` (newest `20261202000000_author_updates.sql`): where it fills `draft` from the presentation, also set
  `draft_version = p.data_version`.
- `publish_review` (newest `20261202000000_author_updates.sql`): when it writes the draft into the presentation, also
  `data_version = greatest(data_version, r.draft_version)`.
- `approve_submission` (newest `20261201000000_editor_author_and_copy_source.sql` §4): add `data_version` to the
  insert column list and `p.data_version` to its select.
- `share_presentation`: not changed (a shared copy is only ever written by `share_presentation`, never by an editor tab).

- [ ] **Step 5: Notes** — `supabase/migrations/CLAUDE.md`: add `QMOLD` ("saved by an older app version than the
  presentation's `data_version`; the app keeps the work and asks for a reload") to the refusal codes, and a "Data
  version" bullet naming this file and the functions above.

- [ ] **Step 6: Rolled-back SQL test** (the user runs it in the Supabase SQL editor, or Claude with `execute_sql` permission)

A `do $t$ … $t$` block that ends in `raise exception 'TEST RESULT (rolled back): %', r;`, using a fake
`auth.users` row as owner and `set_config('request.jwt.claims', json_build_object('sub', <id>)::text, true)` so
`auth.uid()` works. It must report:
- save with `app_version` 0 on a new presentation → ok, `data_version` 0;
- save again with 0 → ok (**no refusal when nothing newer saved**);
- save with 1 → ok, `data_version` 1;
- save with 0 → refused `QMOLD`, even with the right `base_updated_at`;
- save with 0 and a wrong `base_updated_at` → `QMOLD` (version check comes first).
Expected: all five as listed.

- [ ] **Step 7: Apply** the migration (the user, in the SQL editor, or Claude with permission).

### Task 2: One upgrade step and `DATA_VERSION`

**Files:**
- Modify: `src/lib/schema.ts` (around `slideSchema` line 354, `withGrades` line 532, `presentationSchema` line 586)
- Modify: `src/lib/CLAUDE.md` (new section "Changing the saved shape")
- Modify: `CLAUDE.md` (one line under "Saving Data" pointing to that section)

**Interfaces:**
- Produces: `export const DATA_VERSION = 0;` `export function upgradeSlide(data: unknown): unknown`,
  `export function upgradePresentation(data: unknown): unknown`. `slideSchema` and `presentationSchema` keep their
  names and types (`Slide`, `Presentation` unchanged).

- [ ] **Step 1:** Add `DATA_VERSION` with a comment: bump when the saved shape changes; see `src/lib/CLAUDE.md`.
- [ ] **Step 2:** `upgradeSlide`: returns the data unchanged for now, with a comment saying each future step goes
  here (recognise the old shape by looking at it, one line per step saying what and from when). Wrap:
  `slideSchema = z.preprocess(upgradeSlide, <today's object>)`. Keep `withGrades` exported (`drafts.ts` uses it).
- [ ] **Step 3:** `upgradePresentation`: `withGrades`, then fill missing `term` / `week` / `day` with `""`. Use it as
  the `presentationSchema` preprocess and drop the three `.default("")` (same behavior, one place).
- [ ] **Step 4:** `npx tsc --noEmit` and `npm run lint` → no errors. If `z.preprocess` changes the inferred
  `Slide` type to `unknown` input anywhere, fix the caller's type, not the schema.
- [ ] **Step 5:** Write the rules section in `src/lib/CLAUDE.md` (the five rules from the spec §5) and the pointer
  line in root `CLAUDE.md`.

### Task 3: Send the version; `QMOLD` refusal in the app

**Files:**
- Modify: `src/lib/presentations.ts` (`SaveRefusedError`, `REFUSALS`, `savePresentationToDb` lines 87-95)
- Modify: `src/lib/reviews.ts` (`throwIfRefused`, `saveReviewDraft`, `submitReview`)

**Interfaces:**
- Consumes: `DATA_VERSION` (Task 2); the rpc argument `app_version` (Task 1).
- Produces: `SaveRefusedError` gets a third constructor parameter `readonly isOutdated = false`, true for `QMOLD`.
  `REFUSALS.QMOLD = "QuizMatter was updated. Reload the page to keep editing."`

- [ ] **Step 1:** Add `QMOLD` to `REFUSALS`; pass `error.code === "QMOLD"` as `isOutdated` in both refusal spots
  (`savePresentationToDb` and `throwIfRefused`).
- [ ] **Step 2:** Send `app_version: DATA_VERSION` in the `save_presentation`, `save_review_draft` and
  `submit_review` rpc calls.
- [ ] **Step 3:** `npx tsc --noEmit`, `npm run lint` → clean. Browser: open a presentation, edit, Save → "Presentation
  saved." (works against the Task 1 database).

### Task 4: Keep the work and give it back

**Files:**
- Create: `src/lib/keptWork.ts`
- Modify: `src/lib/store.ts` (state type near line 261; `savePresentation` catch lines 577-591; new action)
- Modify: `src/components/editor/Editor.tsx` (load effect lines 89-105; beforeunload effect lines 108-113; render the modal)
- Modify: `src/components/editor/CLAUDE.md` (a short "Kept work after an update" section)

**Interfaces:**
- Consumes: `SaveRefusedError.isOutdated` (Task 3), `presentationSchema` (Task 2).
- Produces:
  - `keepUnsavedWork(work: { presentation: Presentation; baseUpdatedAt: number | null; isReview: boolean }): void`
  - `takeKeptWork(id: string, isReview: boolean): { presentation: Presentation; baseUpdatedAt: number | null } | null`
  - store: `isOutdated: boolean`, `setOutdated(value: boolean): void`, `restoreKeptWork(): void`

- [ ] **Step 1: `keptWork.ts`.** `keepUnsavedWork` writes `{ presentation, baseUpdatedAt, isReview, keptAt: Date.now() }`
  as JSON under `qm-unsaved:<id>`; any storage error is caught and logged. `takeKeptWork` reads the key; returns null
  if missing, if `isReview` differs (key left alone), or if `presentationSchema.safeParse` fails (key left alone,
  `console.error`); on success removes the key and returns the parsed presentation and `baseUpdatedAt`.
- [ ] **Step 2: Store.** In `savePresentation`'s catch, before the toast: if
  `error instanceof SaveRefusedError && error.isOutdated`, call `keepUnsavedWork({ presentation, baseUpdatedAt: savedAt, isReview: !!review })`,
  set `isOutdated: true`, skip the toast, set `saveStatus: "error"` (if still open), return false.
  `restoreKeptWork()`: `takeKeptWork(state.presentation.id, !!state.review)`; if found, without history:
  `set({ presentation: kept.presentation, savedAt: kept.baseUpdatedAt })` (keep `savedPresentation` as loaded, so it
  counts as unsaved), select its first slide, and `toast.success("Your changes from before the update are back. Save to keep them.")`.
  `loadPresentation` resets `isOutdated: false`.
- [ ] **Step 3: Editor.** In the load effect, after `useEditorStore.setState({ review: … })` and only when
  `draft === undefined`, call `store.restoreKeptWork()`. The beforeunload effect skips when `isOutdated` (so Reload
  isn't blocked). Render `ConfirmModal` when `isOutdated`: title/message/confirm from Global Constraints;
  `onConfirm` → `window.location.reload()`; `onCancel` → `setOutdated(false)` (they can keep looking; Save refuses
  again and re-keeps the latest work). *(My call: ConfirmModal always has Cancel; reusing it beats a second modal.)*
- [ ] **Step 4: Check by hand** (make one test presentation "newer" than the app: in the SQL editor run
  `update presentations set data_version = 1 where id = '<a test presentation>';`):
  - edit + Save → the modal shows; `localStorage` has `qm-unsaved:<id>`;
  - Reload → the edit is back, toast shows, key is gone, Save → "Presentation saved." (set `data_version` back to 0 first);
  - in a private window with storage blocked (DevTools → Application → block), Save → the modal still shows, no crash;
  - put `"broken"` in the key by hand, reload → editor opens normally, key still there;
  - a key with `isReview: true` doesn't restore in the owner's editor.
- [ ] **Step 5:** `npx tsc --noEmit`, `npm run lint` → clean. Write the editor notes section.

### Task 5: Admin → Data check

**Files:**
- Create: `src/app/admin/data-check/page.tsx`, `src/app/admin/data-check/DataCheckList.tsx`, `src/app/admin/data-check/actions.ts`
- Modify: `src/app/admin/AdminMenu.tsx` (item `{ href: "/admin/data-check", label: "Data check", superOnly: true }`)
- Modify: `src/app/admin/CLAUDE.md` (a row in "The pages")

**Interfaces:**
- Consumes: `presentationSchema` (Task 2), `createAdminClient` (`src/lib/supabase/admin.ts`), `getAccount().isSuperAdmin`.
- Produces: server action `checkSavedData(): Promise<{ checked: number; problems: { id: string; title: string; owner: string; slide: number | null; message: string; isReviewDraft: boolean }[] } | string>` (string = error message).

- [ ] **Step 1: Page** like `admin/cleanup/page.tsx`: `notFound()` unless super admin; a card explaining "Run before a
  deploy: `npm run dev`, open this page, fix `upgradeSlide` / `upgradePresentation` until nothing is listed."
- [ ] **Step 2: Action** `checkSavedData`: refuse unless `isSuperAdmin`. With the secret-key client, read
  `presentations` with the same columns as `loadPresentation` plus `slides(data, position)`, ordered by id, **50 per
  page** until done; parse each like `loadPresentation` does (same field mapping — extract that mapping from
  `loadPresentation` into an exported `rowToPresentationInput(row)` in `fetchPresentation.ts` and use it in both)
  with `safeParse`. Then `presentation_reviews` rows with a non-null `draft`, parsed with `presentationSchema.safeParse`.
  For a failure: `slide` = the slide index from the first issue's path (`["slides", n, …]` → `n + 1`), else null;
  `message` = first issue's message + path. Owner = email (from `auth.admin.getUserById`, cached per owner) or "—".
- [ ] **Step 3: `DataCheckList`** (client): a main button "Check saved data" (`btn-press` style), the `Spinner` while
  it runs, then either "All N presentations and review drafts can be read." (success-soft pill) or a table of
  problems (title links to `/presentation/<id>`), plus a sonner toast on error.
- [ ] **Step 4:** `npx tsc --noEmit`, `npm run lint` → clean. Browser (`npm run dev`, logged in as super admin):
  the menu shows Data check; Check → "All … can be read." Plain admin → page not found.

### Task 6: Final check and commit

- [ ] **Step 1:** `npx tsc --noEmit` and `npm run lint` → no errors in changed files.
- [ ] **Step 2:** `git diff` next to the spec: every section done, nothing extra, notes in `src/lib/CLAUDE.md`,
  `src/components/editor/CLAUDE.md`, `src/app/admin/CLAUDE.md`, `supabase/migrations/CLAUDE.md`, root `CLAUDE.md`
  match the code. Update the spec's Status to "built", and its "My calls" with: kept copies aren't tied to a user id
  (only the owner or reviewer can save that presentation anyway); `share_presentation` unchanged; the modal has Cancel.
- [ ] **Step 3:** Ask the user before committing to `main`. Then commit only this feature's files (not the
  uncommitted likes work unless the user says so).
