// Small math helpers for placing, fitting and snapping elements inside a box.

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

// Elements can't be resized smaller than this (in canvas pixels), so they stay easy to grab.
export const MIN_ELEMENT_SIZE = 24;

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Shrinks a rect evenly (keeping its shape) if it's too big for the box — never grows it — then
 * pulls it back inside the box. With `keepCenter`, a shrunk rect keeps its center; otherwise its
 * top-left corner.
 */
export function fitInBox(rect: Rect, box: Size, keepCenter = false): Rect {
  const scale = Math.min(1, box.width / rect.width, box.height / rect.height);
  const width = rect.width * scale;
  const height = rect.height * scale;
  const x = keepCenter ? rect.x + (rect.width - width) / 2 : rect.x;
  const y = keepCenter ? rect.y + (rect.height - height) / 2 : rect.y;
  return { width, height, x: clamp(x, 0, box.width - width), y: clamp(y, 0, box.height - height) };
}

/** The outer edges of a set of rects taken together (e.g. a multi-selection). */
export function getOuterEdges(rects: Rect[]) {
  return {
    minX: Math.min(...rects.map((r) => r.x)),
    minY: Math.min(...rects.map((r) => r.y)),
    maxX: Math.max(...rects.map((r) => r.x + r.width)),
    maxY: Math.max(...rects.map((r) => r.y + r.height)),
  };
}

/** Largest scale s where `start + s * rate` stays within [min, max]. */
export function maxScaleFor(start: number, rate: number, min: number, max: number) {
  if (rate > 0) return (max - start) / rate;
  if (rate < 0) return (min - start) / rate;
  return Infinity;
}

export interface Snap {
  /** How far to move so the closest point lands on its line (0 = nothing close enough). */
  shift: number;
  /** Every line a point sits on after that move, for drawing. */
  lines: number[];
}

/** Finds the line closest to any of the points (within threshold) and how far to move to reach it. */
export function findSnap(points: number[], targets: number[], threshold: number): Snap {
  let shift: number | null = null;
  for (const point of points) {
    for (const target of targets) {
      const gap = target - point;
      if (Math.abs(gap) <= threshold && (shift === null || Math.abs(gap) < Math.abs(shift))) shift = gap;
    }
  }
  if (shift === null) return { shift: 0, lines: [] };
  const move = shift;
  const lines = targets.filter((target) => points.some((point) => Math.abs(point + move - target) < 0.5));
  return { shift: move, lines: [...new Set(lines)] };
}
