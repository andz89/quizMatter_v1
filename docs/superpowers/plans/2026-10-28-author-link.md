# Author Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an editor changes their display name, the Author on their own presentations and on their QuizMatter
lessons changes too.

**Architecture:** A new `presentations.author_id` (the editor's account) links a presentation to its author. Only
the database sets it. While it's set, a trigger always writes that editor's current name into the `author` text,
and `set_display_name` rewrites `author` on every linked presentation in the same step as the name change. Cards,
search (`search_text`), admin pages and Claude keep reading the saved `author` text, so they need no change. The
editor's Details box locks the Author for admins too when the presentation is linked.

**Tech Stack:** Postgres (Supabase migrations, plpgsql triggers), Next.js app (server page → `Editor` → zustand store).

**Spec:** No separate spec file: the design was approved in chat on 2026-10-28. It is summed up here:

- `author_id` is set on an editor's own presentations (on every save, while they're an editor) and on the
  QuizMatter lesson made from their submission (on approval). Teachers' presentations and copies leave it empty;
  their Author stays free text.
- Nobody can set or change `author_id` with a direct write through the API. Only the database's own steps set it.
- While `author_id` is set, `author` is always that editor's current name (display name, or the part of the email
  before "@"; `editor_author()`), whatever is sent.
- `set_display_name` updates `author` on every presentation with `author_id` = me, in the same step. The review
  lock lets that one change through. It doesn't change `updated_at`, so an open tab gets no `QM409`.
- The editor role taken away: their own presentations lose the link on their next save, and the box opens again.
  Their QuizMatter lessons keep it.
- Account deleted: `author_id` becomes empty (`on delete set null`), and the last name stays as plain text.
- The rename counts as one presentation save for the click limit (the existing `count_presentation_write`).
- The app: an admin opening a linked lesson sees the Author as locked text (like the editor already does).

## Global Constraints

- The new migration is `supabase/migrations/20261216000000_author_link.sql`. Follow `supabase/migrations/CLAUDE.md`:
  a plain-English comment at the top, `set search_path = ''`, full names (`public.presentations`).
- Start every replaced function from its newest version: `set_editor_author` and `editor_author` in
  `20261201000000_editor_author_and_copy_source.sql`, `set_display_name` in `20261122000000_super_admin.sql`,
  `approve_submission` in `20261209000000_data_version.sql`, `check_presentation_review_lock` in
  `20261118000000_presentation_term.sql`. Keep everything else in them as it is.
- Author limit: 120 (`DETAIL_MAX_LENGTH.author` in `src/lib/schema.ts`). `editor_author()` already cuts to it.
- No `DATA_VERSION` bump: `author_id` is a column only, never part of the `Presentation` zod shape or the saved JSON.
- SQL tests run only on the local Docker database (`npx -y supabase@latest db reset`, then `docker exec -i
  supabase_db_quizBuilder psql …`). Start Docker Desktop first if it's off.
- The working tree has unrelated uncommitted work (profile photos, profile privacy). Commit only this plan's files,
  and **ask the user before every commit** (work goes to `main`).
- Notes stay true: update the `CLAUDE.md` notes in the same commit as the code they describe.

## Review Focus

1. A rename while the editor's lesson is under review (locked, `QMREV`): the new name must still land. Test in Task 1.
2. Deleting the editor's account while their lesson is under review: the delete must not be refused by the lock
   (the `on delete set null` changes `author_id` on a locked row). Test in Task 1 (`account_delete.sql`).
3. An editor tab opened before the rename saves afterwards with the old Author: no `QM409`, and the Author stays the
   new name. Test in Task 1.
4. A teacher writing `author_id` straight through the API (insert or update) to pose as an editor: it's ignored.
   Test in Task 1.
5. The editor role taken away: their own presentation unlinks on its next save and keeps the typed Author; their
   lesson stays linked. Test in Task 1.

---

### Task 1: The database link (migration + SQL tests + database notes)

