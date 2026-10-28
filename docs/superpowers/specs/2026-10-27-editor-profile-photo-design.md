# Editors' profile photos

## Why

An editor's profile page (`/teachers/<link name>`) today shows only their name, educational background, bio and
their presentations. The user wants editors to be able to put a photo of themselves on it, adjusted (zoomed and
moved) before it's saved, so the page feels like a real person made these lessons.

## Goals

- An **editor** can upload a profile photo. It shows, round, at the top of their profile page next to their name.
- Before saving, a popup lets them **zoom** (one slider) and **move** (drag) the photo inside a round frame. Nothing
  else: no turning, no straightening (the user picked option A of three mockups).
- The photo shows **at once**. No admin checks it first.
- An editor can save a new photo **3 times a day**. The page tells them plainly, e.g. "You can change your photo 3
  times a day. 2 left today." With none left, the button is greyed out and says "You can change it again tomorrow."
  The day starts again at midnight Philippine time (`Asia/Manila`), like the app's other daily limits.
- An editor can **remove** their own photo. Removing does not use up one of the 3.
- **Any admin** can remove an editor's photo from that editor's page in Admin → Editors (`/admin/editors/<id>`). It
  shows in the Admin log. The editor simply sees their photo is gone (no message).
- When the **editor role is taken away**, the photo goes too (only editors have one).
- The database holds every rule above, so a script calling the API directly can't skip them.

## Non-goals

- Plain teachers and admins get no profile photo. (Admins have no profile page teachers can open.)
- The photo shows only on the profile page: not on cards, "This week's lessons by …", "Reviewed by", the NavBar or
  anywhere else.
- No admin approval step, no report button for photos.
- Not part of the click-limit system (`click_limits`, `count_click`): that system pauses and bans people clicking
  too fast. 3 a day is a plain daily allowance an honest editor can reach, like the 30-day wait on display names
  (see root `CLAUDE.md`, "Click Limits": limits an honest teacher hits are never click limits).
- No new npm package for the cropping (see "The adjust popup").

## Anti-goals (a failure even if it works)

- A 4th photo in one day gets through, by any route (app, direct API call, two tabs at once).
- A plain teacher, a banned editor, or a former editor gets a photo on their profile.
- The weekly photo cleanup deletes a profile photo that's still in use, or the profile shows a broken photo.
- A refused upload still fills storage (refused uploads must be refused before the file is stored, like
  `upload-image` counts first).
- The photo is added to the editor's "My photos" list, or to the shared photo library / Admin → Photos.

## How it works

### Database (one new migration, e.g. `20261214000000_profile_photos.sql`)

Not a column in `user_settings`: its "Own settings" policy lets a teacher write any column of their own row
directly, which would skip the daily limit. Instead, its own table that nobody writes directly:

- `profile_photos`: `user_id uuid primary key references public.editors (user_id) on delete cascade`, `src text`
  (empty / null = no photo now), `day date` (the Philippine-time day of the last counted change), `changes int`
  (how many photos were saved on `day`), `updated_at`. The foreign key to `editors` makes "role taken away → photo
  gone" automatic, and deleting the account removes the `editors` row, so the photo goes with it too.
  - Row level security on, **no** insert / update / delete policy for `authenticated`. A read policy is fine for the
    owner (so the account page can read it) and for admins. Profile viewers get the photo through
    `teacher_profile` instead (below).
  - Removing a photo **keeps the row** with an empty `src`, so `day` / `changes` stay and remove + re-add can't reset
    the count.
