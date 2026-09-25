"use client";

import { useEffect, useState } from "react";
import { EditorContent } from "@tiptap/react";
import { useCanvasTextEditor } from "@/lib/useCanvasTextEditor";
import { textToHtml } from "@/lib/richText";
import type { TextTarget } from "@/lib/store";

interface EditableTextProps {
  text: string;
  // Styled version of `text`. Missing on quizzes saved before styled text existed.
  html: string | undefined;
  onChange: (text: string, html: string) => void;
  placeholder: string;
  target: TextTarget;
  fontSize: number;
  // Told whether the text is too long for its box, so the box can show the red mark.
  onOverflowChange: (overflows: boolean) => void;
  // Selected with one click: the header shows the format toolbar for all of this text.
  isSelected?: boolean;
  className?: string;
}

export function EditableText({
  text,
  html,
  onChange,
  placeholder,
  target,
  fontSize,
  onOverflowChange,
  isSelected = false,
  className,
}: EditableTextProps) {
  // Where the user double-clicked to start typing (screen coordinates); null = not editing.
  // Read-only until then, so a drag on the box draws the selection rectangle instead of selecting words.
  const [editStart, setEditStart] = useState<{ x: number; y: number } | null>(null);

  const { editor, ref, overflows } = useCanvasTextEditor({
    content: html ?? textToHtml(text),
    editStart,
    target,
    fontSize,
    isSelected,
    editorClass: "h-full",
    onUpdate: (editor) => {
      if (editor.isEmpty) onChange("", "");
      else onChange(editor.getText({ blockSeparator: "\n" }), editor.getHTML());
    },
    onStopEditing: () => setEditStart(null),
  });

  useEffect(() => onOverflowChange(overflows), [overflows, onOverflowChange]);

  return (
    <div
      // Already typing: leave it be, so a double-click selects a word instead of moving the cursor.
      onDoubleClick={(e) => setEditStart((current) => current ?? { x: e.clientX, y: e.clientY })}
      className={`relative flex h-full w-full items-center overflow-hidden ${editStart ? "cursor-text" : ""}`}
    >
      {text === "" && (
        <span className="pointer-events-none absolute text-text-secondary" style={{ fontSize }}>
          {placeholder}
        </span>
      )}
      <div
        ref={ref}
        // Not typing: no text highlighting, so a drag draws the selection rectangle instead.
        className={`h-full w-full overflow-hidden break-words ${editStart ? "" : "select-none"} ${className ?? ""}`}
        style={{ fontSize, lineHeight: 1.25 }}
      >
        <EditorContent editor={editor} className="h-full" />
      </div>
    </div>
  );
}
