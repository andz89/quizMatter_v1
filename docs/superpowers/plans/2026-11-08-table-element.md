# Table Element Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A table element on slides: type in its cells, add and delete rows and columns.

**Architecture:** One new optional element field, `table`. Pure math in `src/lib/table.ts`. A read-only CSS grid
(`TableGrid`) draws it everywhere; only the cell being typed in mounts a text editor, by reusing `TextBoxContent`.

**Tech Stack:** Next.js, zustand, zod, Tiptap, Supabase (Docker for tests), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-08-table-element-design.md`

## Global Constraints

- Limits: 1–15 rows, 1–15 columns. New table: 3 × 3, 600 × 240 px. Default text size 24. Lines 2 px, cells white.
- `DATA_VERSION` 3 and `current_data_version()` 3, migration `20261231001100_table_element.sql`.
- Don't stage `src/components/editor/SlideToolbar.tsx`, `src/components/presentation/PresentationView.tsx` or `.claude/` (the user's own work). Stage files by name.
- Never push: the user pastes the migration into the live database first.
- Design system classes only for app UI; Lucide icons with `size`. `tsc` and `npm run lint` clean.

## Review Focus

- Undo removes the row or column being typed in or picked: no crash, the pick is let go. (Task 5 e2e)
- The picked cell's row is deleted when it's the last row: the pick moves to a row that exists. (Task 4, `pickAfterDelete` test)
- A table already at the slide's bottom or right edge gets a new row or column: it doesn't grow past the edge. (Task 1 tests)
- Tab on the very last cell, Shift+Tab on the very first: typing stays put and no text is lost. (Task 1 `nextTableCell` test, Task 5 e2e)
- Duplicate or copy a table: the copy keeps its text and later edits don't change the original. (Task 5 e2e)

---

### Task 1: Saved shape and table math

**Files:**
- Modify: `src/lib/constants.ts`, `src/lib/schema.ts`, `src/lib/schema.test.ts`, `supabase/schema.sql` + `src/lib/database.types.ts` (by `npm run db:snapshot`)
- Create: `src/lib/table.ts`, `src/lib/table.test.ts`, `supabase/migrations/20261231001100_table_element.sql`, `supabase/tests/table_element.sql`

**Interfaces:**
- Produces, `constants.ts`: `TABLE_ROWS`, `TABLE_COLUMNS` (`{ min: 1, max: 15 }`), `TABLE_LINE_WIDTH` 2, `TABLE_FONT_SIZE` 24, `TABLE_CELL_FILL` "#FFFFFF".
- Produces, `table.ts`:
  - `type TableSettings = NonNullable<SvgElement["table"]>`, `type TableCellSpot = { row: number; column: number }`, `type TableElement = { x, y, width, height: number; table: TableSettings }`
  - `newTable(): TableSettings`
  - `addTableRow(el: TableElement, at: number, bounds: Size): { table; height }`, `addTableColumn(el, at, bounds): { table; width }`
  - `removeTableRow(el, at): { table; height }`, `removeTableColumn(el, at): { table; width }`
  - `withCellHtml(table, spot, html): TableSettings`
  - `nextTableCell(table, spot, step: 1 | -1): TableCellSpot | null`
  - `tableCellBox(el: TableElement, spot): { left, top, width, height }`
  - `pickAfterDelete(table, spot): TableCellSpot` (the spot after its row or column went, kept inside `table`)

- [ ] **Step 1: Write the failing tests** in `table.test.ts`: `newTable` is 3 × 3 of `{ html: "" }`. `addTableRow` at 1 on a 3-row, 240-high table at y 0 in a 720-high box gives 4 rows, the new one empty and at index 1, height 320. At y 500 height stops at 220 + … i.e. `720 - 500 = 220` is below 240, so height stays 240. `addTableColumn` likewise with width. `removeTableRow` on 240 high with 3 rows gives 160, never below 24 (`MIN_ELEMENT_SIZE`). `withCellHtml` returns new row arrays and leaves the original untouched. `nextTableCell`: end of a row goes to the next row's first cell; last cell +1 and first cell −1 give null. `tableCellBox`: 2 × 2 table, 102 wide, 102 high gives row 1 column 1 `{ left: 52, top: 52, width: 48, height: 48 }` (lines 2). `pickAfterDelete` with spot row 2 on a table now 2 rows gives row 1.
- [ ] **Step 2:** In `schema.test.ts`, test `svgElementSchema` keeps `table`, and refuses rows of different lengths, 16 rows, 16 columns, and zero rows.
- [ ] **Step 3:** Run `npm test`. Expected: the new tests FAIL.
- [ ] **Step 4:** Add the constants, the `table` field (with a `refine` for even rows and a comment like the other fields), `DATA_VERSION = 3`, and `table.ts`. A new row's height is `height / rows`, capped by `Math.max(height, bounds.height - y)`; columns the same with width and x.
- [ ] **Step 5:** Run `npm test`. Expected: PASS.
- [ ] **Step 6:** Write the migration (copy of `20261231000800_calendar_date.sql`'s function, returning 3) and `supabase/tests/table_element.sql` (begin; `current_data_version() < 3` raises FAIL; rollback). Run `npm run test:sql` and `npm run db:snapshot`. Expected: no FAIL or ERROR.
- [ ] **Step 7: Commit** those files by name.

### Task 2: Drawing it and adding it

**Files:**
- Modify: `src/lib/svgLibrary.tsx`, `src/components/editor/ElementSvg.tsx`, `src/lib/store.ts`, `src/components/editor/ElementsPanel.tsx`, `src/components/editor/SelectedElementToolbar.tsx`, `src/lib/importPresentation.ts`, `src/pages/api/mcp.ts`

**Interfaces:**
- Consumes: `newTable`, `TableSettings`, the constants.
- Produces: asset id `"table"` with `isTable: true`, `category: "text"`, `defaultColor: DEFAULT_TEXT_COLOR`, `defaultSize` 600 × 240. `RenderSettings` includes `table`. `TableGrid({ table, color, renderCell? })` exported from `ElementSvg.tsx`, where `renderCell?: (row: number, column: number) => ReactNode` wins over the read-only text; each cell has `data-table-row` and `data-table-column`.

- [ ] **Step 1:** Add the asset (icon: a rounded rectangle with two lines each way) and `!asset.isTable` to `canCrop` and `canTrimDrawing`.
- [ ] **Step 2:** Add `TableGrid` and `if (asset.isTable && settings.table) return <TableGrid … />` next to the text box branch. Grid: `repeat(n, minmax(0, 1fr))` both ways, `gap` and `padding` `TABLE_LINE_WIDTH`, `background: toCssBackground(color)`, `select-none`. Cell: `TABLE_CELL_FILL`, `DEFAULT_TEXT_COLOR`, `min-h-0 min-w-0 overflow-hidden px-2 py-1`, `SlideText` only when the cell has text.
- [ ] **Step 3:** `addElement` gives `table: newTable()` to `isTable` assets. Add the "Table" tile (`col-span-2`) under Text box and Box. Leave tables out of `flippable`, Claude's `ASSET_IDS`. `shrinkPresentation` sends each cell's `htmlToText`.
- [ ] **Step 4:** Run `npx tsc --noEmit`. Expected: no errors. (The visible check is Task 5's e2e.)
- [ ] **Step 5: Commit** those files by name.

### Task 3: Picking a cell and typing

**Files:**
- Create: `src/components/editor/TableContent.tsx`
- Modify: `src/lib/store.ts`, `src/components/editor/SvgElementItem.tsx`, `src/components/editor/TextFormatToolbar.tsx`, `src/lib/useEditorShortcuts.ts`

**Interfaces:**
- Consumes: `TableGrid`, `withCellHtml`, `nextTableCell`, `TextBoxContent`.
- Produces: store `pickedTableCell: (TableCellSpot & { elementId: string; typingAt?: { x: number; y: number } }) | null`, `setPickedTableCell(pick)`. `TextTarget` kind `{ kind: "table"; slideId; elementId }`. `TableContent({ slideId, element, table })`, `tableCellAt(x: number, y: number): TableCellSpot | null` (uses `document.elementFromPoint`).

- [ ] **Step 1:** Add the store state and the `table` branch of `setTextFontSizes`; `chosenFontSize` reads `table.fontSize ?? TABLE_FONT_SIZE`; Clear all leaves out `table` targets.
- [ ] **Step 2:** Write `TableContent`: `TableGrid` with `renderCell` returning, for the cell being typed in, `TextBoxContent` (`editStart={pick.typingAt}`, `target` kind `table`, `isSelected={false}`) in a wrapper that stops `pointerdown` and `dblclick`. `onKeyDownCapture` on it handles Tab with `nextTableCell` and `typingAt: { x: -1, y: -1 }` (off screen, so the cursor goes to the end). `onStopEditing` clears `typingAt` only if this is still the picked cell. An effect lets go of a pick whose cell is gone.
- [ ] **Step 3:** Wire `SvgElementItem`: render `TableContent` for `asset.isTable && element.table`; `pickOnClick` also for tables; click picks with `tableCellAt` from the pointer position, not `e.target` (pointer capture makes the target the body); double-click types; a press on another cell while typing moves the typing there at `click` (the old editor has blurred by then, so use a ref set on press); let go of the pick when it isn't the only selected element; side handles for tables; `cursor-text` while typing.
- [ ] **Step 4:** In `useEditorShortcuts`, with a picked (not typing) cell of the selected table: Escape lets go; Delete empties the cell.
- [ ] **Step 5:** Run `npx tsc --noEmit` and `npm run lint`. Expected: no errors in these files.
- [ ] **Step 6: Commit** those files by name.

### Task 4: Adding and deleting rows and columns

**Files:**
- Modify: `src/components/editor/TableContent.tsx`, `src/components/editor/SvgElementItem.tsx`, `src/components/editor/SelectedElementToolbar.tsx`, `src/components/editor/TextFormatToolbar.tsx` (export `FONT_SIZES`)

**Interfaces:**
- Consumes: `addTableRow`, `addTableColumn`, `removeTableRow`, `removeTableColumn`, `pickAfterDelete`, `tableCellBox`, `pickedTableCell`.
- Produces: `TableButtons({ slideId, element, table, bounds })`, `TablePanel({ slideId, element, table, bounds })`.

- [ ] **Step 1:** `TableButtons` (selection layer, only for the one selected table, hidden while typing): the picked cell's 2 px violet outline at `tableCellBox`, and the two "+" (`title` "Add a row" / "Add a column"), the look of `DiagramBoxButtons`, 20 px past the bottom and right edges, gone at the limit.
- [ ] **Step 2:** `TablePanel`: a `ToolPanelButton` titled "Table", icon `Table2Icon`, with a `PanelReadout` "Row R · Column C", a hint when no cell is picked, then the six actions with `disabled` at the limits. Each writes one `updateElement` and picks per the spec.
- [ ] **Step 3:** Add it to `SelectedElementToolbar`, with a `FontSizePicker` for the whole table when not typing (`showColor`), and the swatch title "Line color".
- [ ] **Step 4:** Run `npx tsc --noEmit` and `npm run lint`. Expected: no errors in these files.
- [ ] **Step 5: Commit** those files by name.

### Task 5: Browser test and notes

**Files:**
- Create: `e2e/table-element.mjs`
- Modify: `src/components/editor/CLAUDE.md`, `src/lib/CLAUDE.md`, `supabase/migrations/CLAUDE.md`

- [ ] **Step 1:** Write the e2e, modeled on `e2e/calendar-date.mjs`, on a blank slide: add a table (9 cells); double-click a cell and type; Tab and type in the next; Tab on the last cell stays there and keeps its text; Ctrl+S saves those cells; "+" row gives 4 rows and a taller table; "+" column gives 4 columns; Table → Add row below and Delete column; undo while a just-added row is picked gives no page error; Delete on a picked cell empties it and keeps the table; duplicate keeps the text; reload keeps it; a table at the slide's bottom edge doesn't grow past it; Present shows the text. Screenshot `table-element.png`.
- [ ] **Step 2:** Run `npm run e2e:dev` in the background, then `node e2e/table-element.mjs`. Expected: every check PASS.
- [ ] **Step 3:** Look at the screenshot and fix what looks wrong.
- [ ] **Step 4:** Update the notes (a "Tables" section in the editor's `CLAUDE.md`, `table.ts` in `src/lib/CLAUDE.md`, the version number in the migrations notes).
- [ ] **Step 5:** Run `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run test:sql`. Expected: all pass.
- [ ] **Step 6: Commit** those files by name.
