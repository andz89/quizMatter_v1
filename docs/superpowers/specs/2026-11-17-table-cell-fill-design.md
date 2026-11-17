# Table cell background color + multi-cell selection

Date: 2026-11-17. Status: approved (user picked drag-select + Color panel approach in chat; the picture-in-cell
idea was dropped by the user).

## Intent and why

Teachers want Excel-like coloring in the table element: give one cell a background color, or select many cells at
once (a whole row, a column, a block) and color them in one go. Color is used to mark headers, group rows, and
highlight answers.

## Goals / non-goals / anti-goals

- **Goals:** per-cell background color; drag across cells (and Shift+click) to select a rectangle of cells; one
  action colors the whole selection; the color shows everywhere a table draws (editor, thumbnails, view page,
  presenting); one undo step per coloring.
- **Non-goals:** pictures inside cells (dropped by the user); per-cell text color (each cell's text styles already
  live in its HTML); non-rectangular selections; borders per cell.
- **Anti-goals:** a second color panel or swatch style (must reuse `ColorPanel` + the design system); a saved
  selection (selection is UI state only); breaking old saved tables.

## Constraints

- Saved-shape change → the full "Changing the saved shape" rules (`src/lib/CLAUDE.md`): optional field, zod first,
  `DATA_VERSION` 3 → 4, `current_data_version()` bumped to 4 in a migration applied to the live database **before**
  the code is pushed to `dev` (the preview uses the live database), Admin → Data check clean.
- Colors must pass `isSafeColor` (no `url(…)` smuggling). A bad saved value must not stop the presentation from
  opening: cleaned in `upgradeSlide`'s `cleanElement`, like element colors.
- Only the cell being typed in has a text editor; selection must not add per-cell React state.
- `TableGrid` (`ElementSvg.tsx`) stays the one place a table is drawn.

## Approaches considered

1. **Drag-select + Shift+click, colored through the Color panel** (picked). Selection is a start cell + end cell
   in the store's `pickedTableCell` (UI-only). The Color panel gets a "Cell background" target, like a diagram's
   "Box background". Trade-off: with a cell picked, dragging on the table selects cells instead of moving the
   table (Escape lets go of the cell first, then drag moves) — the Excel/Google Slides behavior.
2. Excel-style row/column header strips to click. Rejected: permanent chrome around every table, still can't
   select "these three cells".
3. A fill swatch only in the toolbar's Table menu, no multi-select. Rejected: doesn't cover "color a whole row"
   in one step, and a second color-picking UI would drift from the Color panel.

## The design

### Saved shape (`src/lib/schema.ts`, `src/lib/table.ts`)

- A table cell grows from `{ html }` to `{ html, fill? }`. `fill` uses `colorSchema` (solid, light and gradient
  values; same safety rule as every slide color). Missing = the table's plain white (`TABLE_CELL_FILL`).
- `DATA_VERSION` becomes 4. Migration `20261231001900_table_cell_fill.sql` sets `current_data_version()` to 4
  (same pattern as `20261231001100_table_element.sql`). Applied to the live database before the code deploys.
- `upgradeSlide`'s `cleanElement` deletes an unsafe `fill` from every cell of `element.table` (the slide still
  opens; that cell goes back to white).

### Table math (`src/lib/table.ts`)

- `cellRange(a, b)` → the normalized rectangle (`from` top-left, `to` bottom-right) between two cells.
- `withCellsFill(table, from, to, fill | undefined)` → a new table with every cell in the rectangle given
  (or cleared of) `fill`. New arrays, so the slide saves.
- `withCellsEmptied(table, from, to)` → a new table with those cells' `html` set to `""` (the Delete key on a
  selection).
- `tableRangeBox(element, from, to)` → the union box of the rectangle in px (from `tableCellBox` of both corners),
  for the selection outline.
- Row/column add/delete with a selection act on the anchor cell, as today (the range collapses to the anchor
  first — builder's call: simplest, and matches how `TablePanel` already reads the pick).

### Selection state (`src/lib/store.ts`)

- `pickedTableCell` gets an optional `end?: TableCellSpot`. `end` present = the rectangle from the anchor
  (`row`/`column`) to `end` is selected. `typingAt` never coexists with `end` (starting to type collapses the
  selection to the typing cell). Never saved.
- When undo/delete makes the anchor **or** `end` point past the table, the pick is dropped (today's "gone" check
  in `TableContent`, extended to `end`).

### Selecting (`SvgElementItem.tsx`)

- Today: first click selects the table, a click picks a cell, double-click types. Unchanged.
- New: with a cell of this table picked (and not typing), a pointer **drag** starting on a cell selects cells
  instead of moving the table — anchor = the cell under the press, `end` follows the pointer (`tableCellAt`),
  set only while it differs from the anchor. Pointer capture keeps the drag alive past the table's edge (the last
  cell stays the end). A plain click (no movement) just picks the pressed cell, as today.
- **Shift+click** on a cell (with a cell picked) sets `end` to the clicked cell instead of adding the table to the
  element multi-selection.
- Moving a table that has a picked cell: press Escape (lets go of the cell), then drag — the same order diagrams
  use. Documented in the editor notes.

### Showing the selection (`TableContent.tsx` → `TableButtons`)

- The picked-cell outline becomes the range outline: one `tableRangeBox` rectangle (2px accent outline), plus a
  soft accent tint (`--accent-soft` at low opacity) over the range so a multi-cell selection reads like Excel's.
  A single picked cell looks exactly as today (outline only — no tint, builder's call: the tint on one cell adds
  noise while typing-adjacent).

### Coloring (`ColorPanel.tsx`, `SelectedElementToolbar.tsx`, store)

- New `ColorPanelTarget`: `"cellFill"`. The toolbar shows a "Cell background" swatch button for a selected table
  (same look and placement pattern as the diagram "Box background" button) that calls `openColorPanelOn("cellFill")`.
- The Color panel, opened on `cellFill` with one table selected, titles itself "Cell background" and paints the
  selected range — or **every cell** when no cell is picked (the diagram rule: picked box, else all boxes).
  "None" clears `fill` (back to white). Gradients allowed (drawn with `toCssBackground`). One
  `updateElement` call per click = one undo step.
- The panel's Escape closes only the panel when a table cell is picked and not typing (same stopPropagation rule
  as a picked diagram box), so Escape doesn't also drop the selection.

### Drawing (`ElementSvg.tsx` `TableGrid`)

- Each cell div gets `background: toCssBackground(cell.fill)` when `fill` is set (unsafe values draw nothing).
  Because `TableGrid` is the one renderer, the editor, thumbnails, drag previews, the view page and presenting all
  show it with no further work.

### Keys (`useEditorShortcuts.ts`)

- Delete with a selection empties every cell in the range (`withCellsEmptied`, one undo step). Escape lets go of
  the pick (range included), as today.

### Out of scope / untouched

- ~~Claude's import and `read_presentation`~~ — added later the same day at the user's request: Claude's recipe
  takes `{ "text", "style", "fill" }` cells and `read_presentation` returns each cell's `fill` (see
  `src/pages/api/CLAUDE.md`).
- The database stores slides as data; no new checks there beyond the version bump.
- Privacy Policy: nothing new is collected.

## What's left to the builder

- Exact tint opacity for the range overlay; swatch icon for the toolbar button.
- Whether `TablePanel`'s readout says "Rows 1–2 · Columns 1–3" for a range (nice-to-have).
- Test placement details (`table.test.ts`, `schema.test.ts`, extending `e2e/table-element.mjs`).
