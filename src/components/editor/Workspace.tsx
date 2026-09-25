"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { useEditorStore, MIN_ZOOM, type SlideInsertTarget } from "@/lib/store";
import { CANVAS_WIDTH, CANVAS_HEIGHT, SLIDE_DRAG_MIME, getSlideNumbers } from "@/lib/constants";
import { slideSchema } from "@/lib/schema";
import { SlideWorkspaceItem } from "./SlideWorkspaceItem";
import { ZoomControls } from "./ZoomControls";

const WORKSPACE_PADDING = 96;
// Space between one slide and the next slide's toolbar (the toolbar is part of each slide item).
const SLIDE_GAP = 40;
// Room the "+ Multiple choice / + Short answer / + Blank slide" row needs with one-line labels.
const ADD_ROW_WIDTH = 460;

export function Workspace() {
  const quiz = useEditorStore((s) => s.quiz);
  const zoom = useEditorStore((s) => s.zoom);
  const setZoom = useEditorStore((s) => s.setZoom);
  const selectSlide = useEditorStore((s) => s.selectSlide);
  const addSlide = useEditorStore((s) => s.addSlide);
  const reorderSlides = useEditorStore((s) => s.reorderSlides);
  const insertSlides = useEditorStore((s) => s.insertSlides);
  // Where a slide dragged from the Lessons panel will go (a line shows the spot while dragging).
  const [dropTarget, setDropTarget] = useState<SlideInsertTarget | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const slideNodes = useRef(new Map<string, HTMLDivElement>());

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // Fit the fixed-size canvas inside the visible area (both width and height) on first load,
  // so one whole slide shows without scrolling.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const availableWidth = el.clientWidth - WORKSPACE_PADDING * 2;
    const availableHeight = el.clientHeight - WORKSPACE_PADDING * 2;
    const fit = Math.min(1, availableWidth / CANVAS_WIDTH, availableHeight / CANVAS_HEIGHT);
    setZoom(Math.max(MIN_ZOOM, fit));
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

  // True while we scroll to a new slide ourselves. The slides passed on the way shouldn't get
  // selected: each pick redraws the slides mid-scroll and makes the scroll stutter.
  const isAutoScrolling = useRef(false);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (isAutoScrolling.current) return;
        const centered = entries.find((entry) => entry.isIntersecting);
        const slideId = centered?.target.getAttribute("data-slide-id");
        if (slideId && slideId !== useEditorStore.getState().selectedSlideId) selectSlide(slideId);
      },
      { root, rootMargin: "-45% 0px -45% 0px", threshold: 0 }
    );

    slideNodes.current.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [slideIds, selectSlide]);

  // A slide that wasn't there before (added, duplicated, or brought back by undo) scrolls into view.
  const prevSlideIds = useRef(slideIds);
  useEffect(() => {
    const before = prevSlideIds.current.split(",");
    prevSlideIds.current = slideIds;
    const newId = slideIds.split(",").find((id) => !before.includes(id));
    const node = newId && slideNodes.current.get(newId);
    const root = scrollRef.current;
    if (!node || !root) return;

    // Added and duplicated slides are already selected by the store, but one brought back by undo
    // isn't — select it now, since auto-select rests during the scroll and won't pick it later.
    if (useEditorStore.getState().selectedSlideId !== newId) selectSlide(newId);

    // Our own scroll instead of scrollIntoView's smooth mode, whose speed the browser picks (long
    // jumps fly past and stop hard). Auto-select rests until the scroll ends.
    isAutoScrolling.current = true;
    let frame = 0;
    const stop = () => {
      cancelAnimationFrame(frame);
      isAutoScrolling.current = false;
      root.removeEventListener("wheel", stop);
      root.removeEventListener("pointerdown", stop);
    };
    // Scrolling by hand takes over from the animation.
    root.addEventListener("wheel", stop, { passive: true });
    root.addEventListener("pointerdown", stop);

    // Waits two frames, so the new slide's heavy first draw is done before anything moves.
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const rootBox = root.getBoundingClientRect();
        const nodeBox = node.getBoundingClientRect();
        const offset = nodeBox.top + nodeBox.height / 2 - (rootBox.top + root.clientHeight / 2);
        const from = root.scrollTop;
        const to = Math.min(Math.max(0, from + offset), root.scrollHeight - root.clientHeight);
        const distance = to - from;
        // 400–700ms: short hops stay quick, long jumps don't rush.
        const duration = Math.min(700, 400 + Math.abs(distance) * 0.15);
        const start = performance.now();

        const step = (now: number) => {
          const t = Math.min(1, (now - start) / duration);
          // Ease in-out: starts slow, speeds up, then settles gently.
          const eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
          root.scrollTop = from + distance * eased;
          if (t < 1) frame = requestAnimationFrame(step);
          else stop();
        };
        frame = requestAnimationFrame(step);
      });
    });
    return stop;
  }, [slideIds, selectSlide]);

  // Ctrl/Cmd + wheel zooms the canvas. Added by hand with passive: false because React's onWheel
  // is passive, so its preventDefault can't stop the browser from zooming the whole page too.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setZoom(useEditorStore.getState().zoom - e.deltaY * 0.001);
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [setZoom]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      reorderSlides(String(active.id), String(over.id));
    }
  };

  // Slides dragged from the Lessons panel go right after the slide nearest the pointer — or before
  // the first slide when the pointer is over its top half, so a copy can become the new slide 1.
  const isSlideDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(SLIDE_DRAG_MIME);

  const nearestSlideId = (clientY: number) => {
    let nearest: string | null = null;
    let nearestDistance = Infinity;
    slideNodes.current.forEach((node, slideId) => {
      const box = node.getBoundingClientRect();
      const distance = clientY < box.top ? box.top - clientY : clientY > box.bottom ? clientY - box.bottom : 0;
      if (distance < nearestDistance) {
        nearest = slideId;
        nearestDistance = distance;
      }
    });
    return nearest;
  };

  // A drag cancelled over the workspace (e.g. Esc) doesn't always fire dragleave, so clear on dragend too.
  useEffect(() => {
    if (!dropTarget) return;
    const clear = () => setDropTarget(null);
    window.addEventListener("dragend", clear);
    return () => window.removeEventListener("dragend", clear);
  }, [dropTarget]);

  const findDropTarget = (e: React.DragEvent): SlideInsertTarget | null => {
    // The slide under the pointer is a cheap lookup; only measure every slide when over a gap.
    const overSlide = (e.target as Element).closest("[data-slide-id]")?.getAttribute("data-slide-id");
    const slideId = overSlide ?? nearestSlideId(e.clientY);
    if (!slideId) return null;
    if (slideId === quiz.slides[0]?.id) {
      const box = slideNodes.current.get(slideId)?.getBoundingClientRect();
      if (box && e.clientY < box.top + box.height / 2) return { slideId, before: true };
    }
    return { slideId };
  };

  const slideDropHandlers = {
    onDragOver: (e: React.DragEvent) => {
      if (!isSlideDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      const target = findDropTarget(e);
      // Only redraw when the spot actually changes, not on every pointer move.
      if (target?.slideId !== dropTarget?.slideId || !!target?.before !== !!dropTarget?.before) setDropTarget(target);
    },
    onDragLeave: (e: React.DragEvent) => {
      // Only when leaving the workspace itself, not when moving between its children.
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null);
    },
    onDrop: (e: React.DragEvent) => {
      if (!isSlideDrag(e)) return;
      e.preventDefault();
      setDropTarget(null);
      try {
        const slide = slideSchema.parse(JSON.parse(e.dataTransfer.getData(SLIDE_DRAG_MIME)));
        insertSlides([slide], dropTarget ?? findDropTarget(e) ?? undefined);
      } catch {
        // Not a slide we can read — nothing is added.
      }
    },
  };

  // Stays the same function between redraws, so it doesn't undo SlideWorkspaceItem's memo.
  const registerNode = useCallback((slideId: string, node: HTMLDivElement | null) => {
    if (node) slideNodes.current.set(slideId, node);
    else slideNodes.current.delete(slideId);
  }, []);

  const slideNumbers = getSlideNumbers(quiz.slides);
  // Below the needed width the add row shrinks as a whole (CSS zoom keeps it sharp) instead of wrapping.
  const addRowScale = Math.min(1, (CANVAS_WIDTH * zoom) / ADD_ROW_WIDTH);

  return (
    <div className="relative flex-1 overflow-hidden bg-bg-page" {...slideDropHandlers}>
      <div ref={scrollRef} className="h-full overflow-y-auto">
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
                  slideNumber={slideNumbers.get(slide.id)!}
                  zoom={zoom}
                  prevSlideId={quiz.slides[index - 1]?.id}
                  nextSlideId={quiz.slides[index + 1]?.id}
                  canDelete={quiz.slides.length > 1}
                  dropSide={slide.id === dropTarget?.slideId ? (dropTarget.before ? "before" : "after") : undefined}
                  registerNode={registerNode}
                />
              ))}
            </SortableContext>
          </DndContext>

          <div
            className="flex shrink-0 gap-4 whitespace-nowrap"
            style={{ width: (CANVAS_WIDTH * zoom) / addRowScale, height: 96, zoom: addRowScale }}
          >
            <button
              type="button"
              onClick={() => addSlide(undefined, "choice")}
              className="flex flex-1 items-center justify-center rounded-card bg-bg-surface text-sm font-semibold text-text-secondary shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition hover:text-accent-navy hover:shadow-[0_2px_8px_rgba(0,0,0,0.1)]"
            >
              + Multiple choice
            </button>
            <button
              type="button"
              onClick={() => addSlide(undefined, "short-answer")}
              className="flex flex-1 items-center justify-center rounded-card bg-bg-surface text-sm font-semibold text-text-secondary shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition hover:text-accent-navy hover:shadow-[0_2px_8px_rgba(0,0,0,0.1)]"
            >
              + Short answer
            </button>
            <button
              type="button"
              onClick={() => addSlide(undefined, "lesson")}
              className="flex flex-1 items-center justify-center rounded-card bg-bg-surface text-sm font-semibold text-text-secondary shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition hover:text-accent-navy hover:shadow-[0_2px_8px_rgba(0,0,0,0.1)]"
            >
              + Blank slide
            </button>
          </div>
        </div>
      </div>
      <ZoomControls />
    </div>
  );
}
