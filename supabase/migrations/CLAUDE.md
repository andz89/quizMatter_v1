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
- A trigger function (returns `trigger`) can't be called from the API: Postgres refuses to run one outside its
  trigger ("trigger functions can only be called as triggers"). A `security definer` one still gets
  `revoke execute … from public, anon, authenticated` right after creating it (triggers still run: Postgres checks
  `execute` only when the trigger is made); 15 older ones were revoked in `20261206000000_revoke_trigger_helpers.sql`.
  `security invoker` ones don't need it and mostly aren't revoked (e.g. `check_hidden_copy_delete`,
  `keep_editor_category`).
- A rule that must stop only direct writes through the API (not the database's own functions) goes in a
  `security invoker` trigger that checks `current_user = 'authenticated'`: a `security definer` function runs as its
  owner, so its writes get past (e.g. `guard_admin_presentation_update`). `save_presentation` is `security invoker`,
  so its writes are seen as the caller's (`authenticated`) too. A function used inside a policy needs
  `execute` for `authenticated`. A policy on a table can't read that same table (Postgres stops with "infinite
  recursion"): read it in a `security definer` function instead (e.g. `admin_may_delete`).
- A limit checked here (text length, counts) must match the same limit in `src/lib/schema.ts` (or the file named
  in the comment), so the app and the database agree. Write "Same limit as …" next to it.
- After writing one: `npm run test:sql` (resets the local Docker database, replays every migration, runs every test
  in `supabase/tests`), then `npm run db:snapshot`, and commit `supabase/schema.sql` and `src/lib/database.types.ts`
  with the migration. GitHub's Database check (`.github/workflows/database.yml`) fails if they weren't remade.

## Deploying (database first)

- Apply new migrations, in file-name order, **before** deploying the app code that uses them. Otherwise the app
  calls functions or reads tables that aren't there yet: for example, without `20261210000500` Admin → Editors fails
  (it calls `admin_editors`), and without `20261210000400` Admin → Safety fails and the sign up page loses its
  throwaway email check (they read `blocked_email_domains`).
- Then check in the Supabase dashboard (Authentication → Hooks) that the Before User Created hook is still on: the
  sign up limit and the throwaway email check run only through it.

## Finding a function's newest version

Many functions were changed again in later files (`create or replace function`). `supabase/schema.sql` (made by
`npm run db:snapshot`) has every table, function, trigger and policy as it is now, in one file: read a function
there. To change one, copy it from there (or from the **latest** migration that defines it) into a new migration,
so older fixes aren't lost. Never edit `schema.sql` by hand.

## Refusal codes

A refusal raises an error with its own code. The app turns the code into a message in `REFUSALS`
(`src/lib/presentations.ts`) or in the action that called it. Main ones:

- `QM409`: someone saved a newer copy (conflict). `QM422`: a slide the app thought was saved is missing.
- `QM429`: an admin adding shared photos too fast (saving presentations is a click limit now: `QMBLK`). `QMMAX`: too
  many presentations. `QMBAN`: banned account.
- `QMREV`: locked by a review or a submission (`is_review_locked`). `QMRVW`: review step not allowed.
  `QMSUB`: submission not allowed. `QMPUB`: publishing an empty presentation. `QMPHL`: removing a photo that is
  in a presentation or review waiting for QuizMatter (`photo_waiting_for_approval`).
- `42501`: not allowed (wrong person). `22023`: bad input that should never get past zod.
- `QMOLD`: the save came from older app code (`app_version`) than the presentation's `data_version` (or the review
  draft's `draft_version`, or a new copy's source). The app keeps the unsaved work in the browser and asks for a
  reload.
- `QMMNT`: maintenance is on (`check_maintenance`, PostgREST's pre-request guard, HTTP 503; root `CLAUDE.md`,
  "Maintenance"). The open tab goes to `/maintenance`.
- `QMBLK`: a click limit paused the feature (the pause end time is in `details`), read by `pausedUntilFromError`
  (`src/lib/clickLimits.ts`).
- `QMPPL`: an editor already saved 3 profile photos today (`set_profile_photo`).

## Where the big features live

