# Presentation Term Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional Term detail (None, Term 1–3, Other…) to presentations, reaching everywhere Week does.

**Architecture:** A copy of the Week/Day work: a `term` text column (+ the three SQL functions that save, publish
and check presentations, + the `search_text` generated column), a `termSchema` in `schema.ts`, a
`ListOrOtherField` in the Details panel, `term` in `detailsLabel`, the home search filter, and Claude's import.

**Tech Stack:** Next.js, Supabase (Postgres), zod, Cloudflare D1 (Claude's drafts).

**Spec:** `docs/superpowers/specs/2026-10-12-presentation-term-design.md`

## Global Constraints

- List: `Term 1`, `Term 2`, `Term 3`. Max length 40 (`DETAIL_MAX_LENGTH.term`), same in the database check.
- `""` = None. Term sits before Week everywhere (panel, `detailsLabel`, search form, select lists).
- zod before saving (`presentationSchema` covers editor, review drafts, Claude's import). No new packages. Design
  system classes only (the existing `ListOrOtherField` / `SearchSelect` already use them).
- No test runner in this repo: checks are `npx tsc --noEmit`, `npm run lint`, and a one-off scratchpad script.

## Review Focus

1. A tab opened before this change saves without `term` → saved as `""`, not an error (`coalesce` in SQL, `.default("")` in zod). Task 1 + Task 2.
2. A review draft saved before this change is published → term `""`, not null (`coalesce(d ->> 'term', '')`). Task 1.
3. Typing "term 2" in Other… → saved as "Term 2" and the select shows Term 2, not Other…. Task 2 (scratch check).
4. A Claude draft without term → card meta and search don't show "null". Task 4 (`coalesce(..., '')` in the D1 query).
5. Home search for a word that only appears in the term (e.g. "Term 3") finds the presentation → `search_text` rebuilt with `term`. Task 1.

---

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20261118000000_presentation_term.sql`

**Interfaces:**
- Produces: column `presentations.term` (text, `''` = none); `save_presentation` reads `presentation ->> 'term'`;
  `publish_review` copies `d ->> 'term'`; `search_text` includes `term`.

- [ ] **Step 1: Write the migration.** Header + column:

```sql
-- Term: an optional presentation detail ("Term 1", the teacher's own text, or '' for none), picked in the
-- Presentation details panel. Same as TERMS and DETAIL_MAX_LENGTH in src/lib/schema.ts.

alter table public.presentations
  add column term text not null default '';

alter table public.presentations
  add constraint presentations_term_length check (char_length(term) <= 40);
```

Then full copies of `save_presentation`, `publish_review` and `check_review_draft` from
`supabase/migrations/20261116000000_presentation_week_day.sql`, section comments saying
"same as before (20261116000000_presentation_week_day.sql), plus term", with only these changes:

```sql
-- save_presentation
--   insert column list:  ..., subject, term, week, day, curriculum, ...
--   values, before week: -- An app tab opened before Term existed sends none: keep it empty.
--                        coalesce(presentation ->> 'term', ''),
--   on conflict set:     term = excluded.term,   (before week = excluded.week)
-- publish_review
--   update set:          -- A draft saved before Term existed has none: keep it empty.
--                        term = coalesce(d ->> 'term', ''),   (before week)
-- check_review_draft
--   in the length check: and char_length(coalesce(review_draft ->> 'term', '')) <= 40   (before the week line)
```

Then the search line (from `20261117000000_presentation_search_text.sql`):

```sql
-- ─── search_text: same as before (20261117000000_presentation_search_text.sql), plus term ─────────────────
-- A generated column's formula can't be changed, so it is dropped (its index goes with it) and added again.
alter table public.presentations drop column search_text;

alter table public.presentations
  add column search_text text generated always as (
    coalesce(title, '') || ' ' || coalesce(subject, '') || ' ' || coalesce(term, '') || ' ' || coalesce(week, '') || ' '
      || coalesce(day, '') || ' ' || coalesce(curriculum, '') || ' ' || coalesce(learning_competency, '') || ' '
      || coalesce(author, '') || ' ' || public.tags_text(tags)
  ) stored;

create index presentations_search_text_trgm_idx on public.presentations using gin (search_text extensions.gin_trgm_ops);
```

- [ ] **Step 2: Check the copies match.** Extract each function body from the new file and from
`20261116000000_presentation_week_day.sql` into the scratchpad and `git diff --no-index` them; the only
differences must be the term lines and the section comments. Also grep the repo for other users of `search_text`
(views/functions) — if any exist, they must be re-created too (none expected; only `cards.ts` queries it).

- [ ] **Step 3: Commit** `git add supabase/migrations/20261118000000_presentation_term.sql` →
`Presentation term: database column, save/publish/check functions, search text`.

The user applies the migration to Supabase.

### Task 2: Schema, factories, fetch, label

**Files:**
- Modify: `src/lib/schema.ts` (DETAIL_MAX_LENGTH ~451, lists ~475, isOther ~488, schemas ~503, presentationSchema ~585, PresentationDetails ~700)
- Modify: `src/lib/factories.ts:76`, `src/lib/fetchPresentation.ts:70,85`, `src/lib/format.ts:8-11`

**Interfaces:**
- Produces: `TERMS` (string array), `isOtherTerm(term: string): boolean`, `termSchema`, `Presentation.term: string`,
  `detailsLabel(d: { grades: readonly string[]; subject: string; term?: string; week?: string; day?: string }): string`.

- [ ] **Step 1: schema.ts.**

```ts
// in DETAIL_MAX_LENGTH, before week:
  term: 40,
// before WEEKS (and the comment above becomes "The school terms, weeks and days a teacher picks from…"):
export const TERMS = Array.from({ length: 3 }, (_, i) => `Term ${i + 1}`);
// before isOtherWeek:
export const isOtherTerm = (term: string) => isOwnChoice(TERMS, term);
// before weekSchema:
export const termSchema = listOrOwnSchema(TERMS, DETAIL_MAX_LENGTH.term);
// in presentationSchema, before week (comment becomes "The school term, week and day it's for, e.g. "Term 1", "Week 3", "Day 2"…"):
  term: termSchema.default(""),
// in PresentationDetails, before | "week":
  | "term"
```

- [ ] **Step 2: factories.ts** — `term: "",` before `week: "",`.

- [ ] **Step 3: fetchPresentation.ts** — select `subject, term, week, day`; parse `term: data.term,` before `week`.

- [ ] **Step 4: format.ts.**

```ts
/** "Grade 4 · Mathematics · Term 1 · Week 3 · Day 2": a presentation's grades, subject, term, week and day, skipping empty ones. */
export function detailsLabel({ grades, subject, term, week, day }: { grades: readonly string[]; subject: string; term?: string; week?: string; day?: string }): string {
  return joinParts([gradesLabel(grades), subject, term, week, day]);
}
```

- [ ] **Step 5: Scratch check (Review Focus 1, 3).** In the scratchpad, a script run with `npx tsx` from the repo:

```ts
import { termSchema } from "./src/lib/schema";
console.log(termSchema.parse("term 2"), "|", termSchema.parse(" Summer term "), "|", termSchema.safeParse("x".repeat(41)).success);
// Expected: Term 2 | Summer term | false
```

Plus `presentationSchema.parse` on a factory presentation with `term` deleted → `term === ""`. Delete the script after.

- [ ] **Step 6:** `npx tsc --noEmit` (fix any place the new required `term` is missing), `npm run lint`. Commit:
`Presentation term: zod schema, factory, fetch, details label`.

### Task 3: Details panel

**Files:**
- Modify: `src/components/editor/DetailsPanel.tsx` (imports, top comment, before the Week field)

**Interfaces:**
- Consumes: `TERMS`, `DETAIL_MAX_LENGTH.term`, `presentation.term` (Task 2).

- [ ] **Step 1:** Import `TERMS`. Top comment lists "subject, term, week, day". Before the Week field:

```tsx
      <ListOrOtherField
        label="Term"
        list={TERMS}
        value={presentation.term}
        onChange={(term) => setPresentationDetails({ term })}
        maxLength={DETAIL_MAX_LENGTH.term}
        placeholder="Type the term, e.g. Summer term"
        canPickNone
      />
```

`ListOrOtherField`'s comment: "The subject (or term, week, day)". `textField`'s key type: exclude `"term"` only if tsc asks.

- [ ] **Step 2:** `npx tsc --noEmit`, `npm run lint`. Commit `Presentation term: Details panel field`.

### Task 4: Cards, lists and Claude's drafts

**Files:** (each adds `term` to the select after `subject` and `term: string;` before `week: string;` in its row type;
`detailsLabel` picks it up)
- Modify: `src/app/(home)/cards.ts:14,22`
- Modify: `src/app/presentations/page.tsx:19,68`
- Modify: `src/app/admin/presentations/page.tsx:27,100`
- Modify: `src/components/editor/PresentationsPanel.tsx:25,441`
- Modify: `src/lib/drafts.ts:76,95`

- [ ] **Step 1:** The four selects/types above.

- [ ] **Step 2: drafts.ts (Review Focus 4).** `DraftSummary` gets `term: string;` before `week`. Query line:

```sql
         coalesce(json_extract(recipe, '$.details.term'), '') AS term, coalesce(json_extract(recipe, '$.details.week'), '') AS week, coalesce(json_extract(recipe, '$.details.day'), '') AS day,
```

- [ ] **Step 3:** `npx tsc --noEmit`, `npm run lint`. Commit `Presentation term: show on cards and lists`.

### Task 5: Home search

**Files:**
- Modify: `src/app/homeSearch.ts` (import, comments at 41/49, schema)
- Modify: `src/app/(home)/cards.ts` (import, `applySearch`, `draftMatches`)
- Modify: `src/app/(home)/HomeSearchForm.tsx` (import, before the Week field)

**Interfaces:**
- Consumes: `TERMS`, `isOtherTerm` (Task 2), `DraftSummary.term` (Task 4).
- Produces: `HomeSearch.term: string` (`""`, a list term, or `"Other"`).

- [ ] **Step 1: homeSearch.ts.** Import `TERMS`. Comments: "title, subject, term, week, day, …". Schema:

```ts
  // A list term, week or day, or "Other" for every one not on the list.
  term: listChoice(TERMS),
  week: listChoice(WEEKS),
```

- [ ] **Step 2: cards.ts.** Import `TERMS`, `isOtherTerm`. In `applySearch`, before the week lines:

```ts
  if (search.term === OTHER_CHOICE) query = query.neq("term", "").not("term", "in", inList(TERMS)) as Q;
  else if (search.term) query = query.eq("term", search.term) as Q;
```

In `draftMatches`: `details` = `` `${draft.title} ${draft.subject} ${draft.term} ${draft.week} ${draft.day} …` ``, and before the week line:

```ts
    (search.term === OTHER_CHOICE ? isOtherTerm(draft.term) : !search.term || draft.term === search.term) &&
```

- [ ] **Step 3: HomeSearchForm.tsx.** Import `TERMS`. Before the Week field:

```tsx
      <SearchField label="Term">
        <SearchSelect
          value={values.term}
          options={[
            { id: "", label: "Any term" },
            ...TERMS.map((term) => ({ id: term, label: term })),
            { id: OTHER_CHOICE, label: OTHER_CHOICE },
          ]}
          onChange={(term) => set({ term })}
        />
      </SearchField>
```

- [ ] **Step 4:** `npx tsc --noEmit`, `npm run lint`. Commit `Presentation term: home search filter and words`.

### Task 6: Claude's import

**Files:**
- Modify: `src/lib/importPresentation.ts` (import, `claudeDetailsSchema` ~569, guide sentence ~660)

- [ ] **Step 1:** Import `termSchema`. Before `week`:

```ts
  term: termSchema
    .optional()
    .describe(`The school term it's for: "Term 1" to "Term 3", or its own name. Only if the user or their document names one.`),
```

Guide sentence: "…(and author, reference links, term, week or day only when the user, or a document or link they gave you, names them)."

- [ ] **Step 2:** `npx tsc --noEmit`, `npm run lint`. Commit `Presentation term: Claude can set it`.

### Task 7: Final check

- [ ] `git diff 2b128cf..HEAD` read against the spec: every section done, nothing extra, CLAUDE.md rules kept.
- [ ] Tell the user: apply the migration to Supabase, reconnect the claude.ai connector (new MCP field), test in the browser.
