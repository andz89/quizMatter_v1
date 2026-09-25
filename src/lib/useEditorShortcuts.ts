import { useEffect } from "react";
import { useEditorStore } from "./store";
import { isTypingTarget } from "./dom";
import { getContainerBounds } from "./constants";

// How far (px) an arrow key moves the selected element(s); Shift moves further.
const ARROW_STEP = 1;
const ARROW_STEP_SHIFT = 10;
const ARROW_DIRECTIONS: Record<string, { x: number; y: number }> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

/**
 * The editor's keyboard shortcuts, set up once for the whole editor. They read the store when a key
 * is pressed, so the listener never has to be rebuilt when the selection changes.
 *
 * - Ctrl/Cmd+S saves the quiz (also while typing)
 * - Ctrl/Cmd+Z undoes; Ctrl+Y or Ctrl/Cmd+Shift+Z redoes (also while typing, so there's only one undo history)
 * - Ctrl/Cmd+C copies and Ctrl/Cmd+V pastes the selected element(s)
 * - Ctrl/Cmd+G groups, Ctrl/Cmd+Shift+G ungroups
 * - Delete/Backspace removes the selected element(s), Escape deselects
 * - Arrow keys move the selected element(s) 1px (10px with Shift), kept inside their box
 */
export function useEditorShortcuts() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const state = useEditorStore.getState();
      // The editor stays mounted under the presentation, so its shortcuts must not act on hidden slides.
      if (state.isPresenting) return;
      const isMeta = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const { selectedSlideId, selectedElementIds } = state;

      if (isMeta && key === "s") {
        e.preventDefault();
        state.saveQuiz();
        return;
      }
      if (isMeta && key === "z") {
        e.preventDefault();
        if (e.shiftKey) state.redo();
        else state.undo();
        return;
      }
      if (isMeta && key === "y") {
        e.preventDefault();
        state.redo();
        return;
      }

      // Paste an element even while a text field has focus: the user may be typing in the
      // option/question they want to paste into. With an empty clipboard this falls through, so
      // normal text paste still works.
      if (isMeta && key === "v" && state.clipboard) {
        e.preventDefault();
        // No box clicked since copying → undefined, so each element returns to its own box.
        state.pasteClipboard(selectedSlideId, state.selectedContainerId ?? undefined);
        return;
      }

      if (isTypingTarget(e.target)) return;

      if (isMeta && key === "c") {
        // Highlighted text wins over the selected element, so normal text copy still works.
        if (selectedElementIds.length === 0 || window.getSelection()?.toString()) return;
        e.preventDefault();
        state.copySelectedElements();
      } else if (isMeta && key === "g") {
        if (selectedElementIds.length === 0) return;
        // Stops the browser's own Ctrl+G ("find next").
        e.preventDefault();
        if (e.shiftKey) state.ungroupSelectedElements();
        else state.groupSelectedElements();
      } else if (selectedElementIds.length > 0 && (e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault();
        state.deleteElements(selectedSlideId, selectedElementIds);
      } else if (selectedElementIds.length > 0 && ARROW_DIRECTIONS[e.key]) {
        // Stops the page from scrolling.
        e.preventDefault();
        const slide = state.quiz.slides.find((sl) => sl.id === selectedSlideId);
        if (!slide) return;
        const elements = slide.elements.filter((el) => selectedElementIds.includes(el.id));
        const step = e.shiftKey ? ARROW_STEP_SHIFT : ARROW_STEP;
        let dx = ARROW_DIRECTIONS[e.key].x * step;
        let dy = ARROW_DIRECTIONS[e.key].y * step;
        // Shrink the move so no element leaves its box; all move by the same amount to keep their spacing.
        for (const el of elements) {
          const bounds = getContainerBounds(el.containerId, slide);
          // The Math.min/max with 0 stop an element already past an edge from being pushed the wrong way.
          dx = Math.min(Math.max(dx, Math.min(0, -el.x)), Math.max(0, bounds.width - el.width - el.x));
          dy = Math.min(Math.max(dy, Math.min(0, -el.y)), Math.max(0, bounds.height - el.height - el.y));
        }
        if (dx === 0 && dy === 0) return;
        state.updateElements(
          selectedSlideId,
          Object.fromEntries(elements.map((el) => [el.id, { x: el.x + dx, y: el.y + dy }]))
        );
      } else if (e.key === "Escape") {
        state.clearElementSelection();
      }
    };

    // A native text copy/cut means the user now wants text on the clipboard, so drop the copied
    // element — otherwise Ctrl+V would keep pasting the old element instead.
    // (Element copy calls preventDefault on keydown, so it never fires this event.)
    const handleNativeCopy = () => useEditorStore.getState().clearClipboard();

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("copy", handleNativeCopy);
    document.addEventListener("cut", handleNativeCopy);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("copy", handleNativeCopy);
      document.removeEventListener("cut", handleNativeCopy);
    };
  }, []);
}
