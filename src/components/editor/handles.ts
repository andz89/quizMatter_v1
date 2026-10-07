// The resize handles around a selected element (also used by a picked diagram box, the group
// outline and the question box), so they all look and behave the same.

/** A text box's, line's or stretchable shape's edge handle: "x" changes the width, "y" the height; dir = which way is outward. */
export interface EdgeHandle {
  axis: "x" | "y";
  dir: 1 | -1;
  className: string;
}

export const EDGE_HANDLES: EdgeHandle[] = [
  { axis: "x", dir: -1, className: "top-1/2 -left-[5px] h-6 w-2.5 -translate-y-1/2 cursor-ew-resize" },
  { axis: "x", dir: 1, className: "top-1/2 -right-[5px] h-6 w-2.5 -translate-y-1/2 cursor-ew-resize" },
  { axis: "y", dir: -1, className: "left-1/2 -top-[5px] h-2.5 w-6 -translate-x-1/2 cursor-ns-resize" },
  { axis: "y", dir: 1, className: "left-1/2 -bottom-[5px] h-2.5 w-6 -translate-x-1/2 cursor-ns-resize" },
];

/** A resize handle corner: sx/sy say which way "outward" is (+1 = right/down, -1 = left/up). */
export interface Corner {
  sx: 1 | -1;
  sy: 1 | -1;
  className: string;
}

export const CORNERS: Corner[] = [
  { sx: -1, sy: -1, className: "-top-2 -left-2 cursor-nwse-resize" },
  { sx: 1, sy: -1, className: "-top-2 -right-2 cursor-nesw-resize" },
  { sx: -1, sy: 1, className: "-bottom-2 -left-2 cursor-nesw-resize" },
  { sx: 1, sy: 1, className: "-bottom-2 -right-2 cursor-nwse-resize" },
];
