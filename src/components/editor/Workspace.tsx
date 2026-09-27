"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { useShallow } from "zustand/react/shallow";
import { useEditorStore, MIN_ZOOM, type SlideInsertTarget } from "@/lib/store";
import { CANVAS_WIDTH, CANVAS_HEIGHT, SLIDE_DRAG_MIME, getSlideNumbers, canHaveAnswer } from "@/lib/constants";
import { slideSchema } from "@/lib/schema";
import { SlideWorkspaceItem } from "./SlideWorkspaceItem";
import { ZoomControls } from "./ZoomControls";
import { AnswerArea } from "./AnswerArea";
import { useMarqueeSelection } from "@/lib/useMarqueeSelection";

const WORKSPACE_PADDING = 96;
// Space between one slide and the next slide's toolbar (the toolbar is part of each slide item).
const SLIDE_GAP = 40;
// Room the "+ Multiple choice / + Short answer / … / + Title slide" row needs with one-line labels.
const ADD_ROW_WIDTH = 580;
// Slides within this distance of the visible area (1.5 screen heights above and below) get the full
// editable canvas; the rest show the light read-only view, so 100 slides don't all do editor work.
const NEAR_MARGIN = "150% 0px 150% 0px";
// Stays the same array, so the drag-to-reorder list doesn't redraw every slide.
const VERTICAL_ONLY = [restrictToVerticalAxis];

