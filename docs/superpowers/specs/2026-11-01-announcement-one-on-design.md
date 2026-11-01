# One modal and one top bar on at a time

Date: 2026-11-01. Builds on `2026-10-30-announcements-design.md` and `2026-10-31-announcement-post-design.md`.

## Why

An announcement is now one type: a Modal or a Top bar (the form's Type choice). The super admin wants only one of
each switched on at a time, so teachers never get two modals (or two bars) fighting for the screen. Turning on a
second one asks to turn the current one off, and work can always be kept as a draft.

## The rule

- At most **one Modal** and **one Top bar** are on at once. A Modal and a Top bar can be on together.
- "On" means `is_on` and not ended (`ends_at` empty or later than now). A **scheduled** one (On, start date later)
  counts; an ended one doesn't.
- An announcement is never both types: `show_modal` and `show_bar` can't both be true (zod and the database).
- The old "at most 20 on" limit goes away: the new rule allows 2 at most.

## Database (`20261228000000_announcement_one_on.sql`)

- `check_one_on(saved uuid, replace_current boolean)`: takes the announcements lock (the same
  `pg_advisory_xact_lock` the old limit used, so two tabs can't both turn one on), finds another row of the same type
  that is on and not ended, and:
  - `replace_current` false → raises `QMONE` with that row's name as the message;
  - `replace_current` true → turns it off (`is_on = false`) and returns its name.
- `save_announcement(a jsonb, replace_current boolean default false)` and
  `set_announcement_on(target uuid, turn_on boolean, replace_current boolean default false)` call it after their
  write (only when the row ends up on). A refusal rolls the whole step back, so nothing is saved. The Admin log row
  (one per step) gets `turned_off: <name>` in its details when one was turned off.
- `save_announcement` refuses both types (`22023`, "Pick a modal or a top bar, not both.").
- The old two-argument / one-argument versions are dropped (a default argument would make the call ambiguous) and
  `check_announcement_limit` is dropped.

## App

- `saveAnnouncement(input, replaceCurrent)` and `setAnnouncementOn(id, turnOn, replaceCurrent)` return
  `{ conflict: name }` on `QMONE`, so the page can ask.
- **Form:** the On checkbox goes. Buttons: Preview, **Save as draft** (saves with `is_on` false), and **Save and turn
  on** (or **Save** when it's already on). On a conflict, `ConfirmModal` asks "Turn off the current modal?" (or top
  bar) with three buttons: Cancel (stay in the form, nothing saved), **Save as draft**, **Turn it off and turn this
  on** (sends again with `replaceCurrent`).
- **List:** Turn on asks the same, with only Cancel and Turn it off and turn this on. The "Off" status reads
  **Draft**.
- `ConfirmModal` gets an optional middle button (`secondaryLabel`, `onSecondary`); other users don't change.
- zod: a refine refuses both types.

## Tests

- `supabase/tests/announcement_one_on.sql` (Docker): a second modal refused with `QMONE`; with replace the old one is
  off and the new one on; a modal and a bar on together; an ended one doesn't count, a scheduled one does; saving
  itself again isn't a conflict; a draft saves while another is on; `set_announcement_on` the same; both types
  refused; the Admin log names the one turned off.
- Older announcement SQL tests changed where they turned on two of the same type or used both types.
- `announcements.test.ts`: the both-types refine.

## Not changing

How teachers see announcements (`my_announcements`, `pickForPage`), counting, the Privacy Policy.
