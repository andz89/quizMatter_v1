# HTML modal in a sealed box

Date: 2026-11-01. Builds on `2026-10-31-announcement-post-design.md` and `2026-11-01-announcement-photos-design.md`.

## Why

The super admin wants to design a modal with their own HTML, styles and scripts (countdowns, animations, small
games), using pictures from the Photos tab.

## Safety (why a sealed box)

The modal shows inside QuizMatter while the teacher is logged in. A script there would run as that teacher (their
login, their presentations, their data), for every teacher at once; a stolen super admin login or a copied snippet
would be enough. So the HTML never joins the page: it runs in `<iframe sandbox="allow-scripts allow-popups
allow-popups-to-escape-sandbox" srcdoc=…>`:

- No `allow-same-origin`: the box is its own unknown site. It can't read QuizMatter's cookies, storage, login or page.
- No `allow-top-navigation`, `allow-forms`, `allow-modals`: it can't move the QuizMatter page, send forms or show
  alerts. A link with `target="_blank"` opens a new tab (popups, outside the sandbox).
- No lock list: it may load from other sites (see "Outside sites" below).

## Outside sites (2026-11-02)

The box first had a lock list (`default-src 'none'`, pictures only from our R2), but a script could still move its own
box to another site, so "loads nothing from other sites" was never fully true. Since only the super admin writes the
HTML, the lock list was removed: the box may load pictures, fonts, code and pages from any site. The sandbox stays
(no `allow-same-origin`), so it still can't reach QuizMatter or the teacher's login. Because of that, players from
other sites (a YouTube or Facebook `<iframe>`) inside the box usually refuse to play; use the post modal's YouTube or
Facebook attachment for those. The Privacy Policy names "other websites in an announcement" (LEGAL_VERSION
2026-11-02), and the form says that an outside site sees the teacher's IP address.

`sandboxedHtml` adds our helper script before the admin's HTML: Escape inside the box sends `SEALED_BOX_ESCAPE`
(postMessage), which closes the modal once its close button shows (only that box's own message counts); a `#part`
link scrolls inside the box instead of opening an empty tab (`<base target="_blank">`). A script that never stops can
still freeze the teacher's page: the form says to use Preview first.

## Data (`20261230000000_announcement_html.sql`)

- `announcements.modal_format` (`post` / `html`, default `post`), `modal_html` (≤ 100,000 characters, default ''),
  `modal_height` (100–1,000 px, default 400). The content rule becomes: a shown post needs text or an attachment; a
  shown html modal needs HTML.
- Newest `save_announcement` (a save without them = post, '' and 400: older app tabs), `admin_announcements` and
  `my_announcements` (they return the three; `modal_html` only while the modal is open).
- `announcement_uses_photo(a, src)`: the modal's attachment is that photo, or its HTML holds that address. Used by
  `admin_announcement_photos` (`used_by`) and `delete_announcement_photo`.
- Newest `used_photo_srcs` also keeps every R2 address written in an HTML modal.

## App

- zod: `modal_format`, `modal_html`, `modal_height` with the same limits; an html modal needs HTML. `MyAnnouncement`
  reads them with fallbacks (an older row = post).
- Form, Modal section: Format (Post / HTML, sealed box). Size stays. Post = as before. HTML = a code box, Box height,
  close delay; no Picture or GIF and no link pasting. Saving an html modal sends empty post fields.
- `AnnouncementModal` shows `SealedBox` (the sealed frame, `sandboxedHtml` builds its document) for html, at the chosen
  width and height. Preview is the same.

## Tests

`supabase/tests/announcement_html.sql` (Docker); zod tests in `announcements.test.ts`; `sandboxedHtml` test.

## Top bar (added the same day, `20261231000000_announcement_bar_html.sql`)

- A top bar's Format: Text (the editor, cleaned as before) or HTML (sealed box). `bar_format` (`text` / `html`),
  `bar_height` (30–300 px, default 60). The HTML goes in `bar_html` (≤ 1,000 for text, ≤ 100,000 for html), so the
  form keeps the code apart (`barCode`) and switching format loses neither.
- `AnnouncementBar` shows `SealedBox` (shared with the modal) full width at its height; the countdown and ✕ stay
  outside the box, so the HTML can never cover them.
- `announcement_uses_photo` and `used_photo_srcs` also look in an html bar. Test:
  `supabase/tests/announcement_bar_html.sql`.
- Preview moved into each section, next to the close delay (`CloseAfter`).

## The unused part is kept empty (2026-11-02, `20261231000200_announcement_unused_part.sql`)

An announcement is a modal or a top bar, but the form used to save the other part too, and a photo in it counted as
used. A trigger (`announcement_empty_unused_part`) now empties it on every write: a top bar has no modal text,
attachment or html, a modal has no bar html (a row showing both keeps both); the migration cleaned the old rows. The
form sends them empty too. Test: `supabase/tests/announcement_unused_part.sql`.
