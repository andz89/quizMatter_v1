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

const isWordChar = (ch: string) => /[\p{L}\p{N}'’]/u.test(ch);
const isLetter = (ch: string) => /\p{L}/u.test(ch);

/**
 * A paragraph's text in the chosen case, one string per character of `text` (a letter can grow, "ß" → "SS"), so
 * a place in `text` is the same place in the result. The whole paragraph is read, so a word split by bold still
 * counts as one word, and a selection in the middle of a sentence knows where the sentence started.
 * Sentence case: the first letter of the paragraph and the first after . ! ? is upper. A line break ("\n") is
 * not a new sentence. Capitalize Each Word: a letter after anything but a letter, digit or apostrophe is upper.
 */
export function changeCase(text: string, kind: TextCase): string[] {
  const chars = [...text].flatMap((ch) => (ch.length === 2 ? [ch, ""] : [ch])); // keep 1 entry per UTF-16 unit
  let sentenceStart = true;
  return chars.map((ch, i) => {
    if (ch === "") return "";
    if (kind === "upper") return ch.toUpperCase();
    if (kind === "lower") return ch.toLowerCase();
    if (kind === "title") return i === 0 || !isWordChar(chars[i - 1] || chars[i - 2]) ? ch.toUpperCase() : ch.toLowerCase();
    if (isLetter(ch) || /\p{N}/u.test(ch)) {
      const upper = sentenceStart;
      sentenceStart = false;
      return upper ? ch.toUpperCase() : ch.toLowerCase();
    }
    if (ch === "." || ch === "!" || ch === "?") sentenceStart = true;
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
