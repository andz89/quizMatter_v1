"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { useEditorStore, MIN_ZOOM } from "@/lib/store";
import { CANVAS_WIDTH } from "@/lib/constants";
import { SlideWorkspaceItem } from "./SlideWorkspaceItem";
import { ZoomControls } from "./ZoomControls";

const WORKSPACE_PADDING = 96;
// Extra room above/below each slide for its floating toolbar (the Q{n}/delete pill and the
// move/duplicate/add/drag pill both sit just above the slide, via `bottom-full`), so the toolbar
// doesn't overlap the slide before it.
const SLIDE_GAP = 96;

export function Workspace() {
  const quiz = useEditorStore((s) => s.quiz);
  const zoom = useEditorStore((s) => s.zoom);
  const setZoom = useEditorStore((s) => s.setZoom);
  const selectSlide = useEditorStore((s) => s.selectSlide);
  const addSlide = useEditorStore((s) => s.addSlide);
  const reorderSlides = useEditorStore((s) => s.reorderSlides);

  const scrollRef = useRef<HTMLDivElement>(null);
  const slideNodes = useRef(new Map<string, HTMLDivElement>());

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // Fit the fixed-size canvas to the available width on first load.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const availableWidth = el.clientWidth - WORKSPACE_PADDING * 2;
    setZoom(Math.max(MIN_ZOOM, Math.min(1, availableWidth / CANVAS_WIDTH)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Whichever slide crosses the vertical center of the scroll area becomes the selected one,
  // so the toolbar and the elements panel always act on the slide the user is looking at.
  //
  // Deliberately keyed on slideIds (which slides exist, and in what order), not on `quiz.slides`
  // itself: that array gets a new reference on every store mutation, including every pointer-move
  // while dragging or resizing an SVG element. Rebuilding the observer on each of those would fire
  // its callback immediately and reset the current selection mid-drag.
  const slideIds = quiz.slides.map((s) => s.id).join(",");

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const centered = entries.find((entry) => entry.isIntersecting);
        const slideId = centered?.target.getAttribute("data-slide-id");
        if (slideId && slideId !== useEditorStore.getState().selectedSlideId) selectSlide(slideId);
      },
      { root, rootMargin: "-45% 0px -45% 0px", threshold: 0 }
    );

    slideNodes.current.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [slideIds, selectSlide]);

  const handleWheel = (e: React.WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    setZoom(zoom - e.deltaY * 0.001);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      reorderSlides(String(active.id), String(over.id));
    }
  };

  const registerNode = (slideId: string, node: HTMLDivElement | null) => {
    if (node) slideNodes.current.set(slideId, node);
    else slideNodes.current.delete(slideId);
  };

  return (
    <div className="relative flex-1 overflow-hidden bg-bg-page">
      <div ref={scrollRef} className="h-full overflow-y-auto" onWheel={handleWheel}>
        <div
          className="flex flex-col items-center"
          style={{ gap: SLIDE_GAP, padding: `${WORKSPACE_PADDING}px` }}
        >
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={quiz.slides.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              {quiz.slides.map((slide, index) => (
                <SlideWorkspaceItem
                  key={slide.id}
                  slide={slide}
                  index={index}
                  zoom={zoom}
                  isFirst={index === 0}
                  isLast={index === quiz.slides.length - 1}
                  canDelete={quiz.slides.length > 1}
                  onMoveUp={() => reorderSlides(slide.id, quiz.slides[index - 1].id)}
                  onMoveDown={() => reorderSlides(slide.id, quiz.slides[index + 1].id)}
                  registerNode={registerNode}
                />
              ))}
            </SortableContext>
          </DndContext>

          <button
            type="button"
            onClick={() => addSlide()}
            className="flex shrink-0 items-center justify-center rounded-card border border-dashed border-border-default text-sm font-semibold text-text-secondary transition-colors hover:border-accent-navy hover:text-accent-navy"
            style={{ width: CANVAS_WIDTH * zoom, height: 96 }}
          >
            + Add slide
          </button>
        </div>
      </div>
      <ZoomControls />
    </div>
  );
}
