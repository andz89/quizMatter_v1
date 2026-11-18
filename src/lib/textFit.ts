/**
 * Fitting a slide text to its box, measured on the real box in the editor (browser only): the grow mark shows only
 * when the next size up really fits, and a click on it or on "+…" picks the biggest size that does. Both use this one
 * measure, so the mark never offers a size the click can't give. Only the teacher's click changes a size.
 */
import { largestFittingSize } from "./optionRows";
import { FONT_SIZE_RANGE } from "./schema";

let probe: HTMLDivElement | null = null;

// One hidden copy box, outside the editor's zoom.
function getProbe(): HTMLDivElement {
  if (probe && probe.isConnected) return probe;
  probe = document.createElement("div");
  Object.assign(probe.style, { position: "absolute", left: "-10000px", top: "0", visibility: "hidden", pointerEvents: "none" });
  document.body.appendChild(probe);
  return probe;
}

/**
 * Whether the text in `box` (the text's own box: EditableText's, `overflow-hidden`) shows whole at `fontSize`: its
 * copy, at the box's real width, is no taller than the box, and no word is wider than the box (it would break).
 */
export function fitsAt(box: HTMLElement, fontSize: number): boolean {
  const copy = getProbe();
  try {
    return copyFits(copy, box, fontSize);
  } finally {
    // Never leave a copy of the text behind (it would hold the editor's contenteditable while typing).
    copy.textContent = "";
  }
}

function copyFits(copy: HTMLDivElement, box: HTMLElement, fontSize: number): boolean {
  const style = getComputedStyle(box);
  Object.assign(copy.style, {
    width: `${box.clientWidth}px`,
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight === "normal" ? "1.25" : String(Number.parseFloat(style.lineHeight) / Number.parseFloat(style.fontSize)),
    fontSize: `${fontSize}px`,
    whiteSpace: "normal",
  });
  copy.innerHTML = box.innerHTML;
  // Only the words: not the editor's typing (contenteditable) or its ids.
  copy.querySelectorAll("[contenteditable], [id]").forEach((el) => {
    el.removeAttribute("contenteditable");
    el.removeAttribute("id");
  });
  // The copy's own boxes keep their height to their text (the editor's are h-full).
  copy.querySelectorAll<HTMLElement>("*").forEach((el) => (el.style.height = "auto"));
  if (copy.scrollHeight > box.clientHeight + 1) return false;
  // A word wider than the box would break in the middle.
  copy.style.width = "auto";
  copy.style.whiteSpace = "nowrap";
  const words = (box.textContent ?? "").split(/\s+/).filter(Boolean);
  const widest = words.reduce((widest, word) => {
    copy.textContent = word;
    return Math.max(widest, copy.scrollWidth);
  }, 0);
  return widest <= box.clientWidth;
}

/** The biggest text size (up to FONT_SIZE_RANGE.max) at which the text in `box` shows whole; the smallest when none. */
export function fittingSize(box: HTMLElement): number {
  return largestFittingSize(FONT_SIZE_RANGE.max, FONT_SIZE_RANGE.min, (size) => fitsAt(box, size));
}
