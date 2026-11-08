"use client";

import { useEffect } from "react";
import { useEditorStore } from "@/lib/store";
import { DEFAULT_TEXT_COLOR, TABLE_FONT_SIZE } from "@/lib/constants";
import { nextTableCell, withCellHtml, type TableCellSpot, type TableSettings } from "@/lib/table";
import type { SvgElement } from "@/lib/schema";
import { TableGrid } from "./ElementSvg";
import { TextBoxContent } from "./TextBoxContent";

// Off the screen, so the cursor goes to the end of the text instead of under the pointer (Tab).
const CURSOR_AT_END = { x: -1, y: -1 };

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
