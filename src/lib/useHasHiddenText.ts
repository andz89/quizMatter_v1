import { useEffect, useState, type RefObject } from "react";
import { measureRoom } from "./textFit";

/**
 * The question, answer choices and text boxes (never table cells): whether the text in `ref` is cut
 * off at its bottom (slide text keeps its size and never shrinks; see `measureRoom` in textFit.ts), and, with `withSpare`, whether the next size up fits (the grow mark: ask only while it can show,
 * since it lays the text out again). Checked again when the box changes size and when anything inside it changes
 * (typing, styles, the font size). `enabled` false skips the watching (thumbnails and presenting never show a mark).
 */
export function useTextRoom(ref: RefObject<HTMLElement | null>, enabled = true, withSpare = false): { hidden: boolean; spare: boolean } {
  const [room, setRoom] = useState({ hidden: false, spare: false });

  useEffect(() => {
    const box = ref.current;
    if (!enabled || !box) return;
    const check = () => {
      const { hidden, spare } = measureRoom(box, withSpare);
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
  }, [ref, enabled, withSpare]);

  if (!enabled) return { hidden: false, spare: false };
  return withSpare ? room : { hidden: room.hidden, spare: false };
}
