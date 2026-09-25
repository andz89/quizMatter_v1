"use client";

import { memo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { useEditorStore } from "@/lib/store";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "@/lib/constants";
import { SlideCanvas } from "./SlideCanvas";
import { SlideToolbar } from "./SlideToolbar";
import type { Slide } from "@/lib/schema";

// Room the widest toolbar needs in one row (short-answer slide: name + "Add answer" + tools).
const TOOLBAR_WIDTH = 460;

interface SlideWorkspaceItemProps {
  slide: Slide;
  // Q1, Q2… on question slides; Slide 1, Slide 2… on blank slides (each type counted separately).
  slideNumber: number;
  zoom: number;
  // The slides just before/after this one, for the move up/down buttons (undefined at the ends).
  prevSlideId?: string;
  nextSlideId?: string;
  canDelete: boolean;
  registerNode: (slideId: string, node: HTMLDivElement | null) => void;
}

/**
 * One slide in the scrollable workspace: its drag-sortable wrapper, toolbar, and scaled canvas.
 * Wrapped in memo (means: skip redrawing when its props haven't changed) — editing one slide
 * then doesn't redraw all the others, since their `slide` objects stay the same.
 */
export const SlideWorkspaceItem = memo(function SlideWorkspaceItem({
  slide,
  slideNumber,
  zoom,
  prevSlideId,
  nextSlideId,
  canDelete,
  registerNode,
}: SlideWorkspaceItemProps) {
  const reorderSlides = useEditorStore((s) => s.reorderSlides);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: slide.id });
  const slideWidth = CANVAS_WIDTH * zoom;
  const toolbarScale = Math.min(1, slideWidth / TOOLBAR_WIDTH);

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        registerNode(slide.id, node);
      }}
      data-slide-id={slide.id}
      style={{
        width: slideWidth,
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      {/* Outside the slide's zoom, so it stays full size at normal zoom. When the slide gets narrower
          than the toolbar, it shrinks (with CSS zoom, so still sharp) just enough to fit in one row. */}
      <div style={{ zoom: toolbarScale, width: slideWidth / toolbarScale }}>
        <SlideToolbar
          slide={slide}
          slideNumber={slideNumber}
          isFirst={!prevSlideId}
          isLast={!nextSlideId}
          canDelete={canDelete}
          onMoveUp={() => prevSlideId && reorderSlides(slide.id, prevSlideId)}
          onMoveDown={() => nextSlideId && reorderSlides(slide.id, nextSlideId)}
          dragHandle={{ attributes, listeners }}
        />
      </div>
      {/* CSS zoom (not transform: scale) makes the browser multiply every size before drawing,
          so borders and text are drawn at their real screen size and stay sharp. */}
      <div style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, zoom }}>
        <SlideCanvas slide={slide} />
      </div>
    </div>
  );
});
