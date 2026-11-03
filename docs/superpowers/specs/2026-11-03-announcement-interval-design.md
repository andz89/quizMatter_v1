# Announcements: show again every N minutes (design)

## Goal

The super admin can make an announcement come back every N minutes after a teacher closes it, in the same browser
tab. N is the admin's choice for each announcement: any whole number of minutes from 1 to 1,440 (24 hours), e.g.
10, 11 or 15.

Example (N = 15): it shows at 10:00, the teacher closes it at 10:03, it shows again at 10:18; closed at 10:20, it
shows again at 10:35, and so on, until the announcement ends or is turned off.

## Decisions (agreed)

- **A fourth "show it again" choice**, beside Once / Once a day / Every visit: **"Again every N minutes"**. Not a
  separate box that combines with the others (confusing: "once" + every 15 minutes).
- **N minutes after it was closed**, not after it appeared, so the teacher always gets the full N minutes. A corner
  box closing itself counts as closed.
- **Remembered only in that tab** (like Every visit): a new tab shows it at once; nothing about the teacher is saved
  in the database.
- Works for all three types: modal, corner box, top bar.

## What the admin sets

- The form's "After a teacher closes it, show it again" section gets a fourth choice, "Again every N minutes", with
  a minutes box (whole numbers 1–1,440; starts at 15 when picked). Its help text, like the others: "It shows again
  N minutes after the teacher closes it, in the same browser tab, while they move between pages or reload. A new
  tab or window shows it again at once. It's remembered only in that tab, not on their account." Good for: "a
  reminder that must not be missed during an event, e.g. 'Sign-ups close at 5 pm today.'"
- The admin list line shows "Again every 15 min" for it.

## What teachers see

- The tab remembers when each part was closed. An "every N minutes" part is open again once N minutes have passed
  since it was closed (real clock time: a tab in the background at that moment shows it when they come back).
- Moving between pages and reloading keep the closed time (sessionStorage). A new tab, a new Philippine day or
  another account starts fresh, as today (`isSameVisit`).
- Never while presenting (as today); it shows once they stop.
- "Shows after" (`modal_show_after`) delays only the first show in a tab: the tab's clock has already passed it.
- Each part closes separately, as today (a modal/corner box is part `modal`, a bar is part `bar`).

## Database

New migration `20261231000700_announcement_interval.sql`, added the "Adding a column" way:

1. `announcements.repeat` also takes `'interval'` (the check is replaced).
2. New column `repeat_minutes int not null default 0`, with a check: `interval` needs 1–1,440, every other repeat
   needs 0. Existing rows are 0.
3. Newest `save_announcement`: `repeat_minutes` in the insert list (`coalesce(r.repeat_minutes, 0)`, so a new one
   from an older tab is 0) and the update list (an update without the key keeps it).
4. Newest `my_announcements` (drop + create): also `repeat_minutes`. Its closed-part rule is unchanged: an
   `interval` one has no dismissal rows, so it is always sent while live and matching.
5. Newest `dismiss_announcement`: writes nothing for `interval`, as for `every_visit`. So the closed counts stay 0
   for it (as for Every visit) and the Privacy Policy needs no change.

Same limit in the app: `ANNOUNCEMENT_LIMITS.repeatMinutesMax = 1440` (`src/lib/announcements.ts`).

Deploy: the migration first, then the app. The old app works with it: only the new app's form can make an
`interval` announcement, so none exists while the old app is live (the old app's teacher list would refuse one).

## App

- `src/lib/announcements.ts`: `REPEATS` gains `interval` (label "Again every N minutes"); `repeatMinutesMax`;
  `announcementSchema` gets `repeat_minutes` (whole number; 1–1,440 with `interval`, 0 otherwise, each with a
  plain message); `myAnnouncementSchema` gets `repeat_minutes` (`.catch(0)`). Two pure helpers:
  `reopenAt(list, key, closedAt)` gives when a closed part comes back (closed time + `repeat_minutes`, only for an
  `interval` one; else null), and `stillClosed(list, closed, closedAt, now)` returns the closed keys that haven't
  come back yet (what `pickForPage` and `isWaiting` get). The watch's timer waits for the earliest `reopenAt`.
- `src/lib/announcementForm.ts`: `toSaved` sends `repeat_minutes` only with `interval` (0 otherwise);
  `NEW_ANNOUNCEMENT.repeat_minutes = 0`.
- `src/app/admin/announcements/RepeatSection.tsx`: the fourth choice with its minutes box (the form passes the
  minutes and their setter); `REPEAT_HELP.interval`.
- `src/app/admin/announcements/AnnouncementList.tsx`: "Again every N min" in the line.
- `src/components/AnnouncementsWatch.tsx`: the stored tab state gets `closedAt` (key → time it was closed, ms;
  missing in an older tab = `{}`), written by `close`. What counts as closed is worked out with the helper; one
  `setTimeout` to the next comeback time re-renders the watch (none when nothing is due), and the comeback removes
  the key from `closed` / `closedAt`.

## Tests

- `announcements.test.ts`: the schema (minutes only with `interval`, 1–1,440, whole numbers), an older row
  without `repeat_minutes`, the reopen helper (before / at / after N minutes; other repeats never reopen).
- `announcementForm.test.ts`: `toSaved` keeps the minutes only for `interval`.
- `supabase/tests/announcement_interval.sql`: `interval` saved with its minutes; refused without minutes, over
  1,440, or minutes on another repeat (`23514`); an older save gets 0; `my_announcements` sends it;
  `dismiss_announcement` writes no row for it. `announcement_columns.sql` catches a missed column.
- `e2e/announcements-interval.mjs` (Playwright, local Docker only): an "every 1 minute" modal is closed, stays
  closed across an in-app move, and comes back after the minute (Playwright's clock moves the browser's time
  forward instead of waiting); a new tab shows it at once.

## Notes to update

Root `CLAUDE.md` ("Announcements": "Show again"), `src/lib/CLAUDE.md`, `src/components/CLAUDE.md`,
`src/app/admin/CLAUDE.md`, `supabase/migrations/CLAUDE.md`, `e2e/CLAUDE.md`.
