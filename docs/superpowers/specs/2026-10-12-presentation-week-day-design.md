# Presentation Week and Day — Design

Two new optional details on a presentation, picked in the Presentation details panel:

- **Week:** Week 1 … Week 20, Other…, None
- **Day:** Day 1 … Day 5, Other…, None

"Other…" (worded like Subject's, so the panel reads the same) shows a box to type the teacher's own (e.g. "Week 21", "Day 6 (review)").
"None" is a real choice in the list and clears the field. Both start as None. One week and one day per
presentation (not several, like Grade).

## Data

- Stored as text, the same way as `subject`: a list value ("Week 3"), the teacher's own text, or `""` for None.
- `presentations.week` and `presentations.day`: `text not null default ''`, each with a check of at most 40
  characters (`DETAIL_MAX_LENGTH.week` / `.day`).

## Database (migration `20261116000000_presentation_week_day.sql`)

1. Add the two columns and their length checks.
2. `save_presentation` (newest copy: `20261103000000_share_limits.sql`): also insert/update `week` and `day`.
   A tab opened before this sends none: `coalesce(..., '')`.
3. `publish_review` (newest copy: `20261102000000_review_auto_reviewer.sql`): also copy the draft's `week` and
   `day` into the presentation (missing = `''`).
4. `check_review_draft` (newest copy: whichever migration last replaced it): also refuse a draft whose `week` or
   `day` is longer than 40.

Each is a full `create or replace` of the newest version with only these additions.

## Rules (`src/lib/schema.ts`)

- `WEEKS` (`Week 1` … `Week 20`) and `DAYS` (`Day 1` … `Day 5`), next to `SUBJECTS`.
- `week: listOrOwnSchema(WEEKS, 40)` and `day: listOrOwnSchema(DAYS, 40)` in `presentationSchema`, so typing
  "week 3" saves "Week 3". zod checks them before every save (editor, review draft, Claude's import).
- Old saved data without them (review drafts, open tabs): read as `""` (a zod `.default("")`).
- Added to `PresentationDetails`, `factories.ts` (start as `""`), `fetchPresentation.ts` (select and read back).

## Details panel (`src/components/editor/DetailsPanel.tsx`)

- Week and Day under Subject, using the existing `ListOrOtherField`.
- `ListOrOtherField` gets one option, `canPickNone`: shows "None" as a pickable choice (value `""`). Subject keeps
  today's behavior (None hidden once picked).

## Where they show

- **Preview page** (`PresentationPreview.tsx`), the reviewer's submitted view and the admin's review page: in the
  line under the title, where grade and subject already show (`Grade 3 · Science · Week 3 · Day 2 · 12 slides`).
  One `detailsLabel` helper in `format.ts` builds the grade · subject · week · day part for every card and header.
- **Card meta line** (home page, editor's Presentations panel, My presentations, Admin → Presentations), and for
  Claude's drafts too (`drafts.ts` reads them from the recipe): e.g.
  `Grade 3 · Science · Week 3 · Day 2 · 12 slides`. Empty parts are left out.
- **Home search:** "Includes the words" and "Doesn't have" also look in `week` and `day`, for saved
  presentations and for Claude's drafts. Matching is "contains", so "week 1" also finds Week 10–19 (same as the
  other words searched).

## Claude (MCP import)

- `importPresentation.ts` accepts optional `week` and `day`, checked with the same zod rules.
- The presentation format guide Claude reads mentions them.

## Not included

- Week/Day pick-lists in the search options, sorting or grouping by week.

## Checking

`npx tsc --noEmit`, `npm run lint`, and the diff read against this spec. The user tests in the browser and the
migration is applied to Supabase.
