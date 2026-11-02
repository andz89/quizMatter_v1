# Corner box: an announcement at the bottom-right

Date: 2026-11-02. Builds on `2026-10-30-announcements-design.md`, `2026-10-31-announcement-post-design.md`,
`2026-11-01-announcement-html-design.md` and `2026-11-01-announcement-one-on-design.md`. Mockup:
https://claude.ai/artifact/UJS6hbJTF9E1htbYrs9FsU

## Why

The super admin wants a third kind of announcement: a small box at the bottom-right of the screen. Unlike the modal it
doesn't block the page: teachers keep clicking, typing and working while it shows. It has the close circle and can
also close itself after a number of seconds.

## Decisions (from the brainstorm)

- **Content:** the same as the modal: a post (text + one picture, YouTube card or Facebook post / video) or HTML in the
  sealed box.
- **Closing itself counts as seen:** the same as the teacher closing it, so it follows "Show again" (once / once a day
  / every visit).
- **Built as a display option on the modal** (approach A): a corner box is a modal row with `modal_display = 'corner'`.
  Everything about the content (columns, checks, photo use, cleanup, closed records, counts) is reused. The columns
  keep their `modal_…` names; the notes say they also hold a corner box's content.
- **Its own "one on" slot** (A1): at most one centered modal, one top bar and one corner box are on, and all three can
  show at the same time.

## Data (migration `20261231000300_announcement_corner_box.sql`)

- `announcements.modal_display text not null default 'center'`, check `in ('center', 'corner')`.
- `announcements.modal_auto_close int not null default 0`, check `between 0 and 600` (seconds; 0 = never), and
  `modal_display = 'corner' or modal_auto_close = 0` (only a corner box closes itself).
- Check: `modal_display = 'center' or modal_size in ('small', 'medium')` (a corner box is never Large).
- `check_one_on`: the saved row's slot is `bar` (show_bar), `corner` (show_modal and corner) or `modal` (show_modal and
  center); another row that is on and not ended **in the same slot** is the conflict (`QMONE`, or turned off with
  `replace_current`). Same lock as now.
- Newest `save_announcement`, `admin_announcements`, `my_announcements`: also the two fields. A save without them (an
  older app tab) is `center` and `0`, the same pattern as the earlier fields.
- Unchanged: `announcement_dismissals` (a corner box closes as part `modal`), `closed_modal_count` and the recount,
  `announcement_matches` / `announcement_count`, the attachment checks, `announcement_uses_photo`, `used_photo_srcs`,
  the trigger that empties the unused part (a corner box has `show_modal` on, so its content is kept).

## What teachers see

- **Place:** fixed at the bottom-right, 16 px from the edges, at the chosen width (Small 300 / Medium 500). On a
  screen narrower than that, it spans the width at the bottom with 16 px on each side.
- **Not blocking:** no backdrop, no focus trap, no Escape (Escape belongs to the page the teacher is working in; the
  sealed box's Escape message is not listened to here). Only the box's own area is covered.
- **Look:** a white card (`rounded-card`, 1.5 px `border-default`, no shadow), the same content as the modal: the post's
  text (padding, links clickable; right padding clear of the circle), then the attachment edge to edge; or the sealed
  box at its box height.
- **Close circle:** the modal's corner circle (seconds left during the close delay, then `XCircleIcon` filled white).
- **Closing itself** (`modal_auto_close` > 0): a 3 px violet line at the bottom shrinks from full to empty over that many
  seconds, then the box closes exactly like the button (dismiss record for once / daily). The line is a CSS animation
  (`--animate-…` in `globals.css`); it pauses while the mouse is over the box (`animation-play-state`), and its end
  (`onAnimationEnd`) closes the box. No line when it never closes itself.
- **Pages:** it stays while moving between the pages it's chosen for. On a page outside them, or while presenting, it is
  hidden; when it shows again its timer starts over.
- **With other announcements:** it shows together with a bar. While a modal shows, the box waits (`pickForPage`
  returns no box) and appears once the modal is closed: under the modal's backdrop it couldn't be seen or hovered, so
  its timer would run out unseen and count as seen. For the same reason the timer also stops while the tab is in the
  background. On the editor page the bars float at the bottom center; the box stays at the
  bottom-right.
- **Picking** (`pickForPage`): returns `boxes` too: rows with `show_modal` and `modal_display = 'corner'`, not closed in
  this tab, newest first; the watch shows the first. `modals` takes only `center` rows. `myAnnouncementSchema` reads the
  two fields with fallbacks (`center`, 0), so an older row is a modal.

## Admin (super admin only)

- **Form, Type:** Modal / Top bar / Corner box. Corner box = `show_modal` on, `modal_display = 'corner'`.
- **Corner box section** (the Modal section's fields): Format (Post / HTML), Size (Small / Medium only; switching from
  a Large modal picks Medium), the post editor or the HTML box and its height, the close delay, and **Closes itself:
  Never / after N seconds** (5–600). Preview shows the real box at the bottom-right of the admin page.
- **Switching type** keeps what was typed; modal and corner box share their content.
- **zod** (`announcementSchema`): `modal_display` (`center` / `corner`), `modal_auto_close` (0 or 5–600, only for a
  corner box), a corner box's size is Small or Medium; same numbers as the database (`ANNOUNCEMENT_LIMITS`).
- **List:** the type shows "Corner box" (and "closes after N s"); the turn-on conflict box says "corner box"; the
  closed count counts both ways of closing.

## Tests

- `src/lib/announcements.test.ts` (first, failing): the schema's new fields and rules; `pickForPage` keeps corner
  boxes out of `modals` and returns them in `boxes`; an older `my_announcements` row is a center modal with 0.
- `supabase/tests/announcement_corner_box.sql` (Docker): saving a corner box (Small / Medium, auto close); refused:
  Large, a bad display, auto close out of range or on a center modal; an older save is center + 0; one modal, one bar
  and one corner box can be on together; a second corner box is a `QMONE` conflict (and swaps with
  `replace_current`); `my_announcements` returns the two fields; closing it is part `modal`.
- Then `npm test`, `npm run test:sql`, `tsc`, lint, `npm run db:snapshot`. The look and the timer are checked by hand
  with Preview (tests can't load `.tsx`).

## Notes, privacy, deploy

- Notes: root `CLAUDE.md` "Announcements" (the third type, its slot, the `modal_…` columns holding its content),
  `src/components/CLAUDE.md` (the corner box view), and this spec.
- Privacy Policy: one wording change only. Nothing new is collected (the closed records and filters are already
  described), but the page says announcements are "a pop-up or a bar at the top": it becomes "a pop-up, a bar at the
  top or a box in the corner", and `LEGAL_VERSION` moves to that day.
- Deploy: paste the migration into the live SQL editor first, then deploy the app. Until the app deploys, an older
  admin tab saves without the new keys, so editing a corner box there would turn it back into a centered modal: make
  corner boxes only after the deploy.
