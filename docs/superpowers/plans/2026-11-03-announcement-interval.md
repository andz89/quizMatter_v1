# Announcements: show again every N minutes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fourth "show it again" choice, "Again every N minutes" (N = 1–1,440, the admin's choice), that brings
an announcement back N minutes after the teacher closes it, in the same tab.

**Architecture:** The database gets `repeat = 'interval'` and a `repeat_minutes` column (saved and sent to teachers,
never a dismissal row). The browser remembers when each part was closed in the tab's sessionStorage state; two pure
helpers in `announcements.ts` decide what is still closed and when the next one comes back; the watch sets one
timer for that moment.

**Tech Stack:** Next.js (this repo's version), zod, Supabase (Postgres functions), Node's test runner, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-03-announcement-interval-design.md`

## Global Constraints

- N: whole minutes, 1–1,440 with `interval`, 0 with every other repeat — in the table check and in zod, number for number (`ANNOUNCEMENT_LIMITS.repeatMinutesMax = 1440`).
- The form's minutes box starts at 15 when "Again every N minutes" is picked.
- Remembered only in the tab: `dismiss_announcement` writes nothing for `interval`; the app doesn't call it either. No Privacy Policy change.
- Real clock time (`Date.now()`), counted from the close, not from when it appeared.
- All database testing on the local Docker Supabase only (`npm run test:sql`), never live.
- Migration `supabase/migrations/20261231000700_announcement_interval.sql`; apply it before the app deploys.
- Plain-English labels: choice "Again every N minutes"; list line "Again every N min".

## Review Focus

1. A tab saved before this change has no `closedAt`: it must load (treated as `{}`), with its closed parts staying closed — test in Task 3 (`storedSchema` parse of an old object is covered by `stillClosed` treating a missing time as "still closed").
2. Switching an announcement from "Again every 15 minutes" to "Once" must not leave 15 behind: `toSaved` sends 0 and the table refuses minutes on another repeat — tests in Tasks 1 and 2.
3. An admin empties the minutes box while typing: the box must not jump to 0 or save 0 with `interval` — zod refuses 0 with a plain message (Task 2 test); the box ignores an empty value like `AutoClose` does (Task 4).
4. Closed in a background tab, the time passes while hidden: on return it shows at once, not N more minutes later — `stillClosed` uses wall-clock `now` (Task 3 test "comes back once N minutes have passed, however long ago").
5. Presenting when the time comes: hidden until presenting ends, then shows — unchanged watch rule; checked in the e2e (Task 5) by presenting across the comeback moment.

---

### Task 1: Database — `interval` and `repeat_minutes`

**Files:**
- Create: `supabase/tests/announcement_interval.sql`
- Create: `supabase/migrations/20261231000700_announcement_interval.sql`
- Modify (generated): `supabase/schema.sql`, `src/lib/database.types.ts` (via `npm run db:snapshot`)

**Interfaces:**
- Produces: column `announcements.repeat_minutes int not null default 0`; `repeat` check allows `'interval'`; `my_announcements()` returns `repeat_minutes int` as its last column; `save_announcement` reads key `repeat_minutes`.

- [ ] **Step 1: Write the failing SQL test** `supabase/tests/announcement_interval.sql`, same shape as `supabase/tests/announcement_show_after.sql` (super admin + teacher, `pg_temp.ann`, `pg_temp.save`, `pg_temp.code`, rolled back). Checks:
  1. `{"repeat":"interval","repeat_minutes":11}` saves; `admin_announcements` gives 11; the teacher's `my_announcements` row has `repeat = 'interval'` and `repeat_minutes = 11`.
  2. Refused with `23514`: `interval` + 0, `interval` + 1441, `once` + 15, `interval` + -1.
  3. `interval` + 1 and `interval` + 1440 save.
  4. A save without `repeat_minutes` and `repeat = 'once'` gives 0; an update of the 11 one without the key keeps 11.
  5. As the teacher, `dismiss_announcement(<interval id>, 'modal')` writes no `announcement_dismissals` row (count as postgres after `reset role`, or check `my_announcements` still sends it).
- [ ] **Step 2: Run it, see it fail** — `npm run test:sql -- announcement_interval.sql` → ERROR: column `repeat_minutes` does not exist.
- [ ] **Step 3: Write the migration.** Top comment in plain English (what, why, deploy: before the app). Then:
  - `alter table public.announcements drop constraint announcements_repeat_check, add constraint announcements_repeat_check check (repeat in ('once','daily','every_visit','interval')), add column repeat_minutes int not null default 0, add constraint announcements_repeat_minutes check ((repeat = 'interval' and repeat_minutes between 1 and 1440) or (repeat <> 'interval' and repeat_minutes = 0));`
  - Newest `save_announcement`: copy from `20261231000600_announcement_show_after.sql`; add `repeat_minutes` to the insert list (`coalesce(r.repeat_minutes, 0)`) and the update list (`repeat_minutes = r.repeat_minutes`).
  - Newest `my_announcements`: copy from `20261231000600`; drop + create with `repeat_minutes int` added last and `m.repeat_minutes` last in the select; same revoke/grant.
  - Newest `dismiss_announcement`: copy from `supabase/schema.sql`; the early-return check becomes `a.repeat not in ('every_visit', 'interval')`; same grants as before (read them in `schema.sql`).
- [ ] **Step 4: Run all SQL tests** — `npm run test:sql` → "31 of 31 SQL tests passed" (includes `announcement_columns.sql`).
- [ ] **Step 5: Remake the snapshot** — `npm run db:snapshot`; `src/lib/database.types.ts` now has `repeat_minutes`.
- [ ] **Step 6: Commit** the migration, the test, `schema.sql`, `database.types.ts` ("Announcements: repeat 'interval' with repeat_minutes (database)").

### Task 2: Schema and form logic (`announcements.ts`, `announcementForm.ts`)

**Files:**
- Modify: `src/lib/announcements.ts` (REPEATS, REPEAT_LABELS, ANNOUNCEMENT_LIMITS, announcementSchema, myAnnouncementSchema)
- Modify: `src/lib/announcementForm.ts` (NEW_ANNOUNCEMENT, toSaved)
- Modify: `src/app/admin/announcements/RepeatSection.tsx` (`REPEAT_HELP.interval` only: it's keyed by every repeat, so tsc needs it now)
- Test: `src/lib/announcements.test.ts`, `src/lib/announcementForm.test.ts`

**Interfaces:**
- Consumes: Task 1's column name `repeat_minutes`.
- Produces: `REPEATS = ["once","daily","every_visit","interval"]`; `REPEAT_LABELS.interval = "Again every N minutes"`; `ANNOUNCEMENT_LIMITS.repeatMinutesMax = 1440`; `AnnouncementInput.repeat_minutes: number`; `MyAnnouncement.repeat_minutes: number`.

- [ ] **Step 1: Write failing tests.** Add `repeat_minutes: 0` to `valid` and `row()` in `announcements.test.ts`, then:
  - `announcementSchema takes 'every N minutes' with 1–1,440 whole minutes`: `{repeat:"interval",repeat_minutes:11}`, `1`, `1440` parse.
  - `announcementSchema refuses bad minutes`: `interval` with 0, 1441, 1.5 → message `"Pick 1–1,440 minutes."`; `once` with 15 → `"Minutes go only with 'Again every N minutes'."`.
  - `a my_announcements row without repeat_minutes is 0`.
  - In `announcementForm.test.ts`: `toSaved keeps the minutes only for 'every N minutes'` — `{...filled, repeat:"interval", repeat_minutes:11}` → 11; `{...filled, repeat:"once", repeat_minutes:11}` → 0; `NEW_ANNOUNCEMENT.repeat_minutes === 0`.
- [ ] **Step 2: Run** `npm test` → the new tests fail (`repeat_minutes` undefined / `interval` not in enum).
- [ ] **Step 3: Implement** the Produces list; zod field `repeat_minutes: z.number().int(MINUTES_WRONG)` plus two refines (`repeat !== "interval" || 1 ≤ n ≤ 1440` → `"Pick 1–1,440 minutes."`; `repeat === "interval" || n === 0` → `"Minutes go only with 'Again every N minutes'."`, path `repeat_minutes`); `myAnnouncementSchema.repeat_minutes: z.number().catch(0)`; `toSaved`: `repeat_minutes: form.repeat === "interval" ? form.repeat_minutes : 0`.
- [ ] **Step 4: Add `REPEAT_HELP.interval`** in `RepeatSection.tsx` with the spec's text (when: "It shows again N minutes after the teacher closes it, in the same browser tab, while they move between pages or reload. A new tab or window shows it again at once. It's remembered only in that tab, not on their account." goodFor: "a reminder that must not be missed during an event, e.g. \"Sign-ups close at 5 pm today.\"").
- [ ] **Step 5: Run** `npm test`, `npx tsc --noEmit`, `npm run lint` → all clean.
- [ ] **Step 6: Commit.**

### Task 3: The tab's closed times (`stillClosed`, `reopenAt`) and the watch

**Files:**
- Modify: `src/lib/announcements.ts` (two helpers)
- Modify: `src/components/AnnouncementsWatch.tsx`
- Test: `src/lib/announcements.test.ts`

**Interfaces:**
- Consumes: `MyAnnouncement.repeat`, `.repeat_minutes`.
- Produces:
  - `reopenAt(list: MyAnnouncement[], key: string, closedAt: Record<string, number>): number | null` — key `"<id>:modal"`/`"<id>:bar"`; `closedAt[key] + repeat_minutes * 60_000` for an `interval` announcement with a closed time, else null.
  - `stillClosed(list: MyAnnouncement[], closed: string[], closedAt: Record<string, number>, now: number): Set<string>` — `closed` minus keys whose `reopenAt` is ≤ `now`.

- [ ] **Step 1: Write failing tests:**
  - `reopenAt: closed time + N minutes, only for 'every N minutes'` — interval 11 closed at `t` → `t + 660_000`; a `once` row → null; no closed time → null.
  - `stillClosed: an 'every N minutes' part comes back once N minutes have passed, however long ago` — at `t + 659_999` still closed; at `t + 660_000` and at `t + 10 h` open; a `once` key closed at `t` stays closed at `t + 10 h`; a closed key with no time (tab from before) stays closed.
- [ ] **Step 2: Run** `npm test` → fail (not exported).
- [ ] **Step 3: Implement both helpers** (plain functions, next to `isWaiting`).
- [ ] **Step 4: Run** `npm test` → pass.
- [ ] **Step 5: Wire the watch** (`AnnouncementsWatch.tsx`):
  - `storedSchema` gains `closedAt: z.record(z.string(), z.number()).catch({})`; the load keeps it for the same visit (`saved && sameVisit ? saved.closedAt : {}`).
  - `close`: also sets `closedAt[key] = Date.now()`; call `dismiss_announcement` only when `repeat` is `once` or `daily`.
  - `const now = Date.now()` each render; `const closed = stillClosed(stored.items, stored.closed, stored.closedAt, now)` replaces `new Set(stored.closed)` in `pickForPage` and `isWaiting`.
  - One `useEffect` keyed on the earliest future `reopenAt` over `stored.closed`: `setTimeout` to that moment, which drops the reopened keys from `closed` / `closedAt`, writes with `writeStored`, and sets state (re-render). No timer when none is due. Keep it above the early `return null`.
  - Update the component comment.
- [ ] **Step 6: Run** `npx tsc --noEmit`, `npm run lint`, `npm test` → clean.
- [ ] **Step 7: Commit.**

### Task 4: Admin form and list

**Files:**
- Modify: `src/app/admin/announcements/RepeatSection.tsx`
- Modify: `src/app/admin/announcements/AnnouncementForm.tsx:155`
- Modify: `src/app/admin/announcements/AnnouncementList.tsx` (the `parts` line)

**Interfaces:**
- Consumes: `REPEATS`, `REPEAT_LABELS`, `ANNOUNCEMENT_LIMITS.repeatMinutesMax` (Task 2).
- Produces: `RepeatSection({ value, onChange, minutes, onMinutes })` where `onMinutes: (n: number) => void`.

- [ ] **Step 1:** Under the `interval` choice, while it is picked, a number box (`inputClass w-24`, `min={1}`, `max={L.repeatMinutesMax}`, label "Every [ ] minutes (1–1,440)"); an empty box is ignored like `AutoClose`. Picking `interval` with minutes 0 sets 15 (`DEFAULT_REPEAT_MINUTES = 15`); picking another choice leaves the number in the form (toSaved sends 0).
- [ ] **Step 2:** `AnnouncementForm` passes `minutes={form.repeat_minutes}` / `onMinutes={(n) => set("repeat_minutes", n)}`.
- [ ] **Step 3:** List line: `.concat(row.repeat === "interval" ? \` · again every ${row.repeat_minutes} min\` : "")`.
- [ ] **Step 4:** `npx tsc --noEmit`, `npm run lint` → clean. Commit.

### Task 5: Browser test and notes

**Files:**
- Create: `e2e/announcements-interval.mjs`
- Modify: `CLAUDE.md` (Announcements → "Show again"), `src/lib/CLAUDE.md`, `src/components/CLAUDE.md`, `src/app/admin/CLAUDE.md`, `supabase/migrations/CLAUDE.md`, `e2e/CLAUDE.md`

- [ ] **Step 1: Write the e2e test** with `e2e/lib.mjs` (like `announcements-show-after.mjs`): super admin makes a modal in the form with "Again every N minutes" = 2 (checks the box starts at 15, the list says "again every 2 min"); teacher page with `page.clock.install()` before `goto`:
  1. modal shows; close it; gone; in-app move to Saved: still gone;
  2. `page.clock.fastForward("01:59")` → still gone; `fastForward("00:02")` → back;
  3. close; reload; `fastForward("02:01")` → back (closed time survives reload);
  4. close; set `data-presenting` on `<html>`, `fastForward("02:01")` → hidden; remove the mark → shows;
  5. a new tab (new page in the context) shows it at once;
  6. the database has no `announcement_dismissals` row for it.
- [ ] **Step 2: Run** (`npx -y supabase@latest start`, `npm run e2e:dev`, then `node e2e/announcements-interval.mjs`) → "N of N checks passed". Re-run `announcements-admin.mjs`, `announcements-pages.mjs`, `announcements-show-after.mjs` → all pass.
- [ ] **Step 3: Notes** — each file listed above, in plain English, true to the code (the root "Show again" bullet gains `interval`).
- [ ] **Step 4: Final check** — `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run test:sql`, `git diff` against the spec. Commit ("Announcements: show again every N minutes").
