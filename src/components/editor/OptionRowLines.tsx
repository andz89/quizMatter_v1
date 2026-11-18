"use client";

import { useRef } from "react";
import { useEditorStore } from "@/lib/store";
import { OPTION_FONT_SIZE, getOptionRowHeights, getShownOptions } from "@/lib/constants";
import { moveRowLine, oneLineHeight } from "@/lib/optionRows";
import type { Slide } from "@/lib/schema";

// The gap between list rows (gap-3), where each line sits.
const ROW_GAP = 12;

/**
 * List layouts: a line in the gap between two option rows. Dragging it makes one row taller and the other shorter,
 * each down to one line of its own text size; text sizes never change. Sits inside the options grid (absolute).
 */
export function OptionRowLines({ slide }: { slide: Slide }) {
  const zoom = useEditorStore((s) => s.zoom);
  const setOptionRowHeights = useEditorStore((s) => s.setOptionRowHeights);
  const drag = useRef<{ index: number; y: number; heights: number[] } | null>(null);

  const heights = getOptionRowHeights(slide);
  const mins = getShownOptions(slide).map((o) => oneLineHeight(o.fontSize ?? OPTION_FONT_SIZE));
  const move = (index: number, dy: number, from: number[]) => setOptionRowHeights(slide.id, moveRowLine(from, index, dy, mins));

  // Each line's middle: the bottom of the rows above it plus half a gap.
  const lineTops = heights.slice(0, -1).map((_, index) => heights.slice(0, index + 1).reduce((a, b) => a + b, 0) + ROW_GAP * index + ROW_GAP / 2);
  return lineTops.map((top, index) => {
    return (
      <div
        key={index}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Drag to share the room between these two options"
        tabIndex={0}
        title="Drag to share the room between these two options"
        data-keep-container-selection="true"
        onPointerDown={(e) => {
          e.stopPropagation();
          drag.current = { index, y: e.clientY, heights };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current?.index !== index) return;
          // The pointer moves in screen px; divide by zoom to get slide px.
          move(index, (e.clientY - drag.current.y) / zoom, drag.current.heights);
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
          e.preventDefault();
          move(index, e.key === "ArrowUp" ? -6 : 6, heights);
        }}
        // The whole gap's width, so the line is easy to find; the bar in the middle is what to grab.
        className="group absolute inset-x-0 z-20 flex h-3.5 -translate-y-1/2 cursor-row-resize items-center justify-center outline-none"
        style={{ top }}
      >
        <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-accent opacity-30 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
        <div className="relative h-2 w-11 rounded-full bg-accent opacity-60 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
      </div>
    );
  });
}
