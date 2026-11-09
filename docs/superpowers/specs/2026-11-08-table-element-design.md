# Table element

A table a teacher places on a slide, types into, and grows with more rows and columns.

## What the teacher does

- **Add it:** Elements panel, a "Table" tile under Text box and Box (click or drag, like them). It starts 3 rows by 3
  columns, 600 × 240 px, shrunk to fit if the box it lands in is smaller.
- **Move and resize it:** like a text box. Drag moves it. Corners keep its shape, side handles change only width or
  height, and it rotates.
- **Type in a cell:** the first click selects the table, a click on a cell then picks that cell (violet outline), and
  a double-click types in it (the first double-click on an unselected table works too). Same words as a text box:
  Enter makes a new line, Escape stops typing. Tab goes to the next cell, Shift+Tab to the one before. While typing,
  a click on another cell moves the typing there.
- **Format text:** while typing, the header's format bar works as in a text box (bold, italic, underline, align, text
  color). Text size is for the whole table, like a text box's size is for the whole box. Each cell's text shrinks to
  fit on its own, down to the usual smallest size.
- **Add rows and columns:**
  - A "+" below the table adds a row at the end. A "+" to its right adds a column at the end.
  - The toolbar's "Table" menu has Add row above / below, Add column left / right, Delete row, Delete column. They act
    on the picked cell, or on the last row and column when none is picked (the menu says which). After a change the
    new row or column's cell is picked, so pressing "below" again keeps going downward.
- **Picked cell:** Escape lets go of it (Escape again deselects the table, as usual). Delete empties the picked cell
  and keeps the table. With no cell picked, Delete removes the table as it does any element.
- **Color:** the element's Color is the table's lines (gradients work). Cells are white, text is the default text color.

## Rules

- **Rows keep their size when one is added.** A new row makes the table one row taller, and a new column one column
  wider, until it reaches the edge of its box or slide. From there it stops growing and the rows or columns share the
  room. Deleting a row or column makes the table that much smaller.
- **Dragging a line, like Excel.** With the table selected, the line on a column's right side or a row's bottom side
  can be dragged. Only that column or row changes, down to 20 px, and the table grows or shrinks by it. At the edge of
  its box the table can't grow, so the rest comes out of the next column or row. A new column or row copies the size
  of the one before it.
- **A cell keeps its size; text shrinks.** This is the app's rule for text boxes and diagram boxes.
- **Limits:** 1–15 rows, 1–15 columns (a times table up to 12 needs 13 × 13). The + and Add buttons stop at the limit;
  Delete stops at 1. Zod refuses anything else.
- A table is never flipped (mirrored text can't be read) and never cropped.

## Saved shape

The element gets one new optional field, `table`:

```
table: {
  rows: [ [ { html: "<p>Text</p>" }, … ], … ],   // top to bottom, left to right; every row has the same number of cells
  fontSize?: number,                             // the largest the text gets; missing = 24
  columnSizes?: number[], rowSizes?: number[]    // how big each is compared with the others; missing = all the same
}
```

- Cell text is the same HTML a text box saves (`htmlSchema`), so every text style carries over.
- Each cell is an object so a later feature (like a cell's own color) can add a field without changing what `html` means.
- `DATA_VERSION` becomes 3 and the database's `current_data_version()` too, in migration
  `20261231001100_table_element.sql`, so an older tab can't save a table away. No old data needs upgrading.

## How it's built

- **`src/lib/table.ts`** holds the math, with tests and no React: `newTable`, `addTableRow`, `removeTableRow`,
  `addTableColumn`, `removeTableColumn`, `withCellHtml`, `nextTableCell`, `tableCellBox`.
- **Drawing:** `TableGrid` in `ElementSvg.tsx` is a CSS grid on white, with its 2 px lines drawn over the cells as one
  SVG shape, so a gradient works and every line has the same weight at any zoom. Each cell is a read-only `SlideText`,
  so a table looks the same in the editor, thumbnails, presenting and drag previews.
- **Typing:** only the cell being typed in has a text editor, by reusing `TextBoxContent`. A 13 × 13 table would be
  far too heavy with 169 editors.
- **Picking:** one piece of UI state, `pickedTableCell` (`elementId`, `row`, `column`, and `typingAt` while typing),
  never saved. A cell is found with `elementFromPoint` and its data attributes, so a rotated table needs no math.
- **On the slide:** `TableContent.tsx` has `TableContent` (the grid and the typing cell), `TableButtons` (the picked
  cell's outline and the two "+") and `TablePanel` (the toolbar's menu). `SvgElementItem` connects them as it does a
  text box and a diagram.
- **Text size:** a new `TextTarget` kind, `table`, sets the table's `fontSize`.

## Claude's connector

`read_presentation` gives Claude each cell's text as plain text, like a text box's. Claude makes tables with `"asset": "table"`
(added 2026-11-09; `src/lib/importTable.ts` sizes them).

## Testing

- `src/lib/table.test.ts`: every math helper, including stopping at the box's edge. `schema.test.ts`: a table is kept;
  uneven rows and too many rows or columns are refused.
- `supabase/tests/table_element.sql` on Docker: `current_data_version()` is at least 3.
- `e2e/table-element.mjs` on Docker: add a table, type, Tab, both "+", the Table menu, Delete on a picked cell, save,
  reload, present.

## Deploy order

The migration goes into the live SQL editor first, then the code is pushed to `dev` (the preview uses the live
database).

## Left out on purpose

Merged cells, a cell's own background, a header row style.
