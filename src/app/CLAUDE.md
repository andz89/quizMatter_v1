# src/app (the teacher pages)

The pages teachers use outside the editor. Other folders here have their own notes: `admin/` (admin pages),
`api/` (photo routes). The editor itself is in `src/components/editor/`.

## Home pages: `(home)/`

`(home)/layout.tsx` is shared by every home page: the title, the search box (`HomeSearchForm`) and the tabs
(`HomeTabs`, with a count per tab). Each tab is its own page:

| Tab | Page | Shows |
|---|---|---|
| My presentations | `page.tsx` → `MyPresentations.tsx` | My newest cards + Claude's drafts, my folders. "See all" → `/presentations` (a table: `presentations/PresentationList.tsx`) |
| From QuizMatter | `quizmatter/` | What admins shared, a row per subject |
| Other teachers | `teachers/` | Other teachers' published ones, 20 at a time ("Show more") |
| Saved | `saved/` | Presentations I bookmarked (`MAX_SAVED` at most) |
| Reviews & submissions | `reviews-submissions/` | Editors only: `MyReviews.tsx`, `MySubmissions.tsx` |
| (search) | `search/` | Search results; the search lives in the page link (`homeSearch.ts`), so Back and shared links keep it |

- `(home)/cards.ts` loads the cards (first slide only, to keep the page light) and turns rows into card data.
  `CardGrid.tsx` lays them out and handles Present from a card.
- `PresentationCard.tsx`: one card. `PresentationCardMenu.tsx`: its ⋮ menu (Edit, Present, Delete; admins: Move to
  QuizMatter; editors: Submit to QuizMatter). `SaveCardButton.tsx`: the bookmark on other people's cards.
- `PresentationListButtons.tsx`: New presentation (makes a blank one, saves it at once, opens the editor).

## Folders

`MyFolders.tsx` (folder tiles, drag cards onto a folder, the Move modal) + `folderActions.ts` (create, rename,
delete, move). Limits in `src/lib/folders.ts`, checked again in `20261028000000_folders.sql`.

## A presentation's pages: `presentation/`

- `[id]/page.tsx`: the view page (mostly other teachers' published ones): `PresentationPreview.tsx` with Prev/Next,
  "Make a copy" (saves a private copy and opens it), Save (bookmark), and `ReportButton.tsx` (goes to Admin →
  Reports). Actions in `[id]/actions.ts`.
- `[id]/edit/page.tsx`: decides who gets what: my own → editor; locked by review or submission → view; my review →
  the editor in review mode, or `ReviewSubmittedView` once submitted. `PresentationEditor.tsx` loads the editor
  without server rendering (the store makes random ids, which would not match).
- `new/page.tsx`: opens a Claude draft (`?draft=<id>`) as a new, not-yet-saved presentation.

## Sharing and publishing

A teacher's Published makes a **shared copy**: its own presentation row (`shared_from` = the original), which other
teachers see. The teacher keeps editing the original in private; "Update shared presentation" in the Share card
(`src/components/editor/ShareButton.tsx`) copies it again (same link, bookmarks and reports). Private, or deleting
the original, removes the copy. Editors can't publish (they Submit to QuizMatter; the edit page passes `canPublish`). Move to QuizMatter removes the
copy in the database, in the same step (`20261125000000_shared_copy_fixes.sql`). An admin's hide sticks: a hidden
copy can't be made private, and Admin → Reports
"Delete for good" on a copy deletes its original too (`20261124000000_shared_copy_moderation.sql`,
`admin/reports/actions.ts`). Only `share_presentation` / `unshare_presentation` change a copy
(`20261123000000_shared_copy.sql`; app side: `src/lib/sharing.ts`, store `setPublished` / `updateSharedCopy`).
My own lists leave copies out (`shared_from is null`) and show Published / Hidden from the copy (`mySharedCopies` in
`(home)/cards.ts`); opening my copy's editor goes to the original. Limits (`20261103000000_share_limits.sql`,
`20261105000000_publish_daily_reset.sql`): the `share` and `publish` click limits, and it needs a title and one slide
with something on it (`QMPUB`, same rule as `publishableSchema`). QuizMatter (admin) presentations keep their
Draft / Shared switch on the presentation itself, and aren't counted.

## Account, profiles, sign up, login

- `account/`: display name (kept 30 days once changed; `display_name` click limit), personal details and bio,
  password (`AccountForms.tsx`). Rules and limits: `src/lib/userSettings.ts`.
- `teachers/[slug]/`: a teacher's public profile, from `src/lib/profiles.ts` (never the contact number or email).
- `signup/`: Turnstile check (`src/components/Turnstile.tsx`), blocked throwaway emails
  (`src/lib/blockedEmailDomains.ts`), browser speed bumps (`src/lib/browserLimits.ts`), and a limit per internet
  address in the database (`20261108000000_sign_up_limit.sql`). The email link opens `auth/confirm/route.ts`.
- `login/`: login with plain-English errors and a browser speed bump. `src/proxy.ts` sends logged-out people here.
- `oauth/consent/` + `.well-known/`: Claude's login (see `src/pages/api/CLAUDE.md`).

## How a teacher's server action is written

Like `folderActions.ts` and `actions.ts`: `"use server"`, check the input with zod, call the database with the
server client (`@/lib/supabase/server`), `refresh()` the page's data, and return `null` (worked) or a short message
(the page shows it in a sonner toast). The database only lets a teacher touch their own things.

## Other

- `layout.tsx`: the root layout (fonts, `ClickPauseNotice`, toasts). `globals.css`: the design system.
- `dev/asset-shapes/`: development only, makes `src/lib/assetShapes.json`.
