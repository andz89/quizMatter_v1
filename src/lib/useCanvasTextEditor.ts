import { useEffect } from "react";
import { useEditor, type Editor } from "@tiptap/react";
import { useEditorStore } from "@/lib/store";
import { useAutoFitText } from "@/lib/useAutoFitText";
import { TEXT_EXTENSIONS } from "@/lib/richText";

interface CanvasTextEditorOptions {
  // The stored HTML to show.
  content: string;
  // Where the user double-clicked to start typing (screen coordinates); null = not typing.
  editStart: { x: number; y: number } | null;
  minFontSize: number;
  maxFontSize: number;
  // Extra classes on the editable area itself.
  editorClass?: string;
  onUpdate: (editor: Editor) => void;
  onStopEditing: () => void;
}

/**
 * The typing setup shared by every text on the canvas (question, options, text boxes): read-only
 * until double-clicked, plain-text paste, Escape to stop, the header's format toolbar, and text
 * that shrinks to fit its box.
 */
export function useCanvasTextEditor({
  content,
  editStart,
  minFontSize,
  maxFontSize,
  editorClass = "",
  onUpdate,
  onStopEditing,
}: CanvasTextEditorOptions) {
  const setActiveTextEditor = useEditorStore((s) => s.setActiveTextEditor);
  const { ref, fontSize, remeasure } = useAutoFitText<HTMLDivElement>({ minFontSize, maxFontSize });

  const editor = useEditor({
    extensions: TEXT_EXTENSIONS,
    content,
    editable: false,
    // Next.js renders this on the server first; the editor can only be built in the browser.
    immediatelyRender: false,
    editorProps: {
      attributes: { class: `outline-none ${editorClass}` },
      handleDOMEvents: {
        // Paste as plain text only, so colors and fonts from other sites don't come along.
        paste: (view, event) => {
          event.preventDefault();
          view.pasteText(event.clipboardData?.getData("text/plain") ?? "");
          return true;
        },
        // Escape stops typing (a text box stays selected).
        keydown: (view, event) => {
          if (event.key !== "Escape") return false;
          (view.dom as HTMLElement).blur();
          return true;
        },
      },
    },
    onUpdate: ({ editor }) => {
      onUpdate(editor);
      remeasure();
    },
    // The header shows the format toolbar for whichever text has focus.
    onFocus: ({ editor }) => setActiveTextEditor(editor),
    // Only clear it if it's still this text — when jumping straight into another one, that one may
    // already have claimed it.
    onBlur: ({ editor }) => {
      if (useEditorStore.getState().activeTextEditor === editor) setActiveTextEditor(null);
      onStopEditing();
    },
  });

  // Double-click turns on typing and puts the cursor where the user clicked; leaving turns it off.
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editStart !== null, false);
    if (editStart) {
      const pos = editor.view.posAtCoords({ left: editStart.x, top: editStart.y })?.pos;
      editor.commands.focus(pos ?? "end");
    }
  }, [editor, editStart]);

  // Removed while being edited (e.g. deleted, or its slide was): drop it from the header too.
  useEffect(() => {
    return () => {
      if (editor && useEditorStore.getState().activeTextEditor === editor) setActiveTextEditor(null);
    };
  }, [editor, setActiveTextEditor]);

  // Text changed from outside (e.g. "Clear text" or undo): show the new value. While typing, the
  // editor and the stored value always match, so this never moves the cursor mid-edit.
  useEffect(() => {
    if (!editor) return;
    const current = editor.isEmpty ? "" : editor.getHTML();
    if (current !== content) {
      editor.commands.setContent(content, { emitUpdate: false });
      // Replacing the text drops the cursor, so if the user is typing here (e.g. pressed Ctrl+Z),
      // put the cursor back at the end.
      if (editor.isFocused) editor.commands.focus("end");
    }
    remeasure();
  }, [editor, content, remeasure]);

  return { editor, ref, fontSize };
}
