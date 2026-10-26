# supabase/migrations (the database)

The database is the real guard. Its functions and triggers check who is calling and refuse what isn't allowed,
even if the app has a bug. The app's checks (zod, hidden buttons) are only the first line.

## Writing a migration

- A new change = a new file, named with a later date than the last one: `YYYYMMDD000000_what_it_does.sql`. Don't
  edit a file that's already been applied.
- Start with a short comment saying what it changes and why, in plain English (like the files before it).
- Functions use `set search_path = ''` and full names (`public.presentations`). Functions that must get past the
  table rules are `security definer` and check the caller themselves (`auth.uid()`, `public.is_admin()`,
  `public.is_super_admin()`, `public.is_editor()`). Give `execute` only to `authenticated` (`revoke … from public, anon`).
- A trigger function (returns `trigger`) is never called from the API: `revoke execute … from public, anon, authenticated`
  right after creating it. Triggers still run. The 15 existing ones were revoked in `20261206000000_revoke_trigger_helpers.sql`.
- A limit checked here (text length, counts) must match the same limit in `src/lib/schema.ts` (or the file named
  in the comment), so the app and the database agree. Write "Same limit as …" next to it.

## Finding a function's newest version

Many functions were changed again in later files (`create or replace function`). The newest version is in the
**latest** file that defines it. Find it with a search, e.g. `create or replace function public.save_presentation`
(today: `20261201000000_editor_author_and_copy_source.sql`). Always start a change from that newest version, or older fixes get
lost.

## Refusal codes

A refusal raises an error with its own code. The app turns the code into a message in `REFUSALS`
(`src/lib/presentations.ts`) or in the action that called it. Main ones:

- `QM409`: someone saved a newer copy (conflict). `QM422`: a slide the app thought was saved is missing.
- `QM429`: saving too fast. `QMMAX`: too many presentations. `QMBAN`: banned account.
- `QMREV`: locked by a review or a submission (`is_review_locked`). `QMRVW`: review step not allowed.
  `QMSUB`: submission not allowed. `QMPUB`: publishing an empty presentation. `QMPHL`: removing a photo that is
  in a presentation or review waiting for QuizMatter (`photo_waiting_for_approval`).
- `42501`: not allowed (wrong person). `22023`: bad input that should never get past zod.
- `QMOLD`: the save came from older app code (`app_version`) than the presentation's `data_version` (or the review
  draft's `draft_version`). The app keeps the unsaved work in the browser and asks for a reload.
- `QMBLK`: a click limit paused the feature (the pause end time is in `details`), read by `pausedUntilFromError`
  (`src/lib/clickLimits.ts`).

## Where the big features live

- Presentations and saving: `save_presentation` (one step: details + slides, removes deleted slides).
- Data version: `20261209000000_data_version.sql`. `presentations.data_version` and
  `presentation_reviews.draft_version` keep the highest app `DATA_VERSION` that saved them. `save_presentation`,
  `save_review_draft` and `submit_review` take `app_version` (default 0) and refuse a lower one (`QMOLD`, checked
  before `QM409`; drafts through `check_review_version`). `publish_review` and `approve_submission` carry the version
  to the presentation they write. A new function that writes slides from app data must do the same. Its section 0
  also catches up `20261102000000_review_auto_reviewer.sql`, which never reached the live database (old
  `submit_review`, and the `background` column still there); don't run that old file again.
