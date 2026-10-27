# Fixes from the deep review (2026-10-24)

A five-part review (database, `src/lib`, editor, teacher pages + Claude's connector, admin) plus a browser test as
the super admin found the problems below. This document says what each fix must do. "My call" marks a choice Claude
made that the user didn't decide; the user approved the save-on-leave behavior and asked to fix everything.

## Constraints (all fixes)

- **Nothing that opens today may stop opening.** Any stricter zod rule on saved data gets a clean-up step in
  `upgradeSlide` / `upgradePresentation` (see `src/lib/CLAUDE.md`, "Changing the saved shape"), and Admin → Data check
  must still say every presentation opens.
- **Database changes go in new migration files** (the `data_version` and account-delete migrations are already live).
  Split them by topic. They are written and checked, **not applied** to the live database until the user says so.
  One exception: `20261122000000_super_admin.sql` is edited in place (see D7), since that change only matters on a
  fresh database.
- **No commits without asking** (the user's rule for `main`). No new packages expected; if one is needed, npm 10.9.2.
- Every CLAUDE.md rule holds: zod before saving, the one Spinner, the top loading line, design-system tokens only,
  sonner toasts, ConfirmModal for confirms, and the folder notes updated in the same change.
- Plain English in notes and messages.

## A. Leaving the editor saves the work (user's decision)

Today only closing/reloading the tab warns; the browser Back button (or mouse back, or a swipe) inside the app drops
unsaved edits with no warning.

- **Any in-app move away from the editor with unsaved changes saves first:** browser Back/Forward, the editor's ←
  arrow, any link. The owner's editor saves the presentation; a reviewer's editor saves the review draft (like "Save
  as draft"); nothing goes live. A toast says it saved.
- **The ← arrow saves, then goes** (with the Spinner while saving). The "Leave without saving?" box goes away.
- **Closing or reloading the tab** keeps today's "Leave page?" warning (a browser can't finish a save while closing).
- **If that save fails** (another tab saved first `QM409`, locked `QMREV`, a limit, offline, an app update `QMOLD`):
  the work is kept in this browser (`keptWork.ts`) and comes back the next time the presentation opens, with the
  usual toast. Never lost silently. If the browser can't store it either, the teacher must be told before they leave
  (see B1).
- **Coming back before that save finishes** must not show the old version as if it were current (my call: wait for
  the pending save, then load what was saved).
- A Claude draft not yet in the database saves as a new presentation, like its first Save.
  Changed 2026-10-26 (user's decision): an unsaved Claude draft is kept in the browser instead; it becomes a
  presentation only on Save.

## B. Kept work (the uncommitted "stable presentation data" feature)

1. `keepUnsavedWork` reports whether it stored the work. If storing failed, keep the "Leave page?" warning on and say
   so instead of "your changes are safe".
2. Keep the latest edits (the presentation as it is when the box shows / Reload is clicked), not the snapshot from
   when the save started.
3. The Reload button isn't focused automatically (a teacher still typing could press it by accident).
4. **Restoring merges correctly with what a newer tab saved:** slides the newer save added stay; slides it deleted
   stay deleted unless this tab changed them. (Store the last-saved slide ids with the kept work.)
5. Nothing is kept or restored when there were no real edits (e.g. only a publish switch failed).
6. My call: the kept copy stays until a save works (as built), not deleted at restore. Write this, and the B4 merge,
   into the stable-data spec's "Built differently" list.
7. When a refused save returns `""`, the Share card's open confirm box closes, so two boxes don't stack.
8. The "lesson" → "blank" old-shape step moves from `slideSchema` into `upgradeSlide`.
9. Old tabs can't silently drop newer fields when copying: "Make a copy" and inserting slides from another
   presentation are refused with the "QuizMatter was updated, reload" message when the source's `data_version` is
   newer than the tab's `DATA_VERSION`.

## C. Data version can't be poisoned

Today any caller can send a huge `app_version`, and it spreads (review → published lesson, submission → approved
copy), so every later app save is refused forever.

- A database function `current_data_version()` returns the newest version the app knows (0 today).
- Every stored `data_version` / `draft_version` is capped at it, whatever path writes it (my call: a cap, not a
  refusal, so a forgotten bump can't break saving). Direct writes to the column can't raise it either.
- `src/lib/CLAUDE.md`, "Changing the saved shape": bump `current_data_version()` in a migration **before** deploying
  the app with the new `DATA_VERSION`, and a warning that rolling the app back after a bump makes old tabs refuse.

## D. Database rules

1. **Plain admins follow the super-admin spec in the database too** (`2026-10-16-super-admin-design.md`, "What plain
   admins can do"). On presentations they don't own, a plain admin can read, hide/unhide, and delete ones that are
   reported or hidden. Everything else (owner, "from QuizMatter" = Move to QuizMatter, title, author, sharing,
   inserting rows owned by someone else) is the super admin's, or happens inside the database functions (reviews,
   submissions, account delete). Every app path a plain or super admin uses today must still work.
2. **Editor role:** only the super admin gives it (database and `setEditor`); any admin can take it away. It can't
   be given to an admin or a banned teacher; "Make editor" is hidden on those rows.
3. A former admin (removed from `admins`) can't delete QuizMatter presentations.
4. A teacher whose shared copy was hidden can't share a copy of the same presentation to get around the hide.
5. **Account delete can't be blocked** by the hidden-copy trigger (skip its check when there's no logged-in user or
   it runs inside another trigger).
6. **The Admin log records every row** of a multi-row change (hide, delete, photo delete), not only the first.
7. `20261122000000_super_admin.sql` skips its "super admin must exist" step with a notice on a fresh, empty database.
8. `check_review_draft` checks what the tables check (tags ≤ 10, grades ≤ 14, the transition list, speed 1–5), so a
   bad draft is refused at save with a clear message, not at publish.
9. **Direct table writes follow the same limits as the app paths:** photos (speed limit, ban, a row cap matching the
   app), slides (100 per presentation), and the ban check on reports, user settings and folder items. The folder
   limit counts under a lock.
10. The "From editors" photo category can't be renamed or deleted (editor uploads depend on it).
11. Speed: the `admin_actions` read policy calls `is_super_admin()` once per query, not per row; an index for
    `log_ban`'s lookup.
12. Helpers that anon doesn't need are revoked from anon.
13. **Throwaway email addresses are refused by the database signup hook**, from one list kept in the database; the
    signup page reads that list for its instant message (no second list in the code).

## E. Claude and the connection page

1. **The connection (OAuth consent) page shows where it will send the login** (the redirect address), and Allow
   only works when that address is on Claude's own sites (claude.ai, claude.com). Checked again in `answerConsent`.
   My call: no `client_id` check in `checkLogin` (Claude's client ids are created on the fly); the consent check
   covers it.
2. `checkLogin` refuses when it can't tell whether the user is banned (fail closed).
3. **Claude's photo upload follows the plain-admin rule:** an editor's waiting photo is made public only by the
   super admin (same message as the normal upload). When the file arrives, the ticket owner must still be an admin
   and not banned.
4. Claude's import checks every built slide against `slideSchema` (text lengths and all), so a draft that can't be
   saved is refused when Claude sends it, with errors Claude can fix.

## F. Teacher pages and routes

1. The login check (`proxy.ts`) skips only real static files, not page addresses that end in `.png` etc.
2. `auth/confirm` checks `type` with zod, and does nothing (sends home) when someone is already logged in, so a link
   can't swap them into another account.
3. **No silent 1,000-row cut-offs:** liked hearts only read likes for the cards shown; the Liked tab pages like
   Other teachers; From QuizMatter doesn't load every presentation to show 5 per subject.
4. **Errors are handled:** an `error.tsx` in the design system; the like and save buttons show a toast and stop
   their spinner on a network error; one failed tab count shows 0 instead of breaking every home tab.
5. `alert()` becomes a toast (or the Modal for Claude draft errors) in `PresentationCardMenu`, `PresentationList`
   and `Editor`; deleting shows a success toast.
6. `/presentations` gets `loading.tsx`; the links in `presentation/new` and Data check get `LinkPending`.

## G. Editor

1. **Ctrl+V in a text field pastes the text**, not a copied element (element paste only when no input, textarea,
   rich text or dialog has focus).
2. Ctrl+Z / Ctrl+Y inside a text input undo the input's typing, not the slides.
3. **Slide colors only take color values:** the zod color rule and the drawing code accept only the color formats
   the app writes (find them all first), so a crafted value can't load an outside picture. Stored values that don't
   fit are cleaned in `upgradeSlide` (constraint above).
4. Design tokens only: replace `bg-[#111111]`, hard-coded shadows and `rounded-[6px]`; if a value is truly needed,
   add it to `globals.css` and the design-system section of CLAUDE.md.

## H. Admin pages

1. Removing a shared photo asks first (ConfirmModal); a failed removal puts it back where it was.
2. "Make editor" asks first and says their published copies will be removed from other teachers.
3. `setShared` works only on the admin's own presentations (super admin: any); `deleteReportedPresentation` only on
   reported or hidden ones.
4. Re-banning someone already banned never removes their ban when Supabase's step fails; a ban by hand is not marked
   automatic.
5. Dismiss removes only the reports the admin saw.
6. The Editors and Teachers pages don't read whole tables (no 1,000-row cut-offs, no listing every account to find a
   few editors); the editor page's photo lookup doesn't put every photo address in the request link.
7. Overview: each chart counts what its words say (a sent-back review stays counted as submitted; the text says when
   a chart counts only rows that still exist); `admin_todo_counts` runs once per page. The menu's "Under review" and
   the Presentations page show the same number.
8. Safety page text: plain admins are counted by the speed limits.
9. The Admin log filter uses a `next/form` form, so the top loading line shows.
10. Data check runs only in development (`npm run dev`); on the live site the page says to run it there. A review
    draft's row links to the review, not the live presentation.
11. My call, not changed: `log_unban` / `log_click_release` can be called by the super admin alone and are needed by
    the app after Supabase's own unban.

## I. Small cleanups

- `.claude/**` added to the ESLint ignores (lint is then clean).
- The dev request counter sits under the account menu, not over it.
- Misplaced doc comments (`mcp.ts` `checkLogin`, `search.ts` `contains`); `sharing.ts` uses `refusalFromCode`.
- Not changed (my call): the Photos panel's one request per category row (each is remembered for the session).

## J. Notes that must be made true

`src/components/editor/CLAUDE.md` (link box removed; save on leave), the `PhotosPanel.tsx` comment, `src/lib/CLAUDE.md`
(`PRESENTATION_COLUMNS`, `rowToPresentationInput`, likes in `fetchPresentation`, `refusalFromCode`, data version
bump rule, kept work), `supabase/migrations/CLAUDE.md` (newest `save_presentation` / `publish_review` files, the
trigger-revoke wording, the new migrations), `src/app/admin/CLAUDE.md` (Library includes Data check; plain admin
limits), `src/app/CLAUDE.md` (only the super admin gets Move to QuizMatter), root `CLAUDE.md` (review migrations list
gets `data_version` and the new files; plain-admin rules now in the database), and the stable-data spec's "Built
differently" list.

## Out of scope

- Wrangler's expired login on the user's computer (they run `npx wrangler login`).
- Testing as the teacher and editor in the browser needs the user to log in themselves.
