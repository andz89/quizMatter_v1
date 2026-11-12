# Browser tests (Playwright)

Playwright is already installed (`playwright` in devDependencies, its Chromium in `%LOCALAPPDATA%\ms-playwright`).
Don't install it again, and don't make a new folder for browser tests in the scratchpad: write them here, using
`lib.mjs`.

## Running them

1. The local Docker Supabase is up (`npx -y supabase@latest start`).
2. `npm run e2e:dev` (`dev.mjs`, keep it running): the app on **http://localhost:3100**. It reads the local keys from
   `supabase status` (they win over the live ones in `.env.local`), applies the D1 migrations locally, and sets
   `QM_E2E=1`, so `next.config.ts` uses local copies of D1 and R2 (no Cloudflare login needed) and builds in
   `.next-e2e`, so it can run next to `npm run dev`.
3. `node e2e/<test>.mjs`. Each prints `PASS` / `FAIL` per check and `N of M checks passed`, and exits 1 on a failure.
   Screenshots go to `e2e/shots/` (not saved in git).

## Writing one

A plain Node script with the `playwright` library (not `@playwright/test`). From `lib.mjs`:

- `env` (the local keys; it stops if they aren't for 127.0.0.1), `APP`, `SHOTS`.
- `makeTeacher({ first, last, superAdmin, admin })`: a new confirmed account with a unique email;
  `superAdmin` / `admin` also put it in `admins` and set up an authenticator app (`enrollSecondFactor`), since admins
  need the second step; their logins below then pass it (aal2). An admin without one: make a teacher and insert the
  `admins` row with `psql`. `deleteTeacher(teacher)` in `finally` deletes it and its presentations.
- `loginSession(teacher, { skipSecondStep })`: a fresh Supabase session (with the second step when the teacher has
  `totpSecret`); `totpCode(secret)`: the app's 6-digit code now; `enrollSecondFactor(teacher)`.
- `sessionCookies(teacher, change)`: a fresh login session as cookie pieces (`change` can edit it, e.g. make it
  look expired), for a plain `fetch` to the app.
- `loggedIn(browser, teacher, viewport, options)`: a browser context already logged in (the session goes into the
  `sb-127-auth-token` cookie, so the login page's Turnstile box is skipped). `options` go to Playwright's `newContext`
  (e.g. `timezoneId`, `locale`); `skipSecondStep: true` logs an admin in with the password only (aal1). It blocks every `*.supabase.co` request, and `finish()` fails the run if one was tried.
- `api(path, init)`: the local API with the service role key (e.g. insert presentations and slides).
  `psql(sql)`: SQL as postgres in the Docker database. Some triggers still refuse postgres (e.g. only an admin may
  hide, and an open review locks a lesson even against deleting), so do those as the right person.
- `asUser(person, path, init)` / `rpc(person, name, args)`: the local API as that person (their own login token),
  so the database rules apply to them, like the app's calls. They return `{ ok, status, body }` and never throw on a
  refusal; `body.code` is the refusal's code (`QMREV`, `QMSUB`, …). The token is kept per person;
  `forgetLogin(person)` drops it (e.g. after their second step was set up).
- `fakeTurnstile(context)`: Cloudflare's real "are you human?" box never passes headless; this answers its script
  with a stand-in that passes at once (local Supabase has no captcha), so a test can press sign up's or Forgot
  password's button.
- `check(name, ok, detail)` per check, then `finish()` at the end.
- Emails: local Supabase keeps every email in Mailpit (`http://127.0.0.1:54324`, `/api/v1/search`,
  `/api/v1/message/<ID>`); see `forgot-password.mjs`.

Tests that delete data (the announcements ones empty the announcements table) do so only in the local database.

## The tests

- `forgot-password.mjs`: the login link, the Forgot password page (logged out only), the reset email arriving in
  Mailpit (typed with spaces and capitals), the same "Check your email" for an email with no account and for
  Supabase's two email limits (played back, since local waits only 1 second), and other refusals keeping their
  words. Every email link is opened and then Continue clicked
  (`continueLink`). The page's own link (PKCE) opens Set a new password. Then the email's link: logged in as someone
  else the page says log out first (no Continue); a plain `fetch` of it first (like a mail scanner) doesn't use it up;
  Set a new password ("For <email>", "Go to home", mismatch and same password refused, a new one saved and the login
  lock ended), the other device's refresh token stops working, new password in / old out, the used link →
  `/login?error=reset`, `/set-password` logged out → login, a link with no token (reset or sign up words) or an
  unknown type → login, Log out on the link page → Continue works, Continue while logged in (cookies added after the
  page opened) refuses and leaves the link unused, a banned teacher's link → `/login?error=blocked`, and a real
  unconfirmed sign up link (`type=email`, from `generate_link`) → home, confirmed. A failed log out (on the link page and in the account
  menu) says so. Supabase can't be reached at Continue (it stops the local gateway, `supabase_kong_quizBuilder`,
  for a moment): the page says the link still works, and it does. Last, sign up's "Check your email" words and links
  (Supabase's sign up answer played back, so no account is made; screenshot `signup-check-email.png`), and the reset
  limit: 3 real emails, the 4th shows the same screen and sends none; an address at 10 requests doesn't reach Supabase
  (the test adds `cf-connecting-ip` to the page's request, as Cloudflare does). Then Admin → Safety → Password resets
  as the super admin: "3 of 3 · Limit reached", the addresses' counts (an IPv6 /64 as one), and "Over the limit"
  after a 4th send (screenshot `admin-safety-resets.png`). Run it alone:
  the outage check stops the gateway every local test uses (Ctrl+C or a failure starts it again).
- `auto-save.mjs`: an edit saves itself within 12 seconds with no toast, and nothing is sent without a change. It
  holds back when the day's auto saves are used up (Ctrl+S still saves), after a refused save, for restored work, on
  a Claude draft and on a live QuizMatter lesson; it retries after a lost connection; a review saves its own draft.
- `save-button-width.mjs`: at 1280 px with a text box picked, the Save button never runs into the toolbar in the
  middle of the bar (saved, unsaved, saving, couldn't save), and keeps its size while it saves.
- `hidden-slides.mjs`: hide a slide, save, present (→ / ← skip it), the all-slides grid, show it again.
- `add-slide-menu.mjs`: the slide's + and the workspace's Add slide have no "Embed image" (the other 8 types stay),
  and an image slide saved before still opens with its picture.
- `embed-slides.mjs`: add an Embed video and an Embed slides slide in the editor (a bad link is refused), save,
  reload, present fullscreen (only the slide shown plays its embed; YouTube and Google Slides are stand-in pages; the buttons
  stay on a live player and hide on other slides), Exit.
- `calendar-date.mjs`: add a Calendar Page and a Month Calendar (both start on today), Set date to 29 February 2024,
  Today, save, reload.
- `table-element.mjs`: add a table, type, Tab, the text bar, both "+", the Table menu, undo taking away a picked or
  typed-in row, Delete on a picked cell, duplicate, dragging column and row lines, save, reload, the slide's edge, present, a table in a question
  slide's box, long text and a very long word wrapping at the table's text size (never shrinking).
- `table-date-time.mjs`: a table, the Clock, the Digital Clock, the Calendar Page and the Month Calendar together on
  one slide, each added from the Elements panel and dragged to its own spot: typing and Tab, Set time (the hands' real
  angles, AM/PM, Reset, Undo, Redo and Ctrl+Z with the box staying open; a slide already holding an impossible time
  opens showing 10:10), Set date (an empty date and a year before 1900 are ignored), duplicates, save, reload
  (the panels read the saved values back), present fullscreen, Exit, and neither opening nor presenting counts as a change.
- `diagrams.mjs`: the Flowchart, Cycle, Mind Map, Tree and Factor Tree, each on its own slide: every "+" and × up to the
  limits, the panels, typing (Enter, Escape, Shift+Enter, long, empty, `<` and `&`, a click outside), dragging and
  resizing a box and its size limits, Tidy up, Reset, undo, box styles (all boxes or the picked one, a new box copies
  them), flip, rotate, a duplicate, moving a Factor Tree number with those under it, a Factor Tree at 8 levels and at
  31 boxes, a diagram stopping at a question box's edge, diagrams saved earlier, broken saved diagrams opening with
  their starting boxes, whole words shrinking instead of being cut, a box's corner at the diagram's corner, save,
  reload, present.
- `diagrams-date-time.mjs`: diagrams, clocks and calendars together, each scenario with its own presentation and page
  so one failure can't hide the next: clock hands and digital times at their edges; every calendar drawn against
  dates worked out without the app's code (4 and 6 week months, leap days, 1900 and 2100); the date box and sliders
  by keyboard (it first finds which part of the date box comes first on this computer); switching between kinds,
  grouping, things on top of each other; undo across kinds and undo taking away what's picked; Delete on a picked box
  in all five diagrams (only that box, by its ×'s rules); typing in a box
  (Ctrl+S mid-typing, a 50,000 letter paste); dragging at 50% and 150% zoom and on turned and flipped diagrams; a box
  dragged to its limit; copy, paste and Duplicate slide; the question and answer boxes; slides with no time or date;
  bad saved dates, times and diagrams still opening; every field surviving a save; present, All slides, the view
  page; a 1280 × 720 screen; New Year's Eve in Manila and Honolulu (Playwright's `clock`, a German browser).
  `ONLY="date box|zoomed" node e2e/diagrams-date-time.mjs` runs just the scenarios whose names match.
- `math-tools.mjs`: every math tool added from the Elements panel, then each panel at its limits with the drawing read
  from the SVG: number lines, fractions, the counting frame, blocks, thermometer, bar graph, protractor. Save, reopen
  and read the panel back; Reset and undo with the panel open; copy, paste, Duplicate slide; turned and flipped; groups;
  the question and answer boxes; every field surviving a save; present, All slides, the view page; a 1280 × 720 screen;
  bad saved values and numbers no panel can make. `ONLY="bar graph|undo"` runs just the scenarios that match.
- `all-elements.mjs`: every tile in the Elements panel added, drawn, saved and opened again (the categories are read
  from the panel), then pictures, photo crops, squares, lines, 3D solids, text boxes, custom drawings, layers, align,
  groups, moving into and between boxes (Alt keeps a free picture on the slide), a photo that never answers, letters
  keeping their size when opened again, a slide at 1,000 elements, present, the view page, and about 30 kinds of bad
  saved data. Each scenario has its own presentation and page. `ONLY="crop|layers"` runs just the scenarios that
  match; to run tiles add `lists its categories|every tile$` (for example `ONLY="lists its categories|every tile$|every tile: Emoji"`).
- `proxy.mjs`: an expired session opening /login is refreshed and the redirect keeps the new cookies; `/api/mcp`
  skips the proxy, `/api/mcp-admin` and `/api/claude-photos` don't.
- `reports-plain-admin.mjs`: Admin → Reports as a plain admin: a teacher's reported copy has Hide and Delete, a
  reported QuizMatter lesson has neither and says why.
- `submissions.mjs`: Submit to QuizMatter from start to end. An editor submits from the card's ⋮ menu (an empty
  presentation is refused). While it waits, the card says so, has no Edit or Delete, and changes, slide changes,
  deleting and a second submit are all refused. A plain teacher has no Submit, and their call is refused. A plain admin
  sends it back with a note, and the editor sees the note in Reviews & submissions. The editor fixes it and clicks
  "Submit again". The super admin approves it: QuizMatter gets a shared copy that the admin owns, with the editor as
  Author and the same slides. The original stays the editor's, unlocked, and can't be submitted again. Deleting the
  original keeps the receipt ("(original deleted)", with its link) and QuizMatter's copy. Opening a waiting one's
  editor goes to the view page. A presentation
  hidden while it waits can't be approved. A decided presentation's admin page shows "Page not found" with status 200,
  because `loading.tsx` was already sent.
- `reviews.mjs`: Presentation reviews. A plain teacher has no Review button. An editor clicks Review, and the lesson
  locks: teachers see "Under review" and can't copy it, another editor can't start, and even the owner can't change
  it. The editor saves a draft, leaves, and clicks Continue review (the draft is still there). They submit, and the
  submitted round opens view only. A plain admin sends it back with a note; the editor's banner shows it, and Escape
  closes the comments box. They submit again, and the super admin publishes: the live slides change, the reviewer is
  listed, and the lesson unlocks. Then nobody can start another review until the admin clicks "Open to all".
  Other paths: an editor stops their own review ("Canceled by you", draft gone, nothing changed); an admin cancels
  one while it's open in the editor (the editor's next save is refused; "Canceled by QuizMatter"); an editor
  loses the role (their open review and waiting submission are canceled and unlock); a reviewer's account is deleted
  (the lesson unlocks, and another editor can start); and the author's own update of a closed lesson ("Update this
  lesson"; publishing it adds no Reviewed by row and keeps the last reviewer and Open to all as they were).
- `editor-edges.mjs`: the edges of those two. Submitting from the editor's Share card saves an unsaved edit first
  (and Published is greyed out for editors; their publish call is refused). An editor's photo stays private (and
  can't be removed, `QMPHL`) while its submission or review waits, and turns public once approved or published. Two
  admins clicking Approve, or Publish, at the same moment: one works, the other is refused, one copy or one Reviewed
  by row. An older app tab's review save and submit get `QMOLD`. Banning an editor in Admin → Teachers, or a plain
  admin removing one in Admin → Editors, takes the role away and cancels their review and waiting submission;
  unbanning doesn't give the role back. The submission page's "Copied from" line (and "… that was deleted"; the
  database keeps only a real source, so the test copies a lesson, then deletes it). No admin, review or submission
  page scrolls sideways at 390 px. While the Details box is open in the editor, Ctrl+V, arrows, Delete and Ctrl+Z
  change nothing behind it. The banned-editor refusal at Approve (`QMBRV`) can't be reached from the app: banning
  cancels the submission first.
- `second-factor.mjs`: two-step login. An admin member without an authenticator app is sent from Admin to
  Account → Two-step login, a wrong code is refused, the right one (made from the key on the page) turns it on and
  opens Admin. A password-only login is sent from the admin pages to `/login/verify` (wrong code refused, right code
  opens Admin and the pages stay open); `is_admin` is false before and true after; the login page itself goes to the
  verify page after the password and then to the remembered page; a teacher gets "page not found" on the set-up page
  and Admin, and the verify page says there is nothing to check.
- `account-password.mjs`: Account → Password. A direct call to Supabase without the current password, or with a
  wrong one, is refused; on the page a mismatch, the same password and a wrong current password each get their
  words, and the right one changes it (new password in, old out, the browser stays logged in).
- `security-headers.mjs`: every page and API answer carries the security headers (`src/lib/securityHeaders.ts`), the
  home page, editor, view page and account still work with the enforced policy, and the report-only policy logs
  nothing in the console on them (a missing outside host would).
- `photo-delete.mjs`: Photo cleanup's Delete refuses a file under 7 days old (a WebP and an announcement's GIF,
  which counts as our file), and the page shows no Delete button on it.
- `photo-uploads.mjs`: a plain teacher's profile photo is refused before anything is counted; an editor's is stored
  and the profile switches to it, counted once; a too-big upload sent in pieces (no Content-Length) gets 413.
- `announcements-admin.mjs`: the super admin makes a corner box and an HTML modal in the form; a teacher sees them.
- `announcements-show-after.mjs`: the super admin sets "It shows after 8 seconds" in the form (not on a top bar;
  the list line, the saved number, the edit page). The teacher's modal waits, keeps counting across a reload and an
  in-app move, starts over in a new tab, doesn't count in a background tab or while presenting; a corner box with no
  wait shows at once, then waits while the modal is up.
- `announcements-interval.mjs`: the super admin picks "Again every 2 minutes" in the form (the box starts at 15;
  backspacing and typing 30 gives 30). The teacher's modal, once closed, stays gone across an in-app move and a
  reload and comes back after 2 minutes (Playwright's `clock` jumps the time), comes back as soon as the tab is in
  front after a laptop sleep (`clock.setSystemTime`: the time jumps but no timer fires), waits while presenting,
  shows at once in a new tab, and no closed record is saved.
- `announcements-pages.mjs`: announcements put straight in the table, checked on the home, saved, liked, search,
  account and editor pages, at desktop and phone width.
