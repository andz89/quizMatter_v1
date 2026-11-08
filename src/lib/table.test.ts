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
  tableCellBox,
  withCellHtml,
  type TableElement,
  type TableSettings,
} from "./table";

const SLIDE = { width: 1280, height: 720 };
// A table with its cells named by place: "0:0", "0:1", …
function namedTable(rows: number, columns: number): TableSettings {
  return {
    rows: Array.from({ length: rows }, (_, row) =>
      Array.from({ length: columns }, (_, column) => ({ html: `${row}:${column}` })),
    ),
  };
}
const placed = (table: TableSettings, at: Partial<TableElement> = {}): TableElement => ({
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

test("after a delete the pick stays inside what's left", () => {
  const table = namedTable(2, 2);
  assert.deepEqual(pickAfterDelete(table, { row: 2, column: 1 }), { row: 1, column: 1 });
  assert.deepEqual(pickAfterDelete(table, { row: 0, column: 2 }), { row: 0, column: 1 });
  assert.deepEqual(pickAfterDelete(table, { row: 0, column: 0 }), { row: 0, column: 0 });
});
