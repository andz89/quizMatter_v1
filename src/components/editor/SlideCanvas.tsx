"use client";

import { useRef, useState } from "react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import { useEditorStore, withGroupMembers, selectedIdsOn } from "@/lib/store";
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  OPTIONS_AREA_CLASSES,
  OPTIONS_GRID_CLASSES,
  ADD_SHAPE_BOX_ROW_HEIGHT,
  hasShapeBox,
  hasShapeStrip,
} from "@/lib/constants";
import { getElementAsset } from "@/lib/svgLibrary";
import { useElementDropTarget } from "@/lib/useElementDropTarget";
import { QuestionContainer } from "./QuestionContainer";
import { OptionCard } from "./OptionCard";
import { SideContainer } from "./SideContainer";
import { SvgElementItem } from "./SvgElementItem";
import { GroupSelectionOverlay } from "./GroupSelectionOverlay";
import { SnapGuides } from "./SnapGuides";
import { ElementContextMenu } from "./ElementContextMenu";
import { ElementDragGhost } from "./ElementDragGhost";
import { getSlideBackgroundStyle } from "@/components/presentation/SlideStaticView";
import type { Slide } from "@/lib/schema";

const CANVAS_BOUNDS = { width: CANVAS_WIDTH, height: CANVAS_HEIGHT };

interface SlideCanvasProps {
  slide: Slide;
}

