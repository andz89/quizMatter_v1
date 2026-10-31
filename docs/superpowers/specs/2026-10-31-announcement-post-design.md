# Announcement modal as a post (text + one picture or YouTube card)

Date: 2026-10-31. Builds on `2026-10-30-announcements-design.md`. Approved in chat ("go now").

## Goal

The announcement modal reads like a social post: plain text with padding on top, then at most one attachment that
fills the modal's width (no padding): a picture / GIF, or a YouTube preview card. The look follows QuizMatter's
design system (only the layout idea of a post).

## Admin (Admin → Announcements form, Modal section)

- One plain text box (`modal_text`, at most 5,000 characters). Line breaks are kept; web addresses become links
  (`LinkifiedText`).
- One attachment (`modal_attachment`) with ✕ to remove it:
  - **Picture or GIF:** the existing upload (`/api/announcement-image`; photos shrunk, GIFs up to 1 MB).
  - **YouTube:** pasting a YouTube link into the text box (`youtube.com/watch?v=…`, `youtu.be/…`,
    `youtube.com/shorts/…`, `youtube.com/embed/…`) makes a card while there's no attachment yet. The link stays in
    the text.
- Size (Small / Medium / Large) stays. The rich text box, picture resizing and "Full width" go (the modal only;
  the top bar keeps its rich text box).

## Teachers (the modal)

Text (padding) → attachment (edge to edge) → the Close row. A YouTube card is the thumbnail with a play icon and the
title under it; clicking it opens `https://www.youtube.com/watch?v=<id>` in a new tab.

## YouTube card

`POST /api/announcement-youtube` with `{ url }` (super admin only, counted by `count_write('photos')`): reads the
11-character video id, asks YouTube's public oEmbed (`https://www.youtube.com/oembed?format=json&url=…`) for the
title, downloads the thumbnail (`maxresdefault.jpg`, 1280 × 720, else `hqdefault.jpg`, 480 × 360), stores it in R2
like any photo, and returns `{ kind: "youtube", video_id, title, src, width, height }`. Teachers' browsers load only
our R2 copy, so they never contact YouTube unless they click: no Privacy Policy change. Unknown, private or removed
videos, and YouTube being unreachable, give a clear message and no card.

## Facebook posts and videos (added the same day)

Facebook gives other sites no preview (Meta needs a reviewed developer app), so a pasted Facebook post / video link
is shown with Facebook's own embedded frame (`facebook.com/plugins/video.php` or `post.php`), sandboxed; the app
builds its address from the checked link (`src/lib/facebook.ts`). Saved as `{kind: "facebook", href, video}`. A video
is 16:9 edge to edge; a post box is 350–500 px wide (Facebook's limits) and 500 px tall, centered. Every teacher who
sees one loads it from Facebook, so the Privacy Policy names Facebook (Meta). Migration
`20261226000000_announcement_facebook.sql`, test `supabase/tests/announcement_facebook.sql`.

## Data (migration `20261225000000_announcement_post.sql`)

- `announcements.modal_text` text (≤ 5,000) and `modal_attachment` jsonb (null, or `{kind: "photo", src, width?,
  height?}`, or `{kind: "youtube", video_id, title, src, width?, height?}`), checked by
  `announcement_attachment_ok`: `src` is our R2 address (`https://images.quizmatter.com/uploads/…`), sizes
  1–1920, `video_id` matches `^[A-Za-z0-9_-]{11}$`, title ≤ 200. A shown modal needs text or an attachment.
- Existing rows: `modal_text` from `modal_html` (tags removed, paragraphs and line breaks kept, the common entities
  decoded); the first R2 picture becomes the attachment. Then `modal_html` is dropped.
- New `save_announcement`, `admin_announcements`, `my_announcements` (return the two fields instead of
  `modal_html`), and `used_photo_srcs` (keeps attachment pictures and thumbnails).
- zod: `announcementSchema` and `myAnnouncementSchema` hold the same limits.

## Tests

- `supabase/tests/announcement_post.sql`: the limits and the attachment check, teachers get the fields, conversion
  of an old row, `used_photo_srcs` keeps the attachment.
- Existing SQL tests switch from `modal_html` to `modal_text`.
- `src/lib/youtube.test.ts`: the video id from each link style; other sites and bad ids refused.
- `npm test`, `tsc`, lint, build; pasting a link and the card checked by hand in a browser.
