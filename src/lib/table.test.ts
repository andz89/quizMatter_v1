import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addTableColumn,
  addTableRow,
  newTable,
  nextTableCell,
  pickAfterDelete,
  removeTableColumn,
  removeTableRow,
  resizeTableLine,
  tableCellBox,
  tableColumnSizes,
  tableLinePositions,
  withCellHtml,
  type TableElement,
  type TableSettings,
} from "./table";
import { TABLE_CELL_MIN } from "./constants";

const SLIDE = { width: 1280, height: 720 };
// A table with its cells named by place: "0:0", "0:1", …
function namedTable(rows: number, columns: number): TableSettings {
  return {
    rows: Array.from({ length: rows }, (_, row) =>
      Array.from({ length: columns }, (_, column) => ({ html: `${row}:${column}` })),
    ),
  };
}
const placed = (table: TableSettings, at: Partial<TableElement> & { rotation?: number } = {}): TableElement & { rotation?: number } => ({
  x: 0,
  y: 0,
  width: 600,
  height: 240,
  table,
  ...at,
});

test("a new table is 3 rows by 3 empty cells", () => {
  const { rows } = newTable();
  assert.equal(rows.length, 3);
  assert.ok(rows.every((cells) => cells.length === 3 && cells.every((cell) => cell.html === "")));
});

test("a new row goes where it's asked and the table grows by one row", () => {
  const patch = addTableRow(placed(namedTable(3, 2)), 1, SLIDE);
  assert.equal(patch.table.rows.length, 4);
  assert.deepEqual(patch.table.rows[1], [{ html: "" }, { html: "" }]);
  assert.equal(patch.table.rows[0][0].html, "0:0");
  assert.equal(patch.table.rows[2][0].html, "1:0");
  assert.equal(patch.height, 320);
});

test("a new row stops growing the table at the bottom of its box", () => {
  assert.equal(addTableRow(placed(namedTable(3, 2), { y: 450 }), 3, SLIDE).height, 270);
});

test("a table already past the bottom of its box doesn't get taller or shorter", () => {
  assert.equal(addTableRow(placed(namedTable(3, 2), { y: 500 }), 3, SLIDE).height, 240);
});

test("a new column goes where it's asked and the table grows by one column", () => {
  const patch = addTableColumn(placed(namedTable(2, 3)), 0, SLIDE);
  assert.deepEqual(
    patch.table.rows.map((cells) => cells.map((cell) => cell.html)),
    [
      ["", "0:0", "0:1", "0:2"],
      ["", "1:0", "1:1", "1:2"],
    ],
  );
  assert.equal(patch.width, 800);
});

test("a new column stops growing the table at the right of its box", () => {
  assert.equal(addTableColumn(placed(namedTable(2, 3), { x: 880 }), 3, SLIDE).width, 600);
  assert.equal(addTableColumn(placed(namedTable(2, 3), { x: 500 }), 3, SLIDE).width, 780);
});

test("deleting a row removes it and the table shrinks by one row", () => {
  const patch = removeTableRow(placed(namedTable(3, 2)), 1);
  assert.deepEqual(
    patch.table.rows.map((cells) => cells[0].html),
    ["0:0", "2:0"],
  );
  assert.equal(patch.height, 160);
});

test("deleting a column removes it and the table shrinks by one column", () => {
  const patch = removeTableColumn(placed(namedTable(2, 3)), 2);
  assert.deepEqual(
    patch.table.rows.map((cells) => cells.map((cell) => cell.html)),
    [
      ["0:0", "0:1"],
      ["1:0", "1:1"],
    ],
  );
  assert.equal(patch.width, 400);
});

test("deleting never makes a table too small to grab", () => {
  assert.equal(removeTableRow(placed(namedTable(2, 2), { height: 30 }), 0).height, 24);
  assert.equal(removeTableColumn(placed(namedTable(2, 2), { width: 30 }), 0).width, 24);
});