export function SlideCanvas({ slide }: SlideCanvasProps) {
  const reorderOptions = useEditorStore((s) => s.reorderOptions);
  const isSelectedSlide = useEditorStore((s) => s.selectedSlideId === slide.id);
  const selectedElementIds = useEditorStore(selectedIdsOn(slide.id));
  const clearElementSelection = useEditorStore((s) => s.clearElementSelection);
  const selectContainer = useEditorStore((s) => s.selectContainer);
  const copySelectedElements = useEditorStore((s) => s.copySelectedElements);
  const pasteClipboard = useEditorStore((s) => s.pasteClipboard);
  const fitElementsToContainer = useEditorStore((s) => s.fitElementsToContainer);

  const selectElements = useEditorStore((s) => s.selectElements);
  const addShapeBox = useEditorStore((s) => s.addShapeBox);
  const zoom = useEditorStore((s) => s.zoom);

  // Lesson slides have no boxes, so the slide itself takes elements dropped from the Elements panel.
  const isLesson = slide.type === "lesson";
  const isChoice = (slide.type ?? "choice") === "choice";
  const { isDragOver: isCanvasDragOver, dropHandlers: canvasDropHandlers } = useElementDropTarget(slide.id, null);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; containerId: string | null; canPaste: boolean } | null>(null);

  // Rectangle selection: dragging anywhere on the slide that isn't a shape, button or handle (empty
  // space, or a question/option box that isn't being typed in) draws a rectangle, and every element
  // it touches gets selected. Shift+drag adds to the current selection. All points are screen
  // (client) pixels.
  const rootRef = useRef<HTMLDivElement>(null);
  // A press that hasn't moved far enough to count as a drag yet. Until it does, nothing is captured,
  // so plain clicks and double-clicks still reach the box under the mouse.
  const pressStart = useRef<{ x: number; y: number; keptIds: string[] } | null>(null);
  // originX/Y = the canvas's top-left on screen when the drag began, for drawing the rectangle.
  const [marquee, setMarquee] = useState<{
    originX: number;
    originY: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
    keptIds: string[];
  } | null>(null);

  // A rectangle drag ends with a click on the slide, which would clear the new selection — skip that one click.
  const skipNextClick = useRef(false);

  const handleMarqueePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // A drag that ended off the slide never gets its click, so don't carry the skip over.
    skipNextClick.current = false;
    if (e.button !== 0) return;
    // Buttons, grip handles and text being typed in keep their own mouse behavior.
    // (Shapes and their handles stop the event themselves.)
    if ((e.target as HTMLElement).closest("button, [role='button'], [contenteditable='true']")) return;
    // Read the store now: the editor's "click outside deselects" runs right after this.
    const state = useEditorStore.getState();
    const keptIds = e.shiftKey && state.selectedSlideId === slide.id ? state.selectedElementIds : [];
    pressStart.current = { x: e.clientX, y: e.clientY, keptIds };
  };

  const handleMarqueePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (marquee) {
      setMarquee({ ...marquee, x: e.clientX, y: e.clientY });
      return;
    }
    const start = pressStart.current;
    // The button may have been let go outside the slide, where we never heard about it.
    if (!start || (e.buttons & 1) === 0) {
      pressStart.current = null;
      return;
    }
    // A tiny wiggle is still just a click.
    if (Math.abs(e.clientX - start.x) < 4 && Math.abs(e.clientY - start.y) < 4) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const origin = e.currentTarget.getBoundingClientRect();
    setMarquee({
      originX: origin.left,
      originY: origin.top,
      startX: start.x,
      startY: start.y,
      x: e.clientX,
      y: e.clientY,
      keptIds: start.keptIds,
    });
  };

  const handleMarqueePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pressStart.current = null;
    if (!marquee || !rootRef.current) return;
    setMarquee(null);
    const left = Math.min(marquee.startX, e.clientX);
    const right = Math.max(marquee.startX, e.clientX);
    const top = Math.min(marquee.startY, e.clientY);
    const bottom = Math.max(marquee.startY, e.clientY);
    skipNextClick.current = true;

    // Compare on-screen boxes, so this works at any zoom and inside any box (question, option, canvas).
    const touchedIds = Array.from(rootRef.current.querySelectorAll<HTMLElement>("[data-element-id]"))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.left < right && r.right > left && r.top < bottom && r.bottom > top;
      })
      .map((el) => el.dataset.elementId!);

    selectContainer(null, slide.id);
    // Touching any part of a group selects the whole group.
    selectElements(withGroupMembers(slide.elements, [...new Set([...marquee.keptIds, ...touchedIds])]));
  };

  // The rectangle in the canvas's own (unzoomed) coordinates, for drawing it.
  const marqueeBox = marquee
    ? {
        left: (Math.min(marquee.startX, marquee.x) - marquee.originX) / zoom,
        top: (Math.min(marquee.startY, marquee.y) - marquee.originY) / zoom,
        width: Math.abs(marquee.x - marquee.startX) / zoom,
        height: Math.abs(marquee.y - marquee.startY) / zoom,
      }
    : null;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const freeElements = slide.elements.filter((el) => el.containerId === null);
  // "Fit to box" only works on selected elements that sit in a box and aren't text boxes.
  const canFitSelection = slide.elements.some(
    (el) => selectedElementIds.includes(el.id) && el.containerId !== null && !getElementAsset(el.assetId)?.isTextBox
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      reorderOptions(slide.id, String(active.id), String(over.id));
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const containerEl = (e.target as HTMLElement).closest<HTMLElement>("[data-container-id]");
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      containerId: containerEl?.dataset.containerId ?? null,
      // Read once here instead of listening to the clipboard, which would redraw every slide on copy.
      canPaste: useEditorStore.getState().clipboard !== null,
    });
  };

  return (
    <div
      ref={rootRef}
      data-canvas-root="true"
      className="relative flex select-none flex-col gap-6 overflow-hidden rounded-card border bg-bg-surface p-10"
      style={{
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        ...getSlideBackgroundStyle(slide),
        borderColor: isCanvasDragOver ? "var(--accent-navy)" : "var(--border-default)",
      }}
      {...(isLesson ? canvasDropHandlers : {})}
      onPointerDown={handleMarqueePointerDown}
      onPointerMove={handleMarqueePointerMove}
      onPointerUp={handleMarqueePointerUp}
      onClick={(e) => {
        if (skipNextClick.current) {
          skipNextClick.current = false;
          return;
        }
        if (e.target === e.currentTarget) {
          clearElementSelection();
          selectContainer(null, slide.id);
        }
      }}
      onContextMenu={handleContextMenu}
    >
      {!isLesson && <QuestionContainer slide={slide} />}
      {slide.type === "short-answer" && <SideContainer slide={slide} />}

      {isChoice && (
        <>
          {hasShapeStrip(slide) && <SideContainer slide={slide} />}

          {!hasShapeBox(slide) && (
            // Takes the place of the gap under the question: -my-6 cancels the canvas's gap-6 on both
            // sides, so it touches the question and the options. Only the button takes clicks, so the
            // question's resize handle (which reaches a little into this row) still works.
            <div
              className="pointer-events-none relative -my-6 flex shrink-0 items-center"
              style={{ height: ADD_SHAPE_BOX_ROW_HEIGHT }}
            >
              <div className="h-px flex-1 bg-border-default" />
              {/* Sits in the slide's right padding (p-10 = 40px), 6px from the slide's edge. */}
              <button
                type="button"
                title="Add a box for shapes"
                onClick={() => addShapeBox(slide.id)}
                className="pointer-events-auto absolute -right-[34px] flex h-7 w-7 items-center justify-center rounded-full border border-border-default bg-bg-surface text-text-primary hover:bg-bg-page"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M7 2.5V11.5M2.5 7H11.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          )}

          <div className={OPTIONS_AREA_CLASSES}>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={slide.options.map((o) => o.id)} strategy={rectSortingStrategy}>
                <div className={`grid min-h-0 flex-1 ${OPTIONS_GRID_CLASSES[slide.layout]}`}>
                  {slide.options.map((option, index) => (
                    <OptionCard
                      key={option.id}
                      slideId={slide.id}
                      option={option}
                      index={index}
                      isCorrect={option.id === slide.correctOptionId}
                      elements={slide.elements}
                      box={slide}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
            {slide.layout === "list-side" && <SideContainer slide={slide} />}
          </div>
        </>
      )}

      <div className="pointer-events-none absolute inset-0">
        {freeElements.map((element) => (
          <SvgElementItem
            key={element.id}
            slideId={slide.id}
            element={element}
            allElements={freeElements}
            isSelected={selectedElementIds.includes(element.id)}
            bounds={CANVAS_BOUNDS}
          />
        ))}
        <GroupSelectionOverlay slideId={slide.id} elements={freeElements} bounds={CANVAS_BOUNDS} />
        <SnapGuides slideId={slide.id} containerId={null} />
        {isSelectedSlide && <ElementDragGhost />}
      </div>

      {marqueeBox && (
        <div
          className="pointer-events-none absolute z-40 border border-accent-navy"
          style={{ ...marqueeBox, background: "rgba(25, 26, 44, 0.08)" }}
        />
      )}

      {contextMenu && (
        <ElementContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          canCopy={selectedElementIds.length > 0}
          canPaste={contextMenu.canPaste}
          onCopy={copySelectedElements}
          canFit={canFitSelection}
          onPaste={() => pasteClipboard(slide.id, contextMenu.containerId)}
          onFit={() => fitElementsToContainer(slide.id, selectedElementIds)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