**Files:**
- Create: `supabase/migrations/20261216000000_author_link.sql`
- Create: `supabase/tests/author_link.sql`
- Modify: `supabase/tests/account_delete.sql` (Review Focus 2)
- Modify: `supabase/migrations/CLAUDE.md` (the "Editors' Author" bullet under "Where the big features live")
- Modify: `CLAUDE.md` (root, "Submit to QuizMatter", the "Editors' Author and 'Copied from'" bullet)

**Interfaces:**
- Produces: column `public.presentations.author_id uuid null references auth.users (id) on delete set null`.
  Task 2 reads it by name.

- [ ] **Step 1: Write the failing test `supabase/tests/author_link.sql`**

Same frame as `supabase/tests/profile_privacy.sql` (header saying how to run it, `begin;` … `rollback;`, setup as
postgres, `set local role authenticated` + `request.jwt.claims` to act as someone, each check a `do $$ … raise
exception 'FAIL: …' $$`). Call `save_presentation` the way `supabase/tests/data_version_cap.sql:23` does.

Setup: e1 editor ("Al Editor", `al-editor@example.com`), t1 teacher, a1 super admin, a2 a second editor (the
reviewer). Checks, in this order:

1. As e1, `save_presentation` a new presentation `test-al-own` sending `author` = `'Someone else'`
   → `author_id = e1`, `author = 'Al Editor'`.
2. As t1, `save_presentation` `test-al-t1` with `author` = `'A book'` → `author_id is null`, `author = 'A book'`.
3. As t1, a direct `insert into public.presentations (id, owner_id, title, author_id)` with `author_id = e1`
   → the row's `author_id is null`. Then a direct `update … set author_id = e1` on `test-al-t1` → still null.
4. As e1, a direct `update public.presentations set author_id = t1, author = 'X' where id = 'test-al-own'`
   → `author_id = e1`, `author = 'Al Editor'`.
5. As postgres, insert a `presentation_submissions` row (`presentation_id, submitter_id, status, title`, like
   `account_delete.sql:42`) for `test-al-own` with status `'submitted'`; as a1, `approve_submission` it. The copy
   (`copy_id`) → `from_admin`, `author_id = e1`, `author = 'Al Editor'`.
6. As a1, `save_presentation` the copy (its current `updated_at` as `base_updated_at`) sending `author` =
   `'Admin typed'` → `author = 'Al Editor'`, `author_id = e1`.
7. Lock the copy: as a2, `start_review` on it (as postgres first, make the round allowed if `start_review` needs it,
   e.g. `set_review_open`; read `20261210000500_admin_overview_counts.sql`). Remember the copy's `updated_at` and
   `test-al-own`'s `updated_at`.
8. As e1, `set_display_name('Al Renamed')` returns `{"status": "saved"}` → both `test-al-own` and the copy have
   `author = 'Al Renamed'`, and both `updated_at` are unchanged (Review Focus 1 and 3).
9. While the copy is still locked, as a1 a direct `update public.presentations set author = 'Y'` on it → refused
   with `QMREV` (the lock exception is only for the rename). Catch it with `begin … exception when sqlstate 'QMREV'`.
10. As e1, `save_presentation` `test-al-own` with its unchanged `updated_at` (from step 8) sending the old
    `author` = `'Al Editor'` → works (no `QM409`), `author = 'Al Renamed'` (Review Focus 3).
11. As postgres, `delete from public.editors where user_id = e1`. As e1, `save_presentation` `test-al-own` sending
    `author` = `'Typed by me'` → `author_id is null`, `author = 'Typed by me'`. The copy still has
    `author_id = e1` (Review Focus 5).

- [ ] **Step 2: Run it and see it fail**

Run: `npx -y supabase@latest db reset`, then
`docker exec -i supabase_db_quizBuilder psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/author_link.sql`
Expected: an `ERROR` that column `author_id` does not exist.

- [ ] **Step 3: Write the migration `supabase/migrations/20261216000000_author_link.sql`**

Sections, each with a short plain-English comment:

