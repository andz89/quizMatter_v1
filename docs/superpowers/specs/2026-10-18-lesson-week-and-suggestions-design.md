# This week's lessons, maker profiles and suggestions — design

Date: 2026-10-18

## Why

An editor submits *Science, Grade 4, Term 1, Week 1, Day 1*, and the next day submits Day 2. They wanted to edit the
Day 1 description after approval to add "the next lesson is this link". Typing links by hand is extra work, goes stale
when a lesson is deleted or replaced, and only helps the lessons whose editor remembered. Every presentation already
has Subject, Grade, Term, Week and Day, so the app can find a lesson's week by itself.

So instead of editing descriptions, the view page of a QuizMatter presentation gets:

1. **This week's lessons by the same maker**, above the description.
2. A **"See all <name>'s presentations"** button that opens the maker's profile, which now lists their QuizMatter
   presentations, grouped.
3. **Suggestions**: thumbnails of other makers' QuizMatter presentations at the bottom.

## Goals

- A teacher on Ana's Science 4, Term 1, Week 1, Day 1 sees all of Ana's lessons for that week and can open any of them.
- Lessons are matched by **the maker's account id**, never by the Author text (two people can share a name; the Author
  text can be anything).
- Every version shows: if Ana has two Day 3 lessons, both are listed.
- No one has to do anything by hand. A newly approved lesson appears in the list by itself.

## Non-goals

- No Previous / Next lesson buttons (an earlier idea, dropped by the user).
- No editing of the description after approval (the original request, replaced by this feature).
- No ordering or linking of lessons by hand.
- Locking the editor's Author field to their own name: a separate change, later.
- Teachers' own (non-QuizMatter) published presentations are not part of the week list, the profile list or the
  suggestions.

## Anti-goals

- Never mix two makers' lessons in the week list, even when the names match.
- Never show a hidden, private or unpublished presentation in any of the three parts.
- Never show a hidden admin's profile link or name to a teacher (admins' profiles stay hidden, as today:
  `profile_is_visible`).
- Never group admin-made lessons into a week list (they have no reliable maker; see below).

## Who is the "maker" (editor lessons only)

The week list, the "See all" button and the profile list are **only for lessons an editor made**: a live QuizMatter
presentation (`from_admin`, `is_published`, `hidden_at is null`) that is the `copy_id` of an approved
`presentation_submissions` row. Its maker is that row's `submitter_id`, the editor. (The copy itself is owned by the
approving admin, so the owner is *not* the maker.)

**Lessons an admin made** (in the editor, or through Claude; no submission row) get **no week list and no "See all"
button**, only the suggestions. The user chose this to keep it simple: an admin can type any Author on their lessons
("Ana" on some, "Ben" on others), so grouping them by the admin's account would mix authors, and grouping by Author
text was judged not worth it.

If the editor's account is deleted, their submission rows go with it, so their lessons become like admin-made ones:
no week list, suggestions only.

`presentation_submissions` has no read rules for teachers, so the maker must be worked out inside `security definer`
database functions, never by the app reading that table.

## 1. This week's lessons

**Where:** the view page (`src/app/presentation/[id]/PresentationPreview.tsx`), between the header (title, details,
Author / Reviewer lines) and the details card (Description, …). Only on live QuizMatter presentations an editor made
(see above).

**Which lessons:** live QuizMatter presentations an editor made, with:

