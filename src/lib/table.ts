// The table element's math: what a table becomes when a row or column is added, deleted or dragged, or a cell typed in.
// Spec: docs/superpowers/specs/2026-11-08-table-element-design.md. Every function makes new arrays, so a changed slide
// is a new object and gets saved (see "State" in src/components/editor/CLAUDE.md).
import { TABLE_CELL_MIN, TABLE_LINE_WIDTH } from "./constants";
import { MIN_ELEMENT_SIZE, type Rect, type Size } from "./geometry";
import type { SvgElement } from "./schema";

export type TableSettings = NonNullable<SvgElement["table"]>;
export type TableCellSpot = { row: number; column: number };
export type TableElement = Rect & { table: TableSettings };

const NEW_TABLE_ROWS = 3;
const NEW_TABLE_COLUMNS = 3;

const emptyCell = () => ({ html: "" });
const emptyRow = (columns: number) => Array.from({ length: columns }, emptyCell);
const insertAt = <T>(list: T[], at: number, item: T) => [...list.slice(0, at), item, ...list.slice(at)];
const removeAt = <T>(list: T[], at: number) => list.filter((_, index) => index !== at);

export function newTable(): TableSettings {
  return { rows: Array.from({ length: NEW_TABLE_ROWS }, () => emptyRow(NEW_TABLE_COLUMNS)) };
}

const total = (sizes: number[]) => sizes.reduce((sum, size) => sum + size, 0);

// How much of the table one column or row is. No saved sizes = all the same.
const shareOf = (sizes: number[] | undefined, index: number, count: number) => (sizes ? sizes[index] / total(sizes) : 1 / count);

// Bigger by this share of itself, up to the box's edge. A table already at or past the edge keeps its size.
const grown = (size: number, share: number, start: number, boxSize: number) =>
  Math.min(size + size * share, Math.max(size, boxSize - start));

const shrunk = (size: number, share: number) => Math.max(MIN_ELEMENT_SIZE, size - size * share);

// Each column's or row's cells in px: the table's size less its lines, shared out by the saved sizes. Never 0 or less,
// even on a table too small for its lines, so sizes made from these are always valid.
function cellSizes(sizes: number[] | undefined, count: number, size: number) {
  const room = size - TABLE_LINE_WIDTH * (count + 1);
  return Array.from({ length: count }, (_, index) => Math.max(1, room * shareOf(sizes, index, count)));
}

export const tableColumnSizes = ({ table, width }: TableElement) => cellSizes(table.columnSizes, table.rows[0].length, width);
export const tableRowSizes = ({ table, height }: TableElement) => cellSizes(table.rowSizes, table.rows.length, height);

// A new column or row is the size of the one before it (the first one: the one after it), like Excel.
const copiedFrom = (at: number) => Math.max(0, at - 1);

/** A new empty row at `at`. The table gets one row taller, as far as its box allows. */
export function addTableRow({ table, y, height }: TableElement, at: number, bounds: Size) {
  const { rowSizes } = table;
  return {
    table: {
      ...table,
      rows: insertAt(table.rows, at, emptyRow(table.rows[0].length)),
      rowSizes: rowSizes && insertAt(rowSizes, at, rowSizes[copiedFrom(at)]),
    },
    height: grown(height, shareOf(rowSizes, copiedFrom(at), table.rows.length), y, bounds.height),
  };
}

/** A new empty column at `at`. The table gets one column wider, as far as its box allows. */
export function addTableColumn({ table, x, width }: TableElement, at: number, bounds: Size) {
  const { columnSizes } = table;
  return {
    table: {
      ...table,
      rows: table.rows.map((cells) => insertAt(cells, at, emptyCell())),
      columnSizes: columnSizes && insertAt(columnSizes, at, columnSizes[copiedFrom(at)]),
    },
    width: grown(width, shareOf(columnSizes, copiedFrom(at), table.rows[0].length), x, bounds.width),
  };
}