1. `alter table public.presentations add column author_id uuid references auth.users (id) on delete set null;`
   plus an index on `author_id` (the rename and the account delete look rows up by it).
2. `public.keep_author_id()`: a new `security invoker` trigger function, `before insert or update on
   public.presentations`, `for each row`. Only when `current_user = 'authenticated'` (a direct write, or
   `save_presentation`): on INSERT `new.author_id := null`, on UPDATE `new.author_id := old.author_id`. Triggers of
   the same kind run in name order, so `keep_author_id` runs before `set_editor_author`.
3. `create or replace function public.set_editor_author()` (same name, so its existing trigger and revoke stay):
   - when `not new.from_admin`: `new.author_id :=` `new.owner_id` if that owner is in `public.editors`, else `null`.
   - then, when `new.author_id is not null`: `new.author := coalesce(public.editor_author(new.author_id), new.author)`.
4. `create or replace function public.approve_submission(target_id text)` from its newest version, with the copy's
   insert also setting `author_id = s.submitter_id`, and `author` from `public.editor_author(s.submitter_id)`
   (the `editor_name` lookup goes; the trigger would fill it anyway, but say it here too).
5. `create or replace function public.check_presentation_review_lock()` from its newest version. Changes:
   `author_id` is always left out of the comparison (only the database changes it, e.g. a deleted account's
   `on delete set null`), and `author` is also left out while `current_setting('quizmatter.renaming_author', true)
   = 'yes'`.
6. `create or replace function public.set_display_name(name text)` from its newest version. After the
   `user_settings` upsert has worked (after its `begin … exception … end` block, before `return 'saved'`):
   `perform set_config('quizmatter.renaming_author', 'yes', true);` then
   `update public.presentations p set author = public.editor_author(me) where p.author_id = me;`
   (it doesn't touch `updated_at`).

- [ ] **Step 4: Run the test and see it pass**

Run: `npx -y supabase@latest db reset`, then
`docker exec -i supabase_db_quizBuilder psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/author_link.sql`
Expected: ends with `ROLLBACK`, no `FAIL`, no `ERROR`.

- [ ] **Step 5: Add Review Focus 2 to `supabase/tests/account_delete.sql`**

After `approve_submission(target_id => 'test-acd-e1')` (as postgres, after `reset role`): lock the approved copy
with a review round whose reviewer stays (the `a1` super admin's account, or add an editor that isn't deleted;
insert the `presentation_reviews` row directly with status `'reviewing'` if `start_review` refuses, filling the
columns the table needs). Before the delete, check the copy has `author_id = a4` and `author = 'Acd Editor'`. After
the delete, check the copy still exists with `author_id is null` and `author = 'Acd Editor'`.

- [ ] **Step 6: Run every SQL test**

Run: `npx -y supabase@latest db reset`, then each file in `supabase/tests/` (as `-U supabase_admin -d postgres`
for `account_delete.sql` and `blocked_email_domains.sql`, `-U postgres` for the rest).
Expected: every file ends with `ROLLBACK`, no `FAIL`, no `ERROR`.

- [ ] **Step 7: Update the database notes**

- `supabase/migrations/CLAUDE.md`, the "Editors' Author and Make a copy's source" bullet: add `author_id` (who sets
  it, `keep_author_id`, the name always follows it, the rename in `set_display_name` with the
  `quizmatter.renaming_author` lock exception, `on delete set null`), and that the newest `set_editor_author`,
  `approve_submission`, `check_presentation_review_lock` and `set_display_name` are in
  `20261216000000_author_link.sql`. Also its "Finding a function's newest version" example if it names one of these.
- Root `CLAUDE.md`, "Editors' Author and 'Copied from'": the Author is linked by `author_id` and follows the
  editor's display name, on their own presentations and on their QuizMatter lessons (admins can't retype it).

- [ ] **Step 8: Ask the user, then commit**

```bash
git add supabase/migrations/20261216000000_author_link.sql supabase/tests/author_link.sql supabase/tests/account_delete.sql supabase/migrations/CLAUDE.md CLAUDE.md
git commit -m "Author follows the editor's display name (author_id)"
```

