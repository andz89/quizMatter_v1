"use client";

import { useState } from "react";
import { EditorContent } from "@tiptap/react";
import { useCanvasTextEditor } from "@/lib/useCanvasTextEditor";
import { textToHtml } from "@/lib/richText";
import { useEditorStore, type TextTarget } from "@/lib/store";
import { fittingSize } from "@/lib/textFit";
import { HiddenTextMark } from "./HiddenTextMark";
import { GrowTextMark } from "./GrowTextMark";

interface EditableTextProps {
  text: string;
  // Styled version of `text`. Missing on presentations saved before styled text existed.
  html: string | undefined;
  onChange: (text: string, html: string) => void;
  placeholder: string;
  target: TextTarget;
  // Always shown at this size: long text goes onto new lines, and what's past the box's bottom is cut off.
  fontSize: number;
  // Selected with one click: the header shows the format toolbar for all of this text.
  isSelected?: boolean;
  className?: string;
  // The question and answer choices: a click on the "+…" mark makes the text smaller so all of it shows, and a click
  // on the grow mark (the next size up fits) makes it bigger, as big as still fits (textFit.ts, on this real box).
  canFit?: boolean;
}

export function EditableText({
  text,
  html,
  onChange,
  placeholder,
  target,
  fontSize: chosenFontSize,
  isSelected = false,
  className,
  canFit = false,
}: EditableTextProps) {
  const setTextFontSizes = useEditorStore((s) => s.setTextFontSizes);
  // Where the user double-clicked to start typing (screen coordinates); null = not editing.
  // Read-only until then, so a drag on the box draws the selection rectangle instead of selecting words.
  const [editStart, setEditStart] = useState<{ x: number; y: number } | null>(null);

  const { editor, ref, fontSize, hasHiddenText, hasSpareRoom } = useCanvasTextEditor({
    content: html ?? textToHtml(text),
    editStart,
    target,
    fontSize: chosenFontSize,
    isSelected,
    editorClass: "h-full",
    hasTextLimit: true,
    onUpdate: (editor) => {
      if (editor.isEmpty) onChange("", "");
      else onChange(editor.getText({ blockSeparator: "\n" }), editor.getHTML());
    },
    onStopEditing: () => setEditStart(null),
  });

  // The teacher's click on "+…" or the grow mark: the biggest size at which this text shows whole in its box.
  const fit = () => {
    if (!ref.current) return;
    const size = fittingSize(ref.current);
    if (size !== fontSize) setTextFontSizes([target], size);
  };

  return (
    <div
      // Already typing: leave it be, so a double-click selects a word instead of moving the cursor.
      onDoubleClick={(e) => setEditStart((current) => current ?? { x: e.clientX, y: e.clientY })}
      className={`relative flex h-full w-full items-center ${editStart ? "cursor-text" : ""}`}
    >
      {text === "" && (
        <span className="pointer-events-none absolute text-text-secondary" style={{ fontSize }}>
          {placeholder}
        </span>
      )}
      <div
        ref={ref}
        // Not typing: no text highlighting, so a drag draws the selection rectangle instead.
        className={`h-full w-full overflow-hidden ${editStart ? "" : "select-none"} ${className ?? ""}`}
        style={{ fontSize, lineHeight: 1.25 }}
      >
        <EditorContent editor={editor} className="h-full" />
      </div>
      {hasHiddenText && <HiddenTextMark onFit={canFit ? fit : undefined} />}
      {canFit && !hasHiddenText && hasSpareRoom && !editStart && <GrowTextMark onFit={fit} isSelected={isSelected} />}
    </div>
  );
}
