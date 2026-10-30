# Announcements (a modal and/or a top bar for chosen teachers)

Date: 2026-10-30. Branch: `feature/announcements`.

## Goal

The super admin writes a message for teachers and shows it as a **modal**, a **top bar**, or **both** (each with
its own text). The admin chooses:

- the text (a rich text editor: bold, italic, underline, color, align, links; images in the modal only),
- how many seconds pass before the close button appears,
- when it shows again after a teacher closes it (once, once a day, every visit),
- when it is live (an on/off switch plus an optional start and end time),
- on which pages it shows,
- which teachers see it (gender, age, province and town, education, how many presentations they made, role).

Only logged-in teachers see announcements (the targets need their account details).

## Decisions

| Question | Decision |
|---|---|
| Who manages them | The super admin only (`is_super_admin()`), like Maintenance |
| After closing | Chosen per announcement: `once` (never again), `daily` (again after midnight, Philippine time), `every_visit` (again the next time they open the app) |
| Several at once | Yes. Each has an optional start and end. Modals come one at a time, newest first; at most 2 bars at once, newest first |
| Picking pages | Checkboxes of page groups (below), or "All pages" |
| "Subject taught" | There is no such field. It's keywords matched in the teacher's field/major (`education_field`, ignoring case), plus a tick list of education levels (`education_level`) |
| Images | Modal only. The bar is text only |
| Checking for announcements | Rides on the Maintenance check (one check for both, see "How a teacher's browser finds them") |
| Filters | Empty = everyone. Every filled filter must match (AND). A teacher with that detail empty (e.g. an old account without a birthday) does not match a filter on it |

## Data (migration `20261221000000_announcements.sql`)

### `announcements`

| Column | Meaning |
|---|---|
| `id` uuid | |
| `name` text (1–100) | For the admin's list only; teachers never see it |
| `is_on` boolean | The admin's on/off switch |
| `starts_at`, `ends_at` timestamptz, nullable | Optional window; `ends_at` after `starts_at` |
| `show_modal`, `modal_html` (≤ 20,000), `modal_close_after` (0–60 seconds) | The modal part |
| `show_bar`, `bar_html` (≤ 1,000), `bar_close_after` (0–60 seconds) | The bar part. At least one part must be on, and a part that is on needs text |
| `repeat` text | `once`, `daily` or `every_visit` |
| `pages` text[] | Page group keys (below); `{all}` for every page |
| `genders` text[] | Empty, or from `male`, `female` |
| `age_min`, `age_max` int, nullable | 18–100, min ≤ max |
| `provinces` text[] | Each one must pass `is_province` |
| `town_words` text[] | ≤ 20 words, each ≤ 60 characters; a town matches when it contains any of them (ignoring case) |
| `education_levels` text[] | From `bachelor`, `master`, `doctorate`, `other` |
| `field_words` text[] | ≤ 20 words, each ≤ 60 characters; matched in `education_field` the same way |
| `presentations_min`, `presentations_max` int, nullable | 0–50, min ≤ max |
| `roles` text[] | Empty (everyone), or from `teacher` (neither editor nor admin), `editor`, `admin` |
| `created_by`, `created_at`, `updated_at` | |

- At most 20 announcements may be live or waiting to start (`is_on` and `ends_at` not yet passed); the save is
  refused past that.
- No direct access for anyone (RLS on, no policies for `authenticated`). Everything goes through the functions below.

### `announcement_dismissals`

`(announcement_id, user_id, part, closed_at)`, primary key on the first three. `part` is `modal` or `bar`, so
closing the modal doesn't close the bar. Rows go when the announcement is deleted or the account is deleted
(`on delete cascade`). No direct access; written only by `dismiss_announcement`.

`every_visit` writes nothing here: it's remembered only in the browser tab's sessionStorage.

### Functions

