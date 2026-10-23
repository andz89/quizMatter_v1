# Admin Overview, Admin Log and Security Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins an Overview front page (waiting counts, activity charts, recent admin actions), a grouped menu
with counts, a tamper-proof admin action log, and fix the security checker's findings.

**Architecture:** Three migrations: (1) revoke API access to trigger helpers; (2) an `activity_events` table plus two
read functions, `admin_overview` and `admin_todo_counts`, that return counts already grouped; (3) an `admin_actions`
table written only inside the database, by triggers on the tables admins change plus three small `log_*` rpcs for
the steps that use the secret key. The app moves Photos to `/admin/photos`, puts the new Overview at `/admin`, groups
`AdminMenu`, and adds `/admin/activity`.

**Tech Stack:** Supabase Postgres (plpgsql / sql functions, triggers, RLS), Next.js 16 server pages, zod, Tailwind
design-system classes, lucide-react. No new packages.

**Spec:** `docs/superpowers/specs/2026-10-23-admin-overview-design.md`

## Global Constraints

- Functions: `set search_path = ''`, full names (`public.x`), `security definer` only where they must read past RLS;
  `revoke execute … from public, anon` (and from `authenticated` for helpers and trigger functions); `grant execute
  … to authenticated` only for rpcs the app calls.
- Super-admin-only data (sign-ups, logins, pauses/bans, the admin log) is checked in the database with
  `is_super_admin()`, not only in the app.
- `days` is exactly one of `7`, `30`, `90` — checked with zod in the app (`z.coerce.number()`, else default `30`) and
  refused in `admin_overview` otherwise (errcode `22023`).
- Days are UTC dates (`(created_at at time zone 'utc')::date`); the page says "Days in UTC" in small text.
- One click = one log row: the transaction flag `quizmatter.admin_logged` (`set_config(…, 'yes', true)`); every
  logging trigger returns early when `current_setting('quizmatter.admin_logged', true) = 'yes'`, else logs and sets it.
  Logging triggers are `before` triggers so they run before the cascades and other triggers they cause.
- Log only when `public.is_admin()` is true (it is false with the secret key and in `before_account_delete`).
- Design system only: `rounded-card bg-bg-surface border border-border-default`, labels
  `text-[11px] font-bold tracking-[0.05em] text-text-header uppercase`, count pill
  `rounded-dropdown bg-highlight-soft px-2 py-0.5 text-[12px] font-semibold text-highlight-strong`, every chart bar
  `bg-accent`, Lucide icons with
  `size`, `LinkPending` inside every `<Link>`, `loading.tsx` with `TopLoadingBar` + `Spinner` for each new page.
- No test runner: database checks are SQL in `begin; … rollback;` via Supabase MCP `execute_sql` on project
  `zmmkqncfbjkmwfyngaha`, acting as a user with `set local role authenticated; set local request.jwt.claims =
  '{"sub":"<id>"}';`. App checks: `npx tsc --noEmit`, `npm run lint`, and the browser.
- Applying each migration to the live project and every commit to `main` need the user's OK each time. Commit only
  the task's files (`git add <paths>`); the tree has other uncommitted work. If a file you must change already had
  uncommitted changes before this work (`git diff --stat` at the start: e.g. `src/app/admin/editors/page.tsx`,
  `src/app/admin/safety/page.tsx`, `src/lib/photos.tsx`), ask the user before committing it.
- `supabase/migrations/20261204000000_presentation_likes.sql` is live but uncommitted: ask the user to commit it
  before Task 2's commit.

## Review Focus

- A plain admin (not super) → `admin_overview` returns no rows for `signups`, `logins`, `pauses`, `bans`;
  `/admin/activity` is "page not found"; `select` on `admin_actions` returns nothing. Task 2 check B, Task 3 check F,
  Task 6 step 3.
- A teacher (not admin) calls `admin_overview(30)`, `admin_todo_counts()`, `log_ban(…)` → refused (`42501`). Task 2
  check A, Task 3 check F.
- Deleting a reported presentation that has a shared copy and 3 reports → exactly one `presentation_deleted` row.
  Task 3 check C.
- `?days=abc` / `?days=1000` → page shows 30 days, no error; `admin_overview(5)` → refused. Task 2 check A, Task 5
  step 3.
- Old links to `/admin` from the editor's Shared photos panel and the account menu → land on the right page
  (`/admin/photos` for the panel). Task 4 step 3.

---

### Task 1: Security fixes

