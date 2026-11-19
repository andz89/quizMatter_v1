/**
 * Measuring a slide text against its box in the editor (browser only), on a hidden, unrotated copy of the text at the
 * box's real width, outside the editor's zoom. So a rotated or zoomed box, or one scrolled while typing, measures the
 * same as a plain one. Used for the "+…" mark (cut-off letters), the grow mark (the next size up fits), and the
 * teacher's click on either (the biggest size that fits). Both marks and the click share `heightFits` and the word
 * check, so a mark never offers a size the click can't give. Only the teacher's click changes a size.
 */
import { FONT_SIZE_RANGE } from "./schema";
import { isCutOff, largestFittingSize } from "./textRoom";

// Word widths are measured at this size, then scaled: a word's width grows with the size.
const WORD_SIZE = 100;
// Bold words are a little wider than the plain copy measures them.
const WORD_SLACK = 1.06;

let probe: HTMLDivElement | null = null;

function getProbe(): HTMLDivElement {
  if (probe && probe.isConnected) return probe;
  probe = document.createElement("div");
  Object.assign(probe.style, { position: "absolute", left: "-10000px", top: "0", visibility: "hidden", pointerEvents: "none" });
  document.body.appendChild(probe);
  return probe;
}

/** Fills the copy with the box's words, wrapped like the box, at `fontSize`. */
function fillCopy(copy: HTMLDivElement, box: HTMLElement, style: CSSStyleDeclaration, fontSize: number) {
  Object.assign(copy.style, {
    width: `${box.clientWidth}px`,
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight,
    lineHeight: String(Number.parseFloat(style.lineHeight) / Number.parseFloat(style.fontSize) || 1.25),
    whiteSpace: style.whiteSpace,
    overflowWrap: style.overflowWrap,
    wordBreak: style.wordBreak,
    fontSize: `${fontSize}px`,
  });
  copy.innerHTML = box.innerHTML;
  // Only the words: not the editor's typing (contenteditable) or its ids; its own boxes keep to their text's height.
  copy.querySelectorAll<HTMLElement>("*").forEach((el) => {
    el.removeAttribute("contenteditable");
    el.removeAttribute("id");
    el.style.height = "auto";
  });
}

/** The copy's last line's letters (read backwards from the end until a letter sits on a line above). */
function lastLineOf(copy: HTMLDivElement): string {
  const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.textContent) nodes.push(node as Text);
  const range = document.createRange();
  let bottom = -Infinity;
  for (const node of nodes) {
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) bottom = Math.max(bottom, rect.bottom);
  }
  let line = "";
  for (let n = nodes.length - 1; n >= 0; n--) {
    const text = nodes[n].textContent ?? "";
    for (let i = text.length - 1; i >= 0; i--) {
      range.setStart(nodes[n], i);
      range.setEnd(nodes[n], i + 1);
      const rect = range.getBoundingClientRect();
      if (rect.height === 0) continue;
      if (rect.bottom < bottom - rect.height / 2) return line;
      line = text[i] + line;
    }
  }
  return line;
}

/** The widest word at WORD_SIZE, all words laid out in one pass (one layout, then reads). */
function widestWordAtProbeSize(copy: HTMLDivElement, box: HTMLElement): number {
  const words = (box.textContent ?? "").split(/\s+/).filter(Boolean);
  copy.textContent = "";
  Object.assign(copy.style, { width: "auto", whiteSpace: "nowrap", fontSize: `${WORD_SIZE}px` });
  const spans = words.map((word) => {
    const span = document.createElement("span");
    span.style.display = "inline-block";
    span.textContent = word;
    copy.appendChild(span);
    return span;
  });
  return spans.reduce((widest, span) => Math.max(widest, span.offsetWidth), 0) * WORD_SLACK;
}

/**
 * Checks for one box: `heightFits(size)` (the copy at that size is no taller than the box) and `wordFits(size)` (no word
 * wider than the box, so none breaks in the middle; ignored when a word is too wide even at the smallest size, like a
 * long web address, so it can't force the smallest size).
 */
function fitChecks(copy: HTMLDivElement, box: HTMLElement, style: CSSStyleDeclaration) {
  const widest = widestWordAtProbeSize(copy, box);
  const wordWidth = (size: number) => (widest * size) / WORD_SIZE;
  const wordsCanFit = wordWidth(FONT_SIZE_RANGE.min) <= box.clientWidth;
  return {
    fits: (size: number) => {
      if (wordsCanFit && wordWidth(size) > box.clientWidth) return false;
      fillCopy(copy, box, style, size);
      return copy.scrollHeight <= box.clientHeight + 1;
    },
  };
}

/**
 * Whether the text in `box` (the text's own `overflow-hidden` box) is cut off (`hidden`, by `isCutOff`: the empty room
 * under a last line with no g, y, p… doesn't count), and, when `withSpare`, whether the next size up fits (`spare`,
 * for the grow mark; never on empty text or at the biggest size).
 */
export function measureRoom(box: HTMLElement, withSpare: boolean): { hidden: boolean; spare: boolean } {
  const copy = getProbe();
  try {
    const style = getComputedStyle(box);
    const fontSize = Number.parseFloat(style.fontSize);
    fillCopy(copy, box, style, fontSize);
    const cut = copy.scrollHeight - box.clientHeight;
    const hidden = cut > 1 && isCutOff(cut, fontSize, lastLineOf(copy));
    const hasWords = (box.textContent ?? "").trim() !== "";
    if (!withSpare || hidden || !hasWords || fontSize + 1 > FONT_SIZE_RANGE.max) return { hidden, spare: false };
    return { hidden, spare: fitChecks(copy, box, style).fits(Math.round(fontSize) + 1) };
  } finally {
    // Never leave a copy of the text behind (it would hold the editor's typing area).
    copy.textContent = "";
  }
}

/** The biggest text size (up to FONT_SIZE_RANGE.max) at which the text in `box` shows whole; the smallest when none. */
export function fittingSize(box: HTMLElement): number {
  const copy = getProbe();
  try {
    const { fits } = fitChecks(copy, box, getComputedStyle(box));
    return largestFittingSize(FONT_SIZE_RANGE.max, FONT_SIZE_RANGE.min, fits);
  } finally {
    copy.textContent = "";
  }
}