| Function | Who | What |
|---|---|---|
| `save_announcement(...)` | Super admin | Insert or update; checks every limit above; Admin log `announcement_saved` |
| `delete_announcement(id)` | Super admin | Delete; Admin log `announcement_deleted` |
| `admin_announcements()` | Super admin | Every row with its status (`live`, `scheduled`, `ended`, `off`), matched teachers now and how many closed each part |
| `announcement_audience(filters...)` | Super admin | How many teachers match these filters now (the form's "Matches about N teachers") |
| `my_announcements()` | Logged in | The caller's live, matching, not-yet-closed announcements: id, the parts' text, pages, close delays, `repeat`, `updated_at`. Never the targets. A banned teacher gets none |
| `dismiss_announcement(id, part)` | Logged in | Upserts the caller's `closed_at = now()`; ignored for `every_visit` |
| `maintenance_status()` | Anyone | Also returns `announcements_key` (below) |

The matching rule is written once, as `announcement_matches(a, user_id)`, used by `my_announcements`,
`admin_announcements` and `announcement_audience`. It reads the teacher's `user_settings`:

- age: `age_on(birth_date, manila_today())`
- presentations: `count(*)` of `presentations` they own with `shared_from is null`
- role: `is_editor` / `is_admin`

"Live" means `is_on`, and `starts_at` is empty or passed, and `ends_at` is empty or not yet passed.

"Closed" means a `once` part with a dismissal row, or a `daily` part whose `closed_at`, as a Philippine date, is
today.

### `announcements_key`

`maintenance_status()` gets one more field: empty when nothing is live; otherwise an md5 of the live announcements'
ids and `updated_at`s. It changes when one is added, edited, turned on or off, starts or ends.

### Photo cleanup

`used_photo_srcs` also counts every image `src` in `announcements.modal_html`, so the weekly cleanup keeps them.

## How a teacher's browser finds them

1. `getMaintenanceStatus()` (`src/lib/maintenance.ts`) already asks `maintenance_status()` at most once per 60
   seconds per server copy, and only when someone opens a page. It now also keeps `announcementsKey`. So there are
   **no extra database calls when nothing is live**.
2. The root layout passes the key to a browser component, `AnnouncementsWatch` (`src/components/`). An empty key
   means it does nothing.
3. With a key, it looks in sessionStorage (`qm:announcements`: the key, the Philippine date and the list). If the
   key and the date are the same, it uses the saved list. Otherwise it calls `my_announcements()` once and saves
   the result.
4. It never calls on pages that can't show announcements: `/login`, `/signup`, `/privacy`, `/terms`,
   `/maintenance`, `/oauth/*`, `/admin/*`, `/dev/*`.
5. On each page change (`usePathname`) it picks what fits the page from the saved list. No new call.

A brand-new announcement reaches a tab that's already open only after a full page load (the root layout renders
then). That can be up to about 60 seconds late, because of the remembered status. The admin's own server copy
forgets the remembered status when they save (`forgetMaintenanceStatus`), so they see it at once.

### Page groups (`pageGroup(pathname)` in `src/lib/announcements.ts`)

| Key | Label | Addresses |
|---|---|---|
| `my_presentations` | My presentations | `/` (with its folders), `/presentations` |
| `quizmatter` | From QuizMatter | `/quizmatter` |
| `other_teachers` | Other teachers | `/teachers` |
| `saved` | Saved | `/saved` |
| `liked` | Liked | `/liked` |
| `reviews_submissions` | Reviews & submissions | `/reviews-submissions` |
| `search` | Search | `/search` |
| `presentation_view` | Presentation view | `/presentation/<id>` |
| `editor` | Editor | `/presentation/<id>/edit`, `/presentation/new` |
| `account` | Account | `/account` |
| `teacher_profiles` | Teacher profiles | `/teachers/<slug>` |

Any other address belongs to no group and shows nothing, not even "All pages" ones.

**Presenting fullscreen** shows nothing: while `document.fullscreenElement` is set, the bars and modals are hidden,
and a modal waits until fullscreen ends. A popup in front of a class would be bad.

## On screen

- **Top bar:** under the Maintenance bar, at the very top. `bg-accent-soft` with ink text, underlined
  links in `text-accent`. At most 2 bars, newest first. On the editor page, which fills the screen, the bar must
  not break its layout (checked while building).
- **Modal:** the app's `Modal` (`src/components/Modal.tsx`). One at a time, newest first; closing one shows the
  next. Images fit the modal's width.
- **Close button:** hidden at first, with "You can close this in N…" counting down. Then the X (`XIcon`) appears.
  Esc and clicking outside the modal work only after the countdown.
- **Closing:** `once` / `daily` calls `dismiss_announcement` and removes the part from the saved list, so it's gone
  at once. `every_visit` marks it closed in sessionStorage only. If the call fails (e.g. offline), the part stays
  hidden for this visit and may come back later. No error message, since nothing is lost.
