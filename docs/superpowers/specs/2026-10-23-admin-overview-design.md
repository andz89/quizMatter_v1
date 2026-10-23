# Admin Overview, Activity Log and Security Fixes — Design

Date: 2026-10-23

## Why

The admin area feels messy: `/admin` opens straight on Photos, the 7 tabs are one flat row, Under review and
Submissions hide inside Presentations, and nothing says how much is waiting. There is also no way to see what's
happening in the app over time, and no record of what admins do (now that plain admins exist, that matters). The
security check on the live database also found a few things to tidy.

The user approved all of these suggestions ("go with all your suggestions"). Choices marked **(my call)** were made
by Claude, not the user.

## Goals

1. A new **Overview** page is the admin front page: what's waiting for me, activity charts, recent admin actions.
2. The admin menu is **grouped** and shows **counts** of what's waiting.
3. An **admin action log**: who did what, when.
4. **Security fixes:** trigger helpers no longer callable from the API; Teachers / Editors pages see every account,
   not only the first 1,000; leaked password protection turned on.

## Non-goals

- No new teacher-facing features. No change to the rules of reviews, submissions, reports or bans.
- No analytics package, no tracking of page views or clicks (only what the database already stores, plus the admin
  log).
- No charts library **(my call)**: the charts are simple bars drawn with divs in the design system's colors.

## Anti-goals (would make this a failure)

- Plain admins seeing people data they can't see today (teacher emails, sign-ups, logins, bans, the admin log).
- An admin log that admins can edit or delete, or that only the app writes (a direct database call would skip it).
- The Overview being slow because it loads whole tables into the app.

## 1. Menu and pages

New URLs **(my call)**:

- `/admin` → **Overview** (new).
- Photos moves from `/admin` to `/admin/photos` (its `page.tsx`, `AdminPhotos.tsx`, `photoSearch.ts` move into
  `photos/`; every link and `photoSearchHref` to it changes; `/admin?…` photo links break, which is fine).
- Under review and Submissions keep their URLs under `/admin/presentations/…`; they only get their own menu items.
- `/admin/activity` → **Admin log** (new, super admin only).

