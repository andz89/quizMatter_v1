import { ALargeSmallIcon } from "lucide-react";
import { OUTSIDE_CORNER, markPlaceClasses, type MarkPlace } from "@/lib/markPlace";

/**
 * Outside (markPlace.ts, above the box, right edges lined up) the question, an answer choice or a text box whose next text size up still
 * fits: a click makes the text bigger, as big as still fits (the teacher's own click, never by itself). Shown while the
 * box is hovered or selected, so short options don't all carry one. The other side of HiddenTextMark ("+…", which
 * makes text smaller). Outside, so it never covers the text or the resize handles, even on a small box.
 * Its parent must be `relative` inside a `group/box`.
 */
export function GrowTextMark({
  onFit,
  isSelected,
  inTextBox = false,
  place = OUTSIDE_CORNER,
}: {
  onFit: () => void;
  isSelected: boolean;
  inTextBox?: boolean;
  place?: MarkPlace;
}) {
  // A text box has no hoverable box around it (one inside an option would show it on the option's hover): selected only.
  if (inTextBox && !isSelected) return null;
  return (
    // The see-through gap is part of the holder, so moving the mouse from the box to the mark keeps the box hovered.
    // Selected (always shown, handles out), the gap lets the press through to the handle.
    <span
      className={`absolute z-10 ${markPlaceClasses(place)} transition-opacity ${
        isSelected ? "pointer-events-none" : "pointer-events-none opacity-0 group-hover/box:pointer-events-auto group-hover/box:opacity-100"
      }`}
    >
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
        className={`flex cursor-pointer items-center rounded-dropdown bg-accent-soft p-1.5 text-accent hover:ring-2 hover:ring-accent ${
          isSelected ? "pointer-events-auto" : "pointer-events-none group-hover/box:pointer-events-auto"
        }`}
      >
        <ALargeSmallIcon size={26} />
      </button>
    </span>
  );
}
