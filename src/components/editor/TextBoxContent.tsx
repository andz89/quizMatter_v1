"use client";

import { EditorContent } from "@tiptap/react";
import { useCanvasTextEditor } from "@/lib/useCanvasTextEditor";
import { TEXT_BOX_FONT_SIZE } from "@/lib/constants";

interface TextBoxContentProps {
  html: string;
  // Text color for words that don't have their own color.
  color: string;
  // Where the user double-clicked to start typing (screen coordinates); null = not editing.
  editStart: { x: number; y: number } | null;
  onChange: (html: string) => void;
  onStopEditing: () => void;
}

/** The text inside a text box element on the canvas. Read-only until double-clicked, then typeable. */
export function TextBoxContent({ html, color, editStart, onChange, onStopEditing }: TextBoxContentProps) {
  const { editor, ref, fontSize } = useCanvasTextEditor({
    content: html,
    editStart,
    minFontSize: TEXT_BOX_FONT_SIZE.min,
    maxFontSize: TEXT_BOX_FONT_SIZE.max,
    onUpdate: (editor) => onChange(editor.isEmpty ? "" : editor.getHTML()),
    onStopEditing,
  });

  return (
    <div
      ref={ref}
      // Not typing: no text highlighting, so dragging moves the box instead.
      className={`h-full w-full overflow-hidden break-words ${editStart ? "" : "select-none"}`}
      style={{ fontSize, lineHeight: 1.25, color }}
    >
      <EditorContent editor={editor} />
    </div>
  );
}
