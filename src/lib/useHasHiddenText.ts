import { useEffect, useState, type RefObject } from "react";

/**
 * True when some of the text in `ref` is past its bottom and cut off (slide text keeps its size and never shrinks).
 * Checked again when the box changes size and when anything inside it changes (typing, styles, the font size).
 * `enabled` false skips the watching (thumbnails and presenting never show the mark).
 */
export function useHasHiddenText(ref: RefObject<HTMLElement | null>, enabled = true) {
  const [hasHiddenText, setHasHiddenText] = useState(false);

  useEffect(() => {
    const box = ref.current;
    if (!enabled || !box) return;
    // 1px of slack: the browser rounds heights, so text that fits can measure a fraction taller.
    const check = () => setHasHiddenText(box.scrollHeight > box.clientHeight + 1);
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

  return enabled && hasHiddenText;
}
