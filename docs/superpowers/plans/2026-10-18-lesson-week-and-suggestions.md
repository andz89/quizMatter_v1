# This Week's Lessons, Editor Profiles and Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a live QuizMatter presentation's view page, show the same editor's lessons for that week, a "See all <name>'s presentations" link to their profile (which now lists their QuizMatter lessons, grouped), and up to 6 "You may also like" suggestions.

**Architecture:** One migration adds four `security definer` read functions that return only presentation **ids** (plus the editor's name and profile slug for the week list), because `presentation_submissions` and other people's `saved_presentations` rows are unreadable to teachers. The app turns those ids into card rows with the existing `CARD_COLUMNS` query (the table's own read rules still apply), then renders them with the existing `PresentationCard` / `FluidSlidePreview`.

**Tech Stack:** Supabase Postgres (sql functions), Next.js server pages + client components, zod.

**Spec:** `docs/superpowers/specs/2026-10-18-lesson-week-and-suggestions-design.md`

## Global Constraints

- "Live QuizMatter presentation" = `from_admin and is_published and hidden_at is null`.
- "Editor lesson" = a live QuizMatter presentation that is the `copy_id` of a `presentation_submissions` row with `status = 'approved'`; its editor = that row's `submitter_id`. Admin-made lessons (no such row) get **no week list and no "See all"**, only suggestions.
- Week match: same editor, same `subject`, `grades && grades` (at least one in common), same `term`, same `week` (exact text); any `day`; curriculum ignored; every version listed; the viewed lesson is in the list (marked current, not a link). Needs non-empty subject, term and week, else the list holds only the viewed lesson.
- Week list order: day by `DAYS` index (own days after Day 5, empty day last), then title A–Z. Shown only when it has 2+ lessons. Heading: `This week's lessons by <editor name>`, name = display name, or the part of the email before "@" (as `submit_review`).
- "See all <display name>'s presentations": only when the editor has a profile slug the viewer may open (`profile_is_visible`, non-empty `profile_slug`); href `profileHref(slug)`.
- Suggestions: heading `You may also like`; live QuizMatter, same non-empty subject, `grades &&`, not the viewed one, not in its week list; order by save count desc, then `created_at` desc; limit 6. On every live QuizMatter presentation.
- Profile list: the slug owner's editor lessons only, limit 200; grouped by subject (`SUBJECTS` order, own subjects after A–Z, `""` last as "No subject"), then by `grades[0]` (`GRADES` order, own grade after, none last as "No grade"); inside a group: term, week, day (each by list index, own after), then title.
- Functions: `set search_path = ''`, full names, `stable`, `security definer`, `revoke execute … from public, anon`, `grant … to authenticated`; the helper `public.lesson_editor` gets no grants.
- Ids/slugs are checked with zod before each rpc (slug with the existing `profileSlugSchema` in `src/lib/profiles.ts`; ids with `z.string().min(1).max(64)`).
- Design system classes only (`rounded-card`, `bg-bg-surface`, `border-border-default`, labels `text-[11px] font-bold tracking-[0.05em] text-text-header uppercase`, day pill `rounded-dropdown bg-accent-soft px-2 py-0.5 text-[13px] font-semibold text-accent`), Lucide icons with `size`, `LinkPending` inside every `<Link>`.
- No test runner in this repo: the database is checked with SQL in `begin; … rollback;` (Supabase MCP `execute_sql`); the app with `npx tsc --noEmit`, `npm run lint` and the browser.
- Applying the migration to the live project and every commit to `main` need the user's OK each time.

## Review Focus

- A QuizMatter lesson with empty subject, term or week → no list, but "See all" still shows for an editor lesson. Task 1, check C; Task 3, step 4.
- The editor deleted their original after approval (`presentation_id` null, `copy_id` set) → the copy is still an editor lesson. Task 1, check B.
- A hidden or private lesson of the same editor/week → never in the list, the profile or suggestions. Task 1, check D.
- Two editors with the same display name → their lessons never mix (matched by `submitter_id`). Task 1, check E.
- A teacher's own published (non-QuizMatter) presentation viewed → no new sections at all, no extra queries. Task 3, step 4.

---

### Task 1: The migration

**Files:**
- Create: `supabase/migrations/20261129000000_lesson_week.sql`
- Modify: `supabase/migrations/CLAUDE.md` ("Where the big features live": one line for this file)

**Interfaces:**
- Produces:
  - `public.lesson_editor(target_id text) returns uuid` — the editor of a live QuizMatter presentation, or null (no grants).
  - `public.lesson_week(target_id text) returns table (id text, editor_name text, editor_slug text)` — every lesson of the week including `target_id` itself, each row repeating the editor's name and slug (`''` when not visible); no rows for an admin-made or non-live one.
  - `public.suggested_presentations(target_id text) returns table (id text)` — at most 6, already in order.
  - `public.editor_presentations(slug text) returns table (id text)` — at most 200, any order.

- [ ] **Step 1: Write the migration**, each part with a plain-English comment (spec link at the top):
  1. `lesson_editor`: `select s.submitter_id from public.presentation_submissions s join public.presentations p on p.id = s.copy_id where s.copy_id = target_id and s.status = 'approved' and p.from_admin and p.is_published and p.hidden_at is null`.
  2. `lesson_week`: with `t` = the target row and `e = lesson_editor(target_id)` (return nothing if null), return `t` itself plus every live QuizMatter `p` where `lesson_editor(p.id) = e` (write it as a join to approved submissions with `submitter_id = e`, not a per-row function call), `p.subject = t.subject`, `p.grades && t.grades`, `p.term = t.term`, `p.week = t.week`, and `t.subject <> '' and t.term <> '' and t.week <> ''`. `editor_name` = `coalesce(nullif(trim(st.display_name), ''), split_part(u.email, '@', 1))`; `editor_slug` = `st.profile_slug` when `public.profile_is_visible(e)` else `''` (`coalesce(…, '')`).
  3. `suggested_presentations`: only when the target is live QuizMatter with `subject <> ''`; live QuizMatter `p` with the same subject, `p.grades && t.grades`, `p.id <> target_id`, `p.id not in (select id from public.lesson_week(target_id))`; order by `(select count(*) from public.saved_presentations sv where sv.presentation_id = p.id) desc, p.created_at desc`; `limit 6`.
  4. `editor_presentations`: the `user_settings` row with `profile_slug = slug` (and `slug <> ''`) and `public.profile_is_visible(user_id)`; its approved submissions' live QuizMatter copies; `limit 200`.
  5. Revokes / grants as in Global Constraints.

- [ ] **Step 2: Ask the user to OK applying it**, then apply with Supabase MCP `apply_migration` (name `lesson_week`).

- [ ] **Step 3: Run the checks**, each `begin; … rollback;` with `execute_sql`, setting the caller with `set local role authenticated; set local request.jwt.claims = '{"sub":"<a teacher id>"}';` after inserting test rows as the owner role. Make an editor E1 (in `editors`), an editor E2 with the **same** display name, an admin A; insert QuizMatter copies owned by A with approved submissions for E1 / E2:
  - A: E1's Science / Grade 4 / Term 1 / Week 1 Day 1, Day 2, Day 2 (second version), Week 2 Day 1 → `lesson_week(day1)` returns exactly the three Week 1 ids, `editor_name` = E1's name on every row.
  - B: set E1's Day 2 submission `presentation_id = null` → still listed.
  - C: a lesson by E1 with `week = ''` → `lesson_week` returns just that lesson's row (with name and slug).
  - D: hide one Week 1 lesson (`hidden_at = now()`) and set another `is_published = false` → neither in `lesson_week`, `suggested_presentations` or `editor_presentations`.
  - E: E2's Science / Grade 4 / Term 1 / Week 1 Day 3 → not in E1's `lesson_week`; it **is** in `suggested_presentations(E1 day1)`.
  - F: an A-owned QuizMatter lesson with no submission → `lesson_week` returns no rows; `suggested_presentations` still works for it.
  - G: give E2's lesson 2 `saved_presentations` rows and another matching lesson 0 → E2's comes first.
  - H: `editor_presentations('<E1 slug>')` returns E1's live lessons only; an admin's slug as a teacher caller → no rows.

- [ ] **Step 4: Add the line to `supabase/migrations/CLAUDE.md`**, e.g. "This week's lessons and suggestions: `20261129000000_lesson_week.sql` (`lesson_week`, `suggested_presentations`, `editor_presentations`; the maker is the approved submission's editor, never the Author text)."

- [ ] **Step 5: Ask the user to OK the commit**, then commit both files ("Database: this week's lessons, suggestions and editor profile lists").

### Task 2: Reads in the app

**Files:**
- Create: `src/lib/lessons.ts`
- Modify: `src/app/(home)/cards.ts` (one new export)
- Modify: `src/lib/profiles.ts` (export `profileSlugSchema`)
- Modify: `src/lib/schema.ts` (one new export, next to `gradeOrder`)

**Interfaces:**
- Consumes: Task 1's functions.
- Produces:
  - `listOrder(list: readonly string[], value: string): number` in `schema.ts` — the value's index in the list, `list.length` for a value of the teacher's own, `list.length + 1` for `""`. Used for every day / term / week / subject / grade sort in Tasks 3 and 4 (own values tie, then sort A–Z by the caller).
  - `loadCardRows(supabase: SupabaseClient, ids: string[]): Promise<CardPresentation[]>` in `cards.ts` — `CARD_COLUMNS` rows for those ids (`.in("id", ids)`, first slide only, like `orderBy` does), **returned in the order of `ids`**, missing ones dropped; `[]` for no ids, no query.
  - In `src/lib/lessons.ts`:
    - `type LessonWeek = { editorName: string; editorSlug: string; lessonIds: string[] }`
    - `loadLessonWeek(supabase, id: string): Promise<LessonWeek | null>` — null when no rows (admin-made / not live) or the call fails.
    - `loadSuggestionIds(supabase, id: string): Promise<string[]>` — `[]` on failure.
    - `loadEditorPresentationIds(supabase, slug: string): Promise<string[]>` — `[]` on failure or a slug `profileSlugSchema` rejects (lowercase it first, as `loadTeacherProfile` does).
  - Each checks its input with zod first and never throws (the page opens without that part).

- [ ] **Step 1: Write the three loaders and `loadCardRows`**, with a short header comment in `lessons.ts` pointing at the migration.
- [ ] **Step 2: Run `npx tsc --noEmit` and `npx eslint src/lib/lessons.ts src/lib/profiles.ts "src/app/(home)/cards.ts"`.** Expected: no errors.
- [ ] **Step 3: Ask the user to OK the commit**, then commit ("Reads for this week's lessons and suggestions").

### Task 3: The view page

**Files:**
- Create: `src/app/presentation/[id]/LessonWeek.tsx`
- Create: `src/app/presentation/[id]/Suggestions.tsx`
- Modify: `src/app/presentation/[id]/page.tsx`
- Modify: `src/app/presentation/[id]/PresentationPreview.tsx` (two new props, rendered in place)
- Modify: `src/app/CLAUDE.md` ("A presentation's pages" section)

**Interfaces:**
- Consumes: Task 2's loaders, `loadCardRows`, `toCard`.
- Produces:
  - `LessonWeek({ week, currentId }: { week: { editorName: string; editorSlug: string; lessons: CardPresentation[] }; currentId: string })` — the card with the heading, rows (`FluidSlidePreview` thumbnail ~64px wide, title, day pill; the current row says "You're here" in `text-text-secondary` instead of being a link) and, when `editorSlug`, the secondary-button link "See all <editorName>'s presentations" (`UsersIcon` or `ArrowRightIcon`, size 16). Rows are shown only when there are 2+ lessons; the link shows alone otherwise.
  - `Suggestions({ cards }: { cards: PresentationCardData[] })` — heading "You may also like", a grid `grid grid-cols-2 gap-4 sm:grid-cols-3` of `PresentationCard`; nothing when empty.
  - `PresentationPreview` new props: `lessonWeek: { editorName: string; editorSlug: string; lessons: CardPresentation[] } | null` (rendered between `</header>` and the details `<dl>`), `suggestions: PresentationCardData[]` (rendered after the `<dl>`, inside the section).

- [ ] **Step 1: In `page.tsx`**, when `result.presentation.fromAdmin && result.presentation.isPublished`, load `loadLessonWeek` and `loadSuggestionIds` in parallel, then `loadCardRows` for the week ids and the suggestion ids in parallel; sort the week rows by `listOrder(DAYS, row.day)`, then day text, then title; map suggestions with `toCard(row, \`/presentation/${row.id}\`, Date.now())`. Otherwise pass `null` / `[]` with no queries.
- [ ] **Step 2: Write `LessonWeek.tsx` and `Suggestions.tsx`**, client components, design-system classes from Global Constraints.
- [ ] **Step 3: Pass the props through `PresentationPreview`.**
- [ ] **Step 4: Check in the browser** (`npm run dev`, logged in as a teacher): E1's Week 1 Day 1 shows the list with both Day 2 versions and "You're here" on Day 1, the "See all" link opens E1's profile; an E1 lesson with no week shows only the link; an admin-made QuizMatter lesson shows no list and no link but shows suggestions; a teacher's own published presentation shows none of it; the page still opens when the functions error (rename one call temporarily, then undo).
- [ ] **Step 5: Notes:** in `src/app/CLAUDE.md` under "A presentation's pages", a short paragraph: what the week list, link and suggestions show, that they're only on live QuizMatter presentations, the maker rule (approved submission's editor, never the Author text; admin-made = suggestions only), and the files.
- [ ] **Step 6: Run `npx tsc --noEmit` and `npm run lint`.** Expected: no errors in the changed files.
- [ ] **Step 7: Ask the user to OK the commit**, then commit ("View page: this week's lessons and suggestions").

### Task 4: The profile page lists the editor's lessons

**Files:**
- Modify: `src/app/teachers/[slug]/page.tsx`
- Modify: `src/app/CLAUDE.md` ("Account, profiles…": the `teachers/[slug]/` line)
- Modify: `CLAUDE.md` (code map line for `teachers/[slug]/` if its description changes)

**Interfaces:**
- Consumes: `loadEditorPresentationIds`, `loadCardRows`, `toCard`, `PresentationCard`.

- [ ] **Step 1: Load and group** in the page (server): ids → rows → groups by subject, then `grades[0]`, sorted as in Global Constraints (a local `groupLessons(rows: CardPresentation[]): { subject: string; grades: { grade: string; rows: CardPresentation[] }[] }[]`).
- [ ] **Step 2: Render** below the profile `<article>`, only when there are lessons: an `h2` "QuizMatter presentations", then per subject a label-style heading ("Science", or "No subject"), per grade a smaller secondary line ("Grade 4", or "No grade"), and a `grid grid-cols-2 gap-4 sm:grid-cols-3` of `PresentationCard` (`toCard(row, \`/presentation/${row.id}\`, now)`). Widen `main` from `max-w-2xl` to `max-w-4xl` so three cards fit, keeping the profile card at `max-w-2xl`.
- [ ] **Step 3: Check in the browser:** E1's profile shows their live lessons grouped (a two-grade lesson appears once, under its first grade); a teacher with no editor lessons shows the profile only.
- [ ] **Step 4: Notes:** update the `teachers/[slug]/` line in `src/app/CLAUDE.md` (and the root map if needed).
- [ ] **Step 5: Run `npx tsc --noEmit` and `npm run lint`.** Expected: no errors in the changed files.
- [ ] **Step 6: Ask the user to OK the commit**, then commit ("Profiles: an editor's QuizMatter presentations, grouped").

### Final check

- [ ] Read `git diff` of the whole feature next to the spec: every section done, nothing extra, notes true, design system, `LinkPending` on links, the one Spinner (none new needed: `src/app/presentation/loading.tsx` and `src/app/teachers/[slug]/loading.tsx` already show the top line and Spinner).
- [ ] Tell the user what was checked and what passed or failed.
