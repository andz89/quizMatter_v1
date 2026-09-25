"use client";

import { useLayoutEffect } from "react";
import { useAutoFitText } from "@/lib/useAutoFitText";
import { autoFitRange } from "@/lib/constants";
import { textToHtml, toSafeHtml } from "@/lib/richText";

interface SlideTextProps {
  text: string;
  // Styled version of `text`; plain `text` is shown when it's missing or empty.
  html?: string;
  // The largest the text gets; it shrinks when it's too long for its box.
  fontSize: number;
  className?: string;
}

/** Read-only slide text that shrinks to fit its box. Used in presentation mode and thumbnails. */
export function SlideText({ text, html, fontSize: chosenFontSize, className }: SlideTextProps) {
  const { ref, fontSize, remeasure } = useAutoFitText<HTMLDivElement>(autoFitRange(chosenFontSize));

  // Filled in here instead of in JSX: toSafeHtml needs the browser's DOM, which the server doesn't have.
  useLayoutEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = html ? toSafeHtml(html) : textToHtml(text);
    remeasure();
  }, [ref, text, html, remeasure]);

  return (
    <div
      ref={ref}
      className={`h-full w-full overflow-hidden whitespace-pre-wrap break-words ${className ?? ""}`}
      style={{ fontSize, lineHeight: 1.25 }}
    />
  );
}
