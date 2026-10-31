# Code Map (where things live)

Read this first: it tells you where to look before you plan. Folders marked **(notes)** have their own `CLAUDE.md`
with how that part works; it loads when you open a file there. When you plan work in one of them, read its notes
first.

- `src/app/` **(notes)**: the teacher pages. `(home)/` home tabs (My presentations, From QuizMatter, Other
  teachers, Saved, Liked, Reviews & submissions, search) and folders; `presentation/[id]/` the view page and `edit/` the
  editor page; `presentation/new/` opens Claude's drafts; `account/`, `login/`, `signup/`, `teachers/[slug]/`
  (profiles); `oauth/` Claude's login; `(legal)/` the Privacy Policy and Terms of Use (version in `src/lib/legal.ts`). Teachers' server actions:
  `actions.ts`, `folderActions.ts`, or an `actions.ts` next to the page.
- `src/app/admin/` **(notes)**: the admin pages (Overview, the menu
  with counts, Admin log). `src/app/admin/announcements/`: Announcements (see "Announcements" below).
- `src/app/api/` **(notes)**: photo uploads and deletes (files in Cloudflare R2).
- `src/components/editor/` **(notes)**: the editor. Its state and every edit: `src/lib/store.ts` (zustand).
- `src/components/presentation/` **(notes)**: presenting fullscreen (slide effects) and view-only slides.
- `src/components/` **(notes)**: shared UI (`Spinner`, `TopLoadingBar`, `LinkPending`, `Modal`, `NavBar`, `Footer`,
  …). The app's confirm box is `src/components/editor/ConfirmModal.tsx` (used on every page). The support email and
  Facebook link: `src/lib/support.ts`.
- `src/lib/` **(notes)**: helpers, zod schemas (`schema.ts`), saving and loading.
- `supabase/migrations/` **(notes)**: the database. Its functions and triggers hold the real rules and limits.
- `src/pages/api/` **(notes)**: Claude's connector (MCP server). Its drafts live in Cloudflare D1 (`d1/migrations`).
- `src/proxy.ts`: the login check before each page (logged-out visitors may open only login, sign up, the email
  confirm link, Privacy and Terms), and the maintenance stop (see "Maintenance" below; `src/app/maintenance/` is
  its page). `worker.ts` + `wrangler.jsonc`: Cloudflare timers (cleanups).
- `docs/superpowers/specs/`: the designs of past features. Read the matching one before changing a big feature.

**How a save works:** an edit in the editor → a store action in `store.ts` (kept for undo) → Save / Ctrl+S →
`savePresentation` → `savePresentationToDb` (`src/lib/presentations.ts`) checks with zod (`schema.ts`) → the
`save_presentation` database function → a refusal comes back as a code (`QM409`, `QMREV`, …) → `REFUSALS` turns it
into a message → sonner toast.

**How a presentation opens:** `fetchPresentation` (`src/lib/fetchPresentation.ts`) on the server → the page picks
edit / view / review → `Editor` → `store.loadPresentation`.

**Every feature has notes, and they stay true (required):**

- Every feature must be explained in the `CLAUDE.md` of the folder its code lives in (or here, for rules that span
  many folders, like Reviews). A new feature = new notes in the same commit: a section in that folder's
  `CLAUDE.md`, or a new `CLAUDE.md` for a new folder (and a line in this map).
- When you change a feature or a folder (new file, moved logic, new rule, new limit, removed part), update its notes
  and this map in the same commit. Delete notes about things that are gone.
- **The Privacy Policy stays true (required):** a change to what the app collects, who sees it, how long it's kept,
  or which outside service holds it updates the Privacy Policy (`src/app/(legal)/privacy/page.tsx`) and
  `LEGAL_VERSION` (`src/lib/legal.ts`) in the same commit.
- Notes say how things work and connect, in plain English, short. Read the real code before writing them; never
  guess. Stale notes mislead the next session.

# Workflow Preferences

**Always use the Superpowers plugin** (brainstorming, writing-plans, test-driven-development, etc.) for every task. Don't ask first.

**Always use Docker for all testing.** Every test that touches the database, migrations or Supabase runs on the local
Docker stack (`npx -y supabase@latest start` / `db reset`), never on the live project. Never test against the live
Supabase database (no `execute_sql` or `apply_migration` on it to try things out). See "Tests" below.

The only exception: if the user says not to (e.g. "don't use superpowers"), don't use any Superpowers skill for that prompt, and follow the plan-first rule below instead.

