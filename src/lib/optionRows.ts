/**
 * The math for option row heights (spec: docs/superpowers/specs/2026-11-18-option-row-heights-design.md).
 *
 * A slide saves its rows as shares: numbers that only count compared with each other (list layouts: each option's
 * `rowSize`; grid: the slide's `gridRowSizes`). A row's height = its share / the sum × the room, so the rows always
 * fill the options area exactly and never pass its bottom. Nothing here changes a text size.
 * No imports, so `npm test` loads it (`optionRows.test.ts`).
 */

// Room an option card's edges take, top + bottom: p-[5px] twice and its 1.5px border twice (rounded up).
export const OPTION_BOX_EDGES = 13;
// SlideText's line height, per px of font size.
const LINE_HEIGHT = 1.25;

/** Each row gets what it wants plus an equal part of the spare room. Too little room: shared by what they want. */
export function shareOut(wants: number[], room: number): number[] {
  const sum = wants.reduce((a, b) => a + b, 0);
  const spare = room - sum;
  if (spare >= 0) return wants.map((want) => want + spare / wants.length);
  return wants.map((want) => (want * room) / sum);
}

/** The rows' heights from their shares. Any missing share (an older slide) means equal rows. */
export function heightsFromShares(shares: (number | undefined)[], room: number): number[] {
  if (shares.some((share) => share === undefined || !(share > 0))) return shares.map(() => room / shares.length);
  const sum = (shares as number[]).reduce((a, b) => a + b, 0);
  return (shares as number[]).map((share) => (share * room) / sum);
}

/** A grid's rows from what each shown option needs (by place): each row is as tall as its taller option. */
export function gridRowNeeds(needs: number[]): number[] {
  const rows: number[] = [];
  for (let i = 0; i < needs.length; i += 2) rows.push(Math.max(needs[i], needs[i + 1] ?? 0));
  return rows;
}

/**
 * Drags the line between row `index` and the next one by `dy`: one grows, the other shrinks, each stopping at its
 * smallest size (`mins`). A row already under its smallest size isn't made any smaller.
 */
export function moveRowLine(heights: number[], index: number, dy: number, mins: number[]): number[] {
  const above = heights[index];
  const below = heights[index + 1];
  const clamped = Math.max(-Math.max(0, above - mins[index]), Math.min(Math.max(0, below - mins[index + 1]), dy));
  const next = [...heights];
  next[index] = above + clamped;
  next[index + 1] = below - clamped;
  return next;
}

/** The smallest row a drag line leaves: one line of text at `fontSize`, plus the card's edges. */
export function oneLineHeight(fontSize: number): number {
  return fontSize * LINE_HEIGHT + OPTION_BOX_EDGES;
}

// An option card's border, top + bottom (1.5px each, rounded up): its pictures sit inside it.
export const OPTION_BORDER = 3;

/**
 * A picture in an option row after the row's height changed: left as it is while it still fits (so Fit and a grid's
 * Shuffle never grow it, and Fit twice changes nothing); made just small enough to fit (same shape) when it doesn't.
 * Always kept inside the row's width.
 */
export function fitIntoRow<R extends { x: number; y: number; width: number; height: number }>(
  rect: R,
  box: { width: number; height: number },
): R {
  const bottom = rect.y + rect.height;
  const scale = bottom > box.height && bottom > 0 ? box.height / bottom : 1;
  const width = rect.width * scale;
  return { ...rect, y: rect.y * scale, width, height: rect.height * scale, x: Math.min(rect.x, Math.max(0, box.width - width)) };
}

/** The smallest a drag line leaves a row: one line of its text, or its lowest picture (plus the border) if taller. */
export function rowMin(fontSize: number, pictureBottoms: number[]): number {
  return Math.max(oneLineHeight(fontSize), ...pictureBottoms.map((bottom) => bottom + OPTION_BORDER));
}

/**
 * Where the line after row `index` sits in the options grid (CSS `top`): the rows are shares of the grid's real height
 * less its gaps (`getOptionsGridStyle`), so the line uses the same shares and lands in the middle of the real gap.
 */
export function lineTop(heights: number[], index: number, gap: number): string {
  const total = heights.reduce((a, b) => a + b, 0);
  const above = heights.slice(0, index + 1).reduce((a, b) => a + b, 0);
  const gaps = gap * (heights.length - 1);
  return `calc((100% - ${gaps}px) * ${above / total} + ${gap * index + gap / 2}px)`;
}

/**
 * The biggest whole text size from `from` down to `min` for which `fits` says the text shows whole; `min` when none
 * does. Only for the teacher's own click on an option's "+…" mark: nothing calls it by itself.
 */
export function largestFittingSize(from: number, min: number, fits: (size: number) => boolean): number {
  for (let size = Math.floor(from); size > min; size--) if (fits(size)) return size;
  return min;
}
