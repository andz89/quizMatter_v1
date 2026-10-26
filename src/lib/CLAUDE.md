# src/lib (helpers, data shapes, saving)

## The files that matter most

- `schema.ts`: the zod schemas and types for everything saved (presentation, slide, element, photo, …) and their
  limits (`MAX_SLIDES`, text lengths, …). Every save parses with these first (see "Saving Data" in the root
  `CLAUDE.md`). A new saved field = add it here first.
- `store.ts`: the editor's state and every edit action (zustand). Notes in `src/components/editor/CLAUDE.md`.
- `constants.ts`: canvas size, box ids (`QUESTION_CONTAINER_ID`, …), photo URLs, slide effect speeds, diagram limits.
- `factories.ts`: new blank slides and presentations, `duplicateSlide`.
- `svgLibrary.tsx` (very big): every drawing in the Elements panel and the diagram layouts. Before changing diagram
  code here, read the Diagrams rules in `src/components/editor/CLAUDE.md`.
- `importPresentation.ts` (very big): turns Claude's simple "recipe" JSON into real slides, working out every
  element's size and place. `getClaudeFormat()` is the format text Claude reads.

## Saving and loading

- `presentations.ts`: `savePresentationToDb` → zod → the `save_presentation` database function. `REFUSALS` turns
  the database's refusal codes (`QM409` conflict, `QMMAX`, `QM429`, `QMBAN`, `QMREV` locked, …) into messages, and
  `SaveRefusedError` carries them. A new refusal code goes in `REFUSALS`.
- `fetchPresentation.ts`: loads a presentation + who owns it + its review and submission status (server), and
  `sharedCopy` (my original's shared copy) / `sharedFrom` (set when this is a copy).
- `sharing.ts`: `shareCopy(id)` (Publish and "Update shared presentation") and `unshareCopy(id)` (Private) call
  `share_presentation` / `unshare_presentation` (zod first). A teacher's shared copy is its own presentation row
  (`shared_from` = the original). The store keeps `sharedCopy`; `setPublished` / `updateSharedCopy` save unsaved
  edits first. QuizMatter presentations keep the `isPublished` switch. See `20261123000000_shared_copy.sql`.
- `reviews.ts` (reviewer's saves) / `reviewStatus.ts` (reads), `submissions.ts` (Submit to QuizMatter reads).
- `lessons.ts`: reads for "This week's lessons", "You may also like" and an editor's profile list (only ids; see `src/app/CLAUDE.md`).
- `folders.ts`, `userSettings.ts`, `profiles.ts`, `account.ts` (`getAccount`: who is logged in, `isAdmin`).
- `supabase/`: `client.ts` (browser), `server.ts` (server, with the login cookies), `admin.ts` (secret key, server
  only, skips the database rules: use only when there is no other way).
  `listAllUsers` there pages through every account (1,000 at a time); Admin → Teachers and Editors use it.
- `adminActions.ts`: `ADMIN_ACTION_LABELS` (the words for the Admin log), `AdminAction` and `adminActionSchema`. Its keys
  must match the `action` check on `admin_actions` in `20261208000000_admin_log.sql`: add a new one in both places.

## Changing the saved shape

Saved presentations and slides must keep opening after every change, and old editor tabs must not save over newer
data. Spec: `docs/superpowers/specs/2026-10-23-stable-presentation-data-design.md`. Rules:

- A new field is optional or has a default: old slides don't have it.
- Never rename or remove a field, or a value from a list (shape types, transitions…). Add the new one, and turn the
  old into the new in `upgradeSlide` / `upgradePresentation` (`schema.ts`). They run inside the schemas, so every
  parse upgrades. Recognize the old shape by looking at it, with a comment saying what and from when.
- Never give an existing field a new meaning: add a new field.
- Never lower a limit without first fixing the saved data over it (a migration).
- Bump `DATA_VERSION` (`schema.ts`) whenever the saved shape changes: the database then refuses saves from older
  tabs (`QMOLD`), which keep their work (`keptWork.ts`). Before deploying, run Admin → Data check locally
  (`npm run dev`) and fix the upgrade until nothing is listed.

## Other groups

- Limits: `clickLimits.ts` (the one click-limit system, see root `CLAUDE.md`), `browserLimits.ts` (sign up / login
  speed bumps kept in the browser).
- Photos: `photos.tsx` (upload, My photos, shared photos; `isPhotoLocked` / `PHOTO_LOCKED_MESSAGE` for `QMPHL`, a
  photo in something waiting for QuizMatter can't be removed; the editor's Photos panel shows only public shared
  photos, even to admins), `photoFiles.ts` (R2 files, server), `photoTickets.ts`
  (Claude's photo uploads), `cleanupPhotos.ts` (weekly cleanup).
- Claude (MCP): `drafts.ts` (drafts in Cloudflare D1), `importPresentation.ts`, `photoTickets.ts`.
- Timers: `cleanupPhotos.ts`, `cleanupAccounts.ts` (run by `worker.ts`).
- Drawings: `svgLibrary.tsx`, `flags.tsx`, `kids.tsx`, `solids.tsx`, and the big people drawings `schoolBoy.tsx` /
  `clipartKids.tsx`, which load only when needed (`peopleArt.ts`).
- Text: `richText.ts` (tiptap setup, safe HTML), `format.ts` (dates, labels).
- Editor hooks: `useEditorShortcuts`, `useMarqueeSelection`, `useElementDropTarget`, `useCanvasTextEditor`,
  `useAutoFitText`, `useFormatTexts`.

## Picture Shapes (for Claude's import)

The import runs on the server, where drawings can't be measured, so `src/lib/assetShapes.json` keeps each library drawing's real shape (without the empty space around it). The import fits every picture's box to it, like the editor does. Spec: `docs/superpowers/specs/2026-10-10-picture-drawn-shapes-design.md`.

- After adding or changing library art, update the file: `npm run dev`, open `/dev/asset-shapes`, download, replace `src/lib/assetShapes.json`, commit.
- A drawing missing from the file still works, it just keeps the box it's given.
