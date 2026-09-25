"use client";

import { EditorContent } from "@tiptap/react";
import { useCanvasTextEditor } from "@/lib/useCanvasTextEditor";
import { TEXT_BOX_FONT_SIZE } from "@/lib/constants";
import { TextOverflowMark } from "./TextOverflowMark";
import type { TextTarget } from "@/lib/store";

interface TextBoxContentProps {
  html: string;
  // Chosen font size. Missing = the default.
  fontSize: number | undefined;
  target: TextTarget;
  // Text color for words that don't have their own color.
  color: string;
  // Where the user double-clicked to start typing (screen coordinates); null = not editing.
  editStart: { x: number; y: number } | null;
  onChange: (html: string) => void;
  onStopEditing: () => void;
}

/** The text inside a text box element on the canvas. Read-only until double-clicked, then typeable. */
export function TextBoxContent({ html, fontSize = TEXT_BOX_FONT_SIZE, target, color, editStart, onChange, onStopEditing }: TextBoxContentProps) {
  const { editor, ref, overflows } = useCanvasTextEditor({
    content: html,
    editStart,
    target,
    fontSize,
    onUpdate: (editor) => onChange(editor.isEmpty ? "" : editor.getHTML()),
    onStopEditing,
  });

  return (
    <div className="relative h-full w-full">
      <div
        ref={ref}
        // Not typing: no text highlighting, so dragging moves the box instead.
        className={`h-full w-full overflow-hidden break-words ${editStart ? "" : "select-none"}`}
        style={{ fontSize, lineHeight: 1.25, color }}
      >
        <EditorContent editor={editor} />
      </div>
      {overflows && <TextOverflowMark />}
    </div>
  );
}
