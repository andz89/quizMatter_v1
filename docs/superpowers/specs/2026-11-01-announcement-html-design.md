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
- A Content Security Policy at the top of the box (`<meta http-equiv>`, before the admin's HTML; a later one can only
  tighten it): `default-src 'none'`, inline scripts and styles allowed, pictures and media only from
  `https://images.quizmatter.com` (and `data:`/`blob:`). Nothing is loaded from or sent to any other site, so the
  Privacy Policy doesn't change.
- Accepted limit: a script can still move its own box to another page (that page is just as walled off). Only the
  super admin writes these.

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
