// The table element's math: what a table becomes when a row or column is added or deleted, or a cell typed in. Spec:
// docs/superpowers/specs/2026-11-08-table-element-design.md. Every function makes new arrays, so a changed slide is a
// new object and gets saved (see "State" in src/components/editor/CLAUDE.md).
import { TABLE_LINE_WIDTH } from "./constants";
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

// One more row or column of the same size, up to the box's edge. A table already at or past the edge keeps its size.
const grown = (size: number, count: number, start: number, boxSize: number) =>
  Math.min(size + size / count, Math.max(size, boxSize - start));

const shrunk = (size: number, count: number) => Math.max(MIN_ELEMENT_SIZE, size - size / count);

/** A new empty row at `at`. The table gets one row taller, as far as its box allows. */
export function addTableRow({ table, y, height }: TableElement, at: number, bounds: Size) {
  return {
    table: { ...table, rows: insertAt(table.rows, at, emptyRow(table.rows[0].length)) },
    height: grown(height, table.rows.length, y, bounds.height),
  };
}

/** A new empty column at `at`. The table gets one column wider, as far as its box allows. */
export function addTableColumn({ table, x, width }: TableElement, at: number, bounds: Size) {
  return {
    table: { ...table, rows: table.rows.map((cells) => insertAt(cells, at, emptyCell())) },
    width: grown(width, table.rows[0].length, x, bounds.width),
  };
}

/** Only called on a table with more than one row. */
export function removeTableRow({ table, height }: TableElement, at: number) {
  return { table: { ...table, rows: removeAt(table.rows, at) }, height: shrunk(height, table.rows.length) };
}

/** Only called on a table with more than one column. */
export function removeTableColumn({ table, width }: TableElement, at: number) {
  return { table: { ...table, rows: table.rows.map((cells) => removeAt(cells, at)) }, width: shrunk(width, table.rows[0].length) };
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
export function tableCellBox({ table, width, height }: TableElement, { row, column }: TableCellSpot) {
  const rows = table.rows.length;
  const columns = table.rows[0].length;
  const cellWidth = (width - TABLE_LINE_WIDTH * (columns + 1)) / columns;
  const cellHeight = (height - TABLE_LINE_WIDTH * (rows + 1)) / rows;
  return {
    left: TABLE_LINE_WIDTH + column * (cellWidth + TABLE_LINE_WIDTH),
    top: TABLE_LINE_WIDTH + row * (cellHeight + TABLE_LINE_WIDTH),
    width: cellWidth,
    height: cellHeight,
  };
}

/** A picked cell after its row or column was deleted from `table`: the same place, or the last one if that's gone. */
export function pickAfterDelete(table: TableSettings, { row, column }: TableCellSpot): TableCellSpot {
  return { row: Math.min(row, table.rows.length - 1), column: Math.min(column, table.rows[0].length - 1) };
}