**Files:**
- Create: `supabase/migrations/20261206000000_revoke_trigger_helpers.sql`
- Modify: `src/lib/supabase/admin.ts` (add `listAllUsers`), `src/app/admin/teachers/page.tsx:30`,
  `src/app/admin/editors/page.tsx:27`, `supabase/migrations/CLAUDE.md`

**Interfaces:**
- Produces: `listAllUsers(admin: AdminClient): Promise<User[]>` (throws on error) in `src/lib/supabase/admin.ts`.

- [ ] **Step 1: Write the migration.** `revoke execute on function public.<name>() from public, anon, authenticated;`
  for each of: `cancel_reviews_of_removed_editor`, `check_ban_target`, `count_like`, `drop_unapproved_submission`,
  `drop_waiting_editor_photo`, `handle_new_user`, `publish_photos_of_live_presentation`, `publish_photos_of_new_slide`,
  `refuse_locked_photo_delete`, `set_editor_author`, `share_editor_photo`, `share_new_editor_photos`,
  `sync_slide_photos`, `remove_copy_of_quizmatter_presentation`, `remove_new_editor_copies`. First confirm each
  returns `trigger` (`select proname from pg_proc where prorettype = 'trigger'::regtype and pronamespace =
  'public'::regnamespace`); drop any that doesn't from the list.
- [ ] **Step 2: Ask the user's OK, apply** with `apply_migration` (name `revoke_trigger_helpers`).
- [ ] **Step 3: Check.** `get_advisors` (security): the `anon_security_definer_function_executable` list is empty and
  none of the 15 names is in the `authenticated_…` list. In `begin; … rollback;` as a teacher: insert a slide with a
  photo and like a presentation — both still work (triggers still run).
- [ ] **Step 4: `listAllUsers`.** Loop `admin.auth.admin.listUsers({ page, perPage: 1000 })` from page 1 until a page
  returns fewer than 1000 users; collect all. Replace both `listUsers({ perPage: 1000 })` calls with it.
- [ ] **Step 5:** `npx tsc --noEmit` and `npm run lint` pass; Admin → Teachers and Editors still list everyone.
- [ ] **Step 6:** Note the revokes in `supabase/migrations/CLAUDE.md`. Tell the user: Supabase dashboard →
  Authentication → Sign In / Providers → Email → "Prevent use of leaked passwords" (may need a paid plan). Ask OK,
  commit "Security: trigger helpers not callable from the API, admin lists see every account".

### Task 2: Activity events and the overview functions

**Files:**
- Create: `supabase/migrations/20261207000000_admin_overview.sql`
- Modify: `supabase/migrations/CLAUDE.md`

**Interfaces:**
- Produces:
  - `public.admin_overview(days int) returns table (series text, day date, total int)` — one row per series per UTC
    day with `total > 0` (the app fills zero days). `series` ∈ `presentations`, `publishes`, `likes`, `saves`,
    `reports`, `submissions`, `reviews` (every admin) and `signups`, `logins`, `pauses`, `bans` (super admin only).
    Range: the last `days` UTC days including today.
  - `public.admin_todo_counts() returns table (reviews int, submissions int, reports int)` — one row.

- [ ] **Step 1: Write the migration** (spec link at top, plain-English comments):
  1. `activity_events` (`id bigint generated always as identity primary key`, `kind text not null check (kind in
     ('like','save','report'))`, `created_at timestamptz not null default now()`), RLS on, no policies, index on
     `(kind, created_at)`.
  2. One trigger function `record_activity_event()` (`security definer`, uses `tg_argv[0]` as the kind) and three
     `after insert … for each row` triggers on `presentation_likes`, `saved_presentations`, `presentation_reports`.
     Execute revoked from everyone.
  3. `admin_overview` (`stable`, `security definer`, plpgsql): refuse unless `is_admin()` (`42501`) and unless
     `days in (7, 30, 90)` (`22023`). Sources: `presentations.created_at where shared_from is null` → `presentations`;
     `presentations.created_at where shared_from is not null` → `publishes`; `activity_events` by kind →
     `likes`/`saves`/`reports`; `presentation_submissions.submitted_at` → `submissions`;
     `presentation_reviews.submitted_at` → `reviews`; when `is_super_admin()`: `auth.users.created_at` → `signups`,
     `auth.users.last_sign_in_at` → `logins`, `click_history.created_at` with `kind = 'pause'` / `'ban'` →
     `pauses` / `bans`.
  4. `admin_todo_counts` (`stable`, `security definer`, sql; refuse unless `is_admin()`): reviews = rows with
     `status = 'submitted'` in `presentation_reviews`; submissions = `status = 'submitted'` in
     `presentation_submissions`; reports = `count(distinct presentation_id)` in `presentation_reports` (what Admin →
     Reports lists).
  5. Grants: both rpcs to `authenticated` only.
