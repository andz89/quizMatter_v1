# Announcement Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adding an `announcements` column no longer needs a copy of the admin list function, and a forgotten column
fails a test; an update keeps settings the app didn't send.

**Architecture:** `admin_announcements()` returns `setof public.announcements`; the app computes the status label
(`announcementStatus`). `save_announcement` updates from the current row (`jsonb_populate_record(current, a)`).
`my_announcements` is untouched. A new SQL safety test checks every column is classified and saved.

**Tech Stack:** Supabase Postgres (local Docker for every test), Next.js, zod, Node's test runner.

**Spec:** `docs/superpowers/specs/2026-11-02-announcement-columns-design.md`

## Global Constraints

- Every database test runs on the local Docker stack (`npm run test:sql`), never on the live project.
- `my_announcements` keeps its written allow-list (teacher privacy); this plan doesn't change it.
- Server-managed columns (never set by the admin): `id`, `created_by`, `created_at`, `updated_at`, `matched_count`,
  `closed_modal_count`, `closed_bar_count`, `counted_at`, `closed_cleared_at`.
- Status rule: `ended` when `ends_at` ≤ now; else `off` when not `is_on`; else `scheduled` when `starts_at` > now;
  else `live`.
- Deploy order for this change: app first, then this migration (after the corner box migration).
- No commits unless the user asks; notes change with the code.

## Review Focus

- The new app against the **old** `admin_announcements` (deploy window): the list must not crash when
  `matched_count` / `closed_*_count` are missing (`== null` checks) (Task 2 step).
- An update from an older tab missing a newer key keeps the stored value (Task 1 SQL test).
- A save that sends a key with an explicit `null` (e.g. `ends_at: null`) still clears it (Task 1 SQL test).
- A column the admin can't set (e.g. `matched_count` sent in the JSON) is never changed by a save (Task 1 SQL test).
- The edit page still loads every form field from the new `admin_announcements` rows (Task 2: it maps
  `announcementSchema.shape` keys; check by hand).

---

### Task 1: Database (safety test, save fix, admin list)

**Files:**
- Create: `supabase/tests/announcement_columns.sql`, `supabase/migrations/20261231000400_announcement_columns.sql`
- Modify: `supabase/tests/announcements.sql` (part 10), `supabase/tests/announcement_counts.sql` (`row_of`)
- Regenerate: `supabase/schema.sql`, `src/lib/database.types.ts`

**Interfaces:**
- Produces: `admin_announcements() returns setof public.announcements` (newest first); counts under their column
  names; no `status`.

- [ ] **Step 1: Write `announcement_columns.sql`** (style of `announcement_corner_box.sql`, super admin `…0004e1`,
  ends in `rollback;`):
  1. Every column of `public.announcements` (`information_schema.columns`) is in `my_announcements`'s output columns
     (`pg_proc.proargnames` where `proargmodes` = `t`) or in the test's admin-only list: `name`, `is_on`,
     `starts_at`, `ends_at`, `genders`, `age_min`, `age_max`, `education_levels`, `field_words`, `presentations_min`,
     `presentations_max`, `roles`, `created_by`, `updated_at`, `matched_count`, `closed_modal_count`,
     `closed_bar_count`, `counted_at`, `closed_cleared_at` → else `FAIL: column % is neither sent to teachers nor
     marked admin only`.
  2. Every column except the server-managed ones matches `\m<col>\s*=` in
     `pg_get_functiondef('public.save_announcement(jsonb, boolean)'::regprocedure)` and appears in its insert list →
     else `FAIL: save_announcement does not save %`.
  3. `pg_get_function_result('public.admin_announcements()'::regprocedure) = 'SETOF announcements'`.
  4. Save a corner box (Small, auto close 30), then update it with a JSON lacking `modal_display` and
     `modal_auto_close` → still `corner` / 30.
  5. Update with `"ends_at": null` after it had an end → `ends_at` is null.
  6. Update sending `"matched_count": 999` → `matched_count` unchanged.
- [ ] **Step 2: Run it, expect FAIL** (`docker exec -i supabase_db_quizBuilder psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/announcement_columns.sql`): case 3 or 4 fails.
- [ ] **Step 3: Write the migration.** Newest `save_announcement`: same checks; insert path as now; update path
  `select * into cur from public.announcements where id = r.id for update` (missing → `P0002`), then
  `r := jsonb_populate_record(cur, a)` and `update … set <every editable column> = r.<col>, updated_at =
  clock_timestamp(), closed_cleared_at = <as now>`; then `check_one_on` and the log as now. `drop function
  public.admin_announcements(); create function … returns setof public.announcements` (super admin check, `return
  query select a.* from public.announcements a order by a.created_at desc, a.id`), revoke / grant as before.
- [ ] **Step 4: Update the two older tests**: `announcements.sql` part 10 checks `matched_count` /
  `closed_modal_count` / `closed_bar_count` (status checks removed: moved to Task 2); `announcement_counts.sql`
  `row_of` selects `a.matched_count, a.closed_modal_count, a.closed_bar_count, a.counted_at`.
- [ ] **Step 5: Apply and run, expect PASS**; then `npm run test:sql` → all pass; `npm run db:snapshot`.

### Task 2: App (status label, list)

**Files:**
- Modify: `src/lib/announcements.ts`, `src/lib/announcements.test.ts`,
  `src/app/admin/announcements/AnnouncementList.tsx`

**Interfaces:**
- Consumes: Task 1's row shape.
- Produces: `type AnnouncementStatus = "live" | "scheduled" | "ended" | "off"`;
  `announcementStatus(a: { is_on: boolean; starts_at: string | null; ends_at: string | null }, now: Date): AnnouncementStatus`.

- [ ] **Step 1: Failing test** `announcementStatus: live, scheduled, ended, off (ended wins)`: now =
  2026-11-02T00:00Z; on + no times → `live`; on + starts tomorrow → `scheduled`; on + ended an hour ago → `ended`;
  off + ended → `ended`; off + no times → `off`; ends exactly now → `ended`.
- [ ] **Step 2: Run, expect FAIL** (`node --no-warnings --import ./scripts/test-resolve.mjs --test src/lib/announcements.test.ts`).
- [ ] **Step 3: Implement** `announcementStatus` in `src/lib/announcements.ts` (Global Constraints rule).
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: List**: `AnnouncementRow` = `AnnouncementInput & { id: string; created_at: string; matched_count:
  number | null; closed_modal_count: number | null; closed_bar_count: number | null; counted_at: string | null }`
  (nullable: the old function during deploy has none); `status = STATUS[announcementStatus(row, new Date())]`; the
  counts line uses the column names and `== null` checks; `row.status !== "ended"` uses the computed status.
- [ ] **Step 6: Check**: `npx tsc --noEmit`, `npm test`, `npm run lint` → clean.

### Task 3: Notes

**Files:** root `CLAUDE.md` ("Announcements": `admin_announcements` returns the rows; "Adding a column" routine from
the spec; the safety test), `src/lib/CLAUDE.md` (`announcementStatus`), `src/app/admin/CLAUDE.md` (the list's status
and counts).

- [ ] **Step 1: Write the notes.**
- [ ] **Step 2: Re-read `git diff`** against the spec; tell the user the deploy order (corner box migration → app →
  `20261231000400_announcement_columns.sql`).