- **Links** in the text open in the same tab when they point into QuizMatter, and in a new tab otherwise.

### Safe text

Saved text is shown only after it is re-built through the editor's own rules, like `toSafeHtml` in
`src/lib/richText.ts`: tags and styles the editor doesn't allow are dropped. An image survives only when its `src`
starts with `PHOTO_URL_PREFIX` (our R2 photos). A link survives only as `http(s)://` or a path starting with `/`.
The modal and the bar each have their own list of allowed parts (`ANNOUNCEMENT_MODAL_EXTENSIONS`,
`ANNOUNCEMENT_BAR_EXTENSIONS`; the bar has no Image).

## Admin page

**Admin → Announcements** (`src/app/admin/announcements/`), super admin only (`superOnly` in `AdminMenu`; a plain
admin gets "page not found", and the actions refuse).

- **List:** name, status (Live / Scheduled / Ended / Off), parts (Modal / Bar), matched teachers now, closed
  counts. Buttons: New, Edit, Turn on/off, Delete (`ConfirmModal`).
- **Form** (`new/` and `[id]/`):
  1. name, the on/off switch, start and end (Philippine time);
  2. modal box: "Show a modal", the editor, "Close button appears after __ seconds";
  3. bar box: the same, no images;
  4. show again: Once / Once a day / Every visit;
  5. pages: "All pages" or the page groups;
  6. who sees it: gender, age from–to, provinces, town words, education levels, field/major words,
     presentations from–to, roles;
  7. "Matches about N teachers now" (asks `announcement_audience`, after a short pause while typing);
  8. Preview: shows the real modal and bar over the form, countdown included;
  9. Save: zod (`announcementSchema`) first, then `save_announcement`; a refusal shows as a toast. The Spinner
     shows while saving, and `loading.tsx` for the slow pages.
- **Images:** chosen from the computer, shrunk by the browser like other photos (`src/lib/photos.tsx`), saved
  through `upload-image` with a new `announcement` option. It stores the file in R2 and returns its `src`, without
  adding it to any photo list. Super admin only. It's counted like a shared photo (`count_write('photos')`).
- New labels in `ADMIN_ACTION_LABELS`: `announcement_saved`, `announcement_deleted`.

## Packages

`@tiptap/extension-link` and `@tiptap/extension-image`, at the same version as the other Tiptap packages, installed
with `npx -y npm@10.9.2 install`. No other new package.

## Privacy Policy

The Privacy Policy (`src/app/(legal)/privacy/page.tsx`) says:

- your age, gender, province and town, educational background, how many presentations you made, and your role are
  used to choose which announcements you see;
- which announcements you closed, and when, are kept until the announcement or your account is deleted.

`LEGAL_VERSION` (`src/lib/legal.ts`) is set to the date of the change. It only shows as "Last updated", and new
accounts save it; it doesn't ask current teachers to agree again.

## Tests (local Docker only)

- `supabase/tests/announcements.sql`:
  - each filter matches and doesn't match, including empty details;
  - roles; shared copies not counted;
  - once / daily / every_visit;
  - the start and end window;
  - a banned teacher gets none;
  - a teacher can't read `announcements` or call the admin functions;
  - a plain admin is refused;
  - the limits;
  - `announcements_key` is empty when nothing is live and changes after an edit;
  - `used_photo_srcs` keeps modal images.
- `src/lib/announcements.test.ts` (`npm test`):
  - `pageGroup` for each address;
  - the zod limits;
  - the "should this part show?" rule for `every_visit` and the sessionStorage list.

## Notes to update (same commits)

- Root `CLAUDE.md`: a line in the map and an "Announcements" section with these rules.
- `src/app/admin/CLAUDE.md`, `src/components/CLAUDE.md`, `src/lib/CLAUDE.md`, `src/app/api/CLAUDE.md`
  (`upload-image`'s new option) and `supabase/migrations/CLAUDE.md`.
- The root `CLAUDE.md` "Maintenance" section and `src/lib/maintenance.ts`: `maintenance_status()` also carries
  `announcements_key`.

## Out of scope

- Logged-out visitors.
- Announcements by email or in Claude's connector.
- Tracking clicks on links, or how many saw (not closed) an announcement.
- Images in the bar.