- Photos and the weekly cleanup: `used_photo_srcs` (drafts' photos count as used).
- Editor photos (`20261126000000_editor_photos.sql`): an editor's WebP upload also becomes a shared photo with
  `is_public = false` ("From editors" category), hidden from teachers and `search_shared_photos`. It turns public
  for good when a live QuizMatter presentation uses it (triggers on `slide_photos` and `presentations`).
  `20261127000000_editor_photo_fixes.sql`: the "My photos" lock only stops the person whose own submission or
  review is waiting; a waiting photo passes to another editor with the same file; new editors' old photos are
  added; `slide_photos (src)` index. `20261128000000_fix_photo_lock.sql`: the lock trigger reads the owner with
  `to_jsonb(old)`, since `shared_photos` has no `user_id`.
- Click limits: `20261013000000_click_limits.sql`, `20261014000000_click_auto_ban.sql`, `20261017000000_click_history.sql`.
- Reviews: `20261019000000_presentation_reviews.sql` and the review files after it (listed in the root `CLAUDE.md`).
- Submissions: `20261119000000_quizmatter_submissions.sql`, `20261120000000_submission_fixes.sql`,
  `20261121000000_submission_receipts.sql`.
- Super admin: `20261122000000_super_admin.sql`.
- Sharing (a teacher's Publish makes a shared copy, `shared_from` = the original): `20261123000000_shared_copy.sql`
  (`share_presentation`, `unshare_presentation`, and the `shared_copy_change` / `shared_copy_slides` guards that
  refuse any other change to a copy). `20261124000000_shared_copy_moderation.sql`: a hidden copy can't be made private
  or deleted by its teacher, a hidden original can't be shared, a copy can't be sent to QuizMatter, and editors
  can't publish (the editor role removes their copies). `20261125000000_shared_copy_fixes.sql`: an old app tab's
  "published" save is refused, and Move to QuizMatter removes the copy in the same step.
- This week's lessons, suggestions and editor profile lists: `20261129000000_lesson_week.sql` (`lesson_editor`,
  `lesson_week`, `editor_presentations`) and `20261130000000_lesson_extras.sql` (`lesson_extras`: the week list and
  the suggestions in one call, the only one the view page makes; `editor_presentations` checks the profile once).
  They return only ids. A lesson's maker is its approved submission's editor (`lesson_editor`, by `copy_id`), never
  the Author text; admin-made lessons have none.
- Editors' Author and Make a copy's source: `20261201000000_editor_author_and_copy_source.sql` (`set_editor_author`
  makes an editor's own presentations' Author their name on every save; `approve_submission` always uses the
  editor's name; `copied_from`, set by `save_presentation` on the first save only and kept by `keep_copied_from`).
- Author updates (a lesson's own editor changes it through a review round): `20261202000000_author_updates.sql`
  (`is_author_update`; newest `start_review`, `review_status`, `publish_review`, `admin_reviews`) and
  `20261203000000_author_update_published.sql` (newest `my_reviews`: also my published updates, latest round only).
- Likes: `20261204000000_presentation_likes.sql`. `presentation_likes` (who liked what, read only your own) and
  `presentation_like_counts` (the count, kept by the `count_like` trigger, readable by whoever can read the
  presentation), so a like never touches the presentations row. Changed only through `set_liked` (refuses admins,
  your own, private or hidden ones; counts the `like` click).
- Admin overview: `20261207000000_admin_overview.sql`. `activity_events` (a row per like, save or report, written by
  the `record_activity_event` trigger on `presentation_likes`, `saved_presentations`, `presentation_reports`; kept when
  the like is taken back; no one reads it directly). `admin_overview(days)` (days 7, 30 or 90, else `22023`; admins
  only, `42501`) gives one row per series per UTC day; sign-ups, logins, pauses and bans only for the super admin.
  `admin_todo_counts()` gives what waits: submitted reviews, submitted submissions, presentations with a report.
- Admin log: `20261208000000_admin_log.sql`. `admin_actions` (one row per admin step; only the super admin reads it,
  nobody changes it; keys match `ADMIN_ACTION_LABELS` in `src/lib/adminActions.ts`). Rows are written only by
  `log_admin_action` (not callable from the API; logs only when `is_admin()`), from `log_*` triggers on
  `presentation_reviews`, `presentation_submissions`, `presentations`, `presentation_reports` (one row per
  presentation, a statement trigger), `editors`, `photo_categories`, `shared_photos`. One click = one row: the first
  log sets the flag `quizmatter.admin_logged` and the other triggers skip, so side effects (a deleted presentation's
  reports and shared copy, the copies or reviews the editor role removes) aren't logged; the logging triggers are
  `before` triggers so they run first, except an `after insert` one on `presentation_reviews` (`set_review_open`
  making a new row open logs "opened"; "before insert" would fire on its upsert even when it only updates). The
  `editors` trigger skips an insert for someone already an editor (`setEditor`'s upsert). A presentation delete
  logs each row of a multi-delete and skips rows removed by a cascade (`pg_trigger_depth() > 1`). Bans, unbans
  and pause releases change things the database can't see, so the app calls `log_ban` (needs the `banned_users`
  row, else `P0002`; "ban updated" if already banned), `log_unban` (needs it gone) and `log_click_release` after
  they worked (super admin only, `42501`).
- Deleting an account (only from the Supabase dashboard, or the daily cleanup of unconfirmed ones):
  `20261205000000_account_delete_keeps_quizmatter.sql`. The `before_account_delete` trigger on `auth.users` moves
  the account's QuizMatter presentations to the super admin (refused if there's no other super admin), and removes
  their non-approved submissions. Approved receipts and "Reviewed by" rows stay, with an empty
  `submitter_id` / `reviewer_id` (`on delete set null`). Everything else of the account goes with it (`on delete
  cascade`): its own presentations, shared copies, folders, photos rows, likes, saved, reports, limits.
- Folders: `20261028000000_folders.sql`. Teacher profiles: `20261110000000_teacher_profiles.sql`,
  `20261112000000_profile_name_links.sql`.

Claude's drafts and photo tickets are NOT here: they live in Cloudflare D1 (`d1/migrations`).
