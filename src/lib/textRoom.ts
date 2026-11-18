/**
 * Whether slide text is cut off at its box's bottom (the "+…" mark, useHasHiddenText).
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
