# src/lib (helpers, data shapes, saving)

## The files that matter most

- `schema.ts`: the zod schemas and types for everything saved (presentation, slide, element, photo, …) and their
  limits (`MAX_SLIDES`, text lengths, …). Every save parses with these first (see "Saving Data" in the root
  `CLAUDE.md`). A new saved field = add it here first.
  Slide colors (`colorSchema`: an element's `color` and `borderColor`, a slide's `background`, `shapeBoxFill` and
  `shapeBoxBorder`) take only what `isSafeColor` allows: hex (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`), `rgb()` /
  `rgba()` with only numbers, `transparent`, `none`, and `gradient:` / `radial:` / `mesh:` followed by colors and
  commas. So a crafted value (like one hiding `url(…)`) can't load an outside picture. `upgradeSlide` cleans an
  older bad value out (left out; an element's `color` becomes `DEFAULT_TEXT_COLOR`), and the drawing helpers
  (`toCssBackground`, `slideBackgroundCss`, `getSlideBackgroundStyle`) draw nothing for one. A new color format the
  app writes goes in `isSafeColor` first.
- `store.ts`: the editor's state and every edit action (zustand). Notes in `src/components/editor/CLAUDE.md`.
- `constants.ts`: canvas size, box ids (`QUESTION_CONTAINER_ID`, …), photo URLs, slide effect speeds, diagram limits,
  the default text color (`DEFAULT_TEXT_COLOR`).
- `factories.ts`: new blank slides and presentations, `duplicateSlide`.
- `svgLibrary.tsx` (very big): every drawing in the Elements panel and the diagram layouts. Before changing diagram
  code here, read the Diagrams rules in `src/components/editor/CLAUDE.md`.
- `importPresentation.ts` (very big): turns Claude's simple "recipe" JSON into real slides, working out every
  element's size and place. `getClaudeFormat()` is the format text Claude reads.

## Saving and loading

- `presentations.ts`: `savePresentationToDb` → zod → the `save_presentation` database function. `REFUSALS` turns
  the database's refusal codes (`QM409` conflict, `QMMAX`, `QM429`, `QMBAN`, `QMREV` locked, …) into messages, and
  `SaveRefusedError` carries them. Saving too fast is the `presentation_save` click limit (`QMBLK`, not in
  `REFUSALS`): `saveErrorMessage` says it's paused, the store's save calls `checkPauses`, and the Save button greys
  out. A new refusal code goes in `REFUSALS`. `refusalFromCode(code)` gives the
  `SaveRefusedError` for a known code (or null); `reviews.ts` and `sharing.ts` use it too.
- `fetchPresentation.ts`: loads a presentation + who owns it + its review and submission status (server), whether I
  saved it, its likes (`likeCount`, `isLiked`; 0 and not liked if those reads fail), and `sharedCopy` (my original's
  shared copy) / `sharedFrom` (set when this is a copy), and `authorId` (the editor the Author is linked to, or null;
  `20261216000000_author_link.sql`). `loadPresentation` reads one with the client it's given (the
  MCP server and the admin's submission page use it too). `PRESENTATION_COLUMNS` (the columns read) and
  `rowToPresentationInput` (a row in the app's shape, for `presentationSchema`) are shared with Admin → Data check,
  so it checks presentations the same way they open.
- `sharing.ts`: `shareCopy(id)` (Publish and "Update shared presentation") and `unshareCopy(id)` (Private) call
  `share_presentation` / `unshare_presentation` (zod first). A teacher's shared copy is its own presentation row
  (`shared_from` = the original). The store keeps `sharedCopy`; `setPublished` / `updateSharedCopy` save unsaved
  edits first. QuizMatter presentations keep the `isPublished` switch. See `20261123000000_shared_copy.sql`.
- `keptWork.ts`: unsaved work kept in this browser (`qm-unsaved:<id>`) when a save is refused with `QMOLD`, or while
  the editor is left (`saveBeforeLeaving` in `store.ts` keeps it before it saves, and a save that works forgets it;
  a changed Claude draft not saved yet is only kept, never saved by leaving; how the editor uses it:
  `src/components/editor/CLAUDE.md`). `keepUnsavedWork` returns false when the browser
  can't store it (blocked or full), and stores nothing (true) when there are no real edits (only the publish switch
  or save times changed). It keeps the ids of the slides at the last save too, so `takeKeptWork` can merge with what a newer save
  did: walking the kept slides, an untouched one becomes the loaded one (dropped if the newer save deleted it), a
  changed or new one stays; then each slide the newer save added goes in right after the nearest slide before it
  that's in the result (or first). A slide this tab deleted stays deleted. Nothing to give back = null. Tests:
  `keptWork.test.ts` (`npm test`).
- `maintenance.ts`: maintenance status for the proxy, pages, Claude's connector and the timers
  (`getMaintenanceStatus`, remembered 60 seconds; `fetchMaintenanceStatus`, fresh), the note's limit and the
  `QMMNT` / header / event names. `REFUSALS.QMMNT` has its words. See the root `CLAUDE.md`, "Maintenance". The
  status also carries `announcementsKey` (null = no announcement live; it changes when one changes).
- `announcements.ts`: announcements (a modal and/or top bar for chosen teachers; spec
  `docs/superpowers/specs/2026-10-30-announcements-design.md`, `20261221000000_announcements.sql`). `PAGE_GROUPS` and
  `pageGroup(pathname)` (which group a page is in; null = never shows one), the limits (`ANNOUNCEMENT_LIMITS`, same as
  the database's checks), `announcementSchema` (zod, run before every save; keys = the column names),
  `myAnnouncementSchema` (a `my_announcements` row), `pickForPage` (what shows on a page: fits `pages`, skips closed
  parts, newest first, 2 bars at most), `manilaDay`, `isSameVisit` and `MODAL_SIZES` (the modal's widths; a row without one counts as large), `modalAttachmentSchema` (the modal's one
  picture, YouTube card or Facebook post / video; `src` only our R2 address, a Facebook `href` only as `facebookLink`
  gives it) (a tab's saved list is reused only for the same account and Philippine day). It repeats `EDUCATION_LEVELS` because `userSettings.ts`
  can't load in a test. Tests: `announcements.test.ts`.
- `announcementText.ts`: the top bar's text (the modal is plain text). `ANNOUNCEMENT_BAR_EXTENSIONS` (the slide text
  styles + links) for its editor; `toSafeAnnouncementHtml` (browser only) re-builds saved text through them, then
  `cleanAnnouncementDoc` drops links that aren't `http(s)://` or an app path (`isAllowedLink`; `isInternalLink` =
  opens in the same tab). Tests: `announcementText.test.ts`.