- `set_profile_photo(src text)`, `security definer`: refuses if not logged in (`42501`), not an editor (`42501`),
  banned (`QMBAN`, `is_banned()`), or `src` not one of our own photo addresses (`22023`; same rule as
  `photoSchema`'s `startsWith(PHOTO_URL_PREFIX)`). Locks the row, rolls `day` over to today (`Asia/Manila`) when it's
  a new day, refuses with a new code **`QMPPL`** when `changes >= 3`, otherwise sets `src`, `changes + 1`. Returns
  how many are left today. "3" is written once with "Same limit as `PROFILE_PHOTO_CHANGES_PER_DAY`".
- `remove_profile_photo()`: the editor empties their own `src`. Doesn't count.
- `admin_remove_profile_photo(target uuid)`: any admin (`is_admin()`, else `42501`); empties that editor's `src`.
  Doesn't touch their count.
- **Admin log:** a new action `profile_photo_removed` ("Removed a profile photo"), written by a `log_*` trigger on
  `profile_photos` when an admin empties someone else's `src`, the same way the other admin actions are logged. Add
  it to the `action` check on `admin_actions` and to `ADMIN_ACTION_LABELS` (`src/lib/adminActions.ts`) together.
- `teacher_profile(slug)`: newest version from `20261112000000_profile_name_links.sql`. It returns one more column,
  `photo_src` (empty when none), from `profile_photos`. Changing the returned columns needs `drop function` +
  `create function` and the same grants.
- `used_photo_srcs()`: newest version from `20261019000000_presentation_reviews.sql`. Add every non-empty
  `profile_photos.src`, so the weekly cleanup keeps photos in use. A replaced or removed photo's file is then
  unused and the cleanup deletes it after its 7 days, as for any photo.
- A small "today's state" read for the account page: either the owner reads their own `profile_photos` row (the
  app works out "left today" with the Philippine date), or a `my_profile_photo()` function returns `src` and
  `left_today`. Builder's choice; the database's count is the one that counts.

### Uploading (server)

A new route, `src/app/api/profile-photo/route.ts` (POST), modeled on `upload-image`:

1. Logged in, else 401.
2. Size check from the header, then the body (`MAX_STORED_PHOTO_BYTES`), file type from its first bytes
   (`readPhotoType`), file name from its fingerprint (`photoFileName`), and `photoSchema` (zod) on
   `{ src, width, height }`, exactly like `upload-image`.
3. `set_profile_photo(src)` **before** the file is stored: this is both the check and the count, so a refused
   upload never takes up storage. Turn its codes into short messages: `QMPPL` → "You've changed your photo 3 times
   today. You can change it again tomorrow." (429), `QMBAN` → the banned message, `42501` → "Only editors can add a
   profile photo." (403).
4. `savePhotoFile(fileName, body, type)` (same R2 bucket, same `uploads/` folder and address as every photo).
5. Return `{ src, leftToday }`.

If storing the file fails after step 3 (rare), return an error; the builder decides whether to put the old `src`
back or leave it for the editor to try again. The photo must not stay broken on the profile without the editor
knowing.

It never touches the `photos` table ("My photos") or `shared_photos`. The proxy (`src/proxy.ts`) needs no change:
the route is for logged-in people.

Remove (the editor's own) goes through a small server action (or `DELETE` on the same route) calling
`remove_profile_photo()`. The admin's remove is a server action in `src/app/admin/editors/` calling
`admin_remove_profile_photo` (zod on the id first; `isAdmin` checked; `refresh()`), like the other admin actions.

### The adjust popup (browser)

- Built by hand, with no new package: the app's `Modal` (`src/components/Modal.tsx`), a square box with the photo
  and a round guide over it (the outside darkened), "Drag the photo to move it.", a **Zoom** slider (1× to 3×),
  Cancel and **Save photo**. Pointer events, so drag works with a mouse and a finger.
- The photo always covers the whole round frame: at zoom 1 its short side fills the frame, and dragging stops at the
  edges, so there's never an empty corner.
- On Save, a canvas draws exactly what's inside the frame into a **square** image (e.g. 400 × 400 px), as WebP, or
  JPEG where the browser can't make WebP (Safari; drawn on white first), like `shrinkPhoto` in `src/lib/photos.tsx`.
  Same file types and 20 MB pick limit as other photos (`PHOTO_TYPES`, `MAX_PHOTO_FILE_BYTES`). The circle is only
  drawn by CSS when showing it, so the stored file stays a plain square.
- The math that turns zoom + position into "which part of the picture to cut out" is a plain `.ts` function with a
  `*.test.ts` next to it (`npm test`).
- While it uploads: the Spinner on the button, nothing closes the popup (`isBusy`). Then a sonner toast:
  "Profile photo saved." or the server's message. Remove also shows a toast.

### Where it shows

- **Account settings** (`src/app/account/`), editors only (`getAccount().isEditor`): a new "Profile photo" box
  above or below the display name box, with the round photo (or an empty circle), **Change photo** (opens the file
  picker, then the popup) and **Remove** (asks first with `ConfirmModal`), and the line "You can change your photo
  3 times a day." with "N left today" (a `highlight-soft` pill), or the greyed button and "You can change it again
  tomorrow." when none are left. The existing "See your profile" links stay.
- **Profile page** (`src/app/teachers/[slug]/page.tsx`): `loadTeacherProfile` (`src/lib/profiles.ts`) gets
  `photoSrc`. When set, a round photo (about 88 px) left of the name in the header; when not, the header stays as
  today. Show it through `thumbnailUrl(src, 176)` (`src/lib/constants.ts`: a small copy Cloudflare makes and caches,
  twice the shown size so it stays sharp), the same helper Admin → Editors' photo thumbnails use.
- **Admin → Editors → one editor** (`src/app/admin/editors/[id]/page.tsx`): a "Profile photo" part with the photo
  and **Remove photo** (asks first with `ConfirmModal`), or "No profile photo." The page already reads with the
  secret-key client; reading `profile_photos` there is fine.

Everything uses the design system (`globals.css` classes, Lucide icons, `rounded-card` boxes, the main-button
style for Save photo).

### Notes to update in the same commit (root `CLAUDE.md`, "Every feature has notes")

- `src/app/CLAUDE.md`: Account (the Profile photo box) and profiles (the photo).
- `src/app/api/CLAUDE.md`: the new `profile-photo/` route in the table, and that `used_photo_srcs` counts profile
  photos.
- `src/app/admin/CLAUDE.md`: the Editors row (the photo and its Remove).
- `supabase/migrations/CLAUDE.md`: the new migration, `QMPPL` in "Refusal codes", and the newest `teacher_profile`
  and `used_photo_srcs`.
- `src/lib/CLAUDE.md` if a new helper lands there.

### Tests

- `supabase/tests/profile_photos.sql` (local Docker database only; rolls back): a non-editor and a banned editor are
  refused; the 4th change in a day is refused (`QMPPL`) and the next Philippine day allows again; removing doesn't
  count and remove + re-add doesn't reset; only admins can use `admin_remove_profile_photo`; taking the editor role
  away removes the row; nobody can insert / update / delete `profile_photos` directly; `teacher_profile` returns the
  photo; `used_photo_srcs` includes it.
- The crop math's `*.test.ts`.

### Deploying

Apply the migration before the app deploys (the account and profile pages call the new functions).

## Calls made by Claude (check these)

- The photo lives in its own table tied to `editors`, not in `user_settings` (so it can't be written directly).
- New refusal code `QMPPL` for "no changes left today".
- Uploading the same photo again still counts as a change; the first photo counts too.
- The stored photo is a 400 × 400 square; the circle is only how it's shown.
- An editor with no display name can still set a photo; it shows once they have a profile link.
- No photo = the profile header looks exactly like today (no placeholder circle on the profile page).
- The cropping is written by hand (about the size of the mockup's code), not with a package like `react-easy-crop`.
