"use client";

import { useLayoutEffect } from "react";
import { useAutoFitText } from "@/lib/useAutoFitText";
import { textToHtml, toSafeHtml } from "@/lib/richText";

interface FitTextProps {
  text: string;
  // Styled version of `text`; plain `text` is shown when it's missing or empty.
  html?: string;
  minFontSize: number;
  maxFontSize: number;
  className?: string;
}

/** Read-only text that shrinks to fit its container. Used in presentation mode. */
export function FitText({ text, html, minFontSize, maxFontSize, className }: FitTextProps) {
  const { ref, fontSize, remeasure } = useAutoFitText<HTMLDivElement>({ minFontSize, maxFontSize });

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