- `facebook.ts`: Facebook links for the modal's attachment: `facebookLink` (posts, videos, reels, watch, share and
  fb.watch links as https; null for pages, other sites or unsafe links), `findFacebookLink` (the first one in pasted
  text), `facebookEmbedUrl` (Facebook's own player / post box) and `facebookPostWidth` (the post box is 350–500 px).
  Tests: `facebook.test.ts`.
- `youtube.ts`: YouTube links for the modal's card: `youTubeVideoId` (watch, youtu.be, shorts and embed links; null
  for anything else), `findYouTubeVideoId` (the first one in pasted text), `youTubeWatchUrl`. Tests:
  `youtube.test.ts`. `photos.tsx`'s `fetchYouTubeCard` asks `/api/announcement-youtube` for the card, and
  `uploadAnnouncementPhoto` returns a photo attachment.
- `reviews.ts` (reviewer's saves) / `reviewStatus.ts` (reads), `submissions.ts` (Submit to QuizMatter reads).
- `lessons.ts`: reads for "This week's lessons", "You may also like" and an editor's profile list (only ids; see `src/app/CLAUDE.md`).
- `folders.ts`, `userSettings.ts`, `profiles.ts`, `account.ts` (`getAccount`: who is logged in, `isAdmin`).
  `userSettings.ts` also holds the sign up rules: `signUpSchema(blockedDomains)` is a function, since the throwaway
  email services live in the database (`blocked_email_domains`; the sign up page reads them on the server and passes
  them in, and `signUp` takes them too). `THROWAWAY_EMAIL_MESSAGE` is the same text the database's sign up hook
  refuses with (`20261210000400_blocked_email_domains.sql`): change both together. Its `agreeTerms` field (the
  agree box, `z.literal(true)`, `AGREE_TERMS_MESSAGE`) must be ticked; `signUp` then sends `terms_version`
  (`LEGAL_VERSION`), which the database saves with the time (`20261218000000_terms_consent.sql`).
- `legal.ts`: `LEGAL_VERSION`, the Terms and Privacy Policy version (the date they last changed). The pages show it
  as "Last updated" and each new account saves it. Change it whenever either page changes.
- `age.ts`: the birthday rules (`MIN_AGE` 18, `MAX_AGE` 100), `ageOn` (the age in whole years on a date),
  `isAllowedBirthDate`, `birthDateRange` (the date picker's limits) and `todayInManila`. The database does the same
  math (`age_on`, `manila_today`, `20261220000000_age_gender_address.sql`): change both together. No imports, so
  tests load it (`userSettings.ts` can't be loaded by tests).
- `provinces.ts`: `PROVINCES`, the Province dropdown (82 provinces, Metro Manila, "Outside the Philippines"); the
  name itself is saved. The database's `is_province` has the same list; `provinces.test.ts` fails if they differ.
- `supabase/`: `client.ts` (browser), `server.ts` (server, with the login cookies), `admin.ts` (secret key, server
  only, skips the database rules: use only when there is no other way).
  `listAllUsers` there pages through every account (1,000 at a time); Admin → Teachers uses it (Admin → Editors
  gets its editors' emails from the `admin_editors` rpc instead).
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
- Bump the database's `current_data_version()` to the same number in a migration, and apply it **before** deploying
  the app with the new `DATA_VERSION`: every saved version is capped at it, so until then older tabs aren't refused.
- `isNewerThanApp(dataVersion)` (`schema.ts`): "Make a copy" and opening a presentation in the editor's Presentations panel
  check it first and show the `QMOLD` message ("QuizMatter was updated...") instead of copying with fields this older
  tab doesn't know.
- Rolling the app back after a bump makes the older app's saves refuse (`QMOLD`) on everything the newer app saved.

## Other groups

- Limits: `clickLimits.ts` (the one click-limit system, see root `CLAUDE.md`), `browserLimits.ts` (sign up / login
  speed bumps kept in the browser).
- Photos: `photos.tsx` (upload, My photos, shared photos; `isPhotoLocked` / `PHOTO_LOCKED_MESSAGE` for `QMPHL`, a
  photo in something waiting for QuizMatter can't be removed; the editor's Photos panel shows only public shared
  photos, even to admins), `photoFiles.ts` (R2 files, server), `photoTypes.ts` (what a file really is, from its first bytes:
  `readPhotoType` = WebP or JPEG for every upload, `readAnnouncementImageType` also takes a GIF, `MAX_GIF_BYTES`
  = 1 MB; tests
  `photoTypes.test.ts`), `photoTickets.ts`
  (Claude's photo uploads), `cleanupPhotos.ts` (weekly cleanup). `PHOTO_TYPES` (the files a teacher can pick) is in
  `constants.ts`, so pages outside the editor can use it without loading `photos.tsx` (which loads the editor's store).
  Editors' profile photos: `photoCrop.ts` (zoom and move math for the adjust box, with `photoCrop.test.ts`) and
  `profilePhotos.ts` (make the 400 × 400 square, upload it, remove it; kept apart from `photos.tsx` for the same
  reason).
- Claude (MCP): `drafts.ts` (drafts in Cloudflare D1), `importPresentation.ts`, `photoTickets.ts`.
- Timers: `cleanupPhotos.ts`, `cleanupAccounts.ts` (run by `worker.ts`). `cleanupAccounts.ts`, daily: deletes
  accounts unconfirmed after 3 days, `sign_up_attempts` older than a day, and `click_history` and `admin_actions`
  rows older than `KEEP_SAFETY_RECORDS_DAYS` (365, from each row's `created_at`; the Privacy Policy promises it),
  and who closed an announcement that ended over 30 days ago (`cleanup_announcement_dismissals`, 50,000 rows a call,
  up to 20 calls a day; the Privacy Policy promises it too).
- Drawings: `svgLibrary.tsx`, `flags.tsx`, `kids.tsx`, `solids.tsx`, and the big people drawings `schoolBoy.tsx` /
  `clipartKids.tsx`, which load only when needed (`peopleArt.ts`).
- Text: `richText.ts` (tiptap setup, safe HTML), `format.ts` (dates, labels).
- `support.ts`: `SUPPORT_EMAIL` and `FACEBOOK_URL`, the one place each is written (the support address is an alias
  of the admin's Google Workspace inbox). Used by `src/components/SupportEmail.tsx`, `src/components/Footer.tsx` and
  the "blocked" messages (`QMBAN`, the login page).
- Editor hooks: `useEditorShortcuts`, `useMarqueeSelection`, `useElementDropTarget`, `useCanvasTextEditor`,
  `useAutoFitText`, `useFormatTexts`.

## Picture Shapes (for Claude's import)

The import runs on the server, where drawings can't be measured, so `src/lib/assetShapes.json` keeps each library drawing's real shape (without the empty space around it). The import fits every picture's box to it, like the editor does. Spec: `docs/superpowers/specs/2026-10-10-picture-drawn-shapes-design.md`.

- After adding or changing library art, update the file: `npm run dev`, open `/dev/asset-shapes`, download, replace `src/lib/assetShapes.json`, commit.
- A drawing missing from the file still works, it just keeps the box it's given.
