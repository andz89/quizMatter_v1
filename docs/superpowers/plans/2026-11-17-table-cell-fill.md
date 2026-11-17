# Table Cell Fill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-cell background color on the table element, with Excel-like drag / Shift+click multi-cell selection and one-step coloring of the selection.

**Architecture:** A table cell grows from `{ html }` to `{ html, fill? }` (zod `colorSchema`, `DATA_VERSION` 4). Selection is UI-only: `pickedTableCell` gets an optional `end` cell, set by dragging across cells or Shift+click. The Color panel gets a `"cellFill"` target that paints the selected range (or all cells), through one `updateElement` per click. `TableGrid` draws the fill, so every view shows it.

**Tech Stack:** existing only — zod, zustand, React, Tailwind classes from `globals.css`. No new packages.

**Spec:** `docs/superpowers/specs/2026-11-17-table-cell-fill-design.md`

## Global Constraints

- Work on `dev`, never push to `main`. Commit per task.
- All DB testing on local Docker Supabase (`npm run test:sql`), never the live project.
- The migration must be applied to the **live** database by the user before the code is pushed to `dev` (the preview uses the live DB). Say so at handoff.
- Colors must pass `isSafeColor`; unsafe saved values are cleaned in `upgradeSlide`, never drawn.
- One spinner, one confirm box, design-system classes only; Lucide icons with `size`.
- `DATA_VERSION` 4 and `current_data_version()` 4 must match.
- Update the folder `CLAUDE.md` notes in the same commit as the code they describe.

## Review Focus

1. Undo/redo or row delete makes `end` point past the table → the pick (range included) is dropped, no crash. *(Task 3, e2e step.)*
2. A crafted save with `fill: "url(javascript:…)"` in a cell → cleaned on open, slide still opens. *(Task 2 test.)*
3. Shift+click on a table when **no** cell is picked, or on a different element → still element multi-select, unchanged. *(Task 3, manual check step.)*
4. An old tab (version 3) saving over a filled table → refused `QMOLD` by the existing cap triggers. *(Task 2 SQL test asserts the cap is 4.)*
5. Dragging from a cell out past the table's edge → selection keeps the last real cell as `end` (pointer capture; `tableCellAt` returns null outside). *(Task 3, e2e step.)*

---

### Task 1: Table math (`cellRange`, `withCellsFill`, `withCellsEmptied`, `tableRangeBox`)

**Files:**
- Modify: `src/lib/table.ts`
- Test: `src/lib/table.test.ts`

**Interfaces:**
- Consumes: existing `TableSettings`, `TableCellSpot`, `TableElement`, `tableCellBox`.
- Produces:
  - `cellRange(a: TableCellSpot, b: TableCellSpot): { from: TableCellSpot; to: TableCellSpot }` — normalized rectangle (`from` top-left, `to` bottom-right).
  - `withCellsFill(table: TableSettings, a: TableCellSpot, b: TableCellSpot, fill: string | undefined): TableSettings` — every cell in the rectangle gets `fill` (undefined removes the key). New arrays throughout the touched rows.
  - `withCellsEmptied(table: TableSettings, a: TableCellSpot, b: TableCellSpot): TableSettings` — those cells' `html` becomes `""` (fills stay).
  - `tableRangeBox(element: TableElement, a: TableCellSpot, b: TableCellSpot): { left: number; top: number; width: number; height: number }` — the union of `tableCellBox(from)` and `tableCellBox(to)` in px.