- [ ] **Step 2: Ask OK, apply** (name `admin_overview`).
- [ ] **Step 3: Checks** (`begin; … rollback;`):
  - A. As a teacher: `admin_overview(30)` and `admin_todo_counts()` raise `42501`. As an admin: `admin_overview(5)`
    raises `22023`.
  - B. As a plain admin (insert a non-super `admins` row for a test user): no `signups`/`logins`/`pauses`/`bans` rows.
    As the super admin: they appear.
  - C. Insert a like, then delete it: `likes` for today is still 1. Insert 3 reports on one presentation:
    `admin_todo_counts().reports` counts it once.
- [ ] **Step 4:** Notes in `supabase/migrations/CLAUDE.md`. Ask OK, commit "Admin overview: activity events and count
  functions".

### Task 3: The admin action log

**Files:**
- Create: `supabase/migrations/20261208000000_admin_log.sql`, `src/lib/adminActions.ts`
- Modify: `supabase/migrations/CLAUDE.md`

**Interfaces:**
- Produces:
  - Table `public.admin_actions` (columns as in the spec; `action` and `target_type` with check constraints listing
    the values below).
  - `public.log_ban(target uuid) returns void`, `public.log_unban(target uuid) returns void`,
    `public.log_click_release(target uuid, feature text) returns void` — granted to `authenticated`.
  - `src/lib/adminActions.ts`: `ADMIN_ACTION_LABELS: Record<AdminAction, string>`, `type AdminAction`,
    `adminActionSchema` (zod enum of the keys).
- Action keys (`target_type` in brackets): `review_published`, `review_sent_back`, `review_canceled`,
  `review_opened`, `review_closed`, `submission_approved`, `submission_sent_back` [presentation];
  `presentation_shared`, `presentation_unshared`, `presentation_moved`, `presentation_hidden`,
  `presentation_unhidden`, `reports_dismissed`, `presentation_deleted` [presentation]; `teacher_banned`,
  `ban_updated`, `teacher_unbanned`, `editor_added`, `editor_removed`, `pause_released` [user]; `category_created`,
  `category_renamed`, `category_deleted` [category]; `photo_deleted` [photo].
- Labels (exact copy): "Published a review", "Sent a review back", "Canceled a review", "Opened to all editors",
  "Closed to other editors", "Approved a submission", "Sent a submission back", "Shared with teachers", "Made a
  draft again", "Moved to QuizMatter", "Hid a presentation", "Unhid a presentation", "Dismissed reports", "Deleted a
  presentation", "Banned a teacher", "Changed a ban reason", "Unbanned a teacher", "Made an editor", "Removed an
  editor", "Released a pause", "Made a category", "Renamed a category", "Deleted a category", "Deleted a photo".

- [ ] **Step 1: Write the migration:**
  1. `admin_actions` table, RLS on, one policy `for select to authenticated using (public.is_super_admin())`, index
     on `created_at desc` and `(admin_id, created_at desc)`.
  2. `log_admin_action(action text, target_type text, target_id text, target_title text, details jsonb)`
     (`security definer`; no grants): returns at once if the flag is set or `not is_admin()`; else inserts with
     `admin_id = auth.uid()`, `admin_name` = display name or the part of the email before "@" (same as
     `submit_review`), and sets the flag.
  3. Triggers (all `before`, `for each row` unless noted), each calling `log_admin_action`:
     - `presentation_reviews` update: `submitted → published` = `review_published`; `submitted → reviewing` =
       `review_sent_back` (details `{note}`); `→ canceled` by an admin = `review_canceled`; `open_to_all` false→true /
       true→false = `review_opened` / `review_closed`.
     - `presentation_submissions` update: `→ approved` / `→ sent_back` (details `{note}`).
     - `presentations` update: `is_published` change on `from_admin` = shared/unshared; `from_admin` false→true =
       `presentation_moved`; `hidden_at` null↔set = hidden/unhidden. `presentations` delete (when `from_admin` or
       `owner_id <> auth.uid()`) = `presentation_deleted`.
     - `presentation_reports` delete: a **statement-level** `after delete` trigger with `referencing old table`,
       one row per distinct `presentation_id` (skipped when the flag is set, so a cascade from a delete isn't
       logged), `reports_dismissed` with details `{count}`.
     - `editors` insert/delete = `editor_added` / `editor_removed`, `target_title` = the user's email.
     - `photo_categories` insert/update of `name`/delete; `shared_photos` delete (`target_title` = `file_name`).
  4. `log_ban(target)`: refuse unless `is_super_admin()`; refuse (`P0002`) unless a `banned_users` row exists;
     `teacher_banned`, or `ban_updated` if a `teacher_banned` row for that target already exists after the last
     `teacher_unbanned`; details `{reason}`. `log_unban(target)`: super admin; refuse unless the row is gone.
     `log_click_release(target, feature)`: super admin; details `{feature}`. All take the target's email as title.
  5. Trigger functions: execute revoked from everyone.