test("typing changes one cell and leaves the old table as it was", () => {
  const table = namedTable(2, 2);
  const next = withCellHtml(table, { row: 1, column: 0 }, "<p>Hi</p>");
  assert.equal(next.rows[1][0].html, "<p>Hi</p>");
  assert.equal(next.rows[1][1].html, "1:1");
  assert.equal(table.rows[1][0].html, "1:0");
  assert.notEqual(next.rows[1], table.rows[1]);
});

test("Tab goes along the row, then to the start of the next", () => {
  const table = namedTable(2, 2);
  assert.deepEqual(nextTableCell(table, { row: 0, column: 0 }, 1), { row: 0, column: 1 });
  assert.deepEqual(nextTableCell(table, { row: 0, column: 1 }, 1), { row: 1, column: 0 });
});

test("Shift+Tab goes back along the row, then to the end of the row before", () => {
  const table = namedTable(2, 2);
  assert.deepEqual(nextTableCell(table, { row: 1, column: 1 }, -1), { row: 1, column: 0 });
  assert.deepEqual(nextTableCell(table, { row: 1, column: 0 }, -1), { row: 0, column: 1 });
});

test("there's no cell after the last one or before the first", () => {
  const table = namedTable(2, 2);
  assert.equal(nextTableCell(table, { row: 1, column: 1 }, 1), null);
  assert.equal(nextTableCell(table, { row: 0, column: 0 }, -1), null);
});

test("a cell's box sits between the table's lines", () => {
  const element = placed(namedTable(2, 2), { width: 102, height: 102 });
  assert.deepEqual(tableCellBox(element, { row: 0, column: 0 }), { left: 2, top: 2, width: 48, height: 48 });
  assert.deepEqual(tableCellBox(element, { row: 1, column: 1 }), { left: 52, top: 52, width: 48, height: 48 });
});

// A 3-column table 308 wide: 3 cells of 100 and 4 lines of 2, the same for rows.
const even = (at: Partial<TableElement> & { rotation?: number } = {}) => placed(namedTable(3, 3), { width: 308, height: 308, ...at });

test("dragging a column's line changes only that column and the table's width", () => {
  const patch = resizeTableLine(even(), "column", 0, 50, SLIDE);
  assert.deepEqual(patch.table.columnSizes, [150, 100, 100]);
  assert.equal(patch.width, 358);
  assert.equal(patch.height, 308);
  assert.equal(patch.x, 0);
  assert.equal(patch.table.rowSizes, undefined);
});

test("dragging a row's line changes only that row and the table's height", () => {
  const patch = resizeTableLine(even(), "row", 1, -40, SLIDE);
  assert.deepEqual(patch.table.rowSizes, [100, 60, 100]);
  assert.equal(patch.height, 268);
  assert.equal(patch.width, 308);
});

test("a column or row can't be dragged smaller than the smallest cell", () => {
  const patch = resizeTableLine(even(), "column", 1, -500, SLIDE);
  assert.deepEqual(patch.table.columnSizes, [100, TABLE_CELL_MIN, 100]);
  assert.equal(patch.width, 308 - (100 - TABLE_CELL_MIN));
});

test("at the box's edge the extra room comes from the next column", () => {
  const patch = resizeTableLine(even({ x: 1280 - 308 }), "column", 0, 30, SLIDE);
  assert.deepEqual(patch.table.columnSizes, [130, 70, 100]);
  assert.equal(patch.width, 308);
});

test("near the box's edge the table grows first, then takes from the next column", () => {
  const patch = resizeTableLine(even({ x: 1280 - 318 }), "column", 0, 30, SLIDE);
  assert.deepEqual(patch.table.columnSizes, [130, 80, 100]);
  assert.equal(patch.width, 318);
});

test("at the box's edge the next column isn't squeezed below the smallest cell", () => {
  const patch = resizeTableLine(even({ x: 1280 - 308 }), "column", 0, 500, SLIDE);
  assert.deepEqual(patch.table.columnSizes, [180, TABLE_CELL_MIN, 100]);
});

