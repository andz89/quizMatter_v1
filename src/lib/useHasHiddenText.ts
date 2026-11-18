import { useEffect, useState, type RefObject } from "react";
import { isCutOff } from "./textRoom";
import { fitsAt } from "./textFit";

/**
 * Where the text in `box` ends compared with the box's bottom, in the box's own (unzoomed) px: `below` > 0 = cut off by
 * that much, < 0 = that much empty room. Measured from the text's own lines (not the box's scroll height), with the
 * words of its last line, so `isCutOff` can tell a cut through letters from a cut through the empty room under them.
 */
function measureText(box: HTMLElement): { below: number; lastLine: string; fontSize: number } | null {
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.textContent) nodes.push(node as Text);
  const range = document.createRange();
  // Paragraphs and list items count too: an empty line (Enter) has no letters but still takes a line.
  let bottom = Math.max(-Infinity, ...[...box.querySelectorAll("p, li, h1, h2, h3")].map((el) => el.getBoundingClientRect().bottom));
  for (const node of nodes) {
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) bottom = Math.max(bottom, rect.bottom);
  }
  if (bottom === -Infinity) return null;
  // The last line's letters, read backwards from the end until a letter sits on a line above.
  let lastLine = "";
  outer: for (let n = nodes.length - 1; n >= 0; n--) {
    const text = nodes[n].textContent ?? "";
    for (let i = text.length - 1; i >= 0; i--) {
      range.setStart(nodes[n], i);
      range.setEnd(nodes[n], i + 1);
      const rect = range.getBoundingClientRect();
      if (rect.height === 0) continue;
      if (rect.bottom < bottom - rect.height / 2) break outer;
      lastLine = text[i] + lastLine;
    }
  }
  const boxRect = box.getBoundingClientRect();
  // The editor's zoom scales screen px; the font size and the rules are in the box's own px.
  const scale = box.clientHeight > 0 ? boxRect.height / box.clientHeight : 1;
  // Typing near the bottom scrolls the box to the cursor: what's scrolled past the top is hidden too.
  return { below: (bottom - boxRect.bottom) / scale + box.scrollTop, lastLine, fontSize: Number.parseFloat(getComputedStyle(box).fontSize) };
}

/**
 * Whether the text in `ref` is cut off at its bottom (slide text keeps its size and never shrinks), and whether its
 * box has room for bigger text (`spare`). Checked again when the box changes size and when anything inside it changes
 * (typing, styles, the font size). `enabled` false skips the watching (thumbnails and presenting never show a mark).
 */
export function useTextRoom(ref: RefObject<HTMLElement | null>, enabled = true): { hidden: boolean; spare: boolean } {
  const [room, setRoom] = useState({ hidden: false, spare: false });

  useEffect(() => {
    const box = ref.current;
    if (!enabled || !box) return;
    const check = () => {
      const text = measureText(box);
      const hidden = !!text && isCutOff(text.below, text.fontSize, text.lastLine);
      // Room to grow: the next size up really fits (the same measure the grow mark's click uses).
      const spare = !!text && !hidden && text.below < 0 && fitsAt(box, Math.round(text.fontSize) + 1);
      setRoom((current) => (current.hidden === hidden && current.spare === spare ? current : { hidden, spare }));
    };
    const resizes = new ResizeObserver(check);
    resizes.observe(box);
    const changes = new MutationObserver(check);
    changes.observe(box, { childList: true, subtree: true, characterData: true, attributes: true });
    check();
    // The app's font can finish loading after the first check and move the line breaks.
    let stopped = false;
    document.fonts?.ready.then(() => {
      if (!stopped) check();
    });
    return () => {
      stopped = true;
      resizes.disconnect();
      changes.disconnect();
    };
  }, [ref, enabled]);

  return enabled ? room : { hidden: false, spare: false };
}

/** True when some of the text in `ref` is past its bottom and cut off (see useTextRoom). */
export function useHasHiddenText(ref: RefObject<HTMLElement | null>, enabled = true) {
  return useTextRoom(ref, enabled).hidden;
}
