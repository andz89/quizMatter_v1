/**
 * Guesses of how much room text takes, for Claude's import (`importPresentation.ts`) and its layout report. Slide text
 * never shrinks: what's past its box's bottom is cut off, so these guesses are what warns Claude. The browser does the
 * real wrapping. Kept apart (only `.ts` imports) so `npm test` can check them: `importText.test.ts`.
 */
import { DEFAULT_QUESTION_HEIGHT, QUESTION_CONTAINER_WIDTH, QUESTION_FONT_SIZE, QUESTION_NUMBER_INDENT } from "./constants";

// For each px of font size, a character is about this wide and a line this tall (px).
export const CHAR_WIDTH_PER_PX = 0.525;
export const LINE_HEIGHT_PER_PX = 1.25;
// Bold letters are about this much wider than regular ones.
const BOLD_WIDTH = 1.08;
// Real lines end at a whole word, so they hold fewer letters than fit: the checks count this share of a full line.
const WORD_WRAP_SHARE = 0.85;
// The room the question box's edges take (px), top + bottom (and left + right): p-4 plus its 1px border.
export const QUESTION_PADDING = 34;
// Room the question text has across: slides from Claude are numbered, so their question box is narrower.
export const QUESTION_TEXT_WIDTH = QUESTION_CONTAINER_WIDTH - QUESTION_PADDING - QUESTION_NUMBER_INDENT;
// Room an option's text keeps from its box's edges (px, both sides together), about (the card's padding and border
// take 13).
export const OPTION_TEXT_PADDING = 16;

/** How many characters fit on one line of a box `width` wide at `fontSize`, about. */
export function charsPerLineFor(width: number, fontSize: number, bold = false): number {
  return Math.max(1, Math.floor(width / (fontSize * CHAR_WIDTH_PER_PX * (bold ? BOLD_WIDTH : 1))));
}

/** Roughly how tall `text` is at `fontSize` in a box `width` wide. Each \n starts a new line. Sizes tables too. */
export function textHeightFor(text: string, width: number, fontSize: number, bold = false): number {
  const charsPerLine = charsPerLineFor(width, fontSize, bold);
  const lines = text.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
  return lines * fontSize * LINE_HEIGHT_PER_PX;
}

/** Like textHeightFor, but counting the room lost where lines end at a whole word, so it errs on the tall side. */
function wrappedHeightFor(text: string, width: number, fontSize: number, bold = false): number {
  const charsPerLine = Math.max(1, Math.floor(charsPerLineFor(width, fontSize, bold) * WORD_WRAP_SHARE));
  const lines = text.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
  return lines * fontSize * LINE_HEIGHT_PER_PX;
}

/** A text box's height for `text`: its guessed height plus half a line, as the guess is rough. */
export function textBoxHeightFor(text: string, width: number, fontSize: number, bold = false): number {
  return Math.ceil(textHeightFor(text, width, fontSize, bold) + (fontSize * LINE_HEIGHT_PER_PX) / 2);
}

/**
 * A question box just tall enough for its text, with half a line spare (the guess is rough, and a line past the
 * bottom is cut off) — short questions get a shorter box. Never taller than the default: the report warns past it.
 */
export function questionHeightFor(question: string, fontSize = QUESTION_FONT_SIZE): number {
  const height = wrappedHeightFor(question, QUESTION_TEXT_WIDTH, fontSize) + (fontSize * LINE_HEIGHT_PER_PX) / 2 + QUESTION_PADDING;
  return Math.min(DEFAULT_QUESTION_HEIGHT, Math.ceil(height));
}

/** Whether text probably needs more room than the box has at this font size (then it's cut off). */
export function tooLong(words: string, box: { width: number; height: number }, fontSize: number, bold = false): boolean {
  if (words.trim() === "") return false;
  // A word longer than a line breaks in the middle, which is hard to read: count it as too long.
  const longestWord = Math.max(...words.split(/\s+/).map((word) => word.length));
  if (longestWord > charsPerLineFor(Math.max(1, box.width), fontSize, bold)) return true;
  // Even one line can be taller than a short box (a list row under a picture strip). 1px for rounding.
  return wrappedHeightFor(words, Math.max(1, box.width), fontSize, bold) > box.height + 1;
}

/**
 * About how tall an option row must be for `text` at `fontSize` in a box `width` wide: its lines plus the card's
 * edges. The import sizes option rows with it (like the editor's grid re-fit); it never changes a text size.
 */
export function optionNeedFor(text: string, width: number, fontSize: number): number {
  // The same careful count as tooLong, so a row sized by it is never reported as cut off.
  return wrappedHeightFor(text, Math.max(1, width - OPTION_TEXT_PADDING), fontSize) + OPTION_TEXT_PADDING;
}