Root `CLAUDE.md` may hold unrelated uncommitted changes: check `git diff CLAUDE.md` first and stage only this
task's lines (or ask the user).

---

### Task 2: The Author box locks for a linked presentation (app + editor notes)

**Files:**
- Modify: `src/lib/fetchPresentation.ts` (`PRESENTATION_COLUMNS`, `loadPresentation`, `fetchPresentation`)
- Modify: `src/app/presentation/[id]/edit/page.tsx`
- Modify: `src/app/presentation/[id]/edit/PresentationEditor.tsx`
- Modify: `src/components/editor/Editor.tsx`
- Modify: `src/lib/store.ts` (state type near `canPublish` at line 361, default near line 624)
- Modify: `src/components/editor/DetailsModal.tsx:133-144`
- Modify: `src/lib/CLAUDE.md` (the `fetchPresentation.ts` line), `src/components/editor/CLAUDE.md` (Modals: `DetailsModal`)

**Interfaces:**
- Consumes: column `presentations.author_id` (Task 1).
- Produces: `loadPresentation(...)` returns `{ presentation, ownerId, sharedFrom, authorId: string | null }`;
  `fetchPresentation(id)` returns `authorId: string | null` too; `Editor` / `PresentationEditor` prop
  `isAuthorLinked?: boolean` (default `false`); store field `isAuthorLinked: boolean` (default `false`).

- [ ] **Step 1: Read `author_id`**

Add `author_id` to `PRESENTATION_COLUMNS` (Admin → Data check reads the same list; `rowToPresentationInput` doesn't
change). `loadPresentation` returns `authorId: data.author_id`, and `fetchPresentation` passes it on (update their
doc comments).

- [ ] **Step 2: Pass it to the editor**

In the edit page's "my own presentation" branch, pass `isAuthorLinked={result.authorId !== null}` to
`PresentationEditor`, which passes it to `Editor`, which sets it in the store in the same `setState` as
`canPublish` (and adds it to that effect's dependency list). Add one comment line next to each, in the style of the
`canPublish` comments. The review branch doesn't need it (review mode already shows the Author as text).

- [ ] **Step 3: Lock the box**

In `DetailsModal`, read `isAuthorLinked` from the store. Order of the Author field:
review → text as now; editor's own (`isEditor`) → text as now ("You (added when you save)" when empty);
`isAuthorLinked` → `<Field label="Author"><p className="text-sm text-text-primary">{presentation.author || "—"}</p></Field>`
with a comment that the database always writes the editor's name there; else the text box.

- [ ] **Step 4: Check types and lint**

Run: `npx tsc --noEmit` and `npm run lint`
Expected: no errors in the changed files.

- [ ] **Step 5: Check it in the app**

`npm run dev` on the local database (after Task 1's `db reset`): as an editor, rename on the Account page → open
one of their presentations' Details: the new name. As the admin who approved their submission, open that lesson's
editor → Details shows the Author as locked text with the new name. A teacher's presentation still has the text box.

- [ ] **Step 6: Update the notes**

`src/lib/CLAUDE.md`: `fetchPresentation.ts` also gives `authorId`. `src/components/editor/CLAUDE.md`: `DetailsModal`
shows the Author as locked text in review mode, on an editor's own presentation, and when the presentation is linked
to an editor (store `isAuthorLinked`).

- [ ] **Step 7: Ask the user, then commit**

```bash
git add src/lib/fetchPresentation.ts "src/app/presentation/[id]/edit/page.tsx" "src/app/presentation/[id]/edit/PresentationEditor.tsx" src/components/editor/Editor.tsx src/lib/store.ts src/components/editor/DetailsModal.tsx src/lib/CLAUDE.md src/components/editor/CLAUDE.md
git commit -m "Details: the Author is locked on a presentation linked to an editor"
```

`src/lib/CLAUDE.md` already has unrelated uncommitted changes: stage only this task's lines (or ask the user).
