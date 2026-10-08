# Fixed subject list + subject chips (Part 1 of presentation categories)

Part 1 of 4 (then: group by subject, Grade × Subject browse page, teacher folders). Admin collections were built and then removed.

## Goal

Teachers pick a presentation's subject from the DepEd K–12 list instead of typing it, so subjects are spelled
the same everywhere. The home page shows subject chips above the cards, so a teacher can filter a tab by subject
with one click.

## Decisions

- **Subjects** (`SUBJECTS` in `src/lib/schema.ts`, next to `GRADES`): Mathematics, Science, English, Filipino,
  Araling Panlipunan, Edukasyon sa Pagpapakatao (ESP/GMRC), MAPEH, EPP/TLE, Mother Tongue. Plus **Other**, where
  the teacher types their own subject.
- **Storage:** the existing `presentations.subject` text column, unchanged. It holds a list name or the teacher's
  own text. "Other" means any subject that isn't empty and isn't on the list (`isOtherSubject`). No migration: the
  13 existing presentations already use list names or nothing.
- **Zod tidies the subject before saving:** `subjectSchema` trims it, keeps the 80-character limit, and turns a
  list name typed in another case ("science") into the list's spelling ("Science"). Used by `presentationSchema`
  (editor and review saves) and `claudeDetailsSchema` (Claude).
- **Chips are in every tab**, above the cards: "All", then each list subject that has cards, then "Other", each
  with its count. Chips with 0 cards are hidden (except the picked one). Presentations with no subject show only
  under "All". The chip filters the cards the tab already has (no new database query). Changing tab or search
  goes back to "All". In My reviews, chips filter the Published cards only.

## Changes

1. `src/lib/schema.ts`: `SUBJECTS`, `OTHER_SUBJECT = "Other"`, `isOtherSubject(subject)`, `subjectSchema`;
   `presentationSchema.subject` uses `subjectSchema`.
2. `src/lib/importPresentation.ts`: Claude's `subject` uses `subjectSchema`; its description lists the subjects
   and says to use its own subject only when none fit.
3. `src/components/editor/DetailsPanel.tsx`: Subject becomes a select ("Not set", the 9 subjects, "Other…").
   "Other…" shows a text box under it. A subject not on the list opens as "Other…" with its text filled in.
4. `src/app/homeSearch.ts`: the search's `subject` is "" / a list subject / "Other" (old free-text links fall
   back to "").
5. `src/app/page.tsx`: the Subject search is an exact match, or for "Other" "not empty and not on the list";
   `draftMatches` does the same for Claude's drafts. Cards carry their `subject`.
6. `src/app/PresentationCard.tsx`: `PresentationCardData` gets an optional `subject`.
7. `src/app/PresentationHome.tsx`: the search form's Subject becomes a select; a `SubjectChips` row under the
   tabs filters the picked tab's cards.

## Part 2: group by subject in "From QuizMatter"

When the "All" chip is picked and nobody is searching, "From QuizMatter" shows its cards in groups (`SubjectGroups`
in `PresentationHome.tsx`): a heading like "Mathematics · 3", then one row of up to 5 cards (`MY_ROW_SIZE`). A
group with more gets "See all (N)", which picks that subject's chip (the full grid). Order: the list, then
"Other", then "No subject" (all its cards, since it has no chip). The Last changed / Newest sort applies inside
each group. While searching, or with a chip picked, the tab is the plain grid. Uses the cards already loaded: no
new query.

## Part 3: Browse page (grade × subject grid)

`/browse` (`src/app/browse/page.tsx` + `loading.tsx`), linked as "Browse" in the home page's top bar. Grades
down the side, the subjects and "Other" across the top; each square shows how many shared presentations (From
QuizMatter and other teachers' published ones, not the teacher's own) have that grade and subject, or "–". A
square opens the home search for that grade and subject; a grade or subject heading searches by that one alone.
Presentations without a grade or subject aren't counted.

The counts come from `browse_counts()` (`supabase/migrations/20261027000000_browse_counts.sql`): it groups in the
database and returns only the numbers, so the page stays light, and Supabase's 1,000-row cap never cuts it short.
Security invoker, so the teacher's own read rules apply. The page checks its answer with zod.

## Later change: Grade works like Subject, no "Not set"

- Grade and Subject share one box in the Details panel (`ListOrOtherField`): the list, then "Other…" with a box
  to type your own. No "Not set": a new presentation shows "None" until one is picked ("None" isn't in the list).
- `GRADES` lost "N/A"; `gradeSchema` (up to 40 characters, list spelling fixed) replaces the fixed grade list, and
  `OTHER_CHOICE` ("Other") is shared by grades and subjects. Claude's notes list the grades the same way.
- Home search's Grade filter and the Browse page get "Other" (every grade not on the list).
- `20261030000000_grade_other.sql`: the one presentation with "N/A" got no grade (already run on the database).

## Checking

`npx tsc --noEmit`, `npm run lint`, and reading the diff against this spec. Live testing in the browser is left
to the user.
