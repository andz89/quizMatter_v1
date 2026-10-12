# Presentation Week and Day Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional Week (Week 1–20 / Other… / None) and Day (Day 1–5 / Other… / None) details to presentations.

**Architecture:** Two new text columns on `presentations`, stored like `subject` ("Week 3", the teacher's own text, or `""`). zod (`listOrOwnSchema`) checks them before every save; the database functions that save or copy details get them too. The Details panel reuses `ListOrOtherField`; cards, preview headers, search and Claude's import pick them up.

**Tech Stack:** Next.js (App Router), Supabase (Postgres + plpgsql), zod, Cloudflare D1 (Claude's drafts).

**Spec:** `docs/superpowers/specs/2026-10-12-presentation-week-day-design.md`

## Global Constraints

- Values: `"Week 1"` … `"Week 20"`, `"Day 1"` … `"Day 5"`, the teacher's own text, or `""` (None).
- Max length 40 for each (`DETAIL_MAX_LENGTH.week` / `.day`), same in the database check.
- zod parses before saving (CLAUDE.md "Saving Data"). Design system classes only; Lucide icons only.
- No test runner in this repo: each task is checked with `npx tsc --noEmit` and `npm run lint`. Live testing is the user's.
- No new packages.

## Review Focus

1. A tab opened before this change saves without `week`/`day` → saved as `""`, not an error (`coalesce` in SQL; `.default("")` in zod). Task 1 + Task 2.
2. A review draft saved before this change is published → Week/Day become `""`, publish still works. Task 1 (`coalesce` in `publish_review`).
3. Typing "week 3" in Other… → saved as "Week 3" and the select shows Week 3, not Other…. Task 2 (`listOrOwnSchema`).
4. Picking None after Week 3 → field clears and the select shows None. Task 3 (`canPickNone`).
5. A Claude draft without week/day → card meta and search don't show "null". Task 5 (`coalesce(..., '')` in the D1 query).

---

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20261116000000_presentation_week_day.sql`

**Interfaces:**
- Produces: columns `presentations.week`, `presentations.day` (text, `''` = none); `save_presentation` reads `presentation ->> 'week'` / `'day'`; `publish_review` copies `d ->> 'week'` / `'day'`.

- [ ] **Step 1: Write the migration.** It is a full copy of the newest `save_presentation` (`20261103000000_share_limits.sql`, section 4), `publish_review` (`20261102000000_review_auto_reviewer.sql`, section 3) and `check_review_draft` (`20261022000000_review_fixes.sql`), each with only the week/day lines added:

```sql
-- Week and Day: two optional presentation details ("Week 3", "Day 2", the teacher's own text, or '' for none),
-- picked in the Presentation details panel. Same as WEEKS, DAYS and DETAIL_MAX_LENGTH in src/lib/schema.ts.

alter table public.presentations
  add column week text not null default '',
  add column day text not null default '';

alter table public.presentations
  add constraint presentations_week_length check (char_length(week) <= 40),
  add constraint presentations_day_length check (char_length(day) <= 40);

-- save_presentation: same as before (20261103000000_share_limits.sql), plus week and day.
create or replace function public.save_presentation(...)  -- full body copied, with:
--   insert column list:  ..., subject, week, day, curriculum, ...
--   values:              presentation ->> 'subject',
--                        -- An app tab opened before Week and Day existed sends none: keep them empty.
--                        coalesce(presentation ->> 'week', ''),
--                        coalesce(presentation ->> 'day', ''),
--   on conflict set:     week = excluded.week, day = excluded.day,

-- publish_review: same as before (20261102000000_review_auto_reviewer.sql), plus week and day.
--   update set:          week = coalesce(d ->> 'week', ''), day = coalesce(d ->> 'day', ''),

-- check_review_draft: same as before (20261022000000_review_fixes.sql), plus week and day.
--   in the length check: and char_length(coalesce(review_draft ->> 'week', '')) <= 40
--                        and char_length(coalesce(review_draft ->> 'day', '')) <= 40
```

(The executor writes every function body out in full; the comments above mark the only changed lines.)

- [ ] **Step 2: Check the copies match.** `git diff --no-index` each function body against its source migration; the only differences must be the week/day lines.

- [ ] **Step 3: Commit.**

```bash
git add supabase/migrations/20261116000000_presentation_week_day.sql
git commit -m "Week and Day columns on presentations"
```

### Task 2: Schema, defaults, loading

**Files:**
- Modify: `src/lib/schema.ts` (lists after `SUBJECTS`; `DETAIL_MAX_LENGTH`; `presentationSchema`; `PresentationDetails`)
- Modify: `src/lib/factories.ts` (`createBlankPresentation`)
- Modify: `src/lib/fetchPresentation.ts` (`loadPresentation`)
- Modify: `src/lib/format.ts` (new `detailsLabel`)

**Interfaces:**
- Produces: `WEEKS`, `DAYS` (readonly string tuples), `weekSchema`, `daySchema`, `Presentation.week: string`, `Presentation.day: string`, `detailsLabel(d: { grades: readonly string[]; subject: string; week?: string; day?: string }): string`.

- [ ] **Step 1: schema.ts.**

```ts
// The school weeks and days a teacher picks from. A presentation may also have its own ("Other").
export const WEEKS = Array.from({ length: 20 }, (_, i) => `Week ${i + 1}`);
export const DAYS = Array.from({ length: 5 }, (_, i) => `Day ${i + 1}`);
```

`DETAIL_MAX_LENGTH` gets `week: 40, day: 40`. After `subjectSchema`:

```ts
export const weekSchema = listOrOwnSchema(WEEKS, DETAIL_MAX_LENGTH.week);
export const daySchema = listOrOwnSchema(DAYS, DETAIL_MAX_LENGTH.day);
```

In `presentationSchema`, after `subject`:

```ts
  // The school week and day it's for, e.g. "Week 3", "Day 2" ("" = none). Older data has none.
  week: weekSchema.default(""),
  day: daySchema.default(""),
```

Add `| "week" | "day"` to `PresentationDetails`.

- [ ] **Step 2: factories.ts** — `week: "", day: "",` after `subject: "",`.

- [ ] **Step 3: fetchPresentation.ts** — add `week, day` to the select after `subject`, and `week: data.week, day: data.day,` to the parse.

- [ ] **Step 4: format.ts.**

```ts
/** "Grade 4 · Mathematics · Week 3 · Day 2": a presentation's grade, subject, week and day, skipping empty ones. */
export function detailsLabel({ grades, subject, week, day }: { grades: readonly string[]; subject: string; week?: string; day?: string }): string {
  return joinParts([gradesLabel(grades), subject, week, day]);
}
```

(import `gradesLabel` from `./schema`.)

- [ ] **Step 5:** `npx tsc --noEmit` → fix every place the new required `week`/`day` fields are missing (none expected beyond these). `npm run lint`.

- [ ] **Step 6: Commit** `"Week and Day in the presentation schema"`.

### Task 3: Details panel

**Files:**
- Modify: `src/components/editor/DetailsPanel.tsx`

- [ ] **Step 1:** `ListOrOtherField` gets an optional `canPickNone?: boolean` prop. The None option becomes:

```tsx
        <option value="" disabled={!canPickNone} hidden={!canPickNone}>
          None
        </option>
```

Update its doc comment: "None by default… (or, with `canPickNone`, a choice that clears it)". Picking `""` already runs `setIsOtherPicked(false); onChange("")`.

- [ ] **Step 2:** Under the Subject field:

```tsx
      <ListOrOtherField
        label="Week"
        list={WEEKS}
        value={presentation.week}
        onChange={(week) => setPresentationDetails({ week })}
        maxLength={DETAIL_MAX_LENGTH.week}
        placeholder="Type the week, e.g. Week 21"
        canPickNone
      />
      <ListOrOtherField
        label="Day"
        list={DAYS}
        value={presentation.day}
        onChange={(day) => setPresentationDetails({ day })}
        maxLength={DETAIL_MAX_LENGTH.day}
        placeholder="Type the day, e.g. Day 6"
        canPickNone
      />
```

Import `WEEKS`, `DAYS`. Update the file's top comment to list week and day. `textField`'s key type excludes `"grade"`; also exclude `"week" | "day"` only if tsc asks.

- [ ] **Step 3:** tsc + lint. **Commit** `"Week and Day in Presentation details"`.

### Task 4: Cards and preview headers show them

**Files:** (each replaces `gradesLabel(x.grades), x.subject` in a `joinParts` with `detailsLabel(x)`, and adds `week, day` to the select + row type)
- Modify: `src/app/page.tsx` (select line ~30; `CardPresentation` type; `toCard`; drafts card ~310)
- Modify: `src/components/editor/PresentationsPanel.tsx` (select ~25; `SummaryRow`; `toSummaries`)
- Modify: `src/app/presentations/page.tsx` (select ~19; row type; meta ~83, ~98)
- Modify: `src/app/admin/presentations/page.tsx` (select ~27; row type; meta ~122, ~143)
- Modify: `src/app/presentation/[id]/PresentationPreview.tsx:279`, `src/app/presentation/[id]/edit/ReviewSubmittedView.tsx:31`, `src/app/admin/presentations/reviews/[id]/page.tsx:47` (header line under the title)
- Modify: `src/lib/drafts.ts` (`DraftSummary` + query)

- [ ] **Step 1: drafts.ts.** `DraftSummary` gets `week: string; day: string;`. Query adds:

```sql
         coalesce(json_extract(recipe, '$.details.week'), '') AS week, coalesce(json_extract(recipe, '$.details.day'), '') AS day,
```

- [ ] **Step 2:** Every listed meta line, e.g. in `toCard`:

```ts
    meta: joinParts([detailsLabel(presentation), slideCountLabel(slideCount), timeAgo(Date.parse(presentation.updated_at), now)]),
```

and the preview header: `{joinParts([detailsLabel(presentation), slideCountLabel(slideCount)])}`. Drop `gradesLabel` imports that become unused.

- [ ] **Step 3:** tsc + lint. **Commit** `"Show Week and Day on cards and preview headers"`.

### Task 5: Home search

**Files:**
- Modify: `src/app/page.tsx` (search `q` and `not` filters ~84, ~94; `draftMatches` ~235)
- Modify: `src/app/homeSearch.ts` (comments only: "found in the title, subject, week, day, author or tags")

- [ ] **Step 1:**

```ts
        query = query.or(`title.ilike.${pattern},subject.ilike.${pattern},week.ilike.${pattern},day.ilike.${pattern},author.ilike.${pattern},tags_text.ilike.${pattern}`);
```

`not`: add `.not("week", "ilike", pattern).not("day", "ilike", pattern)`.

`draftMatches`: `const details = \`${draft.title} ${draft.subject} ${draft.week} ${draft.day} ${draft.tags}\`;`

- [ ] **Step 2:** tsc + lint. **Commit** `"Home search looks in Week and Day"`.

### Task 6: Claude's import

**Files:**
- Modify: `src/lib/importPresentation.ts` (`claudeDetailsSchema` after `subject`; the "Also fill in details" sentence ~652)

- [ ] **Step 1:**

```ts
  week: weekSchema
    .optional()
    .describe(`The school week it's for: "Week 1" to "Week 20", or its own name. Only if the user or their document names one.`),
  day: daySchema
    .optional()
    .describe(`The day of that week: "Day 1" to "Day 5", or its own name. Only if the user or their document names one.`),
```

Guide sentence: "…and a few tags (and author, reference links, week or day only when the user, or a document or link they gave you, names them)."

- [ ] **Step 2:** tsc + lint. **Commit** `"Claude can set Week and Day"`.

### Task 7: Final check

- [ ] `npx tsc --noEmit`, `npm run lint`.
- [ ] `git diff c23753a` read against the spec: every part done, nothing extra, zod before saving, design system classes.
- [ ] Ask the user before applying the migration to Supabase (it changes the live database).
