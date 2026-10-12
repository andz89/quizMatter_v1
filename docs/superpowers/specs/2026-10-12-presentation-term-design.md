# Presentation Term — Design

One new optional detail on a presentation, picked in the Presentation details panel:

- **Term:** None, Term 1, Term 2, Term 3, Other…

"Other…" shows a box to type the teacher's own (e.g. "Summer term"). "None" is a real choice in the list and
clears the field. It starts as None. One term per presentation. It works exactly like Week and Day
(`2026-10-12-presentation-week-day-design.md`) and reaches everywhere they do.

## Data

- `presentations.term`: `text not null default ''`, with a check of at most 40 characters
  (`DETAIL_MAX_LENGTH.term`). A list value ("Term 2"), the teacher's own text, or `""` for None.

## Database (migration `20261118000000_presentation_term.sql`)

1. Add the column and its length check.
2. `save_presentation` (newest copy: `20261116000000_presentation_week_day.sql`): also insert/update `term`.
   A tab opened before this sends none: `coalesce(..., '')`.
3. `publish_review` (newest copy: same migration): also copy the draft's `term` (missing = `''`).
4. `check_review_draft` (newest copy: same migration): also refuse a draft whose `term` is longer than 40.
5. `search_text` (from `20261117000000_presentation_search_text.sql`): a generated column's formula can't be
   changed, so drop it (its trigram index goes with it) and add it again with `term` after `subject`, then
   re-create `presentations_search_text_trgm_idx`.

Each function is a full `create or replace` of the newest version with only the `term` lines added.

## Rules (`src/lib/schema.ts`)

- `TERMS` (`Term 1` … `Term 3`) next to `WEEKS`; `DETAIL_MAX_LENGTH.term = 40`; `isOtherTerm`;
  `termSchema = listOrOwnSchema(TERMS, 40)`, so typing "term 2" saves "Term 2".
- `term: termSchema.default("")` in `presentationSchema` (old drafts and open tabs read as `""`). zod checks it
  before every save (editor, review draft, Claude's import).
- Added to `PresentationDetails`, `factories.ts` (starts as `""`), `fetchPresentation.ts` (select and read back).

## Details panel (`DetailsPanel.tsx`)

- Term above Week, using `ListOrOtherField` with `canPickNone`, placeholder "Type the term, e.g. Summer term".

## Where it shows

- `detailsLabel` (`format.ts`) takes `term` and puts it before week:
  `Grade 4 · Mathematics · Term 1 · Week 3 · Day 2`. So it shows on every card and header that already uses it
  (home, My presentations, Admin → Presentations, editor's Presentations panel, preview page, reviewer's submitted
  view, admin's review page).
- Every query that selects `week, day` for those also selects `term`; Claude's drafts read it from the recipe
  (`drafts.ts`, `coalesce(json_extract(recipe, '$.details.term'), '')`).

## Home search

- "Includes the words" / "Doesn't have" look in `term` too: saved presentations through `search_text`, drafts
  through `draftMatches` in `cards.ts`.
- A Term filter in `HomeSearchForm` like Week's: "Any term", Term 1–3, Other (`homeSearch.ts` `listChoice(TERMS)`,
  `cards.ts` query and draft filters).

## Claude (MCP import)

- `importPresentation.ts` accepts optional `term` (`termSchema`), described as "only if the user or their document
  names one"; the guide sentence lists it with week and day. The user reconnects the claude.ai connector after.

## Checking

`npx tsc --noEmit`, `npm run lint`, the copied SQL functions diffed against their source (only `term` lines
differ), and the diff read against this spec. The user tests in the browser and applies the migration to Supabase.
