import { useCallback, useLayoutEffect, useRef, useState } from "react";

interface AutoFitOptions {
  minFontSize: number;
  maxFontSize: number;
}

// Hard floor used only when text is too long to fit even at `minFontSize` — better to keep
// shrinking than to clip the text against the container, which is what a fixed floor caused.
const ABSOLUTE_MIN_FONT_SIZE = 8;

/**
 * Shrinks font-size (via binary search) until the text fits its container. Re-measures on mount
 * and on container resize; callers invoke the returned `remeasure` directly whenever the content
 * changes in a way that doesn't itself resize the container — e.g. an editable field re-measures
 * from its input handler, while a read-only field re-measures from an effect keyed on its text prop.
 */
export function useAutoFitText<T extends HTMLElement>({ minFontSize, maxFontSize }: AutoFitOptions) {
  const ref = useRef<T>(null);
  const [fontSize, setFontSize] = useState(maxFontSize);
  const measureRef = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const fits = (size: number) => {
      el.style.fontSize = `${size}px`;
      return el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth;
    };

    const largestThatFits = (low: number, high: number) => {
      let best: number | null = null;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (fits(mid)) {
          best = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      return best;
    };

    const measure = () => {
      const size =
        largestThatFits(minFontSize, maxFontSize) ??
        largestThatFits(ABSOLUTE_MIN_FONT_SIZE, minFontSize - 1) ??
        ABSOLUTE_MIN_FONT_SIZE;

      setFontSize(size);
      el.style.fontSize = `${size}px`;
    };

    measureRef.current = measure;
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [minFontSize, maxFontSize]);

  const remeasure = useCallback(() => measureRef.current(), []);

  return { ref, fontSize, remeasure };
}
