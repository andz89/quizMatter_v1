import { strFromU8, unzipSync } from "fflate";
import { WORD_LINES_MAX, wordLines } from "./wordText";

/**
 * Opens a Word file (.docx) for the editor's Word file panel, in the browser only: the file is never uploaded or
 * saved. A .docx is a zip; only its text part (`word/document.xml`) is unzipped, so pictures cost nothing.
 */

export const WORD_FILE_ERROR = "Open a Word file (.docx). For an old .doc file, save it as .docx in Word first.";
export const WORD_FILE_MAX_BYTES = 20 * 1024 * 1024;
export const WORD_FILE_TOO_BIG = "This file is too big (over 20 MB). Save a copy without the pictures and try again.";

export type WordFileResult = { lines: string[]; more: boolean } | { error: string };

export function readWordBytes(bytes: Uint8Array): WordFileResult {
  try {
    const xml = unzipSync(bytes, { filter: (file) => file.name === "word/document.xml" })["word/document.xml"];
    if (!xml) return { error: WORD_FILE_ERROR };
    const lines = wordLines(strFromU8(xml));
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
