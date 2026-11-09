/**
 * The size of Claude's tables. A cell's text never shrinks (it goes onto new lines, and lines past the cell's bottom are
 * cut off), so rows are sized from their text here and the ones that still don't fit are reported back to Claude. Kept
 * apart from importPresentation.ts (which loads drawings) so it's tested.
 */
import { TABLE_FONT_SIZE, TABLE_LINE_WIDTH } from "./constants";
import type { Size } from "./geometry";
import { tableColumnSizes, tableRowSizes, type TableElement, type TableSettings } from "./table";

// The room a cell's edges take from its text (px): TableGrid's px-2 and py-1, both sides.
const CELL_PADDING_X = 16;
const CELL_PADDING_Y = 8;
// A table the app places starts this wide, or wider when it has many columns.
const START_WIDTH = 600;
const START_COLUMN_WIDTH = 100;

/** How tall `text` is in px, at this width and font size. Each \n starts a new line. */
type MeasureText = (text: string, width: number, fontSize: number, bold: boolean) => number;

// A cell's HTML as its words: a paragraph is a line, and an escaped letter (&amp;) counts as one letter.
const cellWords = (html: string) =>
  html
    .replace(/<\/p>\s*<p[^>]*>/g, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&[a-z0-9#]+;/gi, "x");

// How tall each row must be to show all its text, in px.
function rowNeeds(table: TableSettings, columnWidths: number[], measure: MeasureText) {
  const fontSize = table.fontSize ?? TABLE_FONT_SIZE;
  return table.rows.map((cells) =>
    Math.max(
      ...cells.map(
        ({ html }, column) =>
          measure(cellWords(html), Math.max(1, columnWidths[column] - CELL_PADDING_X), fontSize, html.includes("<strong>")) + CELL_PADDING_Y,
      ),
    ),
  );
}

/** The size a table starts at when the app places it: as tall as its text, inside `box`. */
export function tableStartSize(table: TableSettings, box: Size, measure: MeasureText): Size {
  const width = Math.min(box.width, Math.max(START_WIDTH, table.rows[0].length * START_COLUMN_WIDTH));
  const needs = rowNeeds(table, tableColumnSizes({ x: 0, y: 0, width, height: 0, table }), measure);
  const height = needs.reduce((sum, need) => sum + need, 0) + TABLE_LINE_WIDTH * (table.rows.length + 1);
  return { width, height: Math.min(box.height, height) };
}

/**
 * The table with its rows shared out by the text they hold, unless Claude chose the sizes itself, and which rows (from
 * 0) are still too short for their text.
 */
export function fitTableRows(element: TableElement, measure: MeasureText): { table: TableSettings; cutOff: number[] } {
  const needs = rowNeeds(element.table, tableColumnSizes(element), measure);
  // Rows that all need the same room are the table's normal look: nothing to save.
  const table = element.table.rowSizes || needs.every((need) => need === needs[0]) ? element.table : { ...element.table, rowSizes: needs };
  const heights = tableRowSizes({ ...element, table });
  return { table, cutOff: needs.flatMap((need, row) => (need > heights[row] + 1 ? [row] : [])) };
}
