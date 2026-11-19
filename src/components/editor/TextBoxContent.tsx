"use client";

import { EditorContent } from "@tiptap/react";
import { useCanvasTextEditor } from "@/lib/useCanvasTextEditor";
import { TEXT_BOX_FONT_SIZE } from "@/lib/constants";
import { useEditorStore, type TextTarget } from "@/lib/store";
import { fittingSize } from "@/lib/textFit";
import { OUTSIDE_CORNER, type MarkPlace } from "@/lib/markPlace";
import { HiddenTextMark } from "./HiddenTextMark";
import { GrowTextMark } from "./GrowTextMark";

interface TextBoxContentProps {
  html: string;
  // Chosen font size, always kept (long text goes onto new lines). Missing = the default.
  fontSize: number | undefined;
  // A table's cell: the "+…" mark goes to the cell's corner, past its padding.
  inTableCell?: boolean;
  target: TextTarget;
  // Text color for words that don't have their own color.
  color: string;
  // Where the user double-clicked to start typing (screen coordinates); null = not editing.
  editStart: { x: number; y: number } | null;
  // Selected on its own with one click: the header's format toolbar changes all of its text.
  isSelected: boolean;
  // Where its "+…" and grow marks sit (outside the box, away from the slide's edges). Missing = past the bottom-right.
  markPlace?: MarkPlace;
  onChange: (html: string) => void;
  onStopEditing: () => void;
}

/** The text inside a text box element on the canvas. Read-only until double-clicked, then typeable. */
export function TextBoxContent({ html, fontSize: chosenFontSize = TEXT_BOX_FONT_SIZE, inTableCell = false, target, color, editStart, isSelected, markPlace = OUTSIDE_CORNER, onChange, onStopEditing }: TextBoxContentProps) {
  const setTextFontSizes = useEditorStore((s) => s.setTextFontSizes);
  const { editor, ref, fontSize, hasHiddenText, hasSpareRoom } = useCanvasTextEditor({
    content: html,
    editStart,
    isSelected,
    target,
    fontSize: chosenFontSize,
    // A text box's grow mark shows only while it's selected, never while typing; table cells have none.
    checkSpareRoom: !inTableCell && isSelected && !editStart,
    isTableCell: inTableCell,
    onUpdate: (editor) => onChange(editor.isEmpty ? "" : editor.getHTML()),
    onStopEditing,
  });

  // The teacher's click on "+…" or the grow mark (text boxes; a table's text size is the whole table's): the biggest
  // size at which this text shows whole in its box (textFit.ts).
  const fit = () => {
    if (!ref.current) return;
    const size = fittingSize(ref.current);
    if (size !== fontSize) setTextFontSizes([target], size);
  };

  return (
    // relative: holds the "+…" and grow marks by its corner.
    <div className="relative h-full w-full">
      <div
        ref={ref}
        // Not typing: no text highlighting, so dragging moves the box instead. The text sits in the middle
        // (top to bottom); "safe" puts it back at the top when it's too long, so its start is never cut off.
        className={`flex h-full w-full flex-col justify-center-safe overflow-hidden ${editStart ? "" : "select-none"}`}
        style={{ fontSize, lineHeight: 1.25, color }}
      >
        <EditorContent editor={editor} />
      </div>
      {hasHiddenText && <HiddenTextMark onFit={fit} place={markPlace} />}
      {!inTableCell && !hasHiddenText && hasSpareRoom && !editStart && <GrowTextMark onFit={fit} isSelected={isSelected} inTextBox place={markPlace} />}
    </div>
  );
}
