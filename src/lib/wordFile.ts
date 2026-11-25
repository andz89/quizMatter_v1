import { strFromU8, unzipSync } from "fflate";
import { WORD_LINES_MAX, parseNumbering, parseStyleNumbers, wordLines } from "./wordText";

/**
 * Opens a Word file (.docx) for the editor's Word file panel, in the browser only: the file is never uploaded or
 * saved. A .docx is a zip; only its text part (`word/document.xml`), Word's list numbers (`word/numbering.xml`) and
 * its styles (`word/styles.xml`, for styles that number their paragraphs) are unzipped, so pictures cost nothing. Each part's unzipped size (from the zip's list) is checked first, so a small file that unzips huge is refused before
 * it fills the tab's memory.
 */

export const WORD_FILE_ERROR = "Open a Word file (.docx). For an old .doc file, save it as .docx in Word first.";
export const WORD_FILE_MAX_BYTES = 20 * 1024 * 1024;
export const WORD_TEXT_MAX_BYTES = 20 * 1024 * 1024;
export const WORD_FILE_TOO_BIG = "This file is too big (over 20 MB). Save a copy without the pictures, or split it, and try again.";

const TEXT_PART = "word/document.xml";
// Word's automatic list numbers ("1.", "a)") live here, not in the text.
const NUMBERING_PART = "word/numbering.xml";
// A paragraph style can carry the numbering ("List Number"), so the styles are read too.
const STYLES_PART = "word/styles.xml";

export type WordFileResult = { lines: string[]; more: boolean } | { error: string };

export function readWordBytes(bytes: Uint8Array): WordFileResult {
  let tooBig = false;
  try {
    const parts = unzipSync(bytes, {
      filter: (file) => {
        if (file.name !== TEXT_PART && file.name !== NUMBERING_PART && file.name !== STYLES_PART) return false;
        if (file.originalSize > WORD_TEXT_MAX_BYTES) tooBig = true;
        return !tooBig;
      },
    });
    if (tooBig) return { error: WORD_FILE_TOO_BIG };
    const xml = parts[TEXT_PART];
    if (!xml) return { error: WORD_FILE_ERROR };
    const numbering = parts[NUMBERING_PART] ? parseNumbering(strFromU8(parts[NUMBERING_PART])) : undefined;
    const styleNumbers = parts[STYLES_PART] ? parseStyleNumbers(strFromU8(parts[STYLES_PART])) : undefined;
    const lines = wordLines(strFromU8(xml), numbering, styleNumbers);
    return { lines: lines.slice(0, WORD_LINES_MAX), more: lines.length > WORD_LINES_MAX };
  } catch {
    return { error: WORD_FILE_ERROR };
  }
}

export async function readWordFile(file: File): Promise<WordFileResult> {
  if (!file.name.toLowerCase().endsWith(".docx")) return { error: WORD_FILE_ERROR };
  if (file.size > WORD_FILE_MAX_BYTES) return { error: WORD_FILE_TOO_BIG };
  return readWordBytes(new Uint8Array(await file.arrayBuffer()));
}
