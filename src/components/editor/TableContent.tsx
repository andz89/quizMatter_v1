"use client";

import { useEffect } from "react";
import { useEditorStore } from "@/lib/store";
import { DEFAULT_TEXT_COLOR, TABLE_COLUMNS, TABLE_FONT_SIZE, TABLE_ROWS } from "@/lib/constants";
import type { Size } from "@/lib/geometry";
import {
  addTableColumn,
  addTableRow,
  nextTableCell,
  pickAfterDelete,
  removeTableColumn,
  removeTableRow,
  tableCellBox,
  withCellHtml,
  type TableCellSpot,
  type TableSettings,
} from "@/lib/table";
import type { SvgElement } from "@/lib/schema";
import { ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon, PlusIcon, Table2Icon, Trash2Icon } from "lucide-react";
import { TableGrid } from "./ElementSvg";
import { PanelReadout, ToolPanelButton } from "./PanelControls";
import { TextBoxContent } from "./TextBoxContent";

// Off the screen, so the cursor goes to the end of the text instead of under the pointer (Tab).
const CURSOR_AT_END = { x: -1, y: -1 };
// How far past the table's edge a "+" sits, so it never covers the resize handles.
const PLUS_OUT = 20;

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/** Which cell of a table is at this point on the screen, or null. By position: a dragged element's events all point at it. */
export function tableCellAt(x: number, y: number): TableCellSpot | null {
  const cell = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-table-row]");
  return cell ? { row: Number(cell.dataset.tableRow), column: Number(cell.dataset.tableColumn) } : null;
}

interface TableProps {
  slideId: string;
  element: SvgElement;
  table: TableSettings;
}

/**
 * A table on the slide being edited: the same grid as everywhere else, with a text editor in the one cell being
 * typed in. Only that cell has one: a big table would be far too heavy with an editor in every cell.
 */
export function TableContent({ slideId, element, table }: TableProps) {
  const updateElement = useEditorStore((s) => s.updateElement);
  const pick = useEditorStore((s) => (s.pickedTableCell?.elementId === element.id ? s.pickedTableCell : null));
  const setPick = useEditorStore((s) => s.setPickedTableCell);

  // The picked cell can be gone (e.g. undo took away its row).
  const isGone = !!pick && !table.rows[pick.row]?.[pick.column];
  useEffect(() => {
    if (isGone) setPick(null);
  }, [isGone, setPick]);

  const renderCell = (row: number, column: number) => {
    if (!pick?.typingAt || pick.row !== row || pick.column !== column || isGone) return null;
    const spot = { row, column };
    // Only if this is still the cell: moving to another one blurs this one after the pick has changed.
    const stopTyping = () => {
      const current = useEditorStore.getState().pickedTableCell;
      if (current?.elementId === element.id && current.row === row && current.column === column) {
        setPick({ elementId: element.id, ...spot });
      }
    };
    return (
      <div
        className="h-full w-full cursor-text select-text"
        // Clicks inside place the cursor, and a double-click selects a word; neither reaches the table.
        onPointerDown={stop}
        onDoubleClick={stop}
        // Capture, so these keys reach neither the text editor nor the editor's shortcuts.
        onKeyDownCapture={(e) => {
          if (e.key !== "Tab" && e.key !== "Escape") return;
          e.preventDefault();
          e.stopPropagation();
          if (e.key === "Escape") return stopTyping();
          const next = nextTableCell(table, spot, e.shiftKey ? -1 : 1);
          if (next) setPick({ elementId: element.id, ...next, typingAt: CURSOR_AT_END });
        }}
      >
        <TextBoxContent
          html={table.rows[row][column].html}
          fontSize={table.fontSize ?? TABLE_FONT_SIZE}
          target={{ kind: "table", slideId, elementId: element.id }}
          color={DEFAULT_TEXT_COLOR}
          editStart={pick.typingAt}
          isSelected={false}
          onChange={(html) => updateElement(slideId, element.id, { table: withCellHtml(table, spot, html) })}
          onStopEditing={stopTyping}
        />
      </div>
    );
  };

  return <TableGrid table={table} color={element.color} renderCell={renderCell} />;
}

/** One "+" next to the table, in the same look as a diagram's. */
function PlusButton({ title, style, onClick }: { title: string; style: React.CSSProperties; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      tabIndex={-1}
      onPointerDown={stop}
      // No focus: a later Enter or Space would otherwise add another one.
      onMouseDown={(e) => e.preventDefault()}
      onDoubleClick={stop}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="pointer-events-auto absolute flex h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-accent text-white hover:bg-accent-hover"
      style={style}
    >
      <PlusIcon size={12} />
    </button>
  );
}