test("at the box's edge the last column has nothing to take from and stays", () => {
  const patch = resizeTableLine(even({ x: 1280 - 308 }), "column", 2, 30, SLIDE);
  assert.deepEqual(patch.table.columnSizes, [100, 100, 100]);
  assert.equal(patch.width, 308);
});

test("a turned table keeps its left side still while a column changes", () => {
  const start = even({ rotation: 90 });
  const patch = resizeTableLine(start, "column", 0, 40, SLIDE);
  // Turned 90°, its left side is its top on the screen: the middle moves down by half the growth.
  const middleY = patch.y + patch.height / 2;
  assert.ok(Math.abs(middleY - (start.y + start.height / 2 + 20)) < 0.001);
  assert.ok(Math.abs(patch.x + patch.width / 2 - (start.x + start.width / 2)) < 0.001);
});

test("a dragged size shows in the cell's box", () => {
  const { table, width } = resizeTableLine(even(), "column", 0, 50, SLIDE);
  const element = placed(table, { width, height: 308 });
  assert.deepEqual(tableCellBox(element, { row: 0, column: 0 }), { left: 2, top: 2, width: 150, height: 100 });
  assert.deepEqual(tableCellBox(element, { row: 0, column: 1 }), { left: 154, top: 2, width: 100, height: 100 });
});

test("sizes stay in proportion when the whole table is resized", () => {
  const table = { ...namedTable(1, 2), columnSizes: [300, 100] };
  assert.deepEqual(tableColumnSizes(placed(table, { width: 206 })), [150, 50]);
});

test("a table too small for its lines still has positive sizes", () => {
  assert.ok(tableColumnSizes(placed(namedTable(1, 15), { width: 24 })).every((size) => size > 0));
});

test("a new column takes the size of the column on its left, and the table grows by it", () => {
  const table = { ...namedTable(2, 2), columnSizes: [300, 100] };
  const patch = addTableColumn(placed(table, { width: 400 }), 1, SLIDE);
  assert.deepEqual(patch.table.columnSizes, [300, 300, 100]);
  assert.equal(patch.width, 700);
});

test("a new first row takes the size of the row below it", () => {
  const table = { ...namedTable(2, 2), rowSizes: [50, 150] };
  const patch = addTableRow(placed(table, { height: 200 }), 0, SLIDE);
  assert.deepEqual(patch.table.rowSizes, [50, 50, 150]);
  assert.equal(patch.height, 250);
});

test("deleting a sized column takes its size away", () => {
  const table = { ...namedTable(2, 2), columnSizes: [300, 100] };
  const patch = removeTableColumn(placed(table, { width: 400 }), 0);
  assert.deepEqual(patch.table.columnSizes, [100]);
  assert.equal(patch.width, 100);
});

test("deleting a sized row takes its size away", () => {
  const table = { ...namedTable(2, 2), rowSizes: [50, 150] };
  const patch = removeTableRow(placed(table, { height: 200 }), 1);
  assert.deepEqual(patch.table.rowSizes, [50]);
  assert.equal(patch.height, 50);
});

test("after a delete the pick stays inside what's left", () => {
  const table = namedTable(2, 2);
  assert.deepEqual(pickAfterDelete(table, { row: 2, column: 1 }), { row: 1, column: 1 });
  assert.deepEqual(pickAfterDelete(table, { row: 0, column: 2 }), { row: 0, column: 1 });
  assert.deepEqual(pickAfterDelete(table, { row: 0, column: 0 }), { row: 0, column: 0 });
});

test("the line positions run down the middle of each line, around and between the cells", () => {
  assert.deepEqual(tableLinePositions(placed(namedTable(1, 2), { width: 102, height: 52 })), { columns: [1, 51, 101], rows: [1, 51] });
});

test("the line positions follow dragged sizes", () => {
  const table = { ...namedTable(1, 2), columnSizes: [150, 50] };
  assert.deepEqual(tableLinePositions(placed(table, { width: 206, height: 52 })).columns, [1, 153, 205]);
});
