"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { EyeOffIcon } from "lucide-react";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "@/lib/constants";
import type { ReactNode } from "react";
import type { Slide } from "@/lib/schema";
import { SlideStaticView } from "./SlideStaticView";

/**
 * A slide shrunk to fit its box's width, whatever that width is (a grid changes it with the screen).
 * The box must have the slide's shape (aspect ratio) and hide what overflows.
 */
export function FluidSlidePreview({ slide, questionNumber }: { slide: Slide; questionNumber?: number }) {
  return (
    <HiddenSlideMark isHidden={!!slide.hidden}>
      <FluidCanvas>
        <SlideStaticView slide={slide} questionNumber={questionNumber} />
      </FluidCanvas>
    </HiddenSlideMark>
  );
}

/** Every small picture of a hidden slide (hidden from presenting) looks the same: faded, with an eye-off mark. */
export function HiddenSlideMark({ isHidden, children }: { isHidden: boolean; children: ReactNode }) {
  if (!isHidden) return children;
  return (
    <div className="relative h-full w-full">
      <div className="h-full w-full opacity-40 grayscale">{children}</div>
      <span
        title="Hidden when presenting"
        className="absolute right-1.5 top-1.5 flex items-center justify-center rounded-dropdown bg-bg-surface p-1 text-text-secondary"
      >
        <EyeOffIcon size={14} />
      </span>
    </div>
  );
}

/** Anything drawn at full slide size (CANVAS_WIDTH × CANVAS_HEIGHT), shrunk to fit its box's width. */
export function FluidCanvas({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // 0 until measured, so the full-size slide never flashes before it's shrunk.
  const [scale, setScale] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current!;
    const fit = () => setScale(el.clientWidth / CANVAS_WIDTH);
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="pointer-events-none h-full w-full">
      {scale > 0 && (
        <div style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, transform: `scale(${scale})`, transformOrigin: "top left" }}>
          {children}
        </div>
      )}
    </div>
  );
}
