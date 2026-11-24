# Presentation Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Someone else's presentation card opens a Canva-style modal; the full page uses the same layout.

**Architecture:** One server loader (`loadPresentationView`) feeds both the page and a server action; one client
component (`PresentationDetails`) draws both; a provider in the root layout holds the modal.

**Tech Stack:** Next.js app router, React client components, server actions, zod, Tailwind design system.

**Spec:** `docs/superpowers/specs/2026-11-25-presentation-modal-design.md`

## Global Constraints

- Design system classes only; Lucide icons; the one `Modal`, `Spinner`, `TopLoadingBar`.
- zod on every action input (`z.uuid()`).
- No database change, no new package.
- Notes (`src/app/CLAUDE.md`, root map) updated in the same commit.

## Review Focus

- Escape in the Report box closes only that box, not the presentation modal.
- Presenting from inside the modal shows fullscreen above it; arrow keys don't move the strip meanwhile.
- A card click while another presentation is still loading shows the newest one only.
- Leaving through a link inside the modal (profile, Make a copy) closes it.
- Save/Like in the modal: the list behind is refreshed on close (Saved tab drops an unsaved card).

---

### Task 1: Server loader + actions

**Files:** Create `src/app/presentation/[id]/loadView.ts`; modify `src/app/presentation/[id]/actions.ts`,
`src/app/presentation/[id]/page.tsx`.

**Interfaces — Produces:**
- `type PresentationViewData = { presentation; isMine; showHidden; ownerId; profileSlugs; publisherName; isSaved; likeCount; isLiked; canLike; review; reviewers; waitingSince: string | null; lessonWeek: LessonWeekData | null; maker: { name: string; slug: string } | null; hasMoreLikeThis: boolean }`
- `loadPresentationView(id: string): Promise<PresentationViewData | null>`
- actions `openPresentation(id: string): Promise<PresentationViewData | null>` and
  `loadMoreLikeThis(id: string): Promise<PresentationCardData[]>`.

- [ ] Move the page's logic (account, `fetchPresentation`, week list) into the loader; maker = week's editor, else the
  publisher with a profile slug.
- [ ] Page renders `PresentationDetails` with the loader's data.

### Task 2: `PresentationDetails` + `MoreLikeThis` (replace `PresentationPreview`, `Suggestions`)

- [ ] Layout per the spec; strip with lazy thumbnails; Share; Report compact; `onChange` after save/like.
- [ ] Delete `PresentationPreview.tsx` and `Suggestions.tsx`.

### Task 3: Modal provider + cards

**Files:** Create `src/app/PresentationModal.tsx`; modify `src/app/layout.tsx`, `src/app/PresentationCard.tsx`,
`src/app/(home)/cards.ts`, `LessonWeek.tsx`, `LikeButton.tsx`, `ReportButton.tsx`.

- [ ] `PresentationModalProvider`, `useOpenPresentation(): ((id: string) => void) | null`.
- [ ] `opensInModal: true` from `toSavableCard` (and the fallback in `toSavableCards`).

### Task 4: Browser test + notes

- [ ] `e2e/presentation-modal.mjs`: card → modal (address unchanged) → Show more like this → a suggestion swaps it →
  Back closes → reload has no modal → `/presentation/<id>` is the full page with the same title → Escape in Report
  keeps the modal.
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm test`; update notes; commit.
