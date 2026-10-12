# Home Page Groups as Their Own Pages — Design

Today the home page (`/`) loads five groups of presentations at once (My presentations, From QuizMatter, My
reviews, Saved, Other teachers) and shows one at a time as tabs. This gives each group its own page and address,
and gives search its own page with one mixed list of results.

**Goals (from the user):** faster loading (a page loads only its group), its own link and a working Back button,
more room per group, and simpler code (today's `PresentationHome.tsx` does all five groups in 750 lines).

## Pages

All home pages share one layout (Next.js route group `src/app/(home)/`): the title, "New presentation", the
search box and the tab row. Only the cards under them change when a tab is clicked.

| Address | Shows |
|---|---|
| `/` | **My presentations**: folders, newest cards, "See all" to `/presentations`, drag into folders, select many (as today) |
| `/quizmatter` | **From QuizMatter**: subject chips, 5 per subject + "See all", Last changed / Newest (as today) |
| `/reviews` | **My reviews** (editors only; anyone else is sent to `/`): open rounds, canceled ones, published (as today) |
| `/saved` | **Saved**: all of them (at most `MAX_SAVED` = 50) |
| `/teachers` | **Other teachers**: newest first, 20 at a time with "Show more" |
| `/search` | **Search results**: one mixed list (see Search) |

- `/presentations` (the full table of my presentations) stays as it is. `/teachers/[slug]` (a teacher's profile)
  stays as it is; it's a different address from `/teachers`, so they don't clash.

## The shared layout (`src/app/(home)/layout.tsx`)

- NavBar, the "Presentations" heading and its line, `NewPresentationButton`.
- A blocked account sees `BlockedHome` instead of any home page (moved here from today's `page.tsx`).
- **Search box** (client component): reads the current search with `useSearchParams` (layouts don't re-render on
  navigation, so it can't take the search as a prop). Pressing Search goes to `/search?…`.
- **Tab row** (client component): one `<Link>` per page with `LinkPending` (the top loading line on click), the
  open tab picked with `usePathname`. Same look as today's tabs; on phones it's today's burger menu. "My reviews"
  only for editors.
- **Counts on the tabs** stay: the layout asks the database for counts only (`count: "exact", head: true`, no
  rows), one per group, plus the open review rounds for "My reviews". Saving or unsaving a presentation calls
  `router.refresh()`, which updates them.

## Each page loads only its own group

- Each page is a server component that loads its group and the small things its cards need (my saved ids for the
  bookmarks; publisher names for other teachers' cards). E.g. `/quizmatter` no longer loads my folders or
  other teachers' presentations.
- Shared code moves out of today's `src/app/page.tsx` into `src/app/(home)/cards.ts`: the card columns, `toCard` /
  `toSavableCard`, the section queries, and `loadSavedIds`. Every page uses it.
- Today's `PresentationHome.tsx` is split by page: `/`'s client part keeps folders, drag and drop and select many
  (`MyFolders.tsx` unchanged); `/quizmatter`'s keeps the subject chips, subject rows and sorts; the shared `Cards`
  grid, `Empty` and `PartLabel` move to one small shared file. Present (`PresentationView`) and the bookmark
  toggle work on every page as today.
- Every new page gets a `loading.tsx` with the top line and the Spinner (CLAUDE.md).

## Search (`/search`)

- One mixed list. "Look in": **All** (default) = From QuizMatter + Other teachers; **From QuizMatter**; **Other
  teachers**; **Mine** (my own, with Claude's drafts at the top, matched as today). "Saved" and "My reviews" are
  removed from "Look in" (they only repeat presentations already in those groups); an old link with them falls
  back to All.
- One database query for the list: the "Look in" rows, every search filter as today (`search_text` words, title,
  subject, author, tags, grade, week, day, changed within), the chosen sort, and `count: "exact"`.
- Shows the total ("42 results"), the first 20, and **"Show more"**, which adds `shown=40` (then 60, …) to the link.
  The page keeps its scroll (`scroll: false`), the button shows the Spinner while it waits. `shown` is checked by
  zod (a multiple of 20, at most 500) like the other search options.
- "Clear search" goes back to `/`.
- **Old links**: `/` with search options in its link (e.g. `/?q=fractions`) redirects to `/search` with the same
  options.

## Other teachers (`/teachers`)

Newest first, 20 at a time with "Show more" (`?shown=40`), the same button and rules as search.

## Not changing

Cards, bookmarks, Present, folders, drag and drop, the subject rows, My reviews' parts, the Spinner, the top line,
the design system. No database change. No new package.

## Checking

`npx tsc --noEmit`, `npx eslint src`, and the diff read against this spec. The user tests in the browser: every
tab, Back/refresh on each page, search + "Show more", an old `/?q=` link, a non-editor opening `/reviews`.
