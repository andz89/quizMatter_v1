/**
 * Whether slide text is cut off at its box's bottom (the "+…" mark, useHasHiddenText), and the size search for the
 * teacher's click on "+…" or the grow mark (textFit.ts).
 * No imports, so `npm test` loads it (`textRoom.test.ts`).
 *
 * Lexend's lines are 1.25 × the font size, and the bottom 0.25 of that is room for letters that hang below the line
 * (g, j, p, q, y, a comma). So when the box cuts only that room off a last line without such letters, nothing shows
 * missing, and it isn't counted as hidden.
 */

// Letters (and marks) that reach into the room under a line.
const HANGING = /[gjpqyQ,;()[\]{}@$|_]/;
// How much of the room under a line those letters fill, and how much is always empty (per px of font size).
const HANGING_ROOM = 0.2;
const EMPTY_ROOM = 0.04;

/** True when `cut` px of the text (its full height minus the box's) hides something on its last line. */
export function isCutOff(cut: number, fontSize: number, lastLine: string): boolean {
  const room = HANGING.test(lastLine) ? EMPTY_ROOM : HANGING_ROOM;
  // 1 px of slack: the browser rounds heights, so text that fits can measure a fraction taller.
  return cut > Math.max(1, room * fontSize);
}

/**
 * The biggest whole text size from `from` down to `min` for which `fits` says the text shows whole; `min` when none
 * does. `fits` must be true for every size below one that fits (smaller text never needs more room), so the range is
 * halved each time: a handful of tries instead of one per size. Only for the teacher's click on "+…" or the grow mark.
 */
export function largestFittingSize(from: number, min: number, fits: (size: number) => boolean): number {
  let low = min; // known to be the answer when nothing bigger fits
  let high = Math.floor(from);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) low = middle;
    else high = middle - 1;
  }
  return low;
}
