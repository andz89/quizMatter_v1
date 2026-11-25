import type { Node as PmNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";

/** The text bar's "Change case" choices. They change the real letters, so nothing new is saved. */
export type TextCase = "upper" | "lower" | "sentence" | "title";

export const TEXT_CASES: { value: TextCase; label: string }[] = [
  { value: "upper", label: "UPPERCASE" },
  { value: "lower", label: "lowercase" },
  { value: "sentence", label: "Sentence case" },
  { value: "title", label: "Capitalize Each Word" },
];

// Letters, digits and accent marks typed as their own character (NFD text, e.g. "e" + "́").
const isWordChar = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}\p{M}]/u.test(ch);
const isLetter = (ch: string | undefined) => ch !== undefined && /\p{L}/u.test(ch);
const isApostrophe = (ch: string | undefined) => ch === "'" || ch === "’";
const isSpace = (ch: string | undefined) => ch === undefined || /\s/u.test(ch);

// A word that is a web address, email or file name ("www.deped.gov.ph", "juan@gmail.com", "notes.docx"): Sentence
// case and Capitalize Each Word leave it as typed.
const looksLikeAddress = (word: string) =>
  word.includes("@") || word.includes("://") || /^www\./i.test(word) || /[\p{L}\p{N}]\.[\p{L}\p{N}]/u.test(word);

/**
 * A paragraph's text in the chosen case, one string per character of `text` (a letter can grow, "ß" → "SS"), so
 * a place in `text` is the same place in the result. The whole paragraph is read, so a word split by bold still
 * counts as one word, and a selection in the middle of a sentence knows where the sentence started.
 * - Sentence case: the first letter of the paragraph, and the first after . ! ? followed by a space, is upper; so
 *   is the word "I" (and I'm, I'll…). A line break ("\n") is not a new sentence.
 * - Capitalize Each Word: a letter is upper when no word comes right before it. An apostrophe after a letter is
 *   inside the word ("Don't"); one before a word is a quote ("'Hello").
 * - In both, web addresses, emails and file names stay as typed. Names still go lower in Sentence case: the app
 *   can't tell them from other words.
 */
export function changeCase(text: string, kind: TextCase): string[] {
  // One entry per UTF-16 unit: a character taking two units is followed by "".
  const units = [...text].flatMap((ch) => (ch.length === 2 ? [ch, ""] : [ch]));
  // The character before / after place i, skipping the "" halves.
  const before = (i: number) => (units[i - 1] === "" ? units[i - 2] : units[i - 1]);
  const after = (i: number) => units[i + units[i].length];

  // Greek capital sigma at a word's end lowercases to its final form.
  const lower = (i: number) => {
    const ch = units[i];
    return ch === "Σ" && isLetter(before(i)) && !isWordChar(after(i)) ? "ς" : ch.toLowerCase();
  };
  if (kind === "upper") return units.map((ch) => ch.toUpperCase());
  if (kind === "lower") return units.map((_, i) => lower(i));

  // Places inside an address-like word (runs of non-spaces), left as typed.
  const kept = new Set<number>();
  for (const match of text.matchAll(/\S+/gu)) {
    if (looksLikeAddress(match[0])) for (let i = 0; i < match[0].length; i++) kept.add(match.index + i);
  }

  // A word right before place i: a word character, or an apostrophe with a word character before it.
  const wordBefore = (i: number) => {
    const prev = before(i);
    if (isWordChar(prev)) return true;
    // An apostrophe is one unit, so the character before it is before(i - 1).
    return isApostrophe(prev) && isWordChar(before(i - 1));
  };
  // The word "I" on its own, or before an apostrophe (I'm, I'll). Not before a hyphen: Filipino "i-click".
  const isPronounI = (i: number) => {
    const next = after(i);
    return (units[i] === "i" || units[i] === "I") && !wordBefore(i) && !isWordChar(next) && next !== "-";
  };

  let sentenceStart = true;
  return units.map((ch, i) => {
    if (ch === "") return "";
    const wordChar = isLetter(ch) || /\p{N}/u.test(ch);
    if (kept.has(i)) {
      if (wordChar) sentenceStart = false;
      return ch;
    }
    if (kind === "title") return wordChar && !wordBefore(i) ? ch.toUpperCase() : lower(i);
    if (wordChar) {
      const upper = sentenceStart || isPronounI(i);
      sentenceStart = false;
      return upper ? ch.toUpperCase() : lower(i);
    }
    if ((ch === "." || ch === "!" || ch === "?") && isSpace(after(i))) sentenceStart = true;
    return ch;
  });
}

/**
 * Changes the case of the selected text (all of it when nothing is selected) inside `tr`, keeping each piece's
 * bold, italic, color… Only pieces that really change are replaced, from the last one back, so earlier places
 * stay right. Used as a Tiptap chain `command`.
 */
export function applyTextCase(tr: Transaction, kind: TextCase): boolean {
  const { doc } = tr;
  const from = tr.selection.empty ? 0 : tr.selection.from;
  const to = tr.selection.empty ? doc.content.size : tr.selection.to;
  const changes: { from: number; to: number; text: string; node: PmNode }[] = [];

  doc.nodesBetween(from, to, (block, blockPos) => {
    if (!block.isTextblock) return true;
    const start = blockPos + 1;
    // A hard break is one character, so a place in this text is a place in the paragraph.
    const cases = changeCase(block.textBetween(0, block.content.size, "\n", "\n"), kind);
    block.forEach((node, offset) => {
      if (!node.isText || !node.text) return;
      const a = Math.max(offset, from - start);
      const b = Math.min(offset + node.nodeSize, to - start);
      if (a >= b) return;
      const next = cases.slice(a, b).join("");
      if (next !== node.text.slice(a - offset, b - offset)) changes.push({ from: start + a, to: start + b, text: next, node });
    });
    return false;
  });

  for (const change of changes.reverse()) {
    tr.replaceWith(change.from, change.to, doc.type.schema.text(change.text, change.node.marks));
  }
  return true;
}
