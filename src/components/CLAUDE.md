# src/components (shared UI)

Pieces used on many pages. Reuse them; don't make a second version. `editor/` and `presentation/` have their own
notes.

- `Spinner.tsx`: the one spinner. `TopLoadingBar.tsx`: the one top loading line. `LinkPending.tsx`: put inside a
  `<Link>` to show both at once on click (see the root `CLAUDE.md`).
- `Modal.tsx`: the one modal box (title, ✕, Escape / click outside closes, `isBusy` blocks closing, optional footer).
  For "Are you sure?" use `editor/ConfirmModal.tsx` instead, never the browser's `confirm()`.
- `NavBar.tsx` (server only): the top bar of every page, with `AccountMenu.tsx` (Admin, Account settings, Log out).
- `Logo.tsx`: the one logo (same drawing as `src/app/icon.svg`).
- `SearchForm.tsx`: the search box with its options panel, used by the home page and Admin → Photos.
- `ClickPauseNotice.tsx`: the sticky "paused" notice from click limits; in the root layout once.
- `Turnstile.tsx`: Cloudflare's "are you human" check on sign up (with its own retries).
- `PeopleArtGate.tsx`: holds back a presentation until the big people drawings have downloaded
  (`src/lib/peopleArt.ts`).
- `LinkifiedText.tsx`: plain text with clickable links. `LoginAbout.tsx`: the About part of the login page.
- `DevRequestCounter.tsx`: development only (never on quizmatter.com): counts the app's network requests.