export function Workspace() {
  // Only which slides exist (and their numbers), not their content: dragging an element changes the
  // presentation on every pointer-move, and watching all of it would redraw this whole list each time.
  // useShallow keeps the same array while the ids/numbers stay the same.
  const slideIdList = useEditorStore(useShallow((s) => s.presentation.slides.map((slide) => slide.id)));
  const slideNumberList = useEditorStore(
    useShallow((s) => {
      const numbers = getSlideNumbers(s.presentation.slides);
      return s.presentation.slides.map((slide) => numbers.get(slide.id));
    })
  );
  // Gone if the slide was deleted (or undone away) while its answer was open.
  const answerSlide = useEditorStore((s) =>
    s.presentation.slides.find((slide) => slide.id === s.answerSlideId && canHaveAnswer(slide))
  );
  const zoom = useEditorStore((s) => s.zoom);
  const setZoom = useEditorStore((s) => s.setZoom);
  const selectSlide = useEditorStore((s) => s.selectSlide);
  const addSlide = useEditorStore((s) => s.addSlide);
  const reorderSlides = useEditorStore((s) => s.reorderSlides);
  const insertSlides = useEditorStore((s) => s.insertSlides);
  const closeAnswer = useEditorStore((s) => s.closeAnswer);
  // Where a slide dragged from the Presentations panel will go (a line shows the spot while dragging).
  const [dropTarget, setDropTarget] = useState<SlideInsertTarget | null>(null);
  // Slides on or near the screen — these get the full editable canvas.
  const [nearSlideIds, setNearSlideIds] = useState<ReadonlySet<string>>(new Set());

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
  // Keyed on slideIds (which slides exist, and in what order), so the observers are only rebuilt
  // when slides are added, removed or moved — not on every edit.
  const slideIds = slideIdList.join(",");

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

    // Tracks which slides are near the screen. It only reports slides that came near or went away,
    // so the set is updated from those changes (and kept as-is when nothing changed, to skip a redraw).
    const nearObserver = new IntersectionObserver(
      (entries) => {
        setNearSlideIds((prev) => {
          const next = new Set(prev);
          entries.forEach((entry) => {
            const slideId = entry.target.getAttribute("data-slide-id");
            if (!slideId) return;
            if (entry.isIntersecting) next.add(slideId);
            else next.delete(slideId);
          });
          return next.size === prev.size && [...next].every((id) => prev.has(id)) ? prev : next;
        });
      },
      { root, rootMargin: NEAR_MARGIN, threshold: 0 }
    );

    slideNodes.current.forEach((node) => {
      observer.observe(node);
      nearObserver.observe(node);
    });
    return () => {
      observer.disconnect();
      nearObserver.disconnect();
    };
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

  // Slides dragged from the Presentations panel go right after the slide nearest the pointer — or before
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
    if (slideId === slideIdList[0]) {
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

  // Drag on empty space — on a slide or the gray area around it — to select elements with a rectangle.
  // It selects on the slide pressed on, or the nearest slide when pressed outside one.
  const { pointerHandlers: marqueeHandlers, marqueeBox } = useMarqueeSelection(
    (e) => {
      const slideId =
        (e.target as Element).closest("[data-slide-id]")?.getAttribute("data-slide-id") ?? nearestSlideId(e.clientY);
      const root = slideId && slideNodes.current.get(slideId);
      return root ? { slideId, root } : null;
    },
    null,
    1
  );

  // Stays the same function between redraws, so it doesn't undo SlideWorkspaceItem's memo.
  const registerNode = useCallback((slideId: string, node: HTMLDivElement | null) => {
    if (node) slideNodes.current.set(slideId, node);
    else slideNodes.current.delete(slideId);
  }, []);

  // Below the needed width the add row shrinks as a whole (CSS zoom keeps it sharp) instead of wrapping.
  const addRowScale = Math.min(1, (CANVAS_WIDTH * zoom) / ADD_ROW_WIDTH);

  return (
    <div className="relative flex-1 overflow-hidden bg-bg-page" {...slideDropHandlers}>
      <div ref={scrollRef} className="h-full select-none overflow-y-auto" {...marqueeHandlers}>
        <div
          className="flex flex-col items-center"
          style={{ gap: SLIDE_GAP, padding: `${WORKSPACE_PADDING}px` }}
        >
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={VERTICAL_ONLY}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={slideIdList} strategy={verticalListSortingStrategy}>
              {slideIdList.map((slideId, index) => (
                <SlideWorkspaceItem
                  key={slideId}
                  slideId={slideId}
                  slideNumber={slideNumberList[index]}
                  zoom={zoom}
                  isNear={nearSlideIds.has(slideId)}
                  prevSlideId={slideIdList[index - 1]}
                  nextSlideId={slideIdList[index + 1]}
                  canDelete={slideIdList.length > 1}
                  dropSide={slideId === dropTarget?.slideId ? (dropTarget.before ? "before" : "after") : undefined}
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
              onClick={() => addSlide(undefined, "true-false")}
              className="flex flex-1 items-center justify-center rounded-card bg-bg-surface text-sm font-semibold text-text-secondary shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition hover:text-accent-navy hover:shadow-[0_2px_8px_rgba(0,0,0,0.1)]"
            >
              + True or false
            </button>
            <button
              type="button"
              onClick={() => addSlide(undefined, "custom")}
              className="flex flex-1 items-center justify-center rounded-card bg-bg-surface text-sm font-semibold text-text-secondary shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition hover:text-accent-navy hover:shadow-[0_2px_8px_rgba(0,0,0,0.1)]"
            >
              + Custom question
            </button>
            <button
              type="button"
              onClick={() => addSlide(undefined, "blank")}
              className="flex flex-1 items-center justify-center rounded-card bg-bg-surface text-sm font-semibold text-text-secondary shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition hover:text-accent-navy hover:shadow-[0_2px_8px_rgba(0,0,0,0.1)]"
            >
              + Blank slide
            </button>
            <button
              type="button"
              onClick={() => addSlide(undefined, "title")}
              className="flex flex-1 items-center justify-center rounded-card bg-bg-surface text-sm font-semibold text-text-secondary shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition hover:text-accent-navy hover:shadow-[0_2px_8px_rgba(0,0,0,0.1)]"
            >
              + Title slide
            </button>
          </div>
        </div>
      </div>
      {/* Drawn over the whole workspace (same top-left as the scroll area), so the slide's edges don't cut it off. */}
      {marqueeBox && (
        <div
          className="pointer-events-none absolute z-40 border border-accent-navy"
          style={{ ...marqueeBox, background: "rgba(25, 26, 44, 0.08)" }}
        />
      )}
      <ZoomControls />
      {answerSlide && <AnswerArea slide={answerSlide} onClose={closeAnswer} />}
    </div>
  );
}
