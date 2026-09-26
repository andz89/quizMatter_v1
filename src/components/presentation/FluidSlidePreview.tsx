"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "@/lib/constants";
import type { ReactNode } from "react";
import type { Slide } from "@/lib/schema";
import { SlideStaticView } from "./SlideStaticView";

/**
 * A slide shrunk to fit its box's width, whatever that width is (a grid changes it with the screen).
 * The box must have the slide's shape (aspect ratio) and hide what overflows.
 */
export function FluidSlidePreview({ slide }: { slide: Slide }) {
  return (
    <FluidCanvas>
      <SlideStaticView slide={slide} />
    </FluidCanvas>
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
