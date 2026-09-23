"use client";

import { useLayoutEffect, useRef } from "react";
import { useAutoFitText } from "@/lib/useAutoFitText";

// Pressing Enter in a contentEditable doesn't insert a literal "\n" character — Chrome represents
// each subsequent line as its own sibling <div> (Firefox uses <br>), and neither contributes a "\n"
// to el.textContent, so a plain textContent read silently loses every line break. This walks the
// top-level child nodes and reconstructs the break as an explicit "\n", so the stored value (and
// anything that later renders it as plain text with white-space: pre-wrap, e.g. presentation mode)
// keeps the line breaks the editor already shows.
function getTextWithLineBreaks(el: HTMLElement): string {
  let result = "";
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.textContent ?? "";
    } else if (node.nodeName === "BR") {
      result += "\n";
    } else {
      if (result !== "") result += "\n";
      result += node.textContent ?? "";
    }
  }
  return result;
}

interface EditableTextProps {
  value: string;
  onChange: (text: string) => void;
  placeholder: string;
  resetKey: string;
  minFontSize: number;
  maxFontSize: number;
  className?: string;
  textAlign?: "left" | "center";
}

export function EditableText({
  value,
  onChange,
  placeholder,
  resetKey,
  minFontSize,
  maxFontSize,
  className,
  textAlign = "left",
}: EditableTextProps) {
  const { ref, fontSize, remeasure } = useAutoFitText<HTMLDivElement>({ minFontSize, maxFontSize });
  const lastResetKey = useRef<string | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (lastResetKey.current === resetKey) return;
    el.textContent = value;
    lastResetKey.current = resetKey;
    remeasure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  return (
    <div className="relative flex h-full w-full items-center overflow-hidden">
      {value === "" && (
        <span
          className="pointer-events-none absolute text-text-secondary"
          style={{ fontSize, textAlign }}
        >
          {placeholder}
        </span>
      )}
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={(e) => {
          onChange(getTextWithLineBreaks(e.currentTarget));
          remeasure();
        }}
        onPaste={(e) => {
          // Force plain-text-only paste (no formatting/images carried over from rich sources).
          e.preventDefault();
          const text = e.clipboardData.getData("text/plain");
          document.execCommand("insertText", false, text);
        }}
        className={`h-full w-full overflow-hidden whitespace-pre-wrap break-words outline-none ${className ?? ""}`}
        style={{ fontSize, textAlign, lineHeight: 1.25 }}
      />
    </div>
  );
}