The plan-first rule (only when Superpowers is off): whenever a requested feature or adjustment would change the structure or behavior of the app (new data flow, new component/module, schema change, new dependency, altered logic), do NOT write code first. First reply with a plan: describe the structure/architecture you intend to build, walk through the logic in detail, and explicitly call out any external or internal library you plan to use. Wait for the user to review and approve the plan before implementing.

After implementing, do a checking step before saying the work is done:

1. Run `npx tsc --noEmit` and `npm run lint`, and fix any errors in the files you changed.
2. Read your changes again (`git diff`) next to the approved plan. Make sure every part of the plan is done, nothing extra was added, and the rules in this file were followed (zod before saving, the one Spinner, the design system, npm 10 for packages, the folder `CLAUDE.md` notes still true, etc.).
3. Tell the user what you checked and what passed or failed.

# Installing Packages (npm version)

The app deploys on Cloudflare Workers Builds, which runs `npm ci` with **npm 10.9.2**. The user's machine has npm 11, which writes a `package-lock.json` that npm 10's `npm ci` rejects ("package.json and package-lock.json are not in sync") and the deploy fails.

So whenever you add, remove, or update a package, always use npm 10.9.2 instead of plain `npm`:

- Add: `npx -y npm@10.9.2 install <package>` (dev: `npx -y npm@10.9.2 install -D <package>`)
- Remove: `npx -y npm@10.9.2 uninstall <package>`
- Any other change to `package.json` dependencies: run `npx -y npm@10.9.2 install` afterwards to rewrite the lock file

Do this yourself — don't ask the user to run it. Commit `package-lock.json` together with `package.json`.

# Code Review Commands

When the user names a feature or part of the app they want reviewed (e.g. "review the slide limits", "review the login page"), find the files that feature lives in and give them a ready-to-copy `/code-review` command with those file paths as the target, so the review looks only at that feature:

```
/code-review high src/lib/schema.ts src/lib/presentations.ts supabase/migrations/20261011000000_lower_limits.sql
```

- Search the code first (Grep/Glob). Don't guess paths from memory.
- Include every file that holds the feature's logic: components, server actions, `src/lib` helpers, zod schemas, and the Supabase migrations for it. Leave out files that only mention it in passing.
- Keep the effort level the user asked for (default `high`).
- Under the command, list each file with a few words on why it's included, so the user can drop any they don't want.
- Don't run the review yourself. Give the command, and let the user run it.

# Code Style

Keep the code:

- Simple and readable
- Well-structured without over-engineering
- Optimized where it actually matters
- Easy to maintain and modify
- Free of unnecessary abstractions, hooks, utilities, or patterns unless they provide a real benefit

# Tests

