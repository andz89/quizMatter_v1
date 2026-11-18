"use client";

import { EditorContent } from "@tiptap/react";
import { useCanvasTextEditor } from "@/lib/useCanvasTextEditor";
import { TEXT_BOX_FONT_SIZE } from "@/lib/constants";
import type { TextTarget } from "@/lib/store";
import { HiddenTextMark } from "./HiddenTextMark";

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
  onChange: (html: string) => void;
  onStopEditing: () => void;
}

/** The text inside a text box element on the canvas. Read-only until double-clicked, then typeable. */
export function TextBoxContent({ html, fontSize: chosenFontSize = TEXT_BOX_FONT_SIZE, inTableCell = false, target, color, editStart, isSelected, onChange, onStopEditing }: TextBoxContentProps) {
  const { editor, ref, fontSize, hasHiddenText } = useCanvasTextEditor({
    content: html,
    editStart,
    isSelected,
    target,
    fontSize: chosenFontSize,
    onUpdate: (editor) => onChange(editor.isEmpty ? "" : editor.getHTML()),
    onStopEditing,
  });

  return (
    // relative: holds the "+…" mark in its corner.
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
      {hasHiddenText && <HiddenTextMark inTableCell={inTableCell} />}
    </div>
  );
}