- [ ] **Step 2: Ask OK, apply** (name `admin_log`).
- [ ] **Step 3: Checks** (`begin; … rollback;`, as the super admin unless said):
  - A. `setShared`-style update of `is_published` on a `from_admin` presentation → one `presentation_shared` row with
    the title.
  - B. Publish a submitted review with `publish_review` → one `review_published` row.
  - C. A teacher presentation with a shared copy and 3 reports; delete the original → exactly one row,
    `presentation_deleted`.
  - D. Delete 3 reports of one presentation → one `reports_dismissed` row, details `{"count":3}`.
  - E. Insert an `editors` row for a teacher who has a shared copy → one `editor_added` row, no delete row.
  - F. As a plain admin: `select * from admin_actions` returns 0 rows; `log_ban(x)` raises `42501`. As a teacher:
    deleting their own presentation writes no row.
  - G. `log_ban` with no `banned_users` row raises `P0002`.
- [ ] **Step 4: `src/lib/adminActions.ts`** with the keys and labels above. `npx tsc --noEmit` passes.
- [ ] **Step 5:** Notes in `supabase/migrations/CLAUDE.md`. Ask OK, commit "Admin log: every admin action, written
  by the database".

### Task 4: Photos moves, grouped menu with counts

**Files:**
- Move: `src/app/admin/page.tsx`, `AdminPhotos.tsx`, `photoSearch.ts` → `src/app/admin/photos/` (`git mv`)
- Create: `src/app/admin/photos/loading.tsx` (copy of the current `src/app/admin/loading.tsx`)
- Modify: `src/app/admin/AdminMenu.tsx`, `src/app/admin/layout.tsx`, `src/components/editor/SharedPhotos.tsx:59`

**Interfaces:**
- Consumes: `admin_todo_counts()` (Task 2).
- Produces: `AdminMenu({ isSuperAdmin, counts }: { isSuperAdmin: boolean; counts: { reviews: number; submissions:
  number; reports: number } })`.

- [ ] **Step 1: Move Photos.** `photoSearchHref` builds `/admin/photos?…`; every `/admin` photo link inside
  `AdminPhotos.tsx` (lines 829, 916) becomes `/admin/photos`; fix the relative imports.
- [ ] **Step 2: Menu.** Groups as in the spec's table (`To do`: Under review → `/admin/presentations/reviews`,
  Submissions → `/admin/presentations/submissions`, Reports; `Library`: Presentations, Photos, Photo cleanup*;
  `People`: Teachers*, Editors, Safety*; then Admin log* → `/admin/activity`). Overview (`/admin`) is current only on
  exactly `/admin`. Presentations must not look current on its reviews/submissions pages. From `sm` up: each group
  has its label above it; below `sm`: one sideways-scrolling row, groups split by a 1.5px `border-l
  border-border-default`. Count pill only when > 0.
- [ ] **Step 3: Layout** calls `admin_todo_counts` (on error, counts are 0 — the menu must never break the page) and
  passes `counts`. `SharedPhotos.tsx` link → `/admin/photos`. Check in the browser: every menu item opens; the
  Shared photos panel link opens Photos; counts match the three pages.
- [ ] **Step 4:** `npx tsc --noEmit`, `npm run lint`. Ask OK, commit "Admin: Photos at /admin/photos, grouped menu
  with counts".

### Task 5: Overview page

**Files:**
- Create: `src/app/admin/page.tsx`, `src/app/admin/OverviewCharts.tsx`
- Modify: `src/app/admin/loading.tsx` (stays: top line + Spinner)