/** The selected table's picked cell (an outline) and the two "+" that add a row or column at the end. */
export function TableButtons({ slideId, element, table, bounds }: TableProps & { bounds: Size }) {
  const updateElement = useEditorStore((s) => s.updateElement);
  const pick = useEditorStore((s) => (s.pickedTableCell?.elementId === element.id ? s.pickedTableCell : null));
  const placed = { ...element, table };
  const rows = table.rows.length;
  const columns = table.rows[0].length;
  const isPickThere = !!pick && !!table.rows[pick.row]?.[pick.column];

  return (
    <>
      {isPickThere && (
        <div className="pointer-events-none absolute" style={{ ...tableCellBox(placed, pick), outline: "2px solid var(--accent)" }} />
      )}
      {!pick?.typingAt && rows < TABLE_ROWS.max && (
        <PlusButton
          title="Add a row"
          style={{ left: element.width / 2, top: element.height + PLUS_OUT }}
          onClick={() => updateElement(slideId, element.id, addTableRow(placed, rows, bounds))}
        />
      )}
      {!pick?.typingAt && columns < TABLE_COLUMNS.max && (
        <PlusButton
          title="Add a column"
          style={{ left: element.width + PLUS_OUT, top: element.height / 2 }}
          onClick={() => updateElement(slideId, element.id, addTableColumn(placed, columns, bounds))}
        />
      )}
    </>
  );
}

const MENU_ROW =
  "flex items-center gap-3 rounded-dropdown px-2 py-1.5 text-sm text-text-primary hover:bg-bg-page disabled:opacity-40 disabled:hover:bg-transparent";
const DELETE_ROW =
  "flex items-center gap-3 rounded-dropdown px-2 py-1.5 text-sm text-text-primary hover:bg-danger-soft hover:text-danger-strong disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-primary";

/** The toolbar's "Table" menu: add or delete a row or column at the picked cell, or at the last one when none is picked. */
export function TablePanel({ slideId, element, table, bounds }: TableProps & { bounds: Size }) {
  const updateElement = useEditorStore((s) => s.updateElement);
  const pick = useEditorStore((s) => (s.pickedTableCell?.elementId === element.id ? s.pickedTableCell : null));
  const setPick = useEditorStore((s) => s.setPickedTableCell);
  const placed = { ...element, table };
  const rows = table.rows.length;
  const columns = table.rows[0].length;
  const isPickThere = !!pick && !!table.rows[pick.row]?.[pick.column];
  const spot = isPickThere ? { row: pick.row, column: pick.column } : { row: rows - 1, column: columns - 1 };

  // One change, so one undo puts it back. Afterwards this cell is picked, so the same button keeps going the same way.
  const apply = (patch: Partial<SvgElement>, next: TableCellSpot) => {
    updateElement(slideId, element.id, patch);
    setPick({ elementId: element.id, ...next });
  };
  const addRow = (at: number) => apply(addTableRow(placed, at, bounds), { row: at, column: spot.column });
  const addColumn = (at: number) => apply(addTableColumn(placed, at, bounds), { row: spot.row, column: at });
  const remove = (patch: { table: TableSettings } & Partial<SvgElement>) => apply(patch, pickAfterDelete(patch.table, spot));

  return (
    <ToolPanelButton title="Table" icon={<Table2Icon size={18} />}>
      <PanelReadout>
        Row {spot.row + 1} · Column {spot.column + 1}
      </PanelReadout>
      {!isPickThere && <p className="text-center text-xs text-text-secondary">Click a cell to choose another one.</p>}
      <div className="flex flex-col">
        <button type="button" disabled={rows >= TABLE_ROWS.max} onClick={() => addRow(spot.row)} className={MENU_ROW}>
          <ArrowUpIcon size={16} /> Add row above
        </button>
        <button type="button" disabled={rows >= TABLE_ROWS.max} onClick={() => addRow(spot.row + 1)} className={MENU_ROW}>
          <ArrowDownIcon size={16} /> Add row below
        </button>
        <button type="button" disabled={columns >= TABLE_COLUMNS.max} onClick={() => addColumn(spot.column)} className={MENU_ROW}>
          <ArrowLeftIcon size={16} /> Add column left
        </button>
        <button type="button" disabled={columns >= TABLE_COLUMNS.max} onClick={() => addColumn(spot.column + 1)} className={MENU_ROW}>
          <ArrowRightIcon size={16} /> Add column right
        </button>
        <button type="button" disabled={rows <= TABLE_ROWS.min} onClick={() => remove(removeTableRow(placed, spot.row))} className={DELETE_ROW}>
          <Trash2Icon size={16} /> Delete row
        </button>
        <button type="button" disabled={columns <= TABLE_COLUMNS.min} onClick={() => remove(removeTableColumn(placed, spot.column))} className={DELETE_ROW}>
          <Trash2Icon size={16} /> Delete column
        </button>
      </div>
    </ToolPanelButton>
  );
}