- the **same maker** (the same editor account),
- the **same subject**,
- **at least one grade in common** (a lesson can have several grades),
- the **same term** and the **same week** (exact text match, so a teacher's own "Other" values match each other too),
- **any day** of that week. **Curriculum doesn't matter.**

The list includes the lesson being viewed, marked as the current one (not a link). It's sorted by day in `DAYS` list
order (Day 1 … Day 5; a day of the teacher's own after them), then by title.

**When it shows:** only if the presentation has a subject, a term and a week, and the list holds at least one other
lesson. Otherwise the section isn't there at all.

**Each row:** a small first-slide thumbnail, the title, and a pill with the day (e.g. "Day 2"). The row opens that
presentation's view page (with `LinkPending`).

**Heading:** "This week's lessons by <name>". My call (from the builder check): the name comes from the **editor's
account** (display name, or the part of the email before "@", like `submit_review`), not from the Author text, so the
heading and the "See all" button always name the same person, whatever Author was typed.

## 2. "See all <name>'s presentations"

On editor lessons, under the week list (or in its place, if the list isn't shown), a secondary button "See all
<name>'s presentations" opens `/teachers/<slug>`.

- It shows only if the editor has a profile the viewer may open (`visible_profiles`: has a display name).
- `<name>` is the editor's display name from their profile.

## 3. The profile page lists the editor's presentations

`src/app/teachers/[slug]/page.tsx` today shows the name, education and bio. Below that card it gets the person's live
QuizMatter presentations that they made as an editor (approved submissions, as defined above), as the usual
presentation cards (`PresentationCard`, first-slide thumbnails), each opening its view page. Admin-made lessons are
never listed on anyone's profile (my call, following the user's "admin lessons get no list").

- **Grouped by subject, then by grade** (my call; the user didn't pick). Subjects in `SUBJECTS` order (own subjects
  after, then "No subject"); inside each, grades in `GRADES` order. A lesson with several grades appears under its
  first grade only, so it isn't repeated.
- Inside a group: term, week, day order, then title.
- No section if the person has none.

## 4. Suggestions

At the bottom of the view page of **every** live QuizMatter presentation (editor-made and admin-made): "You may also
like", up to 6 presentation cards.

- Live QuizMatter presentations (editor-made or admin-made) with the **same subject** and **at least one grade in
  common**.
- Not the presentation being viewed, and not any lesson already in this page's week list (my call: simpler than
  "other makers", and it works the same on admin-made lessons, which have no list).
- **Most saved first** (number of `saved_presentations` rows), then newest. Teachers can only read their own saved
  rows, so the count must come from a `security definer` function that returns only the count, never who saved.
- No section if there are none.

## Database (one migration)

- A helper that gives a live QuizMatter presentation's editor (the approved submission's `submitter_id` by `copy_id`),
  or nothing for an admin-made one.
- `lesson_week(target_id)`: the week list for an editor-made live QuizMatter presentation, checked as above, plus the
  editor's name and profile slug (if visible). No rows for an admin-made one. Returns the rows the list needs (id,
  title, day, first slide data), never anyone's email or the submission rows.
- `maker_presentations(slug)`: the profile list (editor-made only). Respects `profile_is_visible`.
- `suggested_presentations(target_id)`: the suggestions, with the save count used only for sorting.
- All `security definer`, `set search_path = ''`, execute only for `authenticated`, as the other read functions.
- These are reads only, so no zod-before-saving step. The inputs (ids, slug) are checked with zod in the app before
  the call, like `loadTeacherProfile` does with the slug.

## App

- Reads in a new `src/lib/lessons.ts` (or next to `profiles.ts` for the profile list — builder's call), mapping rows
  to the existing `PresentationCardData` where cards are used.
- `fetchPresentation` (or the view page) loads the week list, maker profile link and suggestions in parallel with the
  rest; if one fails, the page opens without that part.
- Design system as usual: white cards on Paper, `rounded-card`, uppercase `text-text-header` labels, the day pill as
  `bg-accent-soft text-accent` (like tags), Lucide icons only, `LinkPending` on every link, the one Spinner / top
  line, a `loading.tsx` is already on these pages.
- Notes: a section in `src/app/CLAUDE.md` (view page and profiles), the database functions in
  `supabase/migrations/CLAUDE.md`, and the map line in the root `CLAUDE.md` if a new file is added.

## Left to the builder

- Exact markup and spacing, within the design system and the mockup (list rows with a thumbnail and a day pill).
- Whether the week list and suggestions load in `fetchPresentation` or a separate call from the page.
- Whether the profile list paginates (my call: no, a maker won't have hundreds of live lessons; cap at a sensible
  number like 200).