- Presentations and saving: `save_presentation` (one step: details + slides, removes deleted slides).
- Data version: `20261209000000_data_version.sql`. `presentations.data_version` and
  `presentation_reviews.draft_version` keep the highest app `DATA_VERSION` that saved them. `save_presentation`,
  `save_review_draft` and `submit_review` take `app_version` (default 0) and refuse a lower one (`QMOLD`, checked
  before `QM409`; drafts through `check_review_version`). `publish_review` and `approve_submission` carry the version
  to the presentation they write. A new function that writes slides from app data must do the same. Its section 0
  also catches up `20261102000000_review_auto_reviewer.sql`, which never reached the live database (old
  `submit_review`, and the `background` column still there); don't run that old file again.
  `20261210000000_data_version_cap.sql`: both columns are capped at `current_data_version()` (0 today, same as
  `DATA_VERSION`) on every insert and update, whatever writes them (triggers `cap_presentation_data_version` and
  `cap_review_draft_version`), so a huge `app_version` can't make every later save refuse. Bump it in a migration
  applied before the app with the new `DATA_VERSION` deploys (`src/lib/CLAUDE.md`, "Changing the saved shape").
  `save_presentation` also refuses (`QMOLD`) a new presentation whose `copiedFrom` source has a higher
  `data_version` than its `app_version` (an old tab's Make a copy), and `share_presentation` gives the shared copy
  its original's `data_version`, so copies of a published presentation are checked too.
- Photos and the weekly cleanup: `used_photo_srcs` (drafts' photos, profile photos and announcement modal images
  count as used; newest in `20261221000000_announcements.sql`).
- Editor photos (`20261126000000_editor_photos.sql`): an editor's WebP upload also becomes a shared photo with
  `is_public = false` ("From editors" category), hidden from teachers and `search_shared_photos`. It turns public
  for good when a live QuizMatter presentation uses it (triggers on `slide_photos` and `presentations`). The
  uploads find that category by its name, so it can't be renamed or deleted, by anyone (`keep_editor_category`,
  `42501`; `20261210000200_database_fixes.sql`).
  `20261127000000_editor_photo_fixes.sql`: the "My photos" lock only stops the person whose own submission or
  review is waiting; a waiting photo passes to another editor with the same file; new editors' old photos are
  added; `slide_photos (src)` index. `20261128000000_fix_photo_lock.sql`: the lock trigger reads the owner with
  `to_jsonb(old)`, since `shared_photos` has no `user_id`.
- Click limits: `20261013000000_click_limits.sql`, `20261014000000_click_auto_ban.sql`, `20261017000000_click_history.sql`.
  `20261211000000_save_photo_click_limits.sql` (test `supabase/tests/save_photo_click_limits.sql`): saving
  presentations (`presentation_save` + `presentation_save_daily`, from `count_presentation_write`: once per request,
  the `quizmatter.write_counted` flag), photo uploads (`photo_upload` + `photo_upload_daily`, in `count_photo_upload`,
  called by the upload route) and photos rows (`photo_rows` + `photo_rows_daily`, from `count_photo_write`) count
  `count_click` instead of `count_write`: 30 in a minute pauses 10 minutes (1 hour if again within 24 hours), 1,000
  saves / 300 uploads / 300 photo rows a day pause until midnight (Philippine time), the 3rd time in a row bans. `count_click` doesn't check bans, so both
  triggers check `is_banned()` first (`QMBAN`). `count_write` is left only for admins' shared photos (`'photos'`).
  Folders and settings: `count_table_write('<feature>')`, statement triggers on `folders`, `folder_items`
  (`folders`) and `user_settings` (`settings`); it counts `<feature>` and `<feature>_daily` (500 a day each), once
  per request (flag `quizmatter.counted_<feature>`), only when
  `current_user = 'authenticated'` (so `set_display_name`, a database function, counts only `display_name`) and
  never without a logged-in user (an account delete runs them as `supabase_auth_admin`).
  `20261213000000_click_history_keeps_email.sql`: each `click_history` row saves the account's email
  (`set_click_history_email`, before insert, so `count_click` and the admin's Release don't send it), and deleting
  the account only empties `user_id` (`on delete set null`), so the record of who reached a limit stays. Test: in
  `supabase/tests/account_delete.sql`.