`AdminMenu.tsx` becomes groups with a small uppercase label (the design system's label style) **(my call)**:

| Group | Items |
|---|---|
| (none) | Overview |
| To do | Under review, Submissions, Reports — each with a count pill when above 0 |
| Library | Presentations, Photos, Photo cleanup* |
| People | Teachers*, Editors, Safety* |
| (none) | Admin log* |

\* super admin only, as today. On phones the menu stays one sideways-scrolling row, with groups split by a thin
divider instead of a label **(my call)**. Count pills use `bg-highlight-soft text-highlight-strong` (Sunny = waiting).

Counts in the menu: "Under review" = rounds in `submitted` (waiting for an admin), "Submissions" = `submitted` rows,
"Reports" = presentations with at least one report that's not dismissed and not hidden — the same rules each page
already uses to list them (the builder reads each page's query and matches it). The layout fetches them with one rpc
(`admin_todo_counts`) on each render; actions already call `refresh()`, so counts update after an admin acts.

## 2. Overview page

Top to bottom:

1. **Waiting for you** — three cards (Under review, Submissions, Reports) with the count and a link. Same numbers as
   the menu.
2. **Activity** — a range switch 7 / 30 / 90 days (search param `?days=`, default 30, checked with zod) and small bar
   charts, one bar per day (per week for 90 days **(my call)**), each with the total for the range:
   - For every admin: presentations created, teachers' publishes (shared copies made, `shared_from` rows' `created_at`),
     likes, saves, reports, submissions sent, reviews submitted. (QuizMatter presentations' own Share switch
     — `setShared`, `is_published` — keeps no date, so it has no chart; it shows in the admin log instead
     **(my call)**.)
   - Super admin only: new teachers (sign-ups), teachers who logged in (from `auth.users.last_sign_in_at`, so it's
     "last login fell on that day", stated under the chart), click-limit pauses and bans (`click_history`).
   (`presentation_likes` is already live in the database — `set_liked` and `count_like` exist there — though its
migration file isn't committed yet; it gets committed before or with this work.)
   Day boundaries in UTC **(my call)**, said in small text under the charts.
3. **Recent admin actions** (super admin only) — the last 10 log rows and a "See all" link to `/admin/activity`.

Data comes from one database function `admin_overview(days int)` (`security definer`, `set search_path = ''`, refuses
unless `is_admin()`; the super-admin-only series are returned only when `is_super_admin()`, else empty). It returns
per-day counts already grouped, so the app never loads raw rows. `days` is limited to 7, 30 or 90 in the function as
well. The page has a `loading.tsx` (top line + Spinner).

**Likes, saves and reports count what happened, not what's left (user's choice).** Unliking, unsaving and dismissing
delete their rows, so a new table `activity_events` (`id bigint identity`, `kind text` check in
`'like', 'save', 'report'`, `created_at timestamptz default now()`; no user or presentation columns, so it holds no
personal data) gets one row from an `after insert` trigger on `presentation_likes`, `saved_presentations` and
`presentation_reports`. Never updated or deleted; RLS on with no policies (only `admin_overview` reads it). The
charts read these three from it, so they start counting from the day it goes live (no history before; said under the
charts). Likes that `set_liked` refuses never insert, so they don't count.

Where each number comes from (the other charts): `presentations.created_at` (not shared copies), shared-copy rows' `created_at` for
"published", `presentation_submissions.submitted_at`, `presentation_reviews.submitted_at`, `auth.users.created_at` /
`last_sign_in_at`, `click_history.created_at`. Note: `presentation_reviews` keeps only the latest round, so "reviews
submitted" counts latest rounds only — said under that chart. The builder checks how shared copies are marked
(`shared_from`) before writing the query.

## 3. Admin action log

New table `admin_actions` **(my call on the shape)**:

`id bigint identity`, `admin_id uuid` (references `auth.users`, `on delete set null`), `admin_name text` (saved at
the time, so the row stays readable after the account is gone), `action text`, `target_type text`,
`target_id text`, `target_title text` (saved at the time), `details jsonb` (e.g. the ban reason or send-back note),
`created_at timestamptz default now()`.

- RLS on; one select policy: `is_super_admin()`. No insert / update / delete policies; nobody can change rows.
- Rows are written **inside the database**, by a helper `log_admin_action(...)` (`security definer`, execute revoked
  from public / anon / authenticated), called from the existing functions and from triggers on tables the app
  writes to directly. Only when the caller `is_admin()`.

Actions logged:

| Action | Where it's written |
|---|---|
| publish review, send back review, cancel review | trigger on `presentation_reviews` status changes made by an admin (so the functions themselves don't change) |
| approve submission, send back submission | trigger on `presentation_submissions` status changes made by an admin |
| open / close to all editors | same `presentation_reviews` trigger, when `open_to_all` changes |
| share / unshare QuizMatter presentation | trigger on `presentations` when `is_published` changes on a `from_admin` one (`setShared` writes it directly) |
| move to QuizMatter | trigger on `presentations` when `from_admin` turns on |
| hide / unhide (reports) | trigger on `presentations` when `hidden_at` changes |
| dismiss reports | trigger on `presentation_reports` delete by an admin (once per presentation, not per report row) |
| delete presentation | trigger on `presentations` delete by an admin (also covers deleting a reported one) |
| ban / unban teacher | rpcs `log_ban` / `log_unban` after the step worked (see below; automatic bans aren't admin actions) |
| give / take editor role | trigger on `editors` insert / delete |
| release a click pause | rpc `log_click_release` after the release worked (the release itself uses the secret key) |
| photo category create / rename / delete; shared photo delete | triggers on `photo_categories` / `shared_photos` |

**One click = one log row (my call).** Rows the database removes as a side effect of a logged step (a deleted
presentation's reports and shared copy, the shared copies removed when someone becomes an editor or a presentation
moves to QuizMatter) are not logged. The main step sets a flag for its transaction
(`set_config('quizmatter.admin_logged', 'yes', true)`, like the existing `quizmatter.*` flags) and the other
triggers skip while it is set; trigger-logged steps like a presentation delete set it in their `before` trigger.

**Bans log only when they fully worked (my call).** `banned_users` gets no logging trigger. After the whole step
worked (row and Supabase login ban), `banTeacher` / `unbanTeacher` call `log_ban(target)` / `log_unban(target)`.
These rpcs refuse unless `is_super_admin()`, and the database checks the fact itself: `log_ban` needs the
`banned_users` row to exist and takes the reason from it; `log_unban` needs it gone. A failed ban's rollback is never
logged. Banning someone already banned logs "ban updated". `releasePause` does the same with
`log_click_release(target, feature)` (super admin only).

Deleting an admin's own non-QuizMatter presentation in the editor is a normal teacher action: the delete trigger logs
only `from_admin` presentations or presentations the admin doesn't own **(my call)**. Account deletes moved by
`before_account_delete` are not logged (no admin caller).

Log rows are kept forever for now **(my call)**; small rows, few admins.

`/admin/activity` page (super admin only, `notFound()` otherwise): a table — when, admin, action, what (title linking
to the presentation when it still exists), details. Filters by admin and by action (search params, zod), 50 per
page. `loading.tsx` included.

## 4. Security fixes

1. **Trigger helpers:** one migration revokes `execute` from `public, anon, authenticated` on every trigger function
   the checker listed (`cancel_reviews_of_removed_editor`, `check_ban_target`, `count_like`,
   `drop_unapproved_submission`, `drop_waiting_editor_photo`, `handle_new_user`, `publish_photos_of_live_presentation`,
   `publish_photos_of_new_slide`, `refuse_locked_photo_delete`, `set_editor_author`, `share_editor_photo`,
   `share_new_editor_photos`, `sync_slide_photos`, plus `remove_copy_of_quizmatter_presentation` and
   `remove_new_editor_copies` if they are triggers). Triggers still run (Postgres doesn't check execute rights for
   triggers). Run the Supabase security check after, expecting those warnings gone.
2. **More than 1,000 accounts:** a helper in `src/lib` pages through `auth.admin.listUsers` until a page comes back
   short; used by `admin/teachers/page.tsx` and `admin/editors/page.tsx`.
3. **Leaked password protection:** a dashboard switch (Authentication → settings), not code. Claude tells the user
   where it is; it may need a paid Supabase plan.

The 52 "signed-in users can run this" warnings stay: those functions check the caller on purpose.

## Notes to update

`src/app/admin/CLAUDE.md` (pages table, menu groups, Overview, Admin log, Photos' new folder), root `CLAUDE.md` map
line for `src/app/admin/`, `supabase/migrations/CLAUDE.md` (new table, functions, revokes).

## Left to the builder

Exact chart look within the design system, query details of `admin_overview`, how the menu wraps on mid-size
screens, file names of new components, and the order of the work.