**Interfaces:**
- Consumes: `admin_overview(days)`, `admin_todo_counts()` (Task 2); `admin_actions` + `ADMIN_ACTION_LABELS` (Task 3).

- [ ] **Step 1: `page.tsx`** (server): `isAdmin` check + `notFound()`; parse `days` (see Global Constraints); call
  both rpcs and, for the super admin, `admin_actions` latest 10. Sections in order: "Waiting for you" (3 cards:
  count, label, link — same labels as the menu), "Activity" (range links 7 / 30 / 90 days as pill links, current one
  `bg-accent-soft text-accent`), "Recent admin actions" (super admin only; when, admin name, label, title; "See all"
  → `/admin/activity`; "No admin actions yet." when empty).
- [ ] **Step 2: `OverviewCharts.tsx`** (server component, no client JS): one card per series with its title, range
  total, and bars (divs, height = `total / max` of that series, `bg-accent rounded-t-[4px]`, `title` attribute "Oct
  12: 4"). Fills missing days with 0. For 90 days, sums into 13 weeks (Monday start). Titles: "New presentations",
  "Teachers' publishes", "Likes", "Saves", "Reports", "Submissions", "Reviews submitted", "New teachers", "Teachers
  who logged in", "Click pauses", "Automatic bans". Notes under charts: likes/saves/reports "Counted from Oct
  <go-live date>."; reviews "Latest round of each presentation only."; logins "Each teacher's last login only."; and
  "Days in UTC." once.
- [ ] **Step 3: Check** in the browser as the super admin and as a plain admin (plain: no people charts, no recent
  actions); `?days=abc` and `?days=1000` show 30 days; phone width has no sideways page scroll.
- [ ] **Step 4:** `npx tsc --noEmit`, `npm run lint`. Ask OK, commit "Admin: Overview page".

### Task 6: Log calls in the actions, Admin log page

**Files:**
- Modify: `src/app/admin/teachers/actions.ts` (`banTeacher`, `unbanTeacher`), `src/app/admin/safety/actions.ts`
  (`releasePause`)
- Create: `src/app/admin/activity/page.tsx`, `src/app/admin/activity/loading.tsx`

**Interfaces:**
- Consumes: `log_ban`, `log_unban`, `log_click_release` (Task 3); `adminActionSchema`, `ADMIN_ACTION_LABELS`.

- [ ] **Step 1: Actions.** After the whole step worked (just before `return null`), call the rpc with the server
  client (`createClient()`, not the secret key). A logging failure doesn't fail the action (the step already
  worked): ignore its error, like `releasePause` does for `click_history`.
- [ ] **Step 2: `/admin/activity`**: `isSuperAdmin` check + `notFound()`; search params `admin` (`z.uuid()`),
  `action` (`adminActionSchema`), `page` (int ≥ 1), invalid ones ignored; 50 per page, newest first; filters as two
  `<select>`s in a GET form (admins = distinct `admin_id, admin_name` in the log); table columns When ("Oct 23, 2026,
  3:40 PM"), Admin, Action (label), What (title; links to `/presentation/<id>` when `target_type = 'presentation'`
  and the presentation still exists), Details (reason / note / feature / count). Empty state "No admin actions yet."
  Previous / Next links.
- [ ] **Step 3: Check** in the browser: ban then unban a test teacher → two rows; a failed ban (temporarily unset
  `SUPABASE_SECRET_KEY` locally) → no row; release a pause → one row; filters work; as a plain admin
  `/admin/activity` is "page not found".
- [ ] **Step 4:** `npx tsc --noEmit`, `npm run lint`. Ask OK, commit "Admin log page, ban and release logging".

### Task 7: Notes and final check

**Files:**
- Modify: `src/app/admin/CLAUDE.md` (pages table: Overview, Photos' new folder, Admin log; menu groups and counts;
  "how an admin action is written": logging is in the database, `log_*` rpcs for secret-key steps), root
  `CLAUDE.md` (map line for `src/app/admin/`: Overview, Admin log)

- [ ] **Step 1:** Update the notes, reading the real code first.
- [ ] **Step 2:** `npx tsc --noEmit`, `npm run lint`, `get_advisors` (security) — compare with the start: only the
  expected "signed-in users can run" warnings remain, plus the new `log_*`/`admin_*` rpcs.
- [ ] **Step 3:** `git diff` against this plan and the spec; tell the user what was checked and what passed or
  failed. Ask OK, commit "Notes: admin overview and admin log".