Run `npm test` (Node's built-in test runner). Tests sit next to the code as `*.test.ts` in `src/`. A test can import only `.ts` files whose own imports are `.ts` (no `.tsx`, no JSON); `@/` means `src/`. SQL tests are in `supabase/tests/`; each rolls back what it did. All testing uses Docker: run them only on the local Docker
database, never the live one: `npx -y supabase@latest db reset` (replays every migration), then
`docker exec -i supabase_db_quizBuilder psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/<file>.sql`. A file's
first lines say when it must run as `-U supabase_admin -d postgres` instead (`account_delete.sql`,
`blocked_email_domains.sql`). It passes when it ends with `ROLLBACK` and no `FAIL` or `ERROR`.

# Saving Data

Validate all input data with zod before saving it to Supabase — from the editor, forms, Claude (the MCP server), or anywhere else. Parse it with the matching zod schema right before the insert/update/rpc call, and don't save anything that fails. Put limits (like maximum text length) in the zod schema, so they're checked in one place.

Changing the saved shape of a presentation or slide (a new field, a renamed one, a removed value) follows the rules
in `src/lib/CLAUDE.md`, "Changing the saved shape": upgrade old data in `upgradeSlide` / `upgradePresentation`, bump
`DATA_VERSION`, bump the database's `current_data_version()` to the same number in a migration, and run Admin → Data
check before deploying. Apply that migration before the app deploys: every saved version is capped at it, so until
then older tabs aren't refused.

# Click Limits (pausing a feature clicked too fast)

There is ONE system for pausing a feature when a teacher clicks it too fast (e.g. bookmarks: 20 clicks in 25 seconds → paused 10 minutes, or 1 hour if it happens again within 24 hours). Reuse it; never build a second one. To add a feature:

1. A migration that inserts its row into `click_limits` and calls `count_click('<feature>')` from that feature's trigger or database function (see `supabase/migrations/20261013000000_click_limits.sql`).
2. Add it to `CLICK_FEATURES` in `src/lib/clickLimits.ts`.
3. In the app: read the refusal with `pausedUntilFromError`, call `pauseFeature`, and disable its buttons with `useIsPaused`. The sticky notice at the bottom (`src/components/ClickPauseNotice.tsx`, in the root layout) shows by itself.
4. Admin → Safety lists it by itself from its row; add what it counts to `COUNTS` in `src/app/admin/safety/page.tsx`
   (and its words to `PAIRS` there if it has a `<feature>_daily` limit too).

Every pause, automatic ban and admin release is written in `click_history` (Admin → Safety → History, with the
teacher's name and email). Each row keeps the email, so it stays after the account is deleted, for 1 year
(`20261213000000_click_history_keeps_email.sql`; the daily cleanup deletes older rows).

A feature's `ban_after_pauses` (in `click_limits`; bookmarks: 3) turns a chain of that many pauses, each within `repeat_within_hours` of the last, into a real ban: a `banned_users` row marked `is_automatic` (Admin → Teachers shows "Automatic") plus Supabase's login ban. Leave it empty for a feature that should never ban. See `supabase/migrations/20261014000000_click_auto_ban.sql`.

Features that pause and then ban (3 times in a row): bookmarks (`saved`), `like`, and saving presentations
(`presentation_save`: every change to a teacher's presentations or slides, once per request), photo uploads
(`photo_upload`), photos sent straight to the table (`photo_rows`), `folders` (folders and folder items) and
`settings` (`user_settings`), each 30 in a minute and also a daily limit (`<feature>_daily`: saves 1,000, uploads and
photo rows 300, folders and settings 500; paused until midnight Philippine time), so a slow script is stopped too
(`20261211000000_save_photo_click_limits.sql`). A button covered by both checks `useIsPaused(feature,
feature_daily)`, and a refusal asks `checkPauses` (both give the same `QMBLK`). Pause only, never ban: `share`, `publish`, `create`,
`display_name`. Size limits (100 slides, 50 presentations, …) and refusals like an old tab or a review lock are
never click limits: an honest teacher hits them.

# Presentation Reviews (editors checking QuizMatter presentations)

Editors (teachers an admin trusts) review shared QuizMatter presentations; an admin publishes or sends back each review. Full design: `docs/superpowers/specs/2026-10-04-presentation-reviews-design.md`. When changing it, keep these rules:

- **Editor role:** the `editors` table and `is_editor()`. Only the super admin gives it, in Admin → Teachers (`setEditor`; a box asks first, since their published copies are removed; never to an admin or a banned teacher, which the database refuses too), and any admin takes it away; Admin → Editors (`src/app/admin/editors`) lists the editors with their review numbers, open round and how many presentations / photos they made, and can remove them (same `setEditor`); a name opens `/admin/editors/<id>`, a view-only page of their presentations (with submission status), their reviews and their uploaded photos. Taking it away cancels that editor's open review.
- **One round at a time** per presentation, in `presentation_reviews`: reviewing → submitted → published (or sent back to reviewing, or canceled by Stop review). While reviewing or submitted the presentation is **locked**: database triggers refuse every change to it and its slides (error `QMREV`), except hiding. Only `publish_review` gets through. A round whose reviewer's account is gone doesn't lock, and admins can cancel any open round ("Cancel review" on the Under review list).
- **The reviewer's work is a draft** in `presentation_reviews.draft`, never in `presentations` / `slides`, until an admin publishes. A reviewer can't change the author, sharing, owner or "from QuizMatter".
- **The rules live in the database functions** (`start_review`, `save_review_draft`, `submit_review`, `stop_review`, `publish_review`, `send_back_review`, `set_review_open`, `admin_cancel_review`, `review_status`, `my_reviews`, `admin_reviews`, `admin_reviewers`), each checking who is calling. Change a rule there, not only in the app. Migrations: `20261019000000_presentation_reviews.sql`, `20261020000000_review_submit_checks.sql`, `20261021000000_review_approvals.sql`, `20261022000000_review_fixes.sql`, `20261025000000_review_reopen_and_canceled.sql`, `20261102000000_review_auto_reviewer.sql`, `20261202000000_author_updates.sql`, `20261203000000_author_update_published.sql`, `20261209000000_data_version.sql` (newest `save_review_draft`, `publish_review` and `admin_reviewers`: a draft keeps its `draft_version`, and an older app tab's save or submit is refused, `QMOLD`), `20261210000000_data_version_cap.sql` (`draft_version` is capped at `current_data_version()`), `20261210000200_database_fixes.sql` (newest `check_review_draft`: a draft is checked like the tables check, so a bad one is refused at save, not at publish), `20261210000500_admin_overview_counts.sql` (newest `start_review` and `submit_review`: a round keeps its first submit's time, `first_submitted_at`, for Admin → Overview).
- **"Reviewed by" is automatic:** there is no form. On submit, `submit_review` takes the reviewer's name (display name, or the part of the email before "@") and email from their account; the app sends only the date (the reviewer's today). No background text.
- **In the app:** reviewer saves go through `src/lib/reviews.ts` (zod first); reads through `src/lib/reviewStatus.ts`. The editor's review mode is `review` in the store plus `ReviewControls` (Save as draft + the ⋮ menu). A submitted review opens view only (`ReviewSubmittedView`, no editor). Admin pages are under `src/app/admin/presentations/reviews`. On the home pages, editors get a "Reviews & submissions" page (`/reviews-submissions`, `src/app/(home)/reviews-submissions/page.tsx`): one `ReviewsTable` with their open and canceled rounds ("Canceled by QuizMatter" / "by you", from `my_reviews()`) and, below them, the live presentations they reviewed ("Published", from their `presentation_reviewers` rows), then their submissions (see "Submit to QuizMatter") in a `SubmissionsTable`. After an admin publishes a review, nobody can start another until the admin turns on "Open to all editors". `ReviewDraftView` and `PresentDraftButton` are shared by the reviewer's and the admin's pages; reuse them.
- **Author updates:** the editor who made a QuizMatter lesson (its approved submission's editor, `lesson_editor`)
  can always start a round on it, even when it's closed to other editors: the button says "Update this lesson" and
  the round is marked `is_author_update` ("Update" with its date on their Reviews & submissions page, "Update by the
  author" on the admin's list). An admin still publishes or sends it back. Publishing it adds no "Reviewed by" row
  and leaves `last_reviewer_id` / `open_to_all` as they were; the author's page keeps their latest published update
  ("Update · published <date>", from `my_reviews`). See `20261202000000_author_updates.sql` and
  `20261203000000_author_update_published.sql`.
- **A deleted reviewer's "Reviewed by" stays:** the `presentation_reviewers` row keeps its saved name, email and
  date; `reviewer_id` becomes empty, so the name shows without a profile link
  (`20261205000000_account_delete_keeps_quizmatter.sql`).
- **Photos in drafts count as used** in `used_photo_srcs`, so the weekly photo cleanup keeps them. Keep that if the cleanup changes.

# Submit to QuizMatter (editors offer their own presentations)

An editor sends one of their own presentations to QuizMatter; an admin approves it or sends it back with a note. Full design: `docs/superpowers/specs/2026-10-12-quizmatter-submissions-design.md`. Keep these rules:

- **Copy on approval:** `approve_submission` copies the presentation and its slides in one step: a shared QuizMatter presentation (`from_admin`), owned by the approving admin, Author = the editor (always their name, never what the Author field says). The editor keeps their original.
- **Editors' Author and "Copied from":** an editor's own presentations always have the editor as Author (the
  `set_editor_author` trigger; their Details box shows it locked). Make a copy saves `copied_from` (set once), and the
  admin's submission page shows "Copied from <title>" with a link. See `20261201000000_editor_author_and_copy_source.sql`.
  The Author is linked to the editor (`presentations.author_id`), on their own presentations and on the QuizMatter
  lessons made from their submissions, so it follows their display name: a rename rewrites it everywhere at once,
  even on a lesson under review, and admins can't retype it (their Details box shows it locked). See
  `20261216000000_author_link.sql`.
- **Editor photos:** every editor upload waits in Admin → Photos (not public) until a live QuizMatter presentation uses
  it: approving their submission or publishing their review makes it public. A photo in a presentation or review
  waiting for QuizMatter can't be removed by anyone (`QMPHL`). See
  `docs/superpowers/specs/2026-10-17-editor-photos-design.md` and `20261126000000_editor_photos.sql`.
- **Receipts:** each `presentation_submissions` row has its own `id`; an approved one stays after the editor deletes the original (`presentation_id` becomes empty) and is traced by `copy_id`. Sent-back and canceled ones go with their original. See `20261121000000_submission_receipts.sql`.
  An approved one also stays when the editor's account is deleted (`submitter_id` becomes empty; the lesson then has
  no maker for `lesson_editor`), while their other submissions are removed
  (`20261205000000_account_delete_keeps_quizmatter.sql`).
- **Editors don't publish:** they send their presentations here instead. `share_presentation` refuses editors, the
  Share card greys out Published, and giving the editor role removes their shared copies
  (`20261124000000_shared_copy_moderation.sql`). A shared copy itself can't be submitted.
- **Locked while waiting:** a `submitted` row in `presentation_submissions` counts in `is_review_locked`, so the review lock triggers refuse changes (`QMREV`). No Withdraw. Approved can't be submitted again.
- **The rules live in the database functions** (`submit_presentation`, `approve_submission`, `send_back_submission`, `my_submissions`, `admin_submissions`, `submission_status`). Migration: `20261119000000_quizmatter_submissions.sql`.
- **In the app:** reads through `src/lib/submissions.ts` (`SUBMISSION_LABELS` for the words and colors); actions `submitToQuizMatter` (`src/app/actions.ts`; from the card's ⋮ menu or the editor's Share card, which saves unsaved edits first; store `submission`), `approveSubmission` / `sendBackSubmission` (admin actions). Admin pages under `src/app/admin/presentations/submissions`.

# Super Admin (one admin who can do everything)

Admins are split in two. Full design: `docs/superpowers/specs/2026-10-16-super-admin-design.md`.

- **Super admin:** `admins.is_super` (set for andzrivero89@gmail.com in `20261122000000_super_admin.sql`), asked
  with `is_super_admin()` in the database and `getAccount().isSuperAdmin` in the app.
- **Plain admins** (every other admin, `is_admin()` still true): Admin → Photos (only the shared photos they
  uploaded, `shared_photos.uploaded_by`), Presentations (no "+ New presentation"), Reports, Editors. Not Teachers,
  Safety, Photo cleanup, Admin log or Data check (hidden, "page not found", actions refuse). No "Move to QuizMatter". They make categories
  but can't rename or delete them. Their presentations (editor or Claude) are QuizMatter ones, like every admin's.
  They follow the speed limits (`count_write`, `count_click`, the 30-day name wait), but a click limit only pauses
  them, never bans them automatically; every admin still skips the
  50-presentation limit (approving a submission makes a copy the admin owns).
- **These rules live in the database too** (`20261210000100_plain_admin_limits.sql`), so a direct API call can't skip
  them: on someone else's presentation a plain admin only reads it, hides or shows it
  (`guard_admin_presentation_update`), and deletes it when it or its shared copy is reported or hidden. Changing an
  owner or "from QuizMatter" (Move to QuizMatter), sharing someone else's QuizMatter presentation, adding rows for
  someone else and giving the editor role are the super admin's. A former admin (taken out of `admins`) can't
  delete QuizMatter presentations. The database's own functions (reviews, submissions, sharing, account delete)
  still work: the guard only stops direct writes (`current_user = 'authenticated'`).
- A new super-admin-only rule goes in the database with `is_super_admin()`, not only in the app.
- **Deleting an admin's account** (Supabase dashboard) first moves their QuizMatter presentations to the super admin,
  so teachers keep them; deleting a super admin who owns some, with no other super admin, is refused
  (`before_account_delete`, `20261205000000_account_delete_keeps_quizmatter.sql`).

# Maintenance (stopping everyone but the super admin)

The super admin turns it on in Admin → Maintenance (`src/app/admin/maintenance`) while fixing things. Everyone else
(teachers, editors, plain admins, logged out visitors) is stopped. Migration: `20261219000000_maintenance.sql`;
test: `supabase/tests/maintenance.sql`. Keep these rules:

- **The database is the real stop.** The browser talks to Supabase directly, so the proxy alone can't stop saves.
  `set_maintenance(true, note)` sets PostgREST's `pgrst.db_pre_request` to `check_maintenance` (and `notify pgrst,
  'reload config'`), so every API request runs it first and gets `QMMNT` (HTTP 503) unless it's the super admin, the
  secret-key client (`service_role`), or the `maintenance_status` call. Turning it off removes the setting, so on
  normal days nothing extra runs. `check_maintenance` also reads the `maintenance` row, so a leftover setting with
  maintenance off lets everyone through. If the guard ever gets stuck, run as postgres:
  `alter role authenticator reset pgrst.db_pre_request; notify pgrst, 'reload config';`.
- **One row** in `maintenance` (on/off, the note, started at / by, the announced time). Read it only through
  `maintenance_status()` (open to all); change it only through `set_maintenance` / `announce_maintenance` (super
  admin; logged in the Admin log as `maintenance_on` / `maintenance_off` / `maintenance_announced`).
- **The app** reads the status with `src/lib/maintenance.ts`: `getMaintenanceStatus()` remembers it for 60 seconds
  per server copy (so the proxy isn't a database call per request; if it can't be read it counts as off).
  `src/proxy.ts` sends page opens (and in-app page loads: Next's router follows the redirect) to `/maintenance` and
  answers server actions and `/api/*` with 503 + the `x-qm-maintenance` header; only `/maintenance`, `/login`, `/privacy` and `/terms` stay
  open, and the super admin passes. `/maintenance` goes to `/` once it's off (by the proxy, not the page, so the two
  can't bounce).
- **Open tabs:** `MaintenanceWatch` (root layout) wraps the browser's fetch; a 503 with the header or code `QMMNT`
  sends the tab to `/maintenance`, after `MAINTENANCE_EVENT`, which makes the editor keep unsaved work in the browser
  (it comes back when the presentation opens again).
- **Login and sign up:** `/login` stays open for the super admin; anyone else is logged out again at once
  (`mayLogInNow` in the login page). Sign up is refused by the sign up hook (`hook_before_user_created`) and the
  proxy.
- **Also stopped:** Claude's connector (`/api/mcp`, checked before its login, 503) and Claude's photo uploads
  (`/api/claude-photo`), since both skip the proxy and use the secret key; and the cleanup timers (`worker.ts` skips
  them, also when the status can't be read).
- **Announce ahead:** `announce_maintenance(time, note)` shows a Sunny bar on every page (`MaintenanceBar`) until
  that time; it doesn't start maintenance by itself. While it's on, the super admin sees a coral "Maintenance is ON"
  bar.
- **Announcements ride on the status:** `maintenance_status()` also returns `announcements_key` (see
  "Announcements").
- **Emergency (the app itself is down and can't show its page):** in Cloudflare, Security → WAF → Custom rules, add
  "hostname equals quizmatter.com → Block" (it doesn't stop direct Supabase calls; pause the Supabase project for
  that). Delete the rule afterwards.

# Announcements (a modal and/or top bar for chosen teachers)

The super admin shows a message to chosen teachers on chosen pages (Admin → Announcements,
`src/app/admin/announcements`). Design: `docs/superpowers/specs/2026-10-30-announcements-design.md`. Migration:
`20261221000000_announcements.sql`; test: `supabase/tests/announcements.sql`. Keep these rules:

- **Super admin only** for making, changing and deleting them (`is_super_admin()` in every admin function; the page
  and actions check `isSuperAdmin`). Only logged-in teachers see them; a banned one sees none.
- **The rules live in the database functions** (`save_announcement`, `set_announcement_on`, `delete_announcement`,
  `admin_announcements`, `announcement_audience`, `my_announcements`, `dismiss_announcement`), with the matching
  rule written once (`announcement_matches`). Nobody reads the tables directly. The limits are in both the database
  and `announcementSchema` (`src/lib/announcements.ts`), number for number; at most 20 on and not ended.
- **Filters:** empty = everyone; every filled one must match. A teacher with that detail empty (e.g. no birthday)
  doesn't match a filter on it. Presentations count their own, not shared copies.
- **The key rides on the maintenance status:** `maintenance_status()` returns `announcements_key` (null when nothing
  is live; an md5 of the live ids and `updated_at`s). `Announcements` (root layout) mounts `AnnouncementsWatch`
  only when it's filled, so on a quiet day nothing extra runs. The watch asks `my_announcements()` once per key, account and
  Philippine day (`isSameVisit`: another teacher on a shared computer starts over) (kept in sessionStorage, `qm:announcements`), never on pages outside the page groups
  (`pageGroup`), and picks what fits each page (`pickForPage`: modals one at a time, at most 2 bars, newest first).
- **Show again:** `once` (an `announcement_dismissals` row, for good), `daily` (again after midnight Philippine
  time), `every_visit` (only sessionStorage: again in a new tab). The modal and the bar close separately.
- **Modal size:** `modal_size` is `small` / `medium` / `large` (300 / 500 / 672 px wide; the height fits the text;
  `MODAL_SIZES`). Older rows and older app tabs count as `large` (`20261222000000_announcement_modal_size.sql`,
  test `supabase/tests/announcement_modal_size.sql`). The admin's text box takes the same width.
- **Counts are kept, not live** (`20261223000000_announcement_counts.sql`, test
  `supabase/tests/announcement_counts.sql`). The list reads `matched_count` / `closed_*_count` / `counted_at`,
  filled by "Count again" (`recount_announcement`), which the app also calls right after each save as a separate
  step (`save_announcement` doesn't count, so a failed count can't undo a save); the form counts only on "Count
  teachers". Never count on page load or while typing.
- **Counting is one query** (`announcement_count`, `20261224000000_announcement_fast_counts.sql`): about 0.2 s
  per 100,000 accounts at worst, against the logged-in role's 8-second limit (checking one account at a time took
  ~5 s per 100,000). It's a second copy of the matching rule (`announcement_matches` checks one teacher): change
  both together; `supabase/tests/announcement_fast_counts.sql` checks they agree.
- **Old "closed" rows are deleted:** the daily timer's `cleanup_announcement_dismissals(batch_size)` keeps an
  announcement's closed counts and deletes its `announcement_dismissals` rows 30 days after it ends, 50,000 a call,
  up to 20 calls a day (the Privacy Policy says so). `dismiss_announcement` writes only for a live one.
- **Hidden while presenting fullscreen** (`document.fullscreenElement`); a waiting modal shows after. On the editor
  page the bars float at the bottom.
- **The modal is a post** (`20261225000000_announcement_post.sql`, spec
  `docs/superpowers/specs/2026-10-31-announcement-post-design.md`, test `supabase/tests/announcement_post.sql`):
  plain text (`modal_text`, padding, links clickable) and at most one attachment (`modal_attachment`, edge to edge):
  one of our photos / GIFs (`/api/announcement-image`) or a YouTube card. Pasting a YouTube link makes the card:
  `/api/announcement-youtube` gets the title and **copies the thumbnail into R2**, so teachers never contact YouTube
  unless they click (it opens in a new tab), the picture can't change behind the admin's back, and no Privacy Policy
  line is needed. Every attachment `src` must be our R2 address (`announcement_attachment_ok` / `modalAttachmentSchema`);
  `used_photo_srcs` keeps them.
- **Facebook posts and videos** (`20261226000000_announcement_facebook.sql`, test
  `supabase/tests/announcement_facebook.sql`, `src/lib/facebook.ts`): Facebook gives other sites no preview, so a
  pasted Facebook link is shown with **Facebook's own embedded player / post box** (a sandboxed frame; the app builds
  its address from the checked link). Only `{kind: "facebook", href, video}` is saved. Every teacher who sees one
  loads it from Facebook, so the Privacy Policy names Facebook (Meta); keep that true. The attachment check turns a
  missing key into "no" (`coalesce(…, false)`): a check lets SQL's "unknown" through.
- **Safe text:** the modal is plain text (no HTML). The bar's saved HTML is re-built through its editor's extensions
  (`toSafeAnnouncementHtml`, `src/lib/announcementText.ts`); only `http(s)://` or in-app links survive.
- **Privacy:** what's used to choose them, and the closed records, are in the Privacy Policy. A new filter on another
  detail updates it too.

# Diagrams and Picture Shapes

Their rules moved next to their code: Diagrams (Flowchart, Cycle, Mind Map, Tree) in `src/components/editor/CLAUDE.md`, Picture Shapes (`assetShapes.json`, for Claude's import) in `src/lib/CLAUDE.md`. Read them before changing either.

# Loading Spinner

Whenever the user waits for something (opening a presentation, loading a page, saving, any slow action), show a spinner — always.

The app has exactly ONE spinner component, in `src/components/Spinner.tsx`. Always reuse it. Never add a second spinner, a different spinner style, or an inline copy of its markup. If it needs a new size or color, add an option to that one component instead.

# Top Loading Line

When the user clicks something that opens another page, show a thin line at the very top of the screen that grows from left to right while they wait, like YouTube — and it must show at once, on the click, not after the server answers.

- The app has exactly ONE top line component, in `src/components/TopLoadingBar.tsx` (its animation is `--animate-top-bar` in `globals.css`). Always reuse it. Never build a second one or add a package for it.
- For links, put `src/components/LinkPending.tsx` inside the `<Link>`. It uses Next.js's `useLinkStatus` to show the top line (and, if asked, the Spinner) the moment the link is clicked.
- For a `next/form` `Form`, put `src/components/FormPending.tsx` inside it: it shows the top line the moment the form is sent (`useFormStatus`).
- Every page that loads slowly also gets a `loading.tsx` that shows the top line and the Spinner.

# Communication Style

When explaining things to the user (in chat replies, comments, or docs), use plain, simple, basic English — short words and short sentences over technical jargon. If a difficult or technical term is unavoidable, add a simpler synonym right after it and give a concrete example. For instance: "memoize (means: remember a result so it doesn't have to be recalculated) — e.g. caching a math answer instead of redoing the calculation every time."

# QuizMatter — Design System

**REQUIRED:** Every new feature, page, button, panel, modal, form, card, and any other part of the app MUST use this design system. This also applies to changes to existing parts. No exceptions: don't invent new colors, fonts, radii, shadows, or icon styles, and don't copy a look from somewhere else. If something you need isn't covered here, add it to `src/app/globals.css` (and to this section) in the same style, instead of hard-coding it in one place.

The source of truth is the "Modernist" design-system project in Claude Design (claude.ai/design), in its `brand/QuizMatter Brand.html`, `styles.css` and `readme.md`. In the code, every value lives in `src/app/globals.css` as a CSS variable and a Tailwind class (`bg-accent`, `rounded-card`, …). Always use those classes; never hard-code a color, radius or font in a component.

## Overall Style

Bright, rounded and friendly for kids, but clean enough to feel credible to teachers:

- **One confident violet** for the brand and main actions, a **sunny yellow** for highlights, and clear **right/wrong** colors (mint/coral). Color always means something; it is never decoration.
- **Soft and round:** 1.5px soft borders and rounded corners everywhere (8 / 14 / 24px). No square corners.
- **Chunky main buttons:** violet with a solid 4px "key" edge underneath that sinks when pressed (the `btn-press` class).
- **Easy-to-read type:** Lexend for all text; Bricolage Grotesque (extra bold, tight spacing) for headings.
- **Generous whitespace** and white cards on the light Paper background.

## Colors

| Tailwind class / CSS variable | Value | Usage |
|---|---|---|
| `bg-page` / `--bg-page` | `#FAF8FF` | Page background (Paper) |
| `bg-surface` / `--bg-surface` | `#FFFFFF` | Cards, panels |
| `border-default` / `--border-default` | `#E6E1F5` | Borders, dividers |
| `text-primary` / `--text-primary` | `#1B1530` | Text, icons (Ink) |
| `text-secondary` / `--text-secondary` | `#756E8E` | Muted text, placeholders |
| `text-header` / `--text-header` | `#9790AD` | Uppercase labels, column headers |
| `accent` / `--accent` | `#6B3DF5` | Quiz Violet: brand, main buttons, selected state, links |
| `accent-hover` / `accent-edge` / `accent-soft` | `#5A2CE0` / `#4B22C9` / `#F3EFFF` | Hover, button key edge, soft violet fill |
| `highlight` (+ `-soft`, `-strong`) | `#FFC233` | Sunny: stars, rewards, drafts, unsaved |
| `success` (+ `-soft`, `-strong`) | `#14C8A0` | Mint: correct answers, saved, published |
| `danger` (+ `-soft`, `-strong`) | `#FF5A5F` | Coral: wrong answers, errors, deleting |

- For a pill or label, use the `-soft` fill with `-strong` text (e.g. `bg-success-soft text-success-strong`).
- **Never white text on Sunny or Mint**: use ink (`text-text-primary`) or the `-strong` color.
- Use Mint and Coral only for right/wrong, success/error and delete, so they keep their meaning.
- Don't use more than two accent colors in one component.
- Slide content (colors people pick, clipart, the SVG library) is the user's own work and doesn't follow these colors.

## Typography

- **Body/UI:** Lexend (`font-sans`, the default), 14px body, 600 weight for buttons.
- **Headings:** `h1`/`h2` get Bricolage Grotesque automatically (in `globals.css`); use `font-extrabold` on them. Use `font-heading` for other display text (e.g. the logo word).
- **Labels:** 11–12px, bold, uppercase, `tracking-[0.05em]`, `text-text-header`.

## Shape

| Class | Radius | Usage |
|---|---|---|
| `rounded-card` | 24px | Cards, panels, modals |
| `rounded-button` | 14px | Buttons |
| `rounded-input` | 14px | Inputs |
| `rounded-dropdown` | 8px | Small buttons, pills, menus |

- Plain `border` is 1.5px (set by `--default-border-width`).
- Shadows: almost none. The main-button key edge (`btn-press`) is the one exception.
- Main button: `rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover`.

## Icons

- **Lucide only** (`lucide-react`). Import the `…Icon` name, e.g. `import { XIcon } from "lucide-react"`, and always pass `size`. Keep Lucide's default 2px stroke. Icons take the text color (`currentColor`), usually `text-text-primary`.
- Never draw a UI icon by hand as inline SVG, and don't add another icon package.

## Logo

- `src/components/Logo.tsx` is the one logo: the "Q-Check" mark (a violet square with a white Q whose tail is a sunny check mark) plus "Quiz**Matter**". Always reuse it. `src/app/icon.svg` is the same mark for the browser tab.
- Don't recolor, rotate or outline the mark. The app name is written **QuizMatter**.

## Spacing & Layout

- Card padding: 16–20px horizontal, 12–14px vertical
- Row height: 48–56px
- Gap between sections: 16–20px
- Icon-to-label gap: 8–12px
- Editor side panels (Elements, Photos, Presentations, …): the `side-panel` class (all 320px wide; 20px padding, 8px on the right next to a thin scrollbar), not their own width or `p-5`. Sideways rows in them use `ScrollRow` (`src/components/editor/ScrollRow.tsx`).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