- Reviews: `20261019000000_presentation_reviews.sql` and the review files after it (listed in the root `CLAUDE.md`).
  Newest `check_review_draft` (run by `save_review_draft` and `submit_review`): `20261210000200_database_fixes.sql`,
  which also checks what the presentations table checks (at most 10 tags and 14 grades, a known slide effect, speed
  1–5), so a bad draft is refused when saved, not when an admin publishes it.
- Submissions: `20261119000000_quizmatter_submissions.sql`, `20261120000000_submission_fixes.sql`,
  `20261121000000_submission_receipts.sql`.
- Super admin: `20261122000000_super_admin.sql` (on a fresh, empty database with no users it only gives a notice
  instead of stopping, so a local `supabase db reset` works). Plain admin limits: `20261210000100_plain_admin_limits.sql`.
  Presentations: every admin reads every one ("Admins read every presentation"); the super admin may change
  anything ("Super admin manages every presentation"); every admin may update any one ("Admins hide any
  presentation"), but `guard_admin_presentation_update` lets nobody but the super admin change `owner_id` or
  `from_admin` on a direct write, and a plain admin change only `hidden_at` on someone else's; every admin deletes
  someone else's only when it or its shared copy is hidden or reported (`admin_may_delete`); and a restrictive rule
  lets only admins delete `from_admin` rows (a former admin can't). Editors: only the super admin adds a row, any
  admin removes one, and `check_editor_target` refuses an admin or a banned teacher. Test:
  `supabase/tests/plain_admin_limits.sql`.
- Sharing (a teacher's Publish makes a shared copy, `shared_from` = the original): `20261123000000_shared_copy.sql`
  (`share_presentation`, `unshare_presentation`, and the `shared_copy_change` / `shared_copy_slides` guards that
  refuse any other change to a copy). `20261124000000_shared_copy_moderation.sql`: a hidden copy can't be made private
  or deleted by its teacher, a hidden original can't be shared, a copy can't be sent to QuizMatter, and editors
  can't publish (the editor role removes their copies). `20261125000000_shared_copy_fixes.sql`: an old app tab's
  "published" save is refused, and Move to QuizMatter removes the copy in the same step.
  `20261210000000_data_version_cap.sql`: the copy gets the original's `data_version`. Newest `share_presentation`:
  `20261210000100_plain_admin_limits.sql` (a copy of a presentation QuizMatter hid can't be shared: refused when
  its `copied_from` source, or that source's shared copy, is hidden). `20261210000200_database_fixes.sql`: the
  hidden-copy check (`check_hidden_copy_delete`) only stops a logged-in person deleting the copy itself; it skips
  when there's no logged-in user or another trigger or a cascade removes it (`pg_trigger_depth() > 1`), so deleting
  an account can't get stuck on it.
- This week's lessons, suggestions and editor profile lists: `20261129000000_lesson_week.sql` (`lesson_editor`,
  `lesson_week`, `editor_presentations`) and `20261130000000_lesson_extras.sql` (`lesson_extras`: the week list and
  the suggestions in one call, the only one the view page makes; `editor_presentations` checks the profile once).
  They return only ids. A lesson's maker is its approved submission's editor (`lesson_editor`, by `copy_id`), never
  the Author text; admin-made lessons have none.
- A teacher's shared presentations on their profile: `20261212000000_teacher_shared_presentations.sql`
  (`teacher_shared_presentations(slug)`: their shared copies' ids, not hidden, last changed first, with the same
  profile check as `teacher_profile`, so a hidden admin's gives nothing). Test:
  `supabase/tests/teacher_shared_presentations.sql`.
- Editors' Author and Make a copy's source: `20261201000000_editor_author_and_copy_source.sql` (`set_editor_author`
  makes an editor's own presentations' Author their name on every save; `approve_submission` always uses the
  editor's name; `copied_from`, set by `save_presentation` on the first save only and kept by `keep_copied_from`).
- Author link: `20261216000000_author_link.sql` (test `supabase/tests/author_link.sql`).
  `presentations.author_id` is the editor a presentation belongs to as its Author: their own presentations (set by
  `set_editor_author` on each save while they're an editor; the next save after the role is taken away empties it)
  and the lesson `approve_submission` makes from their submission. Teachers' presentations and copies have none
  (their Author is free text). A direct write, or `save_presentation`, never sets or changes it (`keep_author_id`,
  only when `current_user = 'authenticated'`). While it's set, `set_editor_author` writes the editor's name
  (`editor_author()`) into `author` on every write, whatever was sent, so admins can't retype it. `set_display_name`
  writes the new name on every linked presentation in the same step, without changing `updated_at` (no `QM409`
  for an open tab); `check_presentation_review_lock` lets that through (flag `quizmatter.renaming_author`) and never
  compares `author_id`, so an account delete (`on delete set null`, the last name stays as text) works on a locked
  lesson. Newest `set_editor_author`, `approve_submission` and `check_presentation_review_lock` are in this file.
  `20261217000000_author_link_fixes.sql` (newest `set_display_name`): the rename isn't a presentation save (it turns
  on the write counter's `quizmatter.write_counted` flag for its update, then puts it back), and a one-time update
  linked what was made before (approved lessons by their submission, editors' own presentations, not shared copies).
- Author updates (a lesson's own editor changes it through a review round): `20261202000000_author_updates.sql`
  (`is_author_update`; newest `review_status`, `admin_reviews`; `publish_review` was changed again in
  `20261209000000_data_version.sql`, `start_review` in `20261210000500_admin_overview_counts.sql`) and
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
  `20261210000500_admin_overview_counts.sql` (test `supabase/tests/admin_overview_counts.sql`): reviews are counted
  by `presentation_reviews.first_submitted_at`, the round's first submit (set once by `submit_review`, kept by a
  send-back or a cancel, emptied by `start_review` for a new round; `send_back_review` still empties
  `submitted_at`), so a sent-back round stays counted. Old rounds were filled from the Admin log's first "sent back"
  of the round, else `submitted_at`, else (sent back before the Admin log existed) the round's start. Newest `admin_overview`, `start_review` and `submit_review` are
  in this file. It also adds `admin_editors()` (admins only, anyone else gets no rows): each editor with their email
  (from `auth.users`), presentations (not shared copies), photos, published reviews and the newest one's date, for
  Admin → Editors.
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
  logs each row of a multi-delete and skips rows removed by a cascade (`pg_trigger_depth() > 1`). Hiding, showing,
  sharing or moving presentations and deleting shared photos log each row too (`20261210000200_database_fixes.sql`:
  each row clears the flag first, except a row changed by another trigger, which keeps it). Bans, unbans
  and pause releases change things the database can't see, so the app calls `log_ban` (needs the `banned_users`
  row, else `P0002`; "ban updated" if already banned), `log_unban` (needs it gone) and `log_click_release` after
  they worked (super admin only, `42501`). Newest read policy and the `target_id` index:
  `20261210000300_direct_write_limits.sql`.
- Deleting an account (only from the Supabase dashboard, or the daily cleanup of unconfirmed ones):
  `20261205000000_account_delete_keeps_quizmatter.sql`. The `before_account_delete` trigger on `auth.users` moves
  the account's QuizMatter presentations to the super admin (refused if there's no other super admin), and removes
  their non-approved submissions. Approved receipts and "Reviewed by" rows stay, with an empty
  `submitter_id` / `reviewer_id` (`on delete set null`). Everything else of the account goes with it (`on delete
  cascade`): its own presentations, shared copies, folders, photos rows, likes, saved, reports, limits. A hidden
  shared copy doesn't stop it (`check_hidden_copy_delete` skips, `20261210000200_database_fixes.sql`).
  Supabase deletes as its own role, `supabase_auth_admin`, which can't run our functions (`count_write`,
  `count_click`, …). In the cascade, "before" triggers run as the table's owner, but "after" triggers (row and
  statement) run as `supabase_auth_admin`. So an "after" trigger on a table the delete reaches must be
  `security definer`, or call nothing that role can't run. The write counter `count_presentation_write` (after,
  invoker) returns first when `auth.uid()` is null (`20261210000300_direct_write_limits.sql`); before that, every
  Supabase delete failed with "permission denied for function count_write". Test, run as `supabase_admin`:
  `supabase/tests/account_delete.sql`.
- Fixes from the 2026-10-24 review: `20261210000200_database_fixes.sql` (the hidden-copy skip, an Admin log row for
  every row, the review draft checks, the locked "From editors" category; each told in its section above). Test:
  `supabase/tests/database_fixes.sql`.
- Limits on direct writes (a teacher writing a table straight through the API, skipping the app's path):
  `20261210000300_direct_write_limits.sql`, test `supabase/tests/direct_write_limits.sql`. Its triggers act only
  when `current_user = 'authenticated'`. `photos`: every new row is counted (`count_photo_write`; banned `QMBAN`), a
  counter of its own because the upload route already counts its upload before storing the file, so one upload
  isn't counted twice; no cap on how many rows (the app has none). Since `20261211000000_save_photo_click_limits.sql`
  that counter is the `photo_rows` click limit. Newest `count_write` is in this file. `slides`: at most 100 per presentation (`check_slide_limit`, `22023`, same as
  `MAX_SLIDES`), counting rows added earlier in the same insert and a slide moved in from another presentation; it
  skips slides already saved (save_presentation's upsert) and locks the presentation row first, like
  `save_presentation`. Speed and bans for slides were already counted by `count_slide_write`.
  `presentation_reports`, `user_settings`, `folder_items`: a banned account can't add or change rows
  (`refuse_banned_write`, `QMBAN`). Also: `check_folder_limit` counts under `pg_advisory_xact_lock` on the teacher
  (the same lock a new presentation takes); the admin log's read policy asks `(select public.is_super_admin())`
  once per query; an index on `admin_actions (target_id)` for `log_ban`; and `grades_from`, `profile_slug`,
  `tags_text`, `slide_photo_srcs` are revoked from `public` and `anon` (kept for `authenticated`: saves fill the
  `tags_text` / `profile_slug` columns with them), `search_shared_photos` stays `service_role` only. It also
  fixes Supabase's account delete (see "Deleting an account" above).
- Sign up hook (`hook_before_user_created`; Supabase Auth runs it just before making an account, turned on in the
  dashboard: Authentication → Hooks → Before User Created). `20261108000000_sign_up_limit.sql`: at most 10 accounts
  an hour from one internet address (`sign_up_attempts`). Newest version: `20261210000400_blocked_email_domains.sql`,
  which first refuses an email whose domain is in `blocked_email_domains` (the throwaway email services, in small
  letters; anyone may read it, the sign up page too; nobody changes it through the API: add a row in the dashboard's
  Table Editor), with the same words as `THROWAWAY_EMAIL_MESSAGE` (`src/lib/userSettings.ts`). The hook isn't
  `security definer`: it runs as `supabase_auth_admin`, and row level security applies to that role, so every table
  it uses needs a grant and a policy for it. A missing grant makes every sign up fail ("permission denied"); a
  missing read policy fails quietly: the hook sees no rows, so that check lets everyone through. Supabase gives it the email in
  `event -> 'user' ->> 'email'` and the address in `event -> 'metadata' ->> 'ip_address'`; it refuses by returning
  `{"error": {"http_code", "message"}}`. Test, run as `supabase_admin`: `supabase/tests/blocked_email_domains.sql`.
- Sign up consent: `20261218000000_terms_consent.sql` (test `supabase/tests/terms_consent.sql`).
  `user_settings.terms_version` / `terms_accepted_at`: which Terms and Privacy Policy version the teacher agreed to
  at sign up, and when. Set only by the newest `handle_new_user` (from the metadata key `terms_version`; empty for an
  account added from the dashboard); `keep_terms_consent` puts them back on a teacher's own write. Sign up details
  never stay in `auth.users.raw_user_meta_data`: `handle_new_user` removes them after copying, and
  `strip_sign_up_details` (before update on `auth.users`) keeps them out.
- Folders: `20261028000000_folders.sql` (the folder limit's lock: `20261210000300_direct_write_limits.sql`).
  Teacher profiles: `20261110000000_teacher_profiles.sql`, `20261112000000_profile_name_links.sql`.
- Editors' profile photos: `20261214000000_profile_photos.sql` (test `supabase/tests/profile_photos.sql`).
  `profile_photos` (one row per editor, `references editors on delete cascade`, so taking the role away or deleting
  the account removes it; no policies, nobody writes it directly). `set_profile_photo(src)` checks login, ban
  (`QMBAN`), editor (`42501`) and that `src` is one of our photo files (`22023`), then counts under a row lock: 3 a
  day by the `Asia/Manila` date (`QMPPL`), returning how many are left. `remove_profile_photo()` and
  `admin_remove_profile_photo(target)` (any admin; logs `profile_photo_removed`) only empty `src`, so the day's count
  stays. `my_profile_photo()` gives the account page `src` and `left_today`. It adds profile photos
  to `used_photo_srcs` (newest now in `20261221000000_announcements.sql`, with the newest `admin_actions` lists).
- Profile privacy: `20261215000000_profile_privacy.sql` (test `supabase/tests/profile_privacy.sql`; spec
  `docs/superpowers/specs/2026-10-28-profile-privacy-design.md`). `user_settings.full_name_public`,
  `education_public`, `bio_public` (default `true`; the owner writes them with their details). Its
  `teacher_profile` (`photo_src` from the photos file, plus the three as "others see this": the switch, or `true` for
  an editor): a private field comes back `''` for everyone but its owner, admins too. Apply it (after
  `20261214000000_profile_photos.sql`, whose table it joins) before the app deploys: `getAccount` reads these columns
  on every page.
- Birthday, gender, province and town: `20261220000000_age_gender_address.sql` (test
  `supabase/tests/age_gender_address.sql`; spec `docs/superpowers/specs/2026-10-30-age-gender-address-design.md`).
  `user_settings.birth_date` (empty allowed; `check_birth_date` refuses under 18, over 100 or a future date on
  today's Philippine date, `QMAGE`), `gender` (`''`, `male`, `female`), `province` (`''` or `is_province`, the same
  list as `src/lib/provinces.ts`), `town` (60 characters), `town_public` (default `true`). `age_on(birth, today)` and
  `manila_today()` are the age math (same as `src/lib/age.ts`). Newest `handle_new_user` and
  `strip_sign_up_details` (copy the four from the sign up metadata, a bad one saved empty, then remove them). Newest
  `teacher_profile` (adds `town`, `province`, `town_public`; never the birthday or gender).
  `admin_teacher_breakdown()` (admins only, `42501` otherwise): `(kind, label, total)` per province, age group
  (`18–24` … `55+`) and gender, `''` = not given. Apply it before the app deploys: `getAccount` reads these columns
  on every page.
- Announcements: `20261221000000_announcements.sql` (test `supabase/tests/announcements.sql`; spec
  `docs/superpowers/specs/2026-10-30-announcements-design.md`). `announcements` (one row each: name, on/off, optional
  `starts_at` / `ends_at`, the modal and bar parts, `repeat` `once` / `daily` / `every_visit`, `pages`, and the
  filters) and `announcement_dismissals` (who closed which part, `modal` or `bar`, and when; gone with the
  announcement or the account). RLS on, no policies, no grants: only the functions read and write them. Every limit
  is a check on the table (word lists through `announcement_words_ok`, provinces through
  `announcement_provinces_ok`, `is_province`); the same limits go in the app's zod `announcementSchema`.
  `announcement_matches(a, uid)` is the one matching rule (empty filter = everyone, a banned account never, an empty
  detail never matches a filter on it; age by `age_on(birth_date, manila_today())`; words anywhere in the town or
  field/major, ignoring case; presentations they own, not shared copies; roles: `editor` / `admin` by the tables,
  `teacher` = neither). `announcement_is_live(a)`: on, started, not ended. Super admin only (`42501`):
  `save_announcement(jsonb)` (keys = column names, no id = new; `updated_at` takes `clock_timestamp()`),
  `set_announcement_on`, `delete_announcement`, `admin_announcements()` (status `live` / `scheduled` / `ended` /
  `off`, matched accounts now, closed counts), `announcement_audience(jsonb)`. At most 20 on and not ended
  (`check_announcement_limit`, `22023`). Logged in: `my_announcements()` (live and matching; a closed part comes
  back off with no text: `once` = ever closed, `daily` = closed on today's Philippine date; both off = left out)
  and `dismiss_announcement(id, part)` (nothing for `every_visit`). Newest `maintenance_status` (adds
  `announcements_key`: an md5 of the live ones' ids and `updated_at`, null when none) and `used_photo_srcs` (adds
  every `<img src>` in `modal_html`) are in this file, and so are the newest `admin_actions` lists
  (`announcement_saved`, `announcement_deleted`, target `announcement`).

Claude's drafts and photo tickets are NOT here: they live in Cloudflare D1 (`d1/migrations`).
- Announcement modal size: `20261222000000_announcement_modal_size.sql` (test
  `supabase/tests/announcement_modal_size.sql`). `announcements.modal_size` (`small` / `medium` / `large`, default
  `large`; the app's `MODAL_SIZES` give their widths). Newest `save_announcement` (a save without it = `large`),
  `admin_announcements` and `my_announcements` (both return it; dropped and made again, with their grants).
- Announcement counts: `20261223000000_announcement_counts.sql` (test `supabase/tests/announcement_counts.sql`).
  `announcements.matched_count`, `closed_modal_count`, `closed_bar_count`, `counted_at`, `closed_cleared_at`.
  `count_announcement(id)` (not granted) counts one now; newest `save_announcement` calls it, and
  `recount_announcement(id)` (super admin, "Count again") too. Newest `admin_announcements` reads the kept numbers
  (plus `counted_at`) instead of counting on every call. Newest `dismiss_announcement` writes only for a live one.
  `cleanup_announcement_dismissals()` (service role, the daily timer): for one that ended over 30 days ago, keeps
  the closed counts, deletes its dismissal rows and sets `closed_cleared_at` (a later Count again keeps those
  closed numbers; saving it with a later end clears the mark, and its closes start over).
- Announcement fast counts: `20261224000000_announcement_fast_counts.sql` (tests
  `supabase/tests/announcement_fast_counts.sql`, `announcement_counts.sql`). `announcement_count(a)` (not granted)
  counts every matching account in one query: a second copy of `announcement_matches`'s rule, since Postgres won't
  merge a function rule into a query this size (one account at a time took ~5 s per 100,000; the logged-in role
  stops at 8 s). Change both together; the test checks they agree on 21 filter sets. Newest `announcement_audience`
  and `count_announcement` use it. Newest `save_announcement` doesn't count (the app calls `recount_announcement`
  next). `cleanup_announcement_dismissals(batch_size default 50000)` replaces the one without a size: it first keeps
  the closed counts of each announcement newly 30 days past its end, then deletes at most `batch_size` of the rows
  of those announcements and returns how many.
- Announcement as a post: `20261225000000_announcement_post.sql` (test `supabase/tests/announcement_post.sql`; spec
  `docs/superpowers/specs/2026-10-31-announcement-post-design.md`). `announcements.modal_text` (≤ 5,000) and
  `modal_attachment` (jsonb: null, `{kind: "photo", src, width?, height?}` or `{kind: "youtube", video_id, title,
  src, width?, height?}`; `announcement_attachment_ok`: `src` only our R2 address, sizes 1–1920, an 11-character
  video id, a title ≤ 200, no other keys) replace `modal_html` (dropped, with its checks; existing rows converted by
  `announcement_text_from_html` / `announcement_attachment_from_html`, kept for the test; a shown modal left empty
  gets its name as text). A shown modal needs text or an attachment (`announcements_modal_has_content`). Newest
  `save_announcement`, `admin_announcements` and `my_announcements` (the two fields instead of `modal_html`) and
  `used_photo_srcs` (the attachment's `src` instead of the `<img>` tags).
- Announcement Facebook posts: `20261226000000_announcement_facebook.sql` (test
  `supabase/tests/announcement_facebook.sql`). Newest `announcement_attachment_ok` also takes `{kind: "facebook",
  href, video}` (href https on facebook.com / www. / m. / web. or fb.watch, ≤ 500, no spaces, quotes or < >; video a
  boolean; no other keys), and turns a missing key into "no" (`coalesce(…, false)`; the `20261225` version let a
  YouTube card without a title through, since a check passes SQL's "unknown"). `announcement_picture_ok` (not granted)
  checks a photo's or YouTube card's picture. Newest `used_photo_srcs` takes only attachments with a `src`.
