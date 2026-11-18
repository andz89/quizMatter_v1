# Option Row Heights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Option rows share the options area by their text: "Fit rows to text" and drag lines in the list layouts,
grid rows fitted again after a shuffle or reorder, and no text ever resized by this feature.

**Architecture:** Row sizes are saved as relative shares (list: `rowSize` on each option; grid: `gridRowSizes` on the
slide). One pure helper (`src/lib/optionRows.ts`) turns shares into heights and does the fit and drag math;
`constants.ts` uses it so `getContainerBounds`, the editor, presenting and thumbnails all read the same heights. Text
is measured only in the browser (`src/lib/measureOptions.ts`), called by the store's actions.

**Tech Stack:** Next.js (this repo's version: read `node_modules/next/dist/docs/` before touching Next APIs), React,
zustand (`src/lib/store.ts`), zod (`src/lib/schema.ts`), Tailwind, Node's test runner, Supabase SQL tests on Docker,
Playwright (`e2e/`).

**Spec:** `docs/superpowers/specs/2026-11-18-option-row-heights-design.md`. Mockup: https://claude.ai/artifact/YE3tGkjTMEB3wLR3x8VZha

## Global Constraints

- **No text resizing, ever, by this feature.** Fit, drag lines, Shuffle, reorder and Claude's import change row heights only; `option.fontSize` is never written by them.
- Rows never pass the bottom of the options area: heights always come from shares of the room.
- Missing `rowSize` on any shown option = equal rows (today's look). Missing `gridRowSizes` = equal grid rows.
- Grid has no drag lines. True / False grid (one row) has nothing to fit.
- `DATA_VERSION` 5 → 6 and `current_data_version()` 6, in a migration applied (by the user, live) before the code reaches `dev`.
- zod before every save; new limits live in the zod schema.
- Design system only: `rounded-*` classes, tokens, Lucide icons with `size`, no new colors.
- Packages: none needed. If one ever is: `npx -y npm@10.9.2 install`.
- All DB tests on local Docker only (`npm run test:sql`), never the live project.
- Notes stay true: update `src/components/editor/CLAUDE.md`, `src/lib/CLAUDE.md`, `src/pages/api/CLAUDE.md` in the commit that changes the code they describe.

## Review Focus

1. **A slide saved before this feature** (no `rowSize`, no `gridRowSizes`) must look exactly as today in the editor, presenting and thumbnails → Task 3 test `equal rows when no option has rowSize`.
2. **True / False after a choice slide was fitted** (C and D hidden but carrying `rowSize`): only A and B count → Task 1 test `hidden options are left out`; Task 3 test `true-false uses the first two`.
3. **An option with a picture**: Fit never makes its row shorter than the picture's bottom, and its pictures scale with the row → Task 4 test (e2e) `picture row keeps its picture`.
4. **Text too big for the room**: rows still end at the bottom (share by need), "+…" shows, no size changes → Task 1 test `shareOut too little room`; Task 6 e2e step.
5. **Switching list ↔ grid and back** keeps each layout's sizes, and options' pictures stay inside their boxes → Task 3 test `grid ignores rowSize, list ignores gridRowSizes`.

---

### Task 1: The row math (`optionRows.ts`)

**Files:**
- Create: `src/lib/optionRows.ts` (no imports, so `npm test` loads it)
- Test: `src/lib/optionRows.test.ts`

**Interfaces:**
- Produces:
  - `shareOut(wants: number[], room: number): number[]` — each gets its want plus an equal part of the spare; when the wants add up to more than `room`, each gets `want * room / sum`. Always sums to `room`.
  - `heightsFromShares(shares: (number | undefined)[], room: number): number[]` — any `undefined` (or a list of 0 length) → equal parts; else proportional.
  - `gridRowNeeds(needs: number[]): number[]` — needs by place (2 or 4) → per row the larger of the pair (`[max(n0,n1), max(n2,n3)]`; 2 needs → one row).
  - `moveRowLine(heights: number[], index: number, dy: number, mins: number[]): number[]` — line between `index` and `index + 1`; one grows by `dy`, the other shrinks, each stopping at its `mins` entry. A row already below its min isn't made smaller.
  - `oneLineHeight(fontSize: number): number` — `fontSize * 1.25 + OPTION_BOX_EDGES` where `export const OPTION_BOX_EDGES = 13` (the card's `p-[5px]` twice + 1.5px border twice, rounded).

- [ ] **Step 1: Write the failing tests** in `src/lib/optionRows.test.ts`:

```ts
test("shareOut gives the spare out equally", () => assert.deepEqual(shareOut([50, 100, 50, 100], 400), [75, 125, 75, 125]));
test("shareOut too little room: shares by want, still sums to room", () => {
  const h = shareOut([100, 300], 200);
  assert.deepEqual(h, [50, 150]);
});
test("heightsFromShares: undefined means equal rows", () => assert.deepEqual(heightsFromShares([2, undefined, 1, 1], 400), [100, 100, 100, 100]));
test("heightsFromShares: proportional", () => assert.deepEqual(heightsFromShares([1, 3], 400), [100, 300]));
test("gridRowNeeds takes the taller of each pair", () => assert.deepEqual(gridRowNeeds([80, 40, 30, 120]), [80, 120]));
test("hidden options are left out", () => assert.deepEqual(gridRowNeeds([80, 40]), [80]));
test("moveRowLine grows one, shrinks the next, stops at the min", () => {
  assert.deepEqual(moveRowLine([100, 100, 100], 0, 30, [40, 40, 40]), [130, 70, 100]);
  assert.deepEqual(moveRowLine([100, 100, 100], 0, 90, [40, 40, 40]), [160, 40, 100]);
  assert.deepEqual(moveRowLine([100, 100, 100], 1, -90, [40, 40, 40]), [100, 40, 160]);
});
test("moveRowLine never shrinks a row already under its min", () => assert.deepEqual(moveRowLine([30, 100], 0, -20, [40, 40]), [30, 100]));
test("oneLineHeight", () => assert.equal(oneLineHeight(40), 63));
```

- [ ] **Step 2: Run** `npm test` → the new file fails (module not found).
- [ ] **Step 3: Implement** the five functions and `OPTION_BOX_EDGES` in `src/lib/optionRows.ts`, with a top comment saying what the shares mean (spec, "List and list + side box").
- [ ] **Step 4: Run** `npm test` → all pass.
- [ ] **Step 5: Commit** `feat: option row math (shares, fit, drag lines)`.

---

### Task 2: Saved shape (schema, DATA_VERSION 6, migration)

**Files:**
- Modify: `src/lib/schema.ts` (`optionSchema` ~line 102, `slideSchema` ~line 590, `DATA_VERSION` line 467)
- Modify: `src/lib/schema.test.ts:303` (`DATA_VERSION` 6), add tests
- Create: `supabase/migrations/20261231002100_option_row_heights.sql`
- Create: `supabase/tests/option_row_heights.sql`
- Regenerate: `supabase/schema.sql`, `src/lib/database.types.ts` (`npm run db:snapshot`)

**Interfaces:**
- Produces: `Option.rowSize?: number`, `Slide.gridRowSizes?: [number, number]`, `DATA_VERSION === 6`, `OPTION_ROW_SIZE_MAX = 10_000` (exported from `schema.ts`).

- [ ] **Step 1: Failing tests** in `schema.test.ts`: `DATA_VERSION` is 6; a slide with `options[0].rowSize: 2.5` and `gridRowSizes: [1, 2]` parses and keeps them; `rowSize: 0`, `-1`, `Infinity`, `OPTION_ROW_SIZE_MAX + 1` are refused; `gridRowSizes: [1]` is refused; a slide with neither parses unchanged.
- [ ] **Step 2: Run** `npm test` → those fail.
- [ ] **Step 3: Implement:** `rowSize: z.number().positive().max(OPTION_ROW_SIZE_MAX).optional()` on `optionSchema`, with a comment ("List layouts: this option's row's share of the options area, compared with the other shown options. Missing on any shown option = equal rows. DATA_VERSION 6."); `gridRowSizes: z.tuple([size, size]).optional()` on `slideSchema` (same "compared with each other" comment, "grid only, by place"). `DATA_VERSION = 6`. No `upgradeSlide` change (new optional fields).
- [ ] **Step 4: Run** `npm test` → pass.
- [ ] **Step 5: Migration** `20261231002100_option_row_heights.sql`: header comment in the style of `20261231002000_mixed_fraction.sql` (why 6, apply BEFORE the app), then `create or replace function public.current_data_version()` returning `6`.
- [ ] **Step 6: SQL test** `supabase/tests/option_row_heights.sql`, copied in shape from `supabase/tests/mixed_fraction.sql`: fails if `current_data_version() < 6`; a teacher saves a version-6 presentation with a choice slide whose options have `rowSize` and `gridRowSizes`, reads it back, and the values are kept; ends with `ROLLBACK`.
- [ ] **Step 7: Run** (Docker running; see memory "Docker Desktop path" if `docker info` fails) `npm run test:sql` → every file passes, no `FAIL`/`ERROR`. Then `npm run db:snapshot`.
- [ ] **Step 8: Commit** `feat: option rowSize / gridRowSizes, DATA_VERSION 6` (schema, tests, migration, SQL test, snapshot files).

---

### Task 3: Heights everywhere (`constants.ts`, canvas, static view)

**Files:**
- Modify: `src/lib/constants.ts` (`BoxLayout` line 153, `getOptionsAreaHeight` ~362, `getContainerBounds` ~370, `OPTIONS_GRID_CLASSES` ~156)
- Modify: `src/components/editor/SlideCanvas.tsx:150`, `src/components/presentation/SlideStaticView.tsx:201`
- Test: `src/lib/constants.test.ts`

**Interfaces:**
- Consumes: Task 1 (`heightsFromShares`), Task 2 (fields).
- Produces:
  - `BoxLayout` gains `Partial<Pick<Slide, "options" | "gridRowSizes">>` (optional, so callers like `AnswerArea`'s literal still compile).
  - `getOptionRowHeights(box: BoxLayout): number[]` — list layouts: one height per shown option (in order), from their `rowSize`s; grid: one per row, from `gridRowSizes`. Room = the options area minus the gaps (`LIST_GAP` 12 / `GRID_ROW_GAP` 20).
  - `getOptionsGridStyle(box: BoxLayout): { gridTemplateRows: string }` — the heights as `"<px>px <px>px …"`.
  - `getOptionRoom(box: BoxLayout): number` — the room `getOptionRowHeights` shares (for the store's fit and drag).
  - `getContainerBounds(option.id, box)` returns that option's own row height (list: its own; grid: its row's). Without `box.options` it falls back to today's equal height.

- [ ] **Step 1: Failing tests** in `constants.test.ts`:
  - `equal rows when no option has rowSize` — a list slide's four option bounds all equal today's value.
  - `list rows follow rowSize` — `rowSize` 1,3,1,1 → heights in ratio and summing to the room; `getContainerBounds` of option 2 returns its height.
  - `true-false uses the first two` — C/D `rowSize` are ignored; 2 heights.
  - `grid ignores rowSize, list ignores gridRowSizes` — the same slide in grid uses `gridRowSizes` (options 0,1 get row 0; 2,3 row 1); in list it uses `rowSize`.
  - `getOptionsGridStyle` returns `gridTemplateRows` with the same numbers.
- [ ] **Step 2: Run** `npm test` → fail.
- [ ] **Step 3: Implement** in `constants.ts`. Remove `grid-rows-4` / `grid-rows-2` from `OPTIONS_GRID_CLASSES` and `TRUE_FALSE_GRID_CLASSES` (the style sets the rows now; keep columns and gaps).
- [ ] **Step 4:** `SlideCanvas` and `SlideStaticView`: add `style={getOptionsGridStyle(slide)}` to the options grid `div`.
- [ ] **Step 5: Run** `npm test`, `npx tsc --noEmit`, `npm run lint` → pass. Open a few existing slides in `npm run dev` (list, list-side, grid, true/false, with a picture strip): unchanged.
- [ ] **Step 6: Commit** `feat: option rows read their saved shares everywhere`.

---

### Task 4: Measuring and the store's actions

**Files:**
- Create: `src/lib/measureOptions.ts` (browser only)
- Modify: `src/lib/store.ts` (`reorderOptions` 1215, `shuffleOptions` 1231, new actions next to `setQuestionHeight` 1080)

**Interfaces:**
- Consumes: Task 1 (`shareOut`, `gridRowNeeds`, `moveRowLine`, `oneLineHeight`), Task 3 (`getOptionRoom`, `getOptionRowHeights`, `getContainerBounds`, `getShownOptions`).
- Produces:
  - `measureOptionNeeds(slide: Slide): number[]` — per shown option (in order): the height its text needs at its own `fontSize ?? OPTION_FONT_SIZE`, at its real width (the option's bounds width minus `OPTION_BOX_EDGES`, halved when it has pictures), plus `OPTION_BOX_EDGES`; at least the bottom of its lowest picture (`el.y + el.height`) when it has pictures. Measures in one hidden `div` styled like `SlideText` (Lexend, `line-height: 1.25`, `white-space: break-spaces`, `overflow-wrap: break-word`), filled with `toSafeHtml(html)` or `textToHtml(text)` from `richText.ts`.
  - Store: `fitOptionRows(slideId: string): void`, `setOptionRowHeights(slideId: string, heights: number[]): void`.

- [ ] **Step 1: Implement `fitOptionRows`:** needs = `measureOptionNeeds(slide)`. List layouts: `shareOut(needs, getOptionRoom(slide))` written as each shown option's `rowSize`. Grid (not true/false): `shareOut(gridRowNeeds(needs), room)` as `gridRowSizes`. Pictures follow with `scaleElementsToBoxes(s.elements, s, resized)` (as `setQuestionHeight` does). Never touches `fontSize`. No-op on hidden slides (`updateSlide` already) and slides without options.
- [ ] **Step 2: Implement `setOptionRowHeights`** (list only; ignored in grid): writes the heights as the shown options' `rowSize`s, scaling pictures the same way. A drag is many calls; the store's history already groups a quick burst into one undo step (`HISTORY_GROUP_MS`).
- [ ] **Step 3:** `shuffleOptions` and `reorderOptions`: in grid layout, after moving the options, re-fit the grid rows the same way as `fitOptionRows` (one shared private function, inside the same `set`, so it's one undo step). List layouts need nothing: `rowSize` moves with its option.
- [ ] **Step 4: Run** `npx tsc --noEmit`, `npm run lint`, `npm test` → pass. (Measuring is DOM-only: Task 6's browser test covers it.)
- [ ] **Step 5: Commit** `feat: fit option rows and option row heights in the store`.

---

### Task 5: The controls (Fit button, drag lines)

**Files:**
- Modify: `src/components/editor/SlideToolbar.tsx:196-207` (next to Shuffle)
- Create: `src/components/editor/OptionRowLines.tsx`
- Modify: `src/components/editor/SlideCanvas.tsx` (render the lines over the options grid)

**Interfaces:**
- Consumes: Task 4's `fitOptionRows`, `setOptionRowHeights`; Task 1's `moveRowLine`, `oneLineHeight`; Task 3's `getOptionRowHeights`.

- [ ] **Step 1: Fit button** in `SlideToolbar`, shown when Shuffle is (`hasCards && !isHidden`, choice or true/false), same classes as Shuffle, `title="Fit rows to text"`, Lucide `Rows3Icon size={18}`, `onClick={() => fitOptionRows(slide.id)}`. Hidden for true/false in grid (one row).
- [ ] **Step 2: `OptionRowLines`** (`{ slide: Slide }`), list layouts only: one line per gap between shown rows, absolutely placed in the 12 px gap from `getOptionRowHeights`, starting right of the ✓/A column (`left` = 0 inside the options grid, which already starts after `pl-13`). A violet grab bar in the middle (`bg-accent`, `rounded-dropdown`, about 44×8), `cursor-row-resize`, the dashed line faint until hover. Pointer drag: on move, `setOptionRowHeights(slide.id, moveRowLine(startHeights, i, dy / zoom, mins))` with `mins` = `oneLineHeight(option.fontSize ?? OPTION_FONT_SIZE)` per row (divide by the store's `zoom`, like `OptionCard`'s drag). `role="separator"`, focusable, ↑ / ↓ move 6 px. `data-keep-container-selection="true"` so a drag doesn't drop the selection. Not rendered on hidden slides or in grid.
- [ ] **Step 3:** Render `<OptionRowLines slide={slide} />` in `SlideCanvas` inside the options grid's wrapper (relative), only when `slide.layout !== "grid"`.
- [ ] **Step 4: Check by hand** (`npm run dev`): the Q16 example from the spec: Fit gives A two lines and C one, no size changes; drag a line; Shuffle keeps A's tall row; grid with two long options in one column re-fits after Shuffle; the grip and ✓ still work; "+…" isn't covered by a line.
- [ ] **Step 5: Run** `npx tsc --noEmit`, `npm run lint` → pass.
- [ ] **Step 6: Commit** `feat: Fit rows to text button and drag lines between option rows`.

---

### Task 6: Browser test and editor notes

**Files:**
- Create: `e2e/option-rows.mjs` (reuse `e2e/lib.mjs`; read `e2e/CLAUDE.md` first)
- Modify: `e2e/CLAUDE.md` (list the test), `src/components/editor/CLAUDE.md` (a section "Option row heights"), `src/lib/CLAUDE.md` (`optionRows.ts`, `measureOptions.ts`, the new fields under `schema.ts`)

- [ ] **Step 1: Write the test** (on `npm run e2e:dev`, port 3100): a teacher's choice slide in list layout with Q16's four options and A at 13 px. Assert:
  - `Fit rows to text` → A's row is taller than C's; every option's font size is unchanged (read each option's text `font-size`).
  - Dragging the line under A by +40 px → A's row grew ~40, B's shrank ~40; one Ctrl+Z puts both back.
  - Shuffle → A's row height is the same as before (it moved with A).
  - Make all options 60 px with the size box → the options' bottom edge is still inside the options area, and "+…" shows on at least one option.
  - Grid layout, two long options moved into the left column → after Shuffle each row is as tall as its longer option needs, both columns end together (the bottom of the lowest cell is the same in both columns).
  - `picture row keeps its picture`: an option with a picture is never shorter than the picture after Fit, and the picture stays inside the box.
  - Save, reload, present: the row heights in presenting match the editor's (ratio within 1 px).
- [ ] **Step 2: Run** `node e2e/option-rows.mjs` → passes.
- [ ] **Step 3: Notes:** the editor section says what Fit / lines / Shuffle do, that nothing resizes text, that grid re-fits after Shuffle / reorder and has no lines; `src/lib/CLAUDE.md` names the two files and fields (DATA_VERSION 6, `20261231002100_option_row_heights.sql`).
- [ ] **Step 4: Commit** `test: option rows browser test; notes`.

---

### Task 7: Claude's import

**Files:**
- Modify: `src/lib/importPresentation.ts` (~1110-1120 and the report ~1432-1450, `getClaudeFormat()`)
- Modify: `src/lib/importText.ts` (remove `optionFontSizeFor`), `src/lib/importText.test.ts`
- Modify: `src/pages/api/CLAUDE.md`, `src/lib/CLAUDE.md` (`importText.ts` line), `e2e/claude-text-fit.mjs` if it checks the old shrinking

**Interfaces:**
- Consumes: Task 1 (`shareOut`, `gridRowNeeds`, `OPTION_BOX_EDGES`), Task 3 (`getOptionRoom`, `getContainerBounds`).
- Produces: `optionNeedFor(text: string, width: number, fontSize: number): number` in `importText.ts` = `textHeightFor(text, width - OPTION_TEXT_PADDING, fontSize) + OPTION_TEXT_PADDING`.

- [ ] **Step 1: Failing tests** in `importText.test.ts`: `optionNeedFor` of a one-line and a three-line text at 40 px; the old `optionFontSizeFor` tests removed.
- [ ] **Step 2: Implement** `optionNeedFor`; delete `optionFontSizeFor`. In `importPresentation.ts`, replace the `optionFontSizeFor` block: choice / true-false slides get rows sized from `optionNeedFor` (list: each option's `rowSize` = `shareOut(needs, room)`; grid: `gridRowSizes` from `gridRowNeeds`), with the half width for options that have pictures. Never set `fontSize` there.
- [ ] **Step 3: Report:** replace `` `${letters} … each` `` with each shown option's size (`A 1120×90 · B …`); the "will be cut off" warning already uses `getContainerBounds(option.id, slide)`, so it now sees each row's own height.
- [ ] **Step 4: `getClaudeFormat()`:** say that option rows are sized by their text automatically, that option text keeps the size given (default `OPTION_FONT_SIZE`), and that a "will be cut off" line means shorter text or a smaller `optionFontSize`.
- [ ] **Step 5: Run** `npm test`, `npx tsc --noEmit`, `npm run lint`, and `node e2e/claude-text-fit.mjs` (update its expectation of shrunk option text to: unchanged size, taller row) → pass.
- [ ] **Step 6: Notes:** `src/pages/api/CLAUDE.md` and the `importText.ts` line in `src/lib/CLAUDE.md`.
- [ ] **Step 7: Commit** `feat: Claude's import sizes option rows, never option text`.

---

### Finish

- [ ] `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run test:sql` all pass; `git diff main...` read against the spec (CLAUDE.md "checking step").
- [ ] Admin → Data check locally (`npm run dev`) lists nothing.
- [ ] Tell the user the deploy order: paste `20261231002100_option_row_heights.sql` into the live SQL editor **first**, then push to `dev`.
