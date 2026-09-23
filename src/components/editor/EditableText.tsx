"use client";

import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEditorStore } from "@/lib/store";
import { useAutoFitText } from "@/lib/useAutoFitText";
import { TEXT_EXTENSIONS, textToHtml } from "@/lib/richText";

interface EditableTextProps {
  text: string;
  // Styled version of `text`. Missing on quizzes saved before styled text existed.
  html: string | undefined;
  onChange: (text: string, html: string) => void;
  placeholder: string;
  minFontSize: number;
  maxFontSize: number;
  className?: string;
}

export function EditableText({
  text,
  html,
  onChange,
  placeholder,
  minFontSize,
  maxFontSize,
  className,
}: EditableTextProps) {
  const setActiveTextEditor = useEditorStore((s) => s.setActiveTextEditor);
  const { ref, fontSize, remeasure } = useAutoFitText<HTMLDivElement>({ minFontSize, maxFontSize });
  const content = html ?? textToHtml(text);

  const editor = useEditor({
    extensions: TEXT_EXTENSIONS,
    content,
    // Next.js renders this on the server first; the editor can only be built in the browser.
    immediatelyRender: false,
    editorProps: {
      attributes: { class: "h-full outline-none" },
      handleDOMEvents: {
        // Paste as plain text only, so colors and fonts from other sites don't come along.
        paste: (view, event) => {
          event.preventDefault();
          view.pasteText(event.clipboardData?.getData("text/plain") ?? "");
          return true;
        },
      },
    },
    onUpdate: ({ editor }) => {
      if (editor.isEmpty) onChange("", "");
      else onChange(editor.getText({ blockSeparator: "\n" }), editor.getHTML());
      remeasure();
    },
    // The header shows the format toolbar for whichever box has focus.
    onFocus: ({ editor }) => setActiveTextEditor(editor),
    // Only clear it if it's still this box — when jumping straight into another box, that box may
    // already have claimed it.
    onBlur: ({ editor }) => {
      if (useEditorStore.getState().activeTextEditor === editor) setActiveTextEditor(null);
    },
  });

  // This box is removed while being edited (e.g. its slide was deleted): drop it from the header too.
  useEffect(() => {
    return () => {
      if (editor && useEditorStore.getState().activeTextEditor === editor) setActiveTextEditor(null);
    };
  }, [editor, setActiveTextEditor]);

  // Text changed from outside (e.g. the "Clear text" button or undo): show the new value. While typing,
  // the editor and the stored value always match, so this never moves the cursor mid-edit.
  useEffect(() => {
    if (!editor) return;
    const current = editor.isEmpty ? "" : editor.getHTML();
    if (current !== content) {
      editor.commands.setContent(content, { emitUpdate: false });
      // Replacing the text drops the cursor, so if the user is in this field (e.g. pressed Ctrl+Z
      // while typing), put the cursor back at the end.
      if (editor.isFocused) editor.commands.focus("end");
    }
    remeasure();
  }, [editor, content, remeasure]);

  return (
    <div className="relative flex h-full w-full items-center overflow-hidden">
      {text === "" && (
        <span className="pointer-events-none absolute text-text-secondary" style={{ fontSize }}>
          {placeholder}
        </span>
      )}
      <div
        ref={ref}
        className={`h-full w-full overflow-hidden break-words ${className ?? ""}`}
        style={{ fontSize, lineHeight: 1.25 }}
      >
        <EditorContent editor={editor} className="h-full" />
      </div>
    </div>
  );
}
