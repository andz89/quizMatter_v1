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
- A limit checked here (text length, counts) must match the same limit in `src/lib/schema.ts` (or the file named
  in the comment), so the app and the database agree. Write "Same limit as …" next to it.

## Finding a function's newest version

Many functions were changed again in later files (`create or replace function`). The newest version is in the
**latest** file that defines it. Find it with a search, e.g. `create or replace function public.save_presentation`
(today: `20261125000000_shared_copy_fixes.sql`). Always start a change from that newest version, or older fixes get
lost.

## Refusal codes

A refusal raises an error with its own code. The app turns the code into a message in `REFUSALS`
(`src/lib/presentations.ts`) or in the action that called it. Main ones:

- `QM409`: someone saved a newer copy (conflict). `QM422`: a slide the app thought was saved is missing.
- `QM429`: saving too fast. `QMMAX`: too many presentations. `QMBAN`: banned account.
- `QMREV`: locked by a review or a submission (`is_review_locked`). `QMRVW`: review step not allowed.
  `QMSUB`: submission not allowed. `QMPUB`: publishing an empty presentation.
- `42501`: not allowed (wrong person). `22023`: bad input that should never get past zod.
- `QMBLK`: a click limit paused the feature (the pause end time is in `details`), read by `pausedUntilFromError`
  (`src/lib/clickLimits.ts`).

## Where the big features live

- Presentations and saving: `save_presentation` (one step: details + slides, removes deleted slides).
- Photos and the weekly cleanup: `used_photo_srcs` (drafts' photos count as used).
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
- Folders: `20261028000000_folders.sql`. Teacher profiles: `20261110000000_teacher_profiles.sql`,
  `20261112000000_profile_name_links.sql`.

Claude's drafts and photo tickets are NOT here: they live in Cloudflare D1 (`d1/migrations`).
