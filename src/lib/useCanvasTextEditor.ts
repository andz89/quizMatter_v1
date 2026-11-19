import { useEffect, useMemo, useRef } from "react";
import { useEditor, type Editor } from "@tiptap/react";
import type { EditorView } from "@tiptap/pm/view";
import { toast } from "sonner";
import { useEditorStore, type TextTarget } from "@/lib/store";
import { TEXT_EXTENSIONS } from "@/lib/richText";
import { useTextRoom } from "@/lib/useHasHiddenText";
import { HTML_MAX, PLAIN_TEXT_MAX } from "@/lib/schema";
import { TEXT_LIMIT_MESSAGE, TextLimit } from "@/lib/textLimit";

// One id, so a teacher holding a key at the limit sees one toast, not a stack.
const showLimitToast = () => toast.error(TEXT_LIMIT_MESSAGE, { id: "text-limit" });

// Fixed lists (never new objects), so the editor is never rebuilt. The question and answer choices also save their
// plain text, which has its own limit; text boxes and table cells save only HTML.
const WITH_TEXT_LIMIT = [...TEXT_EXTENSIONS, TextLimit.configure({ maxText: PLAIN_TEXT_MAX, maxHtml: HTML_MAX, onRefused: showLimitToast })];
const HTML_LIMIT_ONLY = [...TEXT_EXTENSIONS, TextLimit.configure({ maxText: null, maxHtml: HTML_MAX, onRefused: showLimitToast })];

const TEXT_DOM_EVENTS = {
  // Paste as plain text only, so colors and fonts from other sites don't come along.
  paste: (view: EditorView, event: ClipboardEvent) => {
    event.preventDefault();
    view.pasteText(event.clipboardData?.getData("text/plain") ?? "");
    return true;
  },
  // Escape stops typing (a text box stays selected).
  keydown: (view: EditorView, event: KeyboardEvent) => {
    if (event.key !== "Escape") return false;
    (view.dom as HTMLElement).blur();
    return true;
  },
};

interface CanvasTextEditorOptions {
  // The stored HTML to show.
  content: string;
  // Where the user double-clicked to start typing (screen coordinates); null = not typing.
  editStart: { x: number; y: number } | null;
  // Which text this is, so the format toolbar can change its font size.
  target: TextTarget;
  // Always shown at this size: long text goes onto new lines, and what's past the box's bottom is cut off.
  fontSize: number;
  // Selected with one click (not typing): the header's format toolbar changes all of this text.
  isSelected?: boolean;
  // Extra classes on the editable area itself.
  editorClass?: string;
  // Also stop the plain text at PLAIN_TEXT_MAX (the question and answer choices save it). The HTML always stops at
  // HTML_MAX.
  hasTextLimit?: boolean;
  // Also check whether the next text size up fits (the grow mark); only while that mark can show.
  checkSpareRoom?: boolean;
  // A table's cell: never marked or fitted (the user's rule: tables show no "+…" and no grow mark).
  isTableCell?: boolean;
  onUpdate: (editor: Editor) => void;
  onStopEditing: () => void;
}

/**
 * The typing setup shared by every text on the canvas (question, options, text boxes): read-only
 * until double-clicked, plain-text paste, Escape to stop, the header's format toolbar, and
 * the save limits (a change past them is refused with a toast), and whether some text is cut off.
 */
export function useCanvasTextEditor({
  content,
  editStart,
  target,
  fontSize,
  isSelected = false,
  editorClass = "",
  hasTextLimit = false,
  checkSpareRoom = false,
  isTableCell = false,
  onUpdate,
  onStopEditing,
}: CanvasTextEditorOptions) {
  const setActiveTextEditor = useEditorStore((s) => s.setActiveTextEditor);
  const ref = useRef<HTMLDivElement>(null);
  // Read when the editor gets focus; kept in a ref so that handler always sees the latest one.
  const targetRef = useRef(target);
  useEffect(() => {
    targetRef.current = target;
  });

  // The same object between redraws: Tiptap re-applies its options to the editor (slow) whenever
  // one of them is a new object, and the canvas redraws on every pointer-move while dragging.
  const editorProps = useMemo(
    () => ({ attributes: { class: `outline-none ${editorClass}` }, handleDOMEvents: TEXT_DOM_EVENTS }),
    [editorClass]
  );

  const editor = useEditor({
    extensions: hasTextLimit ? WITH_TEXT_LIMIT : HTML_LIMIT_ONLY,
    content,
    editable: false,
    // Next.js renders this on the server first; the editor can only be built in the browser.
    immediatelyRender: false,
    editorProps,
    onUpdate: ({ editor }) => {
      onUpdate(editor);
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
    // Typing near the bottom scrolls the box to the cursor (its overflow is hidden, not unscrollable). When typing
    // stops, go back to the top, so the text's start shows and only its end is cut off (where "+…" points).
    if (!editStart && ref.current) ref.current.scrollTop = 0;
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
  }, [editor, content]);

  // Text past the box's bottom is cut off: the component shows "+…" (HiddenTextMark) so the teacher sees it. Room for
  // a bigger size (`hasSpareRoom`, only with `checkSpareRoom`): the question, answer choices and text boxes offer to
  // make it bigger (GrowTextMark).
  const room = useTextRoom(ref, !isTableCell, checkSpareRoom && !isTableCell);

  return { editor, ref, fontSize, hasHiddenText: room.hidden, hasSpareRoom: room.spare };
}
