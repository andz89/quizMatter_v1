# src/components (shared UI)

Pieces used on many pages. Reuse them; don't make a second version. `editor/` and `presentation/` have their own
notes.

- `Spinner.tsx`: the one spinner. `TopLoadingBar.tsx`: the one top loading line. `LinkPending.tsx`: put inside a
  `<Link>` to show both at once on click (see the root `CLAUDE.md`).
  `FormPending.tsx`: put inside a `next/form` `Form` to show the top line at once on submit (`useFormStatus`).
- `Modal.tsx`: the one modal box (title, ✕, Escape / click outside closes, `isBusy` blocks closing, optional footer,
  `isNarrow` for a small box, `canClose={false}` hides ✕ and ignores Escape / click outside).
  For "Are you sure?" use `editor/ConfirmModal.tsx` instead, never the browser's `confirm()`.
- `NavBar.tsx` (server only): the top bar of every page, with the "Support" button (`KeepFreeButton`) and
  `AccountMenu.tsx` (an "Admin" or "Editor" label above the name, then Admin, Account settings, Help & support,
  Keep QuizMatter free, Log out).
- `KeepFree.tsx`: "Keep QuizMatter free", teachers chipping in with GCash to pay the running costs (instead of ads).
  `KeepFreeModal` shows the owner's GCash QR (`gcash-qr.png`, cropped so no phone number shows), "Save QR image" for
  phones, the name GCash should show (`GCASH_NAME`) and a scam warning. Opened from three places: the top bar's
  "Support" button, the account menu and the footer; never in the editor, Present or the login pages. The QR is a file
  in the code on purpose, so only a deploy can change it (not the database or an Admin page); a new QR needs a new
  `GCASH_NAME`. The app can't know who paid, so nothing is saved.
- `SupportEmail.tsx`: the support address (`SUPPORT_EMAIL`, `src/lib/support.ts`) with a Copy button and a toast;
  on the login page, the blocked account page, the footer and Privacy / Terms. `copySupportEmail` is the account
  menu's Help & support row.
- `Footer.tsx`: in the root layout, under every page but the editor (`/presentation/new`, `/presentation/<id>/edit`,
  checked by address). Computers (`lg`): one row, logo, © and the Privacy / Terms links left, "Keep QuizMatter free"
  (not on login / sign up), Facebook (`FACEBOOK_URL`) and the support email right. Tablets and phones: centered and stacked, with a short line about
  QuizMatter. A page that should push it to the bottom needs nothing: the body is a column and the footer has `mt-auto`.
- `Logo.tsx`: the one logo (same drawing as `src/app/icon.svg`).
- `SearchForm.tsx`: the search box with its options panel, used by the home page and Admin → Photos.
- `ClickPauseNotice.tsx`: the sticky "paused" notice from click limits; in the root layout once.
- Maintenance (root `CLAUDE.md`, "Maintenance"), in the root layout once each: `MaintenanceWatch.tsx` wraps the
  browser's fetch and sends an open tab to `/maintenance` on a maintenance refusal (not on `/maintenance` or
  `/login`). `MaintenanceBar.tsx` (server) shows the announcement to everyone, or "Maintenance is ON" to the super
  admin; `MaintenanceNotice.tsx` draws it: a bar on top, or a card floating at the bottom with ✕ in the editor
  (`isEditorPage` from `Footer.tsx`).
- Announcements (root `CLAUDE.md`, "Announcements"): `Announcements.tsx` (server, root layout right after
  `MaintenanceBar`) renders `AnnouncementsWatch.tsx` only when the maintenance status's `announcementsKey` is filled.
  The watch keeps the teacher's list in sessionStorage (`qm:announcements`: key, Philippine day, account id, items,
  closed parts), asks `my_announcements` only when the key, day or logged-in account changed (`isSameVisit`) and the page is in a page group, hides everything
  while fullscreen, and on close marks the part closed in the tab and (`once` / `daily`) calls
  `dismiss_announcement`.
- `AnnouncementView.tsx`: how an announcement looks (root `CLAUDE.md`, "Announcements"), for teachers and the admin's
  preview. `AnnouncementModal` (the `Modal`, "You can close this in N…" until its close delay ends, then ✕ and a
  Close button) and `AnnouncementBar` (a violet strip with a megaphone; ✕ after the countdown; `isFloating` = a card,
  which the parent places at the bottom). The text goes through `toSafeAnnouncementHtml` in the browser; links into
  the app move with `router.push`, others open in a new tab.
- `Turnstile.tsx`: Cloudflare's "are you human" check on sign up (with its own retries).
- `PeopleArtGate.tsx`: holds back a presentation until the big people drawings have downloaded
  (`src/lib/peopleArt.ts`).
- `LinkifiedText.tsx`: plain text with clickable links. `LoginAbout.tsx`: the About part of the login page.
- `DevRequestCounter.tsx`: development only (never on quizmatter.com): counts the app's network requests.
