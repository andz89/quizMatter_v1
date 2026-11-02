# Corner Box Announcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A third announcement type, a non-blocking box at the bottom-right with the close circle and an optional
self-close timer.

**Architecture:** A corner box is a modal row with `modal_display = 'corner'` and `modal_auto_close` seconds; all
content columns, checks, photo rules and closed records are reused. `check_one_on` gets a third slot. The teacher view
adds `AnnouncementCornerBox` next to `AnnouncementModal` / `AnnouncementBar`; the form adds a third Type choice.

**Tech Stack:** Next.js (this repo's version: read `node_modules/next/dist/docs/` before touching routing), React,
zod, Tailwind (tokens in `src/app/globals.css`), Supabase Postgres (local Docker for every test), Node's test runner.

**Spec:** `docs/superpowers/specs/2026-11-02-announcement-corner-box-design.md`

## Global Constraints

- Every database test runs on the local Docker stack (`npm run test:sql`), never the live project.
- Limits are written twice, number for number: the database and `ANNOUNCEMENT_LIMITS` (`src/lib/announcements.ts`).
- `modal_display`: `center` | `corner`, default `center`. `modal_auto_close`: 0 (never) or 5–600 seconds, only when
  `corner`. A corner box's `modal_size`: `small` | `medium` only.
- One "on" slot each: centered modal, top bar, corner box (`QMONE` conflict; `replace_current` swaps).
- A self-close is the same as a button close (`close(announcement, "modal")`).
- No Escape for the corner box; no backdrop; the box sits below the modal's backdrop (`z-[60]` is the modal).
- Design system only: `rounded-card`, `border-border-default`, `bg-bg-surface`, `bg-accent`, Lucide icons; a new
  animation goes in `globals.css` as `--animate-…`.
- No commits unless the user asks; notes (`CLAUDE.md` files) change with the code.

## Review Focus

- An older admin tab or older `my_announcements` row without the new keys: it must stay a centered modal with 0
  (Task 1 SQL test, Task 2 zod test).
- Turning a second corner box on from the **list** (`set_announcement_on`, not the form): must be a `QMONE` conflict,
  and a centered modal must not conflict with it (Task 1 SQL test).
- A Large modal switched to Corner box: zod must refuse Large with a clear message, and the form must pick Medium
  (Task 2 test; Task 4 step).
- A centered modal sent with `modal_auto_close` > 0 (hand-made request): refused by zod and the database (Tasks 1, 2).
- The corner box closing itself on an `every_visit` announcement: closed only in this tab, no database row (Task 3
  relies on the existing `close`; check by hand in Task 5).

---

### Task 1: Database (migration + SQL test)

**Files:**
- Create: `supabase/migrations/20261231000300_announcement_corner_box.sql`
- Create: `supabase/tests/announcement_corner_box.sql`
- Regenerate: `supabase/schema.sql`, `src/lib/database.types.ts` (`npm run db:snapshot`)

**Interfaces:**
- Produces: columns `modal_display text`, `modal_auto_close int`; `admin_announcements()` and `my_announcements()`
  return both (appended after `bar_height`); `save_announcement(a jsonb, replace_current boolean)` reads both
  (missing = `center` / 0); `check_one_on(saved uuid, replace_current boolean)` uses three slots.

- [ ] **Step 1: Write the failing SQL test** in the style of `supabase/tests/announcement_bar_html.sql` (super admin
  `…0004d1`, teacher `…0004d3`, `pg_temp.ann(extra)`, `pg_temp.act_as`, `pg_temp.code`), ending in `rollback;`. Cases:
  1. A corner box (`modal_display` `corner`, `modal_size` `small`, `modal_auto_close` 30, `is_on` true) saves;
     `admin_announcements` and the teacher's `my_announcements` return `corner` / 30.
  2. Refused (`pg_temp.code` not null): `modal_size` `large` with `corner`; `modal_display` `side`;
     `modal_auto_close` 4, 601; `modal_auto_close` 10 with `center`.
  3. A save without the two keys is `center` / 0.
  4. One centered modal, one bar and one corner box are on together (all saved with `is_on` true, no conflict).
  5. A second corner box with `replace_current` false → sqlstate `QMONE`; with true → the first is turned off.
  6. `set_announcement_on(<a third corner box>, true, false)` → `QMONE`; turning on a centered modal while a corner
     box is on raises nothing.
- [ ] **Step 2: Run it, expect FAIL**: `docker exec -i supabase_db_quizBuilder psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/announcement_corner_box.sql` → an error on case 1 (no such column / key ignored).
- [ ] **Step 3: Write the migration.** Header comment in the house style (what, why, spec path). Contents:
  - `alter table public.announcements add column modal_display text not null default 'center' check (modal_display in ('center', 'corner')), add column modal_auto_close int not null default 0 check (modal_auto_close = 0 or modal_auto_close between 5 and 600);`
  - `add constraint announcements_corner_size check (modal_display = 'center' or modal_size in ('small', 'medium'))`
    and `announcements_auto_close_corner check (modal_display = 'corner' or modal_auto_close = 0)`.
  - Newest `save_announcement`: copy the current one from `supabase/schema.sql:3174` and add the two columns to the
    insert list / values (`coalesce(r.modal_display, 'center')`, `coalesce(r.modal_auto_close, 0)`) and the update.
  - Newest `check_one_on`: slot of a row = `bar` when `show_bar`, else `corner` when `modal_display = 'corner'`, else
    `modal`; the conflict is another on, not-ended row with the same slot. Everything else as now (lock, QMONE,
    turn off).
  - `drop function` + `create function` for `admin_announcements()` and `my_announcements()` with the two fields after
    `bar_height` (copy the newest bodies from `supabase/schema.sql`), then their `revoke` / `grant` as in
    `20261231000000_announcement_bar_html.sql`.
- [ ] **Step 4: Apply it and run the test, expect PASS**: pipe the migration into the same `psql`, rerun the test →
  ends with `ROLLBACK`, no `FAIL` / `ERROR`.
- [ ] **Step 5: Full suite + snapshot**: `npm run test:sql` → "N of N SQL tests passed"; `npm run db:snapshot` →
  "Wrote supabase/schema.sql and src/lib/database.types.ts".

### Task 2: Rules and picking (`src/lib/announcements.ts`)

**Files:**
- Modify: `src/lib/announcements.ts` (limits, `announcementSchema`, `myAnnouncementSchema`, `pickForPage`)
- Test: `src/lib/announcements.test.ts`

**Interfaces:**
- Consumes: Task 1's field names.
- Produces: `MODAL_DISPLAYS = ["center", "corner"] as const`, `type ModalDisplay`; `CORNER_SIZES: ModalSize[] = ["small", "medium"]`;
  `ANNOUNCEMENT_LIMITS.autoCloseMin = 5`, `autoCloseMax = 600`; `announcementSchema` and `MyAnnouncement` gain
  `modal_display: ModalDisplay`, `modal_auto_close: number`; `pickForPage(list, group, closed)` returns
  `{ modals, bars, boxes }` (`modals` = center only; `boxes` = corner, not closed as `<id>:modal`, newest first).

- [ ] **Step 1: Write the failing tests** (add `modal_display: "center", modal_auto_close: 0` to the `valid` object):
  - `announcementSchema takes a corner box, Small or Medium, closing itself after 5–600 seconds`: `{...valid,
    modal_display: "corner", modal_size: "small", modal_auto_close: 30}` succeeds; `modal_auto_close` 0, 5, 600
    succeed.
  - `announcementSchema refuses a bad corner box`: `modal_size: "large"` → message
    `"A corner box is Small or Medium."`; `modal_auto_close` 4 and 601 → message
    `"It closes itself after 5–600 seconds, or never."`; `modal_display: "side"` fails;
    `{...valid, modal_auto_close: 10}` (center) → message `"Only a corner box closes itself."`.
  - `a my_announcements row without the corner fields is a centered modal`: parsed row has `center` and 0.
  - `pickForPage puts corner boxes in boxes, not modals`: a center row and a corner row on `all` → `modals` has only
    the center id, `boxes` only the corner id; with `closed` holding `<corner id>:modal`, `boxes` is empty.
- [ ] **Step 2: Run, expect FAIL**: `node --no-warnings --import ./scripts/test-resolve.mjs --test src/lib/announcements.test.ts` → the four new tests fail.
- [ ] **Step 3: Implement** the Interfaces above. Schema refines carry the three messages exactly as in Step 1;
  `myAnnouncementSchema` uses `.catch("center")` / `.catch(0)`.
- [ ] **Step 4: Run, expect PASS** (same command), then `npm test` → all pass.

### Task 3: What teachers see

**Files:**
- Modify: `src/app/globals.css` (one animation), `src/components/AnnouncementView.tsx`,
  `src/components/AnnouncementsWatch.tsx`

**Interfaces:**
- Consumes: Task 2's `MyAnnouncement` fields and `pickForPage(...).boxes`.
- Produces: `AnnouncementCornerBox(props: { text: string; attachment: ModalAttachment | null; format?: ModalFormat;
  html?: string; height?: number; closeAfter: number; autoClose: number; size: ModalSize; onClose: () => void })`
  exported from `AnnouncementView.tsx`; `--animate-shrink` in `globals.css`.

- [ ] **Step 1: `globals.css`**: `--animate-shrink: shrink 1s linear forwards;` with `@keyframes shrink { from { width:
  100% } to { width: 0 } }`, comment in the file's style ("the corner box's close-itself line; its length is set
  inline").
- [ ] **Step 2: Share the corner circle.** Move the modal's `corner` content (countdown span / `XCircleIcon` button) into
  a local `CloseCircle({ left, onClose })` used by both `AnnouncementModal` and the new box; move the post content
  (text paragraph + `AnnouncementAttachment`) and the html `SealedBox` into a local `AnnouncementContent({ text,
  attachment, format, html, height, width, onEscape? })`, so the box doesn't copy them.
- [ ] **Step 3: `AnnouncementCornerBox`**: a `fixed bottom-4 right-4 z-50` `group` card (`rounded-card border
  border-border-default bg-bg-surface overflow-hidden`), `style={{ width: \`min(${width}px, calc(100vw - 32px))\` }}`
  (width from `MODAL_SIZES`), `role="status"`; `CloseCircle` absolute at `top-3 right-3`; `AnnouncementContent`
  without `onEscape`; when `autoClose > 0`, a 3 px `bg-accent-soft` track with a `bg-accent animate-shrink` bar,
  `style={{ animationDuration: \`${autoClose}s\` }}`, `group-hover:[animation-play-state:paused]`,
  `onAnimationEnd={onClose}`.
- [ ] **Step 4: `AnnouncementsWatch`**: take `boxes` from `pickForPage`; render `boxes[0]` as
  `<AnnouncementCornerBox key={box.id} … autoClose={box.modal_auto_close} onClose={() => close(box, "modal")} />`
  alongside the bars and modal (same hidden-while-presenting rule).
- [ ] **Step 5: Check**: `npx tsc --noEmit` and `npm run lint` → no errors.

### Task 4: Admin form and list

**Files:**
- Modify: `src/app/admin/announcements/AnnouncementForm.tsx`, `src/app/admin/announcements/AnnouncementList.tsx`

**Interfaces:**
- Consumes: Task 2 (`MODAL_DISPLAYS`, `CORNER_SIZES`, limits), Task 3 (`AnnouncementCornerBox`).

- [ ] **Step 1: Form state**: `NEW_ANNOUNCEMENT` gains `modal_display: "center"`, `modal_auto_close: 0`. `TYPES`
  becomes three: `Modal` (`show_modal`, center), `Top bar (text only)` (`show_bar`), `Corner box` (`show_modal`,
  corner); the radio is checked by type key, and choosing Corner box with `modal_size` `large` sets `medium`; choosing
  Modal sets `modal_auto_close` 0.
- [ ] **Step 2: Section**: the Modal section is titled "Corner box" for a corner box; its Size radios list only
  `CORNER_SIZES`; after the close delay add **Closes itself**: radio Never / after `[n]` seconds (number input,
  min 5, max 600; Never = 0; picking "after" starts at 30). Preview: a corner box shows `AnnouncementCornerBox`
  (key `preview.key`) instead of the modal; `showPreview` treats it like the modal.
- [ ] **Step 3: Words**: `typeWord` = "top bar" / "corner box" / "modal" in both files; the list's type text is
  "Corner box" (plus " · closes after N s" when `modal_auto_close` > 0).
- [ ] **Step 4: Check**: `npx tsc --noEmit`, `npm run lint` → no errors. The edit page needs no change (it maps every
  `announcementSchema` key from `admin_announcements`).

### Task 5: Notes, Privacy Policy, final checks

**Files:**
- Modify: `CLAUDE.md` ("Announcements"), `src/components/CLAUDE.md` (announcement views), `src/app/(legal)/privacy/page.tsx`,
  `src/lib/legal.ts`

- [ ] **Step 1: Notes**: root `CLAUDE.md` Announcements: the corner box (a modal row with `modal_display` `corner`,
  its own one-on slot, `modal_auto_close`, closes as part `modal`, Small / Medium only; migration and test names).
  `src/components/CLAUDE.md`: `AnnouncementCornerBox`, `CloseCircle`, `AnnouncementContent`, the shrink line.
- [ ] **Step 2: Privacy**: "a pop-up or a bar at the top" → "a pop-up, a bar at the top or a box in the corner";
  `LEGAL_VERSION` → the day of the change.
- [ ] **Step 3: All checks**: `npm test`, `npm run test:sql`, `npx tsc --noEmit`, `npm run lint` → all pass; re-read
  `git diff` against the spec.
- [ ] **Step 4: Hand checks for the user (Preview)**: the box at the bottom-right, the page still clickable, the
  line shrinking and pausing on hover, closing itself, Small / Medium, the phone width, an `every_visit` one coming
  back in a new tab.
- [ ] **Step 5: Deploy order to tell the user**: paste `20261231000300_announcement_corner_box.sql` into the live SQL
  editor first, then deploy the app; make corner boxes only after the app deploys.
