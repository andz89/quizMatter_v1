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
  A clock's time (`clockTimeSchema`) is whole hours 1–12 and minutes 0–59. The database doesn't check it, so
  `upgradeSlide` leaves out a time outside that (the clock then shows 10:10), and such a slide still opens. A date
  (`calendarDateSchema`) the same way (the calendar then shows `DEFAULT_CALENDAR_DATE`).
  Diagrams the same way (`DIAGRAM_SCHEMAS`): one that breaks its limits goes back to its starting boxes, since it
  would otherwise stop the whole presentation from opening. Math tools too (`MATH_TOOL_SCHEMAS`, with the panels'
  limits from `constants.ts`): a value of the wrong kind or past its limit is left out, and the tool shows its
  starting look. Those limits also keep a request edited by hand from drawing thousands of shapes.
  Any other broken element: `parseSavedPresentation` (opening a presentation or a review draft) takes that element
  out so the rest still opens, and keeps a slide's first `MAX_ELEMENTS`. Never use it for saving: `presentationSchema`
  refuses them there, so a teacher's work isn't dropped silently, and Admin → Data check still lists them.
- `store.ts`: the editor's state and every edit action (zustand). Notes in `src/components/editor/CLAUDE.md`.
- `constants.ts`: canvas size, box ids (`QUESTION_CONTAINER_ID`, …), photo URLs, slide effect speeds, diagram limits,
  the default text color (`DEFAULT_TEXT_COLOR`). Slide numbers (`getSlideNumbers`, hidden slides take none) and
  presenting's steps past hidden slides (`stepPresentation`, `presentStartIndex`), and `shownSlides` (the slides
  presenting goes through, for the view page's Prev/Next); tests `constants.test.ts`.
- `factories.ts`: new blank slides and presentations, `duplicateSlide`.
- `svgLibrary.tsx` (very big): every drawing in the Elements panel and the diagram layouts. The starting values of
  the clock, bar graph and diagrams (`DEFAULT_CLOCK_TIME`, `DEFAULT_FLOWCHART`, …) and their asset ids live in
  `elementDefaults.ts` (no drawing code, so tests and the downloads load them); `svgLibrary.tsx` re-exports them. Before changing diagram
  code here, read the Diagrams rules in `src/components/editor/CLAUDE.md`. The two written fractions share an
  element's `fraction`: the Written Fraction (`shaded` over `parts`) and the Mixed Fraction (the same, plus `whole`
  in front, 1–999, missing = 1; DATA_VERSION 5, `20261231002000_mixed_fraction.sql`, spec
  `docs/superpowers/specs/2026-11-18-mixed-fraction-design.md`). Only the mixed one reads `whole`: Claude's
  import refuses it on anything else, and `cleanElement` leaves it out of any other element's `fraction`. Their panels are in `src/components/editor/MathToolPanels.tsx`.
- `importPresentation.ts` (very big): turns Claude's simple "recipe" JSON into real slides, working out every
  element's size and place. `getClaudeFormat()` is the format text Claude reads.
- `importTable.ts`: how big Claude's tables are: the start size and the rows shared out by their text, naming the rows
  still cut off for the layout report. Kept out of `importPresentation.ts` so it's tested (`importTable.test.ts`).
