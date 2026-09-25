import { useCallback, useLayoutEffect, useRef, useState } from "react";

/**
 * Whether the text inside `ref` goes past its box (so part of it is cut off). Checked on mount
 * and whenever the box resizes; callers call `check` after anything else that changes the text's
 * size — typing, new content, a new font size.
 */
export function useTextOverflow<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [overflows, setOverflows] = useState(false);

  const check = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Where the letters are actually drawn, not the lines' boxes: a line box can stick out a little
    // (its spacing above and below, rounding, the canvas zoom) while every letter still shows.
    const box = el.getBoundingClientRect();
    const range = document.createRange();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let isCut = false;
    for (let node = walker.nextNode(); node && !isCut; node = walker.nextNode()) {
      range.selectNodeContents(node);
      // 1px of slack for rounding.
      isCut = [...range.getClientRects()].some((line) => line.bottom > box.bottom + 1 || line.right > box.right + 1);
    }
    setOverflows(isCut);
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [check]);

  return { ref, overflows, check };
}
