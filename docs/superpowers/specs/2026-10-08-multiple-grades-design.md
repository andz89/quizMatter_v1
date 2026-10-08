# Several grades per presentation

## Goal

A presentation can be for more than one grade (e.g. Grade 1 and Grade 2). Subject stays a single choice.

## Decisions

- **Storage:** `presentations.grade` (text) becomes `grades` (text[]), converted in place: a grade becomes a
  one-item list, none becomes `{}`. At most 14 (the 13 list grades + one of the teacher's own). Changing the
  column's type doesn't fire the review lock triggers, so presentations under review convert too.
- **zod (`gradesSchema`):** a list of list-or-own grades (each trimmed, list spelling fixed), no repeats, at most
  14, at most one grade not on the list. Older data with a single `grade` (review drafts, Claude's drafts, an editor
  tab opened before the change) is read as a one-item list. Claude sends `grades`.
- **Details panel:** a dropdown with checkboxes ("None" until something is ticked): Kindergarten … Grade 12, then
  "Other…", which shows a box for the teacher's own grade.
- **Display (`gradesLabel`):** list grades in list order, neighbors joined: "Grades 1–3", "Kindergarten–Grade 2",
  "Grades 1–2, 5"; an own grade comes last ("Grade 4, College"). Used wherever grade is shown.
- **Home search:** a grade finds presentations that include it; "Other" finds those with an own grade.
- **Browse:** a presentation counts in every grade row it has.

## Database (`supabase/migrations/20261031000000_multiple_grades.sql`)

- Convert the column; a check for at most 14.
- `save_presentation`: writes `grades` (from `grades`, or an old tab's `grade`).
- `publish_review`: same, for older review drafts that have `grade`.
- `browse_counts`: unnests `grades`.

## Checking

`npx tsc --noEmit`, lint on the changed files, and reading the diff against this spec. Live testing is left to the
user.
