// Where a text's "+…" or grow mark sits around its box (GrowTextMark, HiddenTextMark). Above the box, its right edge
// lined up with the box's right edge, so it never covers the text or the resize handles, even on a small box.
// A text box near the slide's top edge (the slide cuts off what passes it) gets it below instead; a box nearly as
// tall as the slide gets it beside it (top lined up), and only one nearly as big as the whole slide inside its own
// corner (it's big then).

/** Per side: after the box (right / below), before it (left / above), or inside its corner. */
export type MarkSide = "after" | "before" | "inside";
export interface MarkPlace {
  x: MarkSide;
  y: MarkSide;
}

/** The room a mark needs past the box, in slide pixels: the 12 px gap (past the 8 px corner handle) + the "+…". */
export const MARK_ROOM = 64;

export const OUTSIDE_CORNER: MarkPlace = { x: "after", y: "before" };

/**
 * One side's place, from the box's start and size along it and the room it has (the slide's width or height).
 * `preferBefore`: above (or left) when there's room, else after; without it, after first.
 */
export function markSide(start: number, size: number, room: number, preferBefore = false): MarkSide {
  const fitsAfter = start + size + MARK_ROOM <= room;
  const fitsBefore = start >= MARK_ROOM;
  if (preferBefore && fitsBefore) return "before";
  if (fitsAfter) return "after";
  if (fitsBefore) return "before";
  return "inside";
}

const X_CLASSES: Record<MarkSide, string> = { after: "left-full pl-3", before: "right-full pr-3", inside: "right-4" };
const Y_CLASSES: Record<MarkSide, string> = { after: "top-full pt-3", before: "bottom-full pb-3", inside: "bottom-4" };

/**
 * The mark's holder's position classes. The 12 px gap is see-through padding of the holder, so moving the mouse from
 * the box to a hover-only mark keeps the box hovered.
 */
export function markPlaceClasses(place: MarkPlace): string {
  // Above or under the box it already clears the text and the handles: line it up with the box's right edge.
  if (place.y !== "inside") return `right-0 ${Y_CLASSES[place.y]}`;
  // No room above or under: beside it, lined up with the box's top (or inside its corner).
  return place.x === "inside" ? `${X_CLASSES.inside} ${Y_CLASSES.inside}` : `${X_CLASSES[place.x]} top-0`;
}
