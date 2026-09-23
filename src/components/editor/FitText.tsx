"use client";

import { useLayoutEffect } from "react";
import { useAutoFitText } from "@/lib/useAutoFitText";

interface FitTextProps {
  text: string;
  minFontSize: number;
  maxFontSize: number;
  className?: string;
  textAlign?: "left" | "center";
}

/** Read-only text that shrinks to fit its container. Used in presentation mode. */
export function FitText({ text, minFontSize, maxFontSize, className, textAlign = "left" }: FitTextProps) {
  const { ref, fontSize, remeasure } = useAutoFitText<HTMLDivElement>({ minFontSize, maxFontSize });

  useLayoutEffect(() => {
    remeasure();
  }, [text, remeasure]);

  return (
    <div
      ref={ref}
      className={`h-full w-full overflow-hidden whitespace-pre-wrap break-words ${className ?? ""}`}
      style={{ fontSize, textAlign, lineHeight: 1.25 }}
    >
      {text}
    </div>
  );
}