- [ ] **Step 1: Write failing tests** in `table.test.ts` (same style as the file's existing tests):
  - `cellRange` flips a bottom-right→top-left pair into `from {0,0}` / `to {1,2}`.
  - `withCellsFill` on a 3×3 table, range (0,0)–(1,1), `"#FF5A5F"`: the 4 cells have the fill, the others don't; the returned table and its touched rows are new objects; untouched row 2 is the same object.
  - `withCellsFill` with `undefined` removes `fill` from the cells (`"fill" in cell` is false).
  - `withCellsEmptied` empties `html` of the range and keeps a cell's `fill`.
  - `tableRangeBox` on an even 3×3 table equals the box from `tableCellBox(from)`'s left/top to `tableCellBox(to)`'s right/bottom.
- [ ] **Step 2: Run** `npm test -- --test-name-pattern="" src/lib/table.test.ts` (or plain `npm test`) → the new tests FAIL (functions not exported).
- [ ] **Step 3: Implement the four functions** in `src/lib/table.ts`. Cell type there comes from `TableSettings` — no local type change needed yet (the `fill` key lands in Task 2's schema; until then type the fill write as building a new cell object `{ ...cell, fill }` / destructuring it off).
- [ ] **Step 4: Run** `npm test` → PASS (if `tsc` complains about `fill` before Task 2, do Task 2's schema line first and re-run — note it in the commit).
- [ ] **Step 5: Commit** `feat: table cell range math (fill, empty, range box)`.

### Task 2: Saved shape — zod `fill`, `DATA_VERSION` 4, cleaning, migration

**Files:**
- Modify: `src/lib/schema.ts` (table cell object, `DATA_VERSION`, `cleanElement`)
- Create: `supabase/migrations/20261231001900_table_cell_fill.sql`
- Create: `supabase/tests/table_cell_fill.sql`
- Test: `src/lib/schema.test.ts`
- Regenerate: `supabase/schema.sql`, `src/lib/database.types.ts` (`npm run db:snapshot`)

**Interfaces:**
- Produces: table cells are `{ html, fill? }` with `fill: colorSchema.optional()` (comment: "the cell's background; missing = white. Added in DATA_VERSION 4."); `DATA_VERSION = 4`.

- [ ] **Step 1: Write failing tests** in `schema.test.ts`:
  - A slide whose table cell has `fill: "#FF5A5F"` parses and keeps it.
  - A slide whose table cell has `fill: "url(https://evil.example)"` parses (via `slideSchema`'s `upgradeSlide` preprocess) with that cell's `fill` **gone**, the cell's `html` kept.
  - `DATA_VERSION` is 4.
- [ ] **Step 2: Run** `npm test` → FAIL.
- [ ] **Step 3: Implement:** add `fill: colorSchema.optional()` to the table cell object in `slideElementSchema`'s `table`; bump `DATA_VERSION` to 4 (update its comment is not needed); in `cleanElement`, when `cleaned.table` has rows, map them: a cell with an unsafe `fill` (reuse `isUnsafeColor`) loses the key (new arrays only when something was cleaned is fine — simplest is to always rebuild).
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Write the migration** `supabase/migrations/20261231001900_table_cell_fill.sql`: copy the shape of `20261231001100_table_element.sql`, selecting 4, with a comment that cells gained a `fill` color (DATA_VERSION 4) and "Apply this BEFORE deploying the app with DATA_VERSION 4."
- [ ] **Step 6: Write the SQL test** `supabase/tests/table_cell_fill.sql` on the pattern of `supabase/tests/calendar_date.sql`: FAIL if `current_data_version() < 4`; a teacher's `save_presentation` with `app_version => 4` stores `data_version` 4; ends with `ROLLBACK`.
- [ ] **Step 7: Run** `npm run test:sql` (Docker; start Docker Desktop if `docker info` fails) → every test passes, including the new one.
- [ ] **Step 8: Run** `npm run db:snapshot`; confirm `supabase/schema.sql` now shows `select 4` in `current_data_version`.
- [ ] **Step 9: Commit** code + migration + snapshot together: `feat: table cell fill in the saved shape (DATA_VERSION 4)`.

### Task 3: Selection state and interaction (store, drag, Shift+click, outline, Delete)

**Files:**
- Modify: `src/lib/store.ts:440` (`pickedTableCell` type)
- Modify: `src/components/editor/SvgElementItem.tsx` (pointer handlers)
- Modify: `src/components/editor/TableContent.tsx` (`TableButtons` outline, gone-check)
- Modify: `src/lib/useEditorShortcuts.ts:132-143` (Delete over a range)
- Test: `e2e/table-element.mjs` (extended in Task 5's e2e run)

**Interfaces:**
- Produces: `pickedTableCell: (TableCellSpot & { elementId: string; typingAt?: { x: number; y: number }; end?: TableCellSpot }) | null`. Rule: `typingAt` and `end` never coexist (setting one clears the other at the call sites; typing calls already pass no `end`).

- [ ] **Step 1: Widen the store type** with `end?: TableCellSpot` (comment: the far corner of a selected rectangle; missing = one cell).
- [ ] **Step 2: `SvgElementItem.tsx` — drag-select and Shift+click.** In `handleBodyPointerDown`, before the existing `e.shiftKey` branch: when `asset?.isTable`, `isTableCellPicked` and not typing —
  - Shift held: `setPickedTableCell` keeping the current anchor with `end` = `tableCellAt(e.clientX, e.clientY)` (no-op when null or equal to the anchor → `end` undefined), capture nothing, return.
  - Otherwise: start a cell-selection drag instead of an element drag — a new `cellDrag` ref `{ anchor: TableCellSpot } | null`; set it from `tableCellAt` (fall through to normal element drag when null, e.g. the press is on the table's outer line), `setPickedTableCell({ elementId, ...anchor })`, `setPointerCapture`, return.
  In `handleBodyPointerMove`: when `cellDrag.current` is set, `tableCellAt` under the pointer → if found and different from the current `end`, `setPickedTableCell({ elementId, ...anchor, end: cell equal to anchor ? undefined : cell })`; return before the element-drag code. In `stopDrag`: clear `cellDrag.current` (the early `if (!state) return` keeps the rest skipped). The existing `onClick` pick-on-click path still handles the no-pick first click.
- [ ] **Step 3: `TableContent.tsx`** — extend the "picked cell can be gone" check to `end` (drop the pick when either spot is past the table). In `TableButtons`, draw the outline with `tableRangeBox(placed, pick, pick.end ?? pick)`; when `pick.end` exists add inside the same div a background `color-mix(in srgb, var(--accent) 12%, transparent)` (outline as today).
- [ ] **Step 4: `useEditorShortcuts.ts`** — in the picked-table-cell branch, Delete calls `withCellsEmptied(table, pick, pick.end ?? pick)` (import from `@/lib/table`; replaces the `withCellHtml` call — single cell is the one-cell range).
- [ ] **Step 5: Run** `npx tsc --noEmit` and `npm run lint` → clean. Manual check in `npm run dev` (owner account): click table → click cell → drag across cells (tint + outline follow, table does not move), Shift+click extends, Escape lets go, then drag moves the table; Shift+click with no cell picked still multi-selects elements; Delete empties the range in one undo step.
- [ ] **Step 6: Commit** `feat: drag and Shift+click select table cells; Delete empties the range`.

### Task 4: Coloring — `cellFill` target, Color panel branch, toolbar swatch

**Files:**
- Modify: `src/lib/store.ts:122` (`ColorPanelTarget`)
- Modify: `src/components/editor/ColorPanel.tsx`
- Modify: `src/components/editor/SelectedElementToolbar.tsx:361-379` (table group)

**Interfaces:**
- Consumes: `withCellsFill`, `cellRange` (Task 1); `pickedTableCell.end` (Task 3).
- Produces: `ColorPanelTarget = "fill" | "border" | "boxFill" | "boxBorder" | "boxText" | "cellFill"`.

- [ ] **Step 1: Add `"cellFill"`** to `ColorPanelTarget` (comment mentions the table's picked cells, or every cell).
- [ ] **Step 2: `ColorPanel.tsx`:** with no text editor, exactly one selected element that has `.table`, and `colorPanelTarget === "cellFill"`: title "Cell background"; the range = `pickedTableCell` for this element (`[pick, pick.end ?? pick]`), else the whole table (`{row:0,column:0}`–`{row:last,column:last}`); `hasNone` true (`undefined` = white), `noneSelected` when every targeted cell has no `fill`; `commonColor` = the shared `fill` of the targeted cells or null; `handleColor` → `updateElement(selectedSlideId, el.id, { table: withCellsFill(el.table, from, to, color) })`; gradients allowed. Extend the Escape handler's stopPropagation to a picked table cell that isn't typing (same reason as the diagram line above it).
- [ ] **Step 3: `SelectedElementToolbar.tsx`:** in the table group (after `TablePanel`), add a swatch button like the diagram's "Box background" (`h-6 w-6 rounded-full border border-border-default`, `outline("cellFill")`), title "Cell background", background = the targeted cells' shared `fill` via `toCssBackground`, else `NONE_SWATCH` for none / `MIXED_COLOR_SWATCH` when mixed; a small "This cell" / "Selected cells" / "All cells" label is **not** added (the panel title carries it) — keep the bar compact.
- [ ] **Step 4: Run** `npx tsc --noEmit`, `npm run lint` → clean. Manual check: color a dragged row in one click, one Ctrl+Z undoes it; "None" clears; with no cell picked the whole table colors; the fill shows in the slide thumbnails and when presenting; typing in a filled cell shows the fill behind the text (needs Task 5's TableGrid change — do Step 5 of Task 5 first if checking visuals now).
- [ ] **Step 5: Commit** `feat: cell background color from the Color panel`.

### Task 5: Drawing, e2e, docs

**Files:**
- Modify: `src/components/editor/ElementSvg.tsx:136-146` (`TableGrid` cell)
- Modify: `e2e/table-element.mjs`
- Modify: `src/components/editor/CLAUDE.md` ("Tables"), `src/lib/CLAUDE.md` (`table.ts` entry), `supabase/migrations/CLAUDE.md` (one line for the new migration)

- [ ] **Step 1: `TableGrid`:** the cell div's `style` gets `background: cell.fill ? toCssBackground(cell.fill) : undefined` (import if needed; unsafe values already draw nothing through `toCssBackground`).
- [ ] **Step 2: Extend `e2e/table-element.mjs`** (read `e2e/CLAUDE.md` + reuse `e2e/lib.mjs` first): add steps that pick a cell, drag to another cell, apply a fill through the toolbar swatch + panel, and assert (a) the two cells' computed background changed, (b) saving and reloading keeps it, (c) Delete over the range empties both cells' text, (d) after deleting the end row (Table menu), the editor doesn't crash and the pick is gone.
- [ ] **Step 3: Run the e2e test:** `npm run e2e:dev` (Docker Supabase up), then `node e2e/table-element.mjs` → PASS.
- [ ] **Step 4: Update the notes** in the same commit: the "Tables" section gets the selection rules (drag/Shift+click, `end` in `pickedTableCell`, Escape-then-drag to move, Delete empties the range) and the cell `fill` (DATA_VERSION 4, cleaned like other colors); `src/lib/CLAUDE.md`'s `table.ts` line mentions the range math and DATA_VERSION 4; `supabase/migrations/CLAUDE.md` data-version entry gains "to 4 for cell fills in `20261231001900_table_cell_fill.sql`, test `supabase/tests/table_cell_fill.sql`".
- [ ] **Step 5: Commit** `feat: draw cell fills everywhere; e2e + notes`.

### Task 6: Final verification

- [ ] **Step 1:** `npx tsc --noEmit` and `npm run lint` → clean in changed files.
- [ ] **Step 2:** `npm test` → PASS; `npm run test:sql` → PASS.
- [ ] **Step 3:** `git diff dev` read against the spec: every spec point built, nothing extra, notes true.
- [ ] **Step 4:** Report to the user: what passed, and the deploy order — **paste `supabase/migrations/20261231001900_table_cell_fill.sql` into the live SQL editor first**, run Admin → Data check locally, then push `dev`.
