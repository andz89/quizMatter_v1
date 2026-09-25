import { useEffect, useLayoutEffect, useRef } from "react";
import { useEditor, type Editor } from "@tiptap/react";
import { useEditorStore, type TextTarget } from "@/lib/store";
import { useTextOverflow } from "@/lib/useTextOverflow";
import { TEXT_EXTENSIONS } from "@/lib/richText";

interface CanvasTextEditorOptions {
  // The stored HTML to show.
  content: string;
  // Where the user double-clicked to start typing (screen coordinates); null = not typing.
  editStart: { x: number; y: number } | null;
  // Which text this is, so the format toolbar can change its font size.
  target: TextTarget;
  fontSize: number;
  // Selected with one click (not typing): the header's format toolbar changes all of this text.
  isSelected?: boolean;
  // Extra classes on the editable area itself.
  editorClass?: string;
  onUpdate: (editor: Editor) => void;
  onStopEditing: () => void;
}

/**
 * The typing setup shared by every text on the canvas (question, options, text boxes): read-only
 * until double-clicked, plain-text paste, Escape to stop, the header's format toolbar, and a check
 * for text that's too long for its box.
 */
export function useCanvasTextEditor({
  content,
  editStart,
  target,
  fontSize,
  isSelected = false,
  editorClass = "",
  onUpdate,
  onStopEditing,
}: CanvasTextEditorOptions) {
  const setActiveTextEditor = useEditorStore((s) => s.setActiveTextEditor);
  const { ref, overflows, check } = useTextOverflow<HTMLDivElement>();
  // Read when the editor gets focus; kept in a ref so that handler always sees the latest one.
  const targetRef = useRef(target);
  useEffect(() => {
    targetRef.current = target;
  });

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
      check();
    },
    // The header shows the format toolbar for whichever text has focus.
    onFocus: ({ editor }) => setActiveTextEditor(editor, targetRef.current),
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

  // Selected but not typing: join the texts the format toolbar changes as a whole. All of it is
  // selected, so the toolbar shows (and changes) the style of the whole text. Typing takes over
  // through onFocus/onBlur.
  const isSelectedNotTyping = isSelected && editStart === null;
  const addSelectedTextEditor = useEditorStore((s) => s.addSelectedTextEditor);
  const removeSelectedTextEditor = useEditorStore((s) => s.removeSelectedTextEditor);
  useEffect(() => {
    if (!editor || !isSelectedNotTyping) return;
    editor.commands.selectAll();
    addSelectedTextEditor({ editor, target: targetRef.current });
    return () => removeSelectedTextEditor(editor);
  }, [editor, isSelectedNotTyping, addSelectedTextEditor, removeSelectedTextEditor]);

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
    check();
  }, [editor, content, check]);

  // A new font size makes the text bigger or smaller without resizing the box.
  useLayoutEffect(check, [fontSize, check]);

  return { editor, ref, overflows };
}
