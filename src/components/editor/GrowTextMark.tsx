import { ALargeSmallIcon } from "lucide-react";

/**
 * In the bottom-right corner of the question, an answer choice or a text box whose next text size up still fits: a click makes the
 * text bigger, as big as still fits (the teacher's own click, never by itself). Shown while the box is hovered or
 * selected, so short options don't all carry one. The other side of HiddenTextMark ("+…", which makes text smaller).
 * Its parent must be `relative` inside a `group/box`.
 */
export function GrowTextMark({ onFit, isSelected, inTextBox = false }: { onFit: () => void; isSelected: boolean; inTextBox?: boolean }) {
  // A text box has no hoverable box around it (one inside an option would show it on the option's hover): selected
  // only, and fully inside its corner, clear of the selected box's corner resize handle.
  if (inTextBox && !isSelected) return null;
  return (
    <button
      type="button"
      data-grow-text-mark
      title="There's room: click to make the text bigger so it fills the box."
      // Keeps the focus, so pressing it while typing doesn't stop the typing.
      onMouseDown={(e) => e.preventDefault()}
      // A text box takes the pointer on press (to drag it), which would swallow the click: keep the press here.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        // Only the fit: not a click on the box under it.
        e.stopPropagation();
        onFit();
      }}
      // Sizes are slide pixels: the canvas is zoomed to fit the screen.
      className={`absolute z-10 flex ${inTextBox ? "right-4 bottom-4" : "right-0 bottom-0 translate-x-1/3 translate-y-1/3"} cursor-pointer items-center rounded-dropdown bg-accent-soft p-1.5 text-accent transition-opacity hover:ring-2 hover:ring-accent ${
        isSelected ? "opacity-100" : "pointer-events-none opacity-0 group-hover/box:pointer-events-auto group-hover/box:opacity-100"
      }`}
    >
      <ALargeSmallIcon size={26} />
    </button>
  );
}
