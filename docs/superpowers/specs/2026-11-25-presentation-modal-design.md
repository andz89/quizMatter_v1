# Presentation modal (someone else's presentation opens in a modal, Canva-style)

## Why

Teachers browse From QuizMatter, Other teachers, Saved, Liked, search and profiles. A card used to open the view
page in a new tab, so every look left the list behind. Now a card opens a big modal over the list, laid out like
Canva's template preview, and closing it puts the teacher back where they were.

## What the teacher sees (logged in)

| How it's opened | What shows |
|---|---|
| Clicking a card of someone else's presentation (any home tab, search, profiles, "More like this") | The modal over the list |
| Clicking a "This week's lessons" row, or a "More like this" card, inside the modal or on the page | The modal switches to / opens that presentation |
| Reload while the modal is open | The list page again, modal closed (the address never changed) |
| Back, Escape, ✕, a click outside | Closes the modal |
| A shared link / typed address / Admin → Reports / My submissions (`/presentation/<id>`) | The full page, in the same layout without the box |
| Ctrl/middle-click on a card | The browser's new tab = the full page |
| Logged out | The public preview, unchanged |
| My own cards and Claude's drafts | Unchanged: the editor in a new tab |

## Layout (modal and page)

- Left: the big slide (Present, then Prev, `n / total`, Next in a row under it),
  then a sideways strip of every shown slide (the current one has a violet border; each little picture is drawn
  only once it scrolls into view, since a presentation can have 100 slides).
- Right: labels (QuizMatter, Reviewed, Under review, Sent to QuizMatter), the title, the details line, the tags,
  "View more by <name>" (round first letter, a link to their profile: the lesson's editor, or the teacher who
  published it), then the buttons: **Make a copy** (main violet; my own: Edit), Save (bookmark), Like (heart and
  count), Share, Report; editors get Review / Update this lesson / Continue review under them. Then the Author /
  Publisher / Reviewer lines, Description, Curriculum, Learning competency, References and This week's lessons.
- Bottom (QuizMatter lessons only): "More like this" with a **Show more like this** button; it loads up to 6 cards
  there (Spinner meanwhile).
- Phones: one column.
- Share: `navigator.share` on touch screens, else copies `<site>/presentation/<id>` and says "Link copied." Only on a
  published presentation (others can't open a private one's link).

## Approaches

1. **Client modal + server action (picked).** A provider in the root layout holds the open id; a card's plain
   click calls `openPresentation(id)` (server action, zod first) and shows the result in the shared `Modal`. Opening
   pushes one history entry with the same address, so Back closes it; a reload just reloads the list. Fits every
   rule the user gave.
2. Next.js intercepting routes (`@modal/(.)presentation/[id]`). Rejected: the address becomes `/presentation/<id>`,
   so a reload shows the full page, which the user doesn't want; it also catches every in-app link to that address.
3. A `?view=<id>` search param on each list page. Rejected: a reload would reopen it, and every list page would need
   to read it.

## How it's built

- `src/app/presentation/[id]/loadView.ts` (server): `loadPresentationView(id)`: `fetchPresentation`, the account,
  This week's lessons, the "View more by" person, `showHidden`, `canLike`, `waitingSince`. Used by the page and by
  the `openPresentation` action, so both show the same thing.
- `actions.ts`: `openPresentation(id)` and `loadMoreLikeThis(id)` (both check the id with zod; read only).
- `PresentationDetails.tsx` (client): the layout above, for both. Replaces `PresentationPreview.tsx` (my own
  locked presentation's view-only page uses it too: Edit instead of Make a copy). `MoreLikeThis.tsx` replaces
  `Suggestions.tsx`.
- `src/app/PresentationModal.tsx` (client): `PresentationModalProvider` (root layout) and `useOpenPresentation()`.
  It closes by itself when the page changes (a link inside it, Make a copy). A Save or Like inside it refreshes
  the list when it closes, so the card behind shows it. While a box opened from it (Report) is on top, Escape
  closes only that box.
- `PresentationCard`: a card with `opensInModal` (set by `toSavableCard`) has no `target="_blank"`; a plain click
  opens the modal.
- No database change, no new package.

## Not doing

- No Follow button (the app has no following).
- The full page doesn't load "More like this" up front any more (the same button), so it's lighter.
