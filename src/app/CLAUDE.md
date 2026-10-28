# src/app (the teacher pages)

The pages teachers use outside the editor. Other folders here have their own notes: `admin/` (admin pages),
`api/` (photo routes). The editor itself is in `src/components/editor/`.

## Home pages: `(home)/`

`(home)/layout.tsx` is shared by every home page: the title, the search box (`HomeSearchForm`) and the tabs
(`HomeTabs`, with a count per tab). Each tab is its own page:

| Tab | Page | Shows |
|---|---|---|
| My presentations | `page.tsx` → `MyPresentations.tsx` | My newest cards + Claude's drafts, my folders. "See all" → `/presentations` (a table: `presentations/PresentationList.tsx`) |
| From QuizMatter | `quizmatter/` | What admins shared, a row per subject (first 5 each, "See all (n)" opens that subject, 20 at a time). Sort and subject live in the page link |
| Other teachers | `teachers/` | Other teachers' published ones, 20 at a time ("Show more") |
| Saved | `saved/` | Presentations I bookmarked (`MAX_SAVED` at most) |
| Liked | `liked/` | Presentations I liked, newest liked first, 20 at a time ("Show more"). Not shown to admins (they can't like) |
| Reviews & submissions | `reviews-submissions/` | Editors only, two tables: Reviews (`MyReviews.tsx`: open, canceled, and "Published" for live ones I reviewed) and Submissions (`MySubmissions.tsx`) |
| (search) | `search/` | Search results; the search lives in the page link (`homeSearch.ts`), so Back and shared links keep it |

- `(home)/cards.ts` loads the cards (first slide only, to keep the page light) and turns rows into card data.
  A request returns 1,000 rows at the most, so a home page never reads a list that can grow past that: it reads only
  the cards it shows (`loadCardContext` reads my likes only for those ids, 50 at a time) and gets totals with
  `count: "exact"`. My saved rows are the one list read whole (`loadCardContext`, the Saved tab): `MAX_SAVED` (50)
  keeps it small.
  From QuizMatter sends one request per subject (`bySubjectChip`): its exact count and its first 5 cards; a picked
  subject (or `subject=none`, the "No subject" row's See all) is paged with `ShowMore` like Other teachers. Liked reads
  my `presentation_likes` rows (newest liked first, paged by the database) with each presentation embedded.
  `CardGrid.tsx` lays them out and handles Present from a card.
- `PresentationCard.tsx`: one card. `PresentationCardMenu.tsx`: its ⋮ menu (Edit, Present, Delete; the super admin: Move
  to QuizMatter; editors: Submit to QuizMatter). `SaveCardButton.tsx`: the bookmark on other people's cards.
  `LikeCardButton.tsx`: the heart with the like count, left of the bookmark (teachers and editors, someone else's
  presentation; `likes` in `CARD_COLUMNS`, my likes in `loadCardContext`). Where I can't like (admins), the count
  shows next to the details line instead.
- `PresentationListButtons.tsx`: New presentation (makes a blank one, saves it at once, opens the editor).

## Folders

`MyFolders.tsx` (folder tiles, drag cards onto a folder, the Move modal) + `folderActions.ts` (create, rename,
delete, move). Limits in `src/lib/folders.ts`, checked again in `20261028000000_folders.sql`. Every change counts
toward the `folders` click limits (30 in a minute and 500 a day, once per request;
`20261211000000_save_photo_click_limits.sql`):
`failure` says it's paused, `showFolderError` shows it and asks `checkPauses`, and "New folder" and the Move
modal grey out.

## A presentation's pages: `presentation/`

- `[id]/page.tsx`: the view page (mostly other teachers' published ones): `PresentationPreview.tsx` with Prev/Next,
  "Make a copy" (saves a private copy and opens it, remembering `copied_from`; an editor's copy gets them as
  Author), Save (bookmark), and `ReportButton.tsx` (goes to Admin → Reports). Actions in `[id]/actions.ts`.
- Likes: `[id]/LikeButton.tsx` on a published presentation's view page. Teachers and editors like someone else's
  (`setPresentationLiked` → `set_liked`, zod first; the `like` click limit); admins and the owner only see the
  count. Who liked what is private (people read only their own likes); everyone sees the count. Database:
  `20261204000000_presentation_likes.sql`.
- On a live QuizMatter presentation the view page also shows, from `src/lib/lessons.ts` (database:
  `lesson_extras`, one call): `[id]/LessonWeek.tsx`, "This week's lessons by <editor>" (the same editor's
  lessons with the same subject, term and week and a grade in common, every day and version; curriculum ignored) and
  "See all <editor>'s presentations" (their profile); and `[id]/Suggestions.tsx`, "You may also like" (up to 6 with
  the same subject and a grade in common, most saved first). The maker is the editor of the approved submission
  (`copy_id`), never the Author text. Lessons an admin made get only the suggestions. Suggestion and profile cards
  use `SavableCardGrid.tsx` (the bookmark works there too).
- `[id]/edit/page.tsx`: decides who gets what: my own → editor; locked by review or submission → view; my review →
  the editor in review mode, or `ReviewSubmittedView` once submitted. `PresentationEditor.tsx` loads the editor
  without server rendering (the store makes random ids, which would not match).
- `new/page.tsx`: opens a Claude draft (`?draft=<id>`) as a new, not-yet-saved presentation. Only Save makes it a
  presentation; leaving the editor keeps its changes in the browser instead (see `src/components/editor/CLAUDE.md`).

## Sharing and publishing

A teacher's Published makes a **shared copy**: its own presentation row (`shared_from` = the original), which other
teachers see. The teacher keeps editing the original in private; "Update shared presentation" in the Share card
(`src/components/editor/ShareButton.tsx`) copies it again (same link, bookmarks and reports). Private, or deleting
the original, removes the copy. Editors can't publish (they Submit to QuizMatter; the edit page passes `canPublish`). Move to QuizMatter removes the
copy in the database, in the same step (`20261125000000_shared_copy_fixes.sql`). An admin's hide sticks: a hidden
copy can't be made private, and Admin → Reports
"Delete for good" on a copy deletes its original too (`20261124000000_shared_copy_moderation.sql`,
`admin/reports/actions.ts`). A copy of a hidden presentation can't be published either: `share_presentation`
refuses when its `copied_from` source, or that source's shared copy, is hidden
(`20261210000100_plain_admin_limits.sql`). Only `share_presentation` / `unshare_presentation` change a copy
(`20261123000000_shared_copy.sql`; app side: `src/lib/sharing.ts`, store `setPublished` / `updateSharedCopy`).
My own lists leave copies out (`shared_from is null`) and show Published / Hidden from the copy (`mySharedCopies` in
`(home)/cards.ts`); opening my copy's editor goes to the original. Limits (`20261103000000_share_limits.sql`,
`20261105000000_publish_daily_reset.sql`): the `share` and `publish` click limits, and it needs a title and one slide
with something on it (`QMPUB`, same rule as `publishableSchema`). QuizMatter (admin) presentations keep their
Draft / Shared switch on the presentation itself, and aren't counted.

## Account, profiles, sign up, login

- `account/`: display name (kept 30 days once changed; `display_name` click limit), personal details and bio
  (the `settings` click limit, like the Elements panel's favorite stars), password (`AccountForms.tsx`). Rules and
  limits: `src/lib/userSettings.ts`.
- Profile privacy (spec `docs/superpowers/specs/2026-10-28-profile-privacy-design.md`): in Personal details, plain
  teachers get a "Show on my profile" checkbox under the full name, the educational background (degree and field
  together) and the bio, saved with Save details (`saveProfile(fields, visibility)`, `profileVisibilitySchema`; all
  on until turned off). With the full name off and both names still in the display name (sign up makes it from
  them), a note says to change the display name. Editors get no checkboxes: their details always show (the database
  decides, `teacher_profile` in `20261215000000_profile_privacy.sql`), and "Make editor" in Admin → Teachers says so.
- Editors' profile photo (spec `docs/superpowers/specs/2026-10-27-editor-profile-photo-design.md`): a "Profile photo"
  box first on `account/`, editors only (`ProfilePhotoForm.tsx`; the page reads `my_profile_photo`). Add / Change
  photo opens the file picker, then "Adjust your photo" (`ProfilePhotoCropper.tsx`: drag to move, Zoom 1–3×, the
  math in `src/lib/photoCrop.ts`), which cuts a 400 × 400 square and uploads it (`src/lib/profilePhotos.ts` →
  `/api/profile-photo`). It shows on the profile at once, no admin check. 3 new photos a day (Philippine time; the
  database counts, `QMPPL`): the box says "N left today", and with none left the button greys out. Remove asks first
  and doesn't give a change back. Not a click limit. Admins can remove it in Admin → Editors; taking the editor role
  away removes it.
- `teachers/[slug]/`: a teacher's public profile, from `src/lib/profiles.ts` (never the contact number or email).
  An editor's profile photo (`photoSrc`, from `teacher_profile`) shows round next to the name; none = the name alone.
  A private full name, background or bio comes back empty for others, so it isn't shown (a private bio has no
  section at all); the owner sees it with an "Only you can see this" tag (`fullNamePublic` / `educationPublic` /
  `bioPublic` off).
  Below it, the QuizMatter presentations they made as an editor (`editor_presentations`, `src/lib/lessons.ts`), by
  subject, then first grade; then "Shared presentations", the ones they published (their shared copies, not hidden,
  last changed first; `teacher_shared_presentations` via `loadSharedPresentationIds` in `src/lib/profiles.ts`).
  Editors can't publish, so only plain teachers have that list. Both lists use `SavableCardGrid.tsx`.
- `signup/`: `page.tsx` (server) reads the throwaway email services from the database's `blocked_email_domains`
  table and gives them to `SignUpForm.tsx` (the form), whose zod check (`signUpSchema(blockedDomains)` in
  `src/lib/userSettings.ts`) refuses them at once. The database's sign up hook checks the same list, so a script
  can't skip it, and it refuses with the same words (`THROWAWAY_EMAIL_MESSAGE`); if the page couldn't read the list,
  the form sends anyway and shows the hook's words (`20261210000400_blocked_email_domains.sql`). Also: Turnstile
  check (`src/components/Turnstile.tsx`), browser speed bumps (`src/lib/browserLimits.ts`), and a limit per
  internet address in the same hook (`20261108000000_sign_up_limit.sql`). The email link opens
  `auth/confirm/route.ts`: it checks `type` with zod (only `email`, the sign up email; add a type there if a new
  email uses it) and, if someone is already logged in, does nothing and opens home, so a link can't swap them into
  another account.
- `login/`: login with plain-English errors, a browser speed bump and a "Need help?" line with the support email
  (`src/components/SupportEmail.tsx`). `src/proxy.ts` sends logged-out people here. Its
  matcher skips only the real static files (`_next/static`, `_next/image`, `favicon.ico`, `icon.svg` and the five
  `.svg` files in `public/`), never a page address that just ends in `.png`; a new file in `public/` must be added there.
- `oauth/consent/` + `.well-known/`: Claude's login (see `src/pages/api/CLAUDE.md`).
- `(legal)/`: `privacy/` and `terms/`, linked from the footer; placeholders ("We're still writing this page" + the
  support email) until the real text is written. Open to logged-out visitors (`src/proxy.ts`), so `layout.tsx` shows
  the NavBar only when logged in, else a bar with the logo and Log in.

## How a teacher's server action is written

Like `folderActions.ts` and `actions.ts`: `"use server"`, check the input with zod, call the database with the
server client (`@/lib/supabase/server`), `refresh()` the page's data, and return `null` (worked) or a short message
(the page shows it in a sonner toast). The database only lets a teacher touch their own things.

## Other

- `layout.tsx`: the root layout (fonts, `ClickPauseNotice`, toasts). `globals.css`: the design system.
- `error.tsx`: the page shown when a page breaks ("Something went wrong", Try again via `retry()`, a link home). This
  Next.js version passes `retry` (and still `reset`, which only clears the error without re-fetching).
- Errors never use `alert()`: they show a sonner toast. The like and save buttons (`LikeCardButton`, `SaveCardButton`,
  `LikeButton`, the preview's Save) catch a network error, show "Couldn't change it. Please try again." and stop their
  spinner. A failed home tab count (`loadTabCounts` in `(home)/layout.tsx`) is logged and shows 0. Deleting a
  presentation shows "Presentation deleted." `presentations/loading.tsx` is that list's top line and Spinner.
- `dev/asset-shapes/`: development only, makes `src/lib/assetShapes.json`.
