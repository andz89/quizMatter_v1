// Where a text's "+…" or grow mark sits around its box (GrowTextMark, HiddenTextMark). Outside the bottom-right
// corner when the slide has room there, so it never covers the text or the resize handles, even on a small box.
// A text box near the slide's right or bottom edge (the slide cuts off what passes it) gets it on the other side,
// still outside; only a box nearly as wide or tall as the slide gets it inside its own corner (it's big then).

/** Per side: after the box (right / below), before it (left / above), or inside its corner. */
export type MarkSide = "after" | "before" | "inside";
export interface MarkPlace {
  x: MarkSide;
  y: MarkSide;
}

/** The room a mark needs past the box, in slide pixels: the 12 px gap (past the 8 px corner handle) + the "+…". */
export const MARK_ROOM = 64;

export const OUTSIDE_CORNER: MarkPlace = { x: "after", y: "after" };

/** One side's place, from the box's start and size along it and the room it has (the slide's width or height). */
export function markSide(start: number, size: number, room: number): MarkSide {
  if (start + size + MARK_ROOM <= room) return "after";
  if (start >= MARK_ROOM) return "before";
  return "inside";
}

const X_CLASSES: Record<MarkSide, string> = { after: "left-full pl-3", before: "right-full pr-3", inside: "right-4" };
const Y_CLASSES: Record<MarkSide, string> = { after: "top-full pt-3", before: "bottom-full pb-3", inside: "bottom-4" };

/**
 * The mark's holder's position classes. The 12 px gap is see-through padding of the holder, so moving the mouse from
 * the box to a hover-only mark keeps the box hovered.
 */
export function markPlaceClasses(place: MarkPlace): string {
  return `${X_CLASSES[place.x]} ${Y_CLASSES[place.y]}`;
}