/** Only called on a table with more than one row. */
export function removeTableRow({ table, height }: TableElement, at: number) {
  const { rowSizes } = table;
  return {
    table: { ...table, rows: removeAt(table.rows, at), rowSizes: rowSizes && removeAt(rowSizes, at) },
    height: shrunk(height, shareOf(rowSizes, at, table.rows.length)),
  };
}

/** Only called on a table with more than one column. */
export function removeTableColumn({ table, width }: TableElement, at: number) {
  const { columnSizes } = table;
  return {
    table: { ...table, rows: table.rows.map((cells) => removeAt(cells, at)), columnSizes: columnSizes && removeAt(columnSizes, at) },
    width: shrunk(width, shareOf(columnSizes, at, table.rows[0].length)),
  };
}

/**
 * The table after the line on a column's right side or a row's bottom side is dragged by `delta` px, like Excel: only
 * that column or row changes and the table grows or shrinks by it. Past the box's edge the table can't grow, so the
 * rest comes out of the next column or row. Always worked out from the table as the drag started. Keeps the table's
 * left and top sides still on the screen, also when it's turned.
 */
export function resizeTableLine(element: TableElement & { rotation?: number }, axis: "column" | "row", index: number, delta: number, bounds: Size) {
  const isColumn = axis === "column";
  const sizes = isColumn ? tableColumnSizes(element) : tableRowSizes(element);
  const size = isColumn ? element.width : element.height;
  const room = Math.max(0, isColumn ? bounds.width - element.x - size : bounds.height - element.y - size);

  const change = Math.max(Math.min(0, TABLE_CELL_MIN - sizes[index]), delta);
  const growth = Math.min(change, room);
  const next = sizes[index + 1];
  const taken = next === undefined ? 0 : Math.min(change - growth, Math.max(0, next - TABLE_CELL_MIN));
  sizes[index] += growth + taken;
  if (next !== undefined) sizes[index + 1] -= taken;

  // The table turns around its middle, which moves half the growth along the side that grew.
  const angle = ((element.rotation ?? 0) * Math.PI) / 180;
  const half = growth / 2;
  const [moveX, moveY] = isColumn
    ? [half * (Math.cos(angle) - 1), half * Math.sin(angle)]
    : [-half * Math.sin(angle), half * (Math.cos(angle) - 1)];
  return {
    table: { ...element.table, [isColumn ? "columnSizes" : "rowSizes"]: sizes },
    x: element.x + moveX,
    y: element.y + moveY,
    width: element.width + (isColumn ? growth : 0),
    height: element.height + (isColumn ? 0 : growth),
  };
}

export function withCellHtml(table: TableSettings, { row, column }: TableCellSpot, html: string): TableSettings {
  return {
    ...table,
    rows: table.rows.map((cells, r) => (r === row ? cells.map((cell, c) => (c === column ? { ...cell, html } : cell)) : cells)),
  };
}

/** The cell Tab (1) or Shift+Tab (-1) goes to, or null past the last or before the first. */
export function nextTableCell(table: TableSettings, { row, column }: TableCellSpot, step: 1 | -1): TableCellSpot | null {
  const columns = table.rows[0].length;
  const index = row * columns + column + step;
  if (index < 0 || index >= table.rows.length * columns) return null;
  return { row: Math.floor(index / columns), column: index % columns };
}

/** Where a cell sits inside its table, in px. Same layout as TableGrid: lines between the cells and around them. */
export function tableCellBox(element: TableElement, { row, column }: TableCellSpot) {
  const columns = tableColumnSizes(element);
  const rows = tableRowSizes(element);
  const startOf = (sizes: number[], index: number) => TABLE_LINE_WIDTH + total(sizes.slice(0, index)) + index * TABLE_LINE_WIDTH;
  return { left: startOf(columns, column), top: startOf(rows, row), width: columns[column], height: rows[row] };
}

/** A picked cell after its row or column was deleted from `table`: the same place, or the last one if that's gone. */
export function pickAfterDelete(table: TableSettings, { row, column }: TableCellSpot): TableCellSpot {
  return { row: Math.min(row, table.rows.length - 1), column: Math.min(column, table.rows[0].length - 1) };
}