- `importText.ts`: the import's guesses of how much room text takes (slide text never shrinks, so they are what warns
  Claude): `tooLong` (the layout report's "will be cut off"; counts the room lost where lines end at a whole word, and
  a single line taller than its box), `questionHeightFor` (the question box: its text plus half a line, up to the
  default), `optionNeedFor` (an option row's height for its text, with the same careful count as `tooLong`; the import
  sizes option rows with it and never changes an option's text size), `textHeightFor` (also sizes tables). Tests: `importText.test.ts`,
  `e2e/claude-text-fit.mjs`.

## Saving and loading

- `presentations.ts`: `savePresentationToDb` → zod → the `save_presentation` database function. `REFUSALS` turns
  the database's refusal codes (`QM409` conflict, `QMMAX`, `QM429`, `QMBAN`, `QMREV` locked, …) into messages, and
  `SaveRefusedError` carries them. Saving too fast is the `presentation_save` click limit (`QMBLK`, not in
  `REFUSALS`): `saveErrorMessage` says it's paused, the store's save calls `checkPauses`, and the Save button greys
  out. A new refusal code goes in `REFUSALS`. `refusalFromCode(code)` gives the
  `SaveRefusedError` for a known code (or null); `reviews.ts` and `sharing.ts` use it too. `saveRefusal(error)` adds
  the limits a teacher can reach in the database: the slide count (`22023`) and a slide over 2 MB (`23514`,
  `slides_data_is_small_object`; zod checks each text, not a whole slide). The editor stops typing at zod's
  text limits (`TextLimit`, below), but a slide zod still refuses (text saved before, or a whole slide over a limit)
  becomes a `SaveRefusedError` naming the slide by its place in the list ("The 3rd slide has too much text in its question. Shorten it, then
  click Save."), not zod's own words: the store then shows it even during auto save and stops auto save until a
  save works, instead of failing quietly every 12 seconds.
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
  A `42501` refusal shows the database's own words, except Postgres's texts ("permission denied", "row-level
  security"), which become "You can't change the sharing of this presentation." `publishableSchema` (`schema.ts`)
  is Publish's content rule: a shown slide with something on it; an empty text box doesn't count.
- `autoSave.ts`: the editor's auto save timing (`AUTO_SAVE_MS`) and its daily cap (`AUTO_SAVES_PER_DAY`, counted in
  this browser under `qm-auto-saves`, so one browser never uses up the `presentation_save_daily` limit; two browsers
  editing hard on the same day can, 600 + 600 > 1,000; change them together).
  How the editor uses it: `src/components/editor/CLAUDE.md`, "Auto save". Tests: `autoSave.test.ts`.
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
- `securityHeaders.ts`: `securityHeaders(supabaseUrl)`, the headers `next.config.ts` adds to every response (pages
  and `/api/*`): `X-Frame-Options: DENY` + `frame-ancestors 'none'` (no other site can frame a page, so an admin can't
  be tricked into clicking through an invisible frame), HSTS for a year (also subdomains), `nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` with camera, microphone and location off
  (fullscreen isn't named: presenting and YouTube need it). The enforced CSP has only `frame-ancestors`, `object-src`
  and `base-uri`, which can't break a page. The full policy is **report-only** (the browser only logs in its console
  what it would block): a new outside service (a new embed host, script or API) must be added to it there, and the
  browser test `e2e/security-headers.mjs` fails if a plain page logs one. Enforcing it later needs nonces for Next's
  inline scripts. No imports, so `securityHeaders.test.ts` checks it with `npm test`.
- `maintenance.ts`: maintenance status for the proxy, pages, Claude's connector and the timers
  (`getMaintenanceStatus`, remembered 60 seconds; `fetchMaintenanceStatus`, fresh), the note's limit and the
  `QMMNT` / header / event names. `REFUSALS.QMMNT` has its words. See the root `CLAUDE.md`, "Maintenance". The
  status also carries `announcementsKey` (null = no announcement live; it changes when one changes).
- `announcementForm.ts`: the admin's announcement form logic, kept out of the `.tsx` so it's tested
  (`announcementForm.test.ts`): `NEW_ANNOUNCEMENT` (what a new one starts with), `changeType` (the Type switch: a
  Large modal becomes a Medium corner box; what was typed stays), `toSaved` (what a save sends: only the chosen
  type's and format's fields, "closes itself" only for a corner box, "shows after" 0 for a top bar, `repeat_minutes` 0 unless
  "Again every N minutes", the field words split), and the Philippine-time
  `toTimeInput` / `fromTimeInput` and `splitWords`.
- `announcements.ts`: announcements (a modal, top bar or corner box for chosen teachers; spec
  `docs/superpowers/specs/2026-10-30-announcements-design.md`, `20261221000000_announcements.sql`). `PAGE_GROUPS` and
  `pageGroup(pathname)` (which group a page is in; null = never shows one), the limits (`ANNOUNCEMENT_LIMITS`, same as
  the database's checks), `announcementSchema` (zod, run before every save; keys = the column names),
  `myAnnouncementSchema` (a `my_announcements` row), `pickForPage` (what shows on a page: fits `pages`, skips closed
  parts and modals / corner boxes whose `modal_show_after` the tab's clock hasn't reached, newest first, 2 bars at
  most, corner boxes only while no modal shows), `isWaiting` (one still waits: the watch's clock runs), `reopenAt` / `stillClosed` (when an "Again every N minutes"
  part closed in the tab comes back, and which closed parts aren't back yet), `cutVideoTitle` (a YouTube card's title cut to its limit by whole characters, so an emoji is never split),
  `announcementType` / `TYPE_WORDS`
  (modal / bar / corner box), `announcementStatus` (the admin list's Live / Scheduled / Ended / Draft), `MODAL_DISPLAYS` / `CORNER_SIZES`, `manilaDay`, `isSameVisit` and `MODAL_SIZES` (the modal's widths; a row without one counts as large), `modalAttachmentSchema` (the modal's one
  picture, YouTube card or Facebook post / video; `src` only our R2 address, a Facebook `href` only as `facebookLink`
  gives it) (a tab's saved list is reused only for the same account and Philippine day). It repeats `EDUCATION_LEVELS` because `userSettings.ts`
  can't load in a test. Tests: `announcements.test.ts`.
- `announcementText.ts`: the top bar's text (the modal is plain text). `ANNOUNCEMENT_BAR_EXTENSIONS` (the slide text
  styles + links) for its editor; `toSafeAnnouncementHtml` (browser only) re-builds saved text through them, then
  `cleanAnnouncementDoc` drops links that aren't `http(s)://` or an app path (`isAllowedLink` in `announcements.ts`;
  `isInternalLink` = opens in the same tab; no `\` or spaces, which browsers turn into another site). It loads Tiptap,
  so teachers' pages import it only when a bar shows (`BarText`). Tests: `announcementText.test.ts`.
- `facebook.ts`: Facebook links for the modal's attachment: `facebookLink` (posts, videos, reels and watch links as
  https; null for pages, other sites, unsafe links and "Copy link"'s short `fb.watch` / `/share/` links, which
  Facebook's player can't show), `isFacebookShortLink` + `FACEBOOK_SHORT_LINK_MESSAGE` (the admin's paste is told
  why), `findFacebookLink` (the first one in pasted text), `facebookEmbedUrl` (Facebook's own player / post box) and `facebookPostWidth` (the post box is 350–500 px).
  Tests: `facebook.test.ts`.
- `youtube.ts`: YouTube links for the modal's card: `youTubeVideoId` (watch, youtu.be, shorts, live and embed
  links, and youtube-nocookie.com's embed; null for anything else), `findYouTubeVideoId` (the first one in pasted
  text), `linkWords` (pasted text's words without brackets, `< >` or punctuation around them; Facebook's search uses
  it too), `youTubeWatchUrl`. Tests:
  `youtube.test.ts`. `photos.tsx`'s `fetchYouTubeCard` asks `/api/announcement-youtube` for the card, and
  `uploadAnnouncementPhoto` returns a photo attachment.
- `reviews.ts` (reviewer's saves) / `reviewStatus.ts` (reads), `submissions.ts` (Submit to QuizMatter reads).
- `lessons.ts`: reads for "This week's lessons", "More like this" and an editor's profile list (only ids; see `src/app/CLAUDE.md`).
  `loadLessonExtras` says `failed` when its read fails, so "More like this" keeps its button and shows a toast
  instead of "Nothing like this yet.".
- `folders.ts`, `userSettings.ts`, `profiles.ts`, `account.ts` (`getAccount`: who is logged in, `isAdmin` /
  `isSuperAdmin` (true only after the second step), `adminRole` (membership: 'super' / 'admin' / 'none', from
  `admin_membership`), and `hasVerifiedFactor()` (asks Supabase whether the account has a verified authenticator app)).
- `secondFactor.ts`: two-step login words (`codeErrorMessage`); browser-safe. `nextPath.ts`: `safeNextPath(next,
  origin)`, the `?next=` page after login or the second step: only this site, never `/login/verify` itself.
- `publishers.ts`: `loadPublisherNames` → the `publisher_names` database function: the "Publisher" line on cards, the
  view page and the editor's Presentations panel. A teacher gets the display name only (an admin-owned one shows
  "QuizMatter"; no display name = no line); only admins get "Display Name (email)" for Admin → Reports
  (`20261231001200_publisher_names_no_email.sql`, test `supabase/tests/publisher_names.sql`).
  `userSettings.ts` also holds the sign up rules: `signUpSchema(blockedDomains)` is a function, since the throwaway
  email services live in the database (`blocked_email_domains`; the sign up page reads them on the server and passes
  them in, and `signUp` takes them too). `THROWAWAY_EMAIL_MESSAGE` is the same text the database's sign up hook
  refuses with (`20261210000400_blocked_email_domains.sql`): change both together. Its `agreeTerms` field (the
  agree box, `z.literal(true)`, `AGREE_TERMS_MESSAGE`) must be ticked; `signUp` then sends `terms_version`
  (`LEGAL_VERSION`), which the database saves with the time (`20261218000000_terms_consent.sql`).
- `passwords.ts`: the password rules (`passwordSchema`, 8–72 characters), and Forgot password's `resetEmailSchema`
  (trimmed, small letters) and `resetErrorMessage` (Supabase's answer to a reset request as words, or null for "Check
  your email": its two email limits count as sent, since they refuse only a real account), `newPasswordSchema` (typed twice, must match), the Account page's `changePasswordSchema`
  (the current password, and a different new one typed twice) and the numbers of Forgot password's limit
  (`RESETS_PER_DAY`, `RESET_REQUESTS_PER_ADDRESS`; the same in `may_send_password_reset`). Only zod, so tests load it
  (`passwords.test.ts`); `userSettings.ts` re-exports the password rules for the forms.
- `emailLinks.ts`: our two email links (`/auth/confirm`, types `email` and `recovery`): `emailLinkSchema` (the link's
  `token_hash` and `type`), `emailLinkResult` (where Continue goes after Supabase's answer), `badLinkDestination` (a
  link missing its parts), `emailLinkPath` (the link page's address, `retry=1` when the link still works) and
  `claimEmail` (a login's email, or null; also used by `/set-password`). Only zod, so tests load it
  (`emailLinks.test.ts`).
- `legal.ts`: `LEGAL_VERSION`, the Terms and Privacy Policy version (the date they last changed). The pages show it
  as "Last updated" and each new account saves it. Change it whenever either page changes.
- `calendarDate.ts`: the date the calendars (Calendar Page, Month Calendar in Elements → Time & Date) show, an
  element's `calendarDate` (`{ year, month, day }`, DATA_VERSION 2, `20261231000800_calendar_date.sql`).
  `isRealCalendarDate` (zod's check: a real day, 1900–2100), `weekdayOf`, `monthGrid` (weeks from Sunday),
  `formatCalendarDate`, `toDateInput` / `fromDateInput` (the Set date box's "YYYY-MM-DD"), `todayCalendarDate` (a new
  calendar gets the computer's today, in the store's `addElement`; Claude's import uses `todayInManila` when it
  gives no date). Names are always English, so the server and every browser draw the same. No imports, so tests
  and `schema.ts` load it. Tests: `calendarDate.test.ts`.
- `optionRows.ts`: the math for option row heights (no imports, tested in `optionRows.test.ts`): `shareOut`,
  `heightsFromShares`, `gridRowNeeds`, `moveRowLine`, `oneLineHeight`, `rowMin`, `lineTop`, `fitIntoRow`,
  `OPTION_BOX_EDGES`, `OPTION_BORDER`. Saved as an option's
  `rowSize` and a slide's `gridRowSizes` (shares; DATA_VERSION 6, `20261231002100_option_row_heights.sql`).
  `measureOptions.ts` (browser only) measures what each option's row needs (a grid's re-fit). Never changes a text
  size. How the editor
  uses them: `src/components/editor/CLAUDE.md`, "Option row heights".
- `table.ts`: the table element's math (an element's `table`, DATA_VERSION 3, `20261231001100_table_element.sql`;
  cell fills DATA_VERSION 4, `20261231001900_table_cell_fill.sql`):
  a new table, adding, deleting and dragging rows and columns (with the table's new size), a cell's new text, Tab's next cell,
  a cell's place in px, and cell rectangles (`cellRange`, `withCellsFill`, `withCellsEmptied`, `tableRangeBox`) for
  the editor's multi-cell selection and background colors. Each makes new arrays, so a changed slide is saved. How
  the editor uses it: `src/components/editor/CLAUDE.md`, "Tables". Tests: `table.test.ts`.
- `slideDrag.ts`: what a slide dragged from the editor's Presentations panel carries (`slideDragData`: the slide and
  `DATA_VERSION`) and how a drop reads it (`readSlideDrag`: the slide, or "newer" / "broken"). How the editor uses it:
  `src/components/editor/CLAUDE.md`, "Slides from other presentations". Tests: `slideDrag.test.ts`.
- `age.ts`: the birthday rules (`MIN_AGE` 18, `MAX_AGE` 100), `ageOn` (the age in whole years on a date),
  `isAllowedBirthDate`, `birthDateRange` (the date picker's limits) and `todayInManila`. The database does the same
  math (`age_on`, `manila_today`, `20261220000000_age_gender_address.sql`): change both together. No imports, so
  tests load it (`userSettings.ts` can't be loaded by tests).
- `supabase/`: `client.ts` (browser), `server.ts` (server, with the login cookies), `admin.ts` (secret key, server
  only, skips the database rules: use only when there is no other way).
  Every client is typed with `Database` from `database.types.ts` (made by `npm run db:snapshot`, never edited), so
  `tsc` catches a wrong function, table or column name. A helper that takes a client uses
  `SupabaseClient<Database>`. The generated types can't say a function argument may be null, that a view's column
  is never null, or what a `json` result holds: cast at the call, with a short comment why (e.g.
  `base_updated_at: baseUpdatedAt as number` in `presentations.ts`).
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
  = 1 MB; also `readUploadBody`, an upload's (or a fetched answer's, like a YouTube
  thumbnail) body that stops reading at the size limit, and `isOurPhotoFile`, our
  file addresses; tests `photoTypes.test.ts`), `photoTickets.ts` (Claude's photo uploads), `cleanupPhotos.ts`
  (weekly cleanup; `isPastKeepTime` = older than 7 days, also used by Photo cleanup's Delete; tests
  `cleanupPhotos.test.ts`). `PHOTO_TYPES` (the files a teacher can pick) is in
  `constants.ts`, so pages outside the editor can use it without loading `photos.tsx` (which loads the editor's store).
  Editors' profile photos: `photoCrop.ts` (zoom and move math for the adjust box, with `photoCrop.test.ts`) and
  `profilePhotos.ts` (make the 400 × 400 square, upload it, remove it; kept apart from `photos.tsx` for the same
  reason).
- Claude (MCP): `drafts.ts` (drafts in Cloudflare D1), `importPresentation.ts`, `importGroups.ts` (Claude's
  `"group"` names → editor groups; tested, since `importPresentation.ts` loads drawings), `photoTickets.ts`.
- Timers: `cleanupPhotos.ts`, `cleanupAccounts.ts` (run by `worker.ts`). `cleanupAccounts.ts`, daily: deletes
  accounts unconfirmed after 3 days, `sign_up_attempts`, `password_reset_requests` and `password_reset_sends` older than a day, and `click_history` and `admin_actions`
  rows older than `KEEP_SAFETY_RECORDS_DAYS` (365, from each row's `created_at`; the Privacy Policy promises it),
  and who closed an announcement that ended over 30 days ago (`cleanup_announcement_dismissals`, 50,000 rows a call,
  up to 20 calls a day; the Privacy Policy promises it too).
- Drawings: `svgLibrary.tsx`, `flags.tsx`, `kids.tsx`, `solids.tsx`, and the big people drawings `schoolBoy.tsx` /
  `clipartKids.tsx`, which load only when needed (`peopleArt.ts`).
- Downloads (the editor's `DownloadButton` box: Word or Text, All slides or Custom; made in the browser, sent nowhere):
  `presentationOutline.ts` reads a presentation once for both, only the chosen slides (`positions`: places in the
  slide list, 1 = first; `parseSlideNumbers` reads the Custom box's "1-3, 5" and says what's wrong): the details,
  then each slide with no label (no "Q1" / "Slide 1"; a question starts with its number, counted like the editor's
  but among the chosen slides only, so they go 1, 2, 3; a custom slide "11–15. …"; other and hidden slides have
  none): question, options (none marked), embed link, text boxes, tables, diagrams, bar graphs, clocks, calendars
  and photos; other drawings are left out. Elements are read box by box (an element in a box is placed relative to
  it): the question box's, the strip or side box's, each option's under its letter (a picture-only option shows as
  "C." with its picture), then the free ones, each group top to bottom. The numbered questions' answers go in an
  Answer key at the end (`answerKey`; a choice as "A. Jupiter" with the option's pictures, a canvas answer under its
  number); a hidden slide's answer stays with it, and a blank or title slide's is its "Reveal". Photos keep their
  crop and flips. A clock, calendar, bar graph or diagram never changed saves no setting, so it's found by its asset
  id and shows its starting look (`elementDefaults.ts`); only the digital clock writes AM / PM, like the slide. Also `presentationFileName`, `saveFile`, and `htmlToText` (Claude's `read_presentation`
  uses it too; `presentationFileName` cuts at 100 whole characters). `markdownExport.ts` writes it as Markdown in a
  `.txt` (photos as links, a cropped one says so; "## Answer key");
  `wordExport.ts` as a real `.docx` with the `docx` package (tables as Word tables, links clickable, the Answer key
  on its own page), imported only on a Word download.
  Its photos are the real pictures: the browser reads each one once straight from R2 (never through our server)
  and redraws it as a JPEG, cropped and flipped like the slide (Word can't show WebP; at most 1,600 px a side, as
  wide on the page as on the slide; 4 photos at a time, each canvas freed at once; one file per `photoKey`).
  That needs the R2 bucket's CORS rule (Cloudflare → R2 → the bucket → Settings → CORS policy: `GET` from
  quizmatter.com, the dev preview and localhost); a photo it can't read stays a "Photo (link)" and a toast says how
  many. Tests: `markdownExport.test.ts`, `wordExport.test.ts` (unzips the file).
- Text: `richText.ts` (tiptap setup, safe HTML). Saved text keeps typed spaces (runs of spaces, spaces at a line's
  start): the editor loads it with `readSavedText` (a document, so no editor-wide `parseOptions` changes later
  `insertContent`) and the read-only text with `toSafeHtml`. Both first run `tidySavedHtml` (a tab or line end older
  Claude imports saved shows as one space, a line end at a tag's edge goes). New text from outside goes through
  `tidyText` in `textToHtml` and `stripMarkup` (`\r\n` → a new line, a tab → one space), so a Claude import's plain
  text and HTML match. Tests: `richText.test.ts`, `e2e/text-spaces.mjs`. `format.ts` (dates, labels), `blanks.ts` (`blankRuns`,
  `markBlanks`: "___" blanks joined into one line, display only; tests `blanks.test.ts`) and `blankLines.ts` (the
  same in the editor, a Tiptap decoration). See `src/components/editor/CLAUDE.md`, "Slide text size".
- `wordText.ts` / `wordFile.ts`: the editor's Word file panel (see `src/components/editor/CLAUDE.md`).
  `wordFile.ts` (`readWordFile`, `readWordBytes`) unzips only `word/document.xml`, `word/numbering.xml` and `word/styles.xml` with `fflate`, in the browser
  (20 MB at most, and its text part 20 MB unzipped, checked from the zip's list before unzipping; `.docx` only,
  `WORD_FILE_ERROR`). `wordText.ts` (no imports): `wordLines` (one line per paragraph
  and line break, only `<w:t>` text, a text box's `mc:Fallback` copy skipped, nested paragraphs their own line; equations as plain text: x², H₂O,
  (x+1)/2, ³√8, [a], ∑ᵢ₌₁ⁿi; the non-breaking hyphen; two choices side by side (a tab or 3+ spaces before "C.") split into two lines; Insert → Symbol's Greek letters and math signs, nothing for
  Wingdings),
  `parseNumbering` (Word's list button numbers: `wordLines` writes "1.", "a)", "(I)" in front of a list paragraph,
  counting per list and depth like Word, restarts and start values kept, bullets left out, a tracked change's old
  numbering skipped; lists made from the same `w:abstractNum` share one count, like Word, unless one restarts; "01."
  (`decimalZero`) kept), `parseStyleNumbers` (a paragraph style that numbers, e.g. "List Number", through `w:basedOn`),
  text moved with Track Changes on read once (`w:moveFrom` skipped), `stripItemMark` (a single letter only as A–E in
  an answer box or I / V / X in the question box, never right before another initial: "J. K. Rowling"), `droppedTextHtml`, `pickedSlideTexts` + `PICKED_LINES_MAX` (ticked lines → question and A–D), `suggestItems` (numbered lines and up to 4
  lines under each, for Show suggestions; `stripItemMark` also removes a "____" blank in front of a number), `WORD_LINES_MAX` (2,000). Tests: `wordText.test.ts`, `wordFile.test.ts`.
- `sameValue.ts`: whether two settings hold the same values in any key order (the database re-sorts saved keys, e.g.
  a fraction comes back as `{parts, whole, shaded}`); `MathToolControls` uses it. Tests: `sameValue.test.ts`.
- `support.ts`: `SUPPORT_EMAIL` and `FACEBOOK_URL`, the one place each is written (the support address is an alias
  of the admin's Google Workspace inbox). Used by `src/components/SupportEmail.tsx`, `src/components/Footer.tsx` and
  the "blocked" messages (`QMBAN`, the login page).
- `textLimit.ts`: `TextLimit`, the Tiptap extension `useCanvasTextEditor` adds to every text on the canvas. It
  refuses a change (typing, paste, a format button) that would push the text past `PLAIN_TEXT_MAX` (5,000; the
  question and answer choices) or `HTML_MAX` (50,000; every text, measured as `getHTML()` saves it), both from
  `schema.ts`, with one toast (`TEXT_LIMIT_MESSAGE`, id `text-limit`). Only a change that makes an over-limit text
  longer is refused, so deleting always works, and an outside change (`setContent` without an update: undo, Clear
  text) always goes through. Test: `e2e/text-limits.mjs`. Spec:
  `docs/superpowers/specs/2026-11-17-text-limits-while-typing-design.md`.
- Editor hooks: `useEditorShortcuts`, `useMarqueeSelection`, `useElementDropTarget`, `useCanvasTextEditor`,
  `useFormatTexts`, `useTextRoom` (the question, answer choices and text boxes: whether the text is cut off, for the "+…" mark, and,
  when asked, whether the next size up fits, for the grow mark; its file is `useHasHiddenText.ts`; table cells get no
  mark), `textFit.ts` (browser only: `measureRoom` and
  `fittingSize`, both on a hidden, unrotated copy of the text at the box's real width; the click's biggest size that
  fits), `textRoom.ts` (no imports, tested: `isCutOff`, cutting the empty room under a last line with no g, y, p…
  doesn't count; `largestFittingSize`, the size search that halves the range), `markPlace.ts` (no imports, tested:
  where the "+…" and grow marks sit, outside the box and away from the slide's edges).

## Picture Shapes (for Claude's import)

The import runs on the server, where drawings can't be measured, so `src/lib/assetShapes.json` keeps each library drawing's real shape (without the empty space around it). The import fits every picture's box to it, like the editor does. Spec: `docs/superpowers/specs/2026-10-10-picture-drawn-shapes-design.md`.

- After adding or changing library art, update the file: `npm run dev`, open `/dev/asset-shapes`, download, replace `src/lib/assetShapes.json`, commit.
- A drawing missing from the file still works, it just keeps the box it's given.
