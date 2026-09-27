"use client";

import { memo, useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { useEditorStore } from "@/lib/store";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "@/lib/constants";
import { SlideCanvas } from "./SlideCanvas";
import { SlideToolbar } from "./SlideToolbar";
import { SlideStaticView } from "@/components/presentation/SlideStaticView";

// Room the widest toolbar needs in one row (custom slide: name + Items box + answer button + tools).
const TOOLBAR_WIDTH = 616;

interface SlideWorkspaceItemProps {
  slideId: string;
  // 1, 2… on question slides; Slide 1, Slide 2… on blank slides (each type counted separately).
  // Missing on a question slide taken out of the numbers.
  slideNumber?: number;
  zoom: number;
  // On or near the screen: shows the full editable canvas. Far away: the light read-only view.
  isNear: boolean;
  // The slides just before/after this one, for the move up/down buttons (undefined at the ends).
  prevSlideId?: string;
  nextSlideId?: string;
  canDelete: boolean;
  // A slide dragged from the Presentations panel will go right before/after this one: a navy line shows where.
  dropSide?: "before" | "after";
  registerNode: (slideId: string, node: HTMLDivElement | null) => void;
}

/**
 * One slide in the scrollable workspace: its drag-sortable wrapper, toolbar, and scaled canvas.
 * Wrapped in memo (means: skip redrawing when its props haven't changed).
 *
 * The drag-to-reorder library redraws every slide's wrapper whenever the slide list redraws, with new
 * drag-handle listeners each time. So the wrapper stays thin, and the heavy part (toolbar + slide) lives
 * in SlideItemContent, its own memo, which gets listeners that never change and so skips those redraws.
 */
export const SlideWorkspaceItem = memo(function SlideWorkspaceItem({
  slideId,
  zoom,
  dropSide,
  registerNode,
  ...contentProps
}: SlideWorkspaceItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: slideId });

  // The same handlers every time, each calling the library's newest listener. Passing the library's
  // own listeners down would redraw every slide's toolbar and canvas whenever the list redraws.
  const latestListeners = useRef(listeners);
  useLayoutEffect(() => {
    latestListeners.current = listeners;
  });
  const stableListeners = useMemo(
    () => ({
      onPointerDown: (e: React.PointerEvent) => latestListeners.current?.onPointerDown?.(e),
      onKeyDown: (e: React.KeyboardEvent) => latestListeners.current?.onKeyDown?.(e),
    }),
    []
  );

  // Stays the same function between redraws. A new one each time would make React detach and
  // re-attach the node on every redraw, and the drag library would measure it again.
  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      registerNode(slideId, node);
    },
    [setNodeRef, registerNode, slideId]
  );

  return (
    <div
      ref={setRefs}
      data-slide-id={slideId}
      className="relative"
      style={{
        width: CANVAS_WIDTH * zoom,
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      <SlideItemContent slideId={slideId} zoom={zoom} attributes={attributes} listeners={stableListeners} {...contentProps} />
      {/* In the middle of the 40px gap between slides (Workspace's SLIDE_GAP). */}
      {dropSide && (
        <div
          className="pointer-events-none absolute inset-x-0 h-[3px] rounded-full bg-accent-navy"
          style={dropSide === "before" ? { top: -22 } : { bottom: -22 }}
        />
      )}
    </div>
  );
});

type SlideItemContentProps = Omit<SlideWorkspaceItemProps, "dropSide" | "registerNode"> &
  Pick<ReturnType<typeof useSortable>, "attributes" | "listeners">;

/** The slide's toolbar and canvas. Reads its own slide from the store, so editing one slide doesn't redraw the others. */
const SlideItemContent = memo(function SlideItemContent({
  slideId,
  slideNumber,
  zoom,
  isNear,
  prevSlideId,
  nextSlideId,
  canDelete,
  attributes,
  listeners,
}: SlideItemContentProps) {
  const slide = useEditorStore((s) => s.presentation.slides.find((sl) => sl.id === slideId));
  // The slide being edited always stays editable, even if it's scrolled away.
  const isSelected = useEditorStore((s) => s.selectedSlideId === slideId);
  const reorderSlides = useEditorStore((s) => s.reorderSlides);
  const slideWidth = CANVAS_WIDTH * zoom;
  const toolbarScale = Math.min(1, slideWidth / TOOLBAR_WIDTH);

  // Just deleted: the list above drops this item on its next redraw.
  if (!slide) return null;
  const isEditable = isNear || isSelected;

  return (
    <>
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
      <div
        style={{
          width: CANVAS_WIDTH,
          height: CANVAS_HEIGHT,
          zoom,
          // Far slides can skip layout and drawing until they come near. Not on the editable canvas:
          // it would also trap its fixed-position right-click menu inside the slide.
          contentVisibility: isEditable ? undefined : "auto",
          containIntrinsicSize: isEditable ? undefined : `${CANVAS_WIDTH}px ${CANVAS_HEIGHT}px`,
        }}
      >
        {isEditable ? (
          <SlideCanvas slide={slide} questionNumber={slideNumber} />
        ) : (
          <SlideStaticView slide={slide} questionNumber={slideNumber} revealAnswer />
        )}
      </div>
    </>
  );
});
