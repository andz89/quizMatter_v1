"use client";

import { useLayoutEffect, useRef } from "react";
import { textToHtml, toSafeHtml } from "@/lib/richText";

interface SlideTextProps {
  text: string;
  // Styled version of `text`; plain `text` is shown when it's missing or empty.
  html?: string;
  fontSize: number;
  className?: string;
}

/** Read-only slide text at a fixed size; too-long text is cut off. Used in presentation mode and thumbnails. */
export function SlideText({ text, html, fontSize, className }: SlideTextProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Filled in here instead of in JSX: toSafeHtml needs the browser's DOM, which the server doesn't have.
  useLayoutEffect(() => {
    if (ref.current) ref.current.innerHTML = html ? toSafeHtml(html) : textToHtml(text);
  }, [text, html]);

  return (
    <div
      ref={ref}
      className={`h-full w-full overflow-hidden whitespace-pre-wrap break-words ${className ?? ""}`}
      style={{ fontSize, lineHeight: 1.25 }}
    />
  );
}
