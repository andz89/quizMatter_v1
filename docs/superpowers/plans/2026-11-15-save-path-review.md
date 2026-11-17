# Save path review plan (2026-11-15)

A deep `/code-review high` of how a presentation is saved, in four rounds, smallest risk of a missed link first. The
user runs each command; Claude fixes the findings (a new migration + SQL test for database ones, `npm test` for app
ones), commits to `dev`, and the user pastes any migration into the live SQL editor before the push. One round at a
time: a round's fixes land before the next round runs, so later rounds review the fixed code.

Scope: an edit → a store action → Save / Ctrl+S / auto save → `savePresentationToDb` → `save_presentation` → its
triggers → a refusal code → the message. Shared copies, reviews and Claude's connector were reviewed already.

## Round 1: the database function and its tests

```
/code-review high supabase/migrations/20261210000000_data_version_cap.sql supabase/migrations/20261209000000_data_version.sql supabase/migrations/20261001000000_safer_presentation_saves.sql supabase/tests/data_version_cap.sql supabase/tests/hidden_slides.sql
```

- `20261210000000_data_version_cap.sql`: the newest `save_presentation` and the version cap trigger.
- `20261209000000_data_version.sql`: the `QMOLD` rule (an older tab is refused) and `copiedFrom`'s version check.
- `20261001000000_safer_presentation_saves.sql`: where `save_presentation` began: `QM409` (a newer save exists),
  `QM422` (a missing slide), the one-step save of details and slides.
- The two SQL tests that call `save_presentation`. There is no test of its own for `QM409` and `QM422`: a likely
  finding, and Round 1's fix should add `supabase/tests/save_presentation.sql`.

Questions for it: can two tabs saving at once lose a slide? Can a save skip `QM409`? Does the slide delete inside it
remove the right rows? Is every input checked like the table checks it?

## Round 2: the triggers that run on every save

```
/code-review high supabase/migrations/20261211000000_save_photo_click_limits.sql supabase/migrations/20261210000300_direct_write_limits.sql supabase/migrations/20261216000000_author_link.sql supabase/migrations/20261217000000_author_link_fixes.sql supabase/migrations/20261201000000_editor_author_and_copy_source.sql supabase/migrations/20261019000000_presentation_reviews.sql supabase/tests/save_photo_click_limits.sql supabase/tests/direct_write_limits.sql supabase/tests/author_link.sql
```

- `20261211000000_save_photo_click_limits.sql`: the save speed limit (`count_presentation_write`: 30 a minute,
  1,000 a day, the ban after 3 pauses).
- `20261210000300_direct_write_limits.sql`: the 100-slide limit (`check_slide_limit`) and the direct-write guards.
- `20261216000000_author_link.sql` + `20261217000000_author_link_fixes.sql`: the review lock on saves
  (`check_presentation_review_lock`), `keep_author_id`, `set_editor_author`, the rename that skips `QM409`.
- `20261201000000_editor_author_and_copy_source.sql`: `keep_copied_from`.
- `20261019000000_presentation_reviews.sql`: the slide review lock (`check_slide_review_lock`).
- Their SQL tests.

Questions for it: can a trigger be skipped by writing the table directly? Does a flag set for one request
(`quizmatter.*` settings) leak into the next? Can the save count be dodged? Does the review lock cover slides too?

## Round 3: saving from the app

```
/code-review high src/lib/presentations.ts src/lib/schema.ts src/lib/fetchPresentation.ts src/lib/autoSave.ts src/lib/presentations.test.ts src/lib/schema.test.ts
```

- `src/lib/presentations.ts`: `savePresentationToDb` (zod, then the call), `REFUSALS`, `saveErrorMessage`.
- `src/lib/schema.ts`: the zod schemas and limits, `upgradeSlide` / `upgradePresentation`, `parseSavedPresentation`.
- `src/lib/fetchPresentation.ts`: how a presentation is read before editing.
- `src/lib/autoSave.ts`: auto save timing and the daily cap.
- Their tests.

Questions for it: can something reach the database that zod didn't check? Is a limit in zod different from the
database's? Does `upgradeSlide` ever drop a teacher's content quietly? Does the app's `DATA_VERSION` match
`current_data_version()`?

## Round 4: the editor's store and the save flow

```
/code-review high src/lib/store.ts src/lib/keptWork.ts src/lib/keptWork.test.ts src/components/editor/Editor.tsx src/components/editor/EditorTopBar.tsx
```

- `src/lib/store.ts`: every edit action, undo, `savePresentation`, `autoSave`, `saveBeforeLeaving`,
  `restoreKeptWork`, `keepWorkNow`.
- `src/lib/keptWork.ts` + its test: unsaved work kept in the browser and merged back.
- `src/components/editor/Editor.tsx`: the auto save timer, the leave-save, the "QuizMatter was updated" box.
- `src/components/editor/EditorTopBar.tsx`: the Save button.

Questions for it: can an edit change a slide in place (so it never saves)? Can two saves run at once? Can kept work
overwrite a newer save without the teacher knowing? Does a refused save ever lose edits? Does the daily auto save
cap leave the teacher with no save?

## After each round

1. Paste the findings to Claude. Claude checks each against the code before fixing (a review can be wrong).
2. Database fixes: a new migration (next name after `20261231001600`), a SQL test that fails first, `npm run
   test:sql`, `npm run db:snapshot`. App fixes: a failing `npm test` first.
3. `npx tsc --noEmit`, `npm run lint`, `npm test`, the notes updated, one commit per round on `dev`.
4. A migration goes into the live SQL editor **before** the push.
