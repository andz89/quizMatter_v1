"use client";

import { useLayoutEffect, useRef } from "react";
import { textToHtml, toSafeHtml } from "@/lib/richText";
import { markBlanks } from "@/lib/blanks";

interface SlideTextProps {
  text: string;
  // Styled version of `text`; plain `text` is shown when it's missing or empty.
  html?: string;
  // Always shown at this size: long text goes onto new lines, and what's past the box's bottom is cut off.
  fontSize: number;
  className?: string;
}

/** Read-only slide text. Used in presentation mode and thumbnails. */
export function SlideText({ text, html, fontSize, className }: SlideTextProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Filled in here instead of in JSX: toSafeHtml needs the browser's DOM, which the server doesn't have.
  useLayoutEffect(() => {
    if (!ref.current) return;
    // An empty paragraph (a blank line) gets a <br>, as the editor gives it, so it keeps one line of height.
    ref.current.innerHTML = (html ? toSafeHtml(html) : textToHtml(text)).replace(/<p([^>]*)><\/p>/g, "<p$1><br></p>");
    // "___" blanks join into one line, as in the editor.
    markBlanks(ref.current);
  }, [text, html]);

  return (
    <div
      ref={ref}
      // break-spaces, like the editor's Tiptap text: a space at the end of a line takes room there too, so the
      // lines break in the same places in the editor, presentation and thumbnails. A word too long for the box
      // breaks in the middle, like the editor's Tiptap text.
      className={`h-full w-full overflow-hidden whitespace-break-spaces wrap-break-word ${className ?? ""}`}
      style={{ fontSize, lineHeight: 1.25 }}
    />
  );
}
