# Announcement columns: fewer copies, nothing forgotten

Date: 2026-11-02. Builds on `2026-10-30-announcements-design.md` and every later announcement spec.

## Why

Adding a column to `announcements` (a new setting) has meant a new full copy of three functions in the migration:
`save_announcement` (8 copies so far), `admin_announcements` and `my_announcements` (6 each, each dropped and created
again). Nothing warns when one copy misses the new column: the setting is quietly not saved, not shown to the admin
(and then overwritten on the next save), or never reaches teachers. Separately, an older admin tab that saves
without a newer key resets that setting to its default (e.g. a corner box back to a centered modal).

This is a code-maintenance change: nothing changes for the super admin or teachers.

## Decisions

- **The admin list reads the table's own rows.** `admin_announcements()` becomes `returns setof public.announcements`
  (super admin check, newest first, as now). A new column is included by itself, forever; the generated TypeScript
  types follow the table. The computed fields go: the list reads the kept counts under their column names
  (`matched_count`, `closed_modal_count`, `closed_bar_count`, `counted_at`), and the status label (live / scheduled /
  ended / off) is worked out in the app by `announcementStatus(row, now)` in `src/lib/announcements.ts` (same rule as
  before: ended when `ends_at` ≤ now, else off when not `is_on`, else scheduled when `starts_at` > now, else live).
- **`my_announcements()` keeps its written list.** It sends data to every teacher's browser, so it names what
  teachers may see (an allow-list). A "whole row minus a hide list" would leak any future admin-only column (e.g. a new
  filter) to all teachers. Unchanged in this work; the safety test watches it.
- **`save_announcement` keeps its written list** (it is the list of what the admin may set), but an update now starts
  from the row as it is: `jsonb_populate_record(<current row>, a)`, so a key the app didn't send keeps its current
  value instead of being reset. A new row still starts from the defaults (the `coalesce`s, as now).
- **A safety test** (`supabase/tests/announcement_columns.sql`) fails, naming the column, when:
  1. a column of `announcements` is neither sent by `my_announcements` nor on the test's "admin only" list (so every
     new column gets a conscious "teachers may see it" or "admin only");
  2. a column the admin sets (every column except `id`, `created_by`, `created_at`, `updated_at`, `matched_count`,
     `closed_modal_count`, `closed_bar_count`, `counted_at`, `closed_cleared_at`) is missing from
     `save_announcement`'s insert list or its update (`col =`), read from `pg_get_functiondef`;
  3. `admin_announcements` stops returning `setof announcements`.
  It also checks the save fix: an update without `modal_display` / `modal_auto_close` keeps a corner box's values.

## Changes

- Migration `20261231000400_announcement_columns.sql`: newest `save_announcement` (update from the current row,
  `for update`, same checks, same `check_one_on` and log), `drop` + `create` `admin_announcements()` returning
  `setof public.announcements`, grants as before.
- SQL tests that read `status` / `matched` / `closed_modal` / `closed_bar` from `admin_announcements`
  (`announcements.sql` part 10, `announcement_counts.sql`) read the column names instead; the status checks move to
  the app test of `announcementStatus`. Tests that read other columns keep working (same names).
- App: `AnnouncementRow` (`AnnouncementList.tsx`) becomes `AnnouncementInput` plus the kept counts under their column
  names; the list calls `announcementStatus(row, new Date())`. The edit page is unchanged (it maps the schema's keys).
- `npm run db:snapshot`; notes: root `CLAUDE.md` "Announcements" (how to add a column: save list, the test's lists,
  `my_announcements` only if teachers need it), `src/lib/CLAUDE.md`, `src/app/admin/CLAUDE.md`.

## Adding a column afterwards (the new routine)

1. `alter table … add column …` with its checks.
2. Re-create `save_announcement` with the column in its insert list (as `coalesce(r.<col>, <default>)`, so an older
   tab that doesn't send it can still make a new one) and its update list.
3. Teachers need it? Re-create `my_announcements` with it (drop + create: its columns change). Otherwise add it to
   the safety test's "admin only" list.
4. `announcementSchema` (zod) and the form.
The admin list needs nothing. `npm run test:sql` fails if step 2 or 3 was missed.

## Tests

- `src/lib/announcements.test.ts`: `announcementStatus` (live, scheduled, ended, off; ended wins over off).
- `supabase/tests/announcement_columns.sql` (the safety test and the save fix), written first.
- `npm run test:sql`, `npm test`, `tsc`, lint.

## Deploy

This one goes the other way round: **deploy the app first, then paste the migration.** The new app works with the
old `admin_announcements` (it computes the status itself; until the migration the counts show as "not counted"),
but the old app would break on the new one (it reads `status`, which is gone). Teachers are not affected either way.
With the corner box still waiting, the whole order is: corner box migration → app → this migration.
