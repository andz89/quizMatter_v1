"use client";

import { useState } from "react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import { useEditorStore, selectedIdsOn } from "@/lib/store";
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
import { useMarqueeSelection } from "@/lib/useMarqueeSelection";
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

  const addShapeBox = useEditorStore((s) => s.addShapeBox);

  // Lesson slides have no boxes, so the slide itself takes elements dropped from the Elements panel.
  const isLesson = slide.type === "lesson";
  const isChoice = (slide.type ?? "choice") === "choice";
  const { isDragOver: isCanvasDragOver, dropHandlers: canvasDropHandlers } = useElementDropTarget(slide.id, null);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; containerId: string | null; canPaste: boolean } | null>(null);

  // Drag on empty space to select elements with a rectangle.
  const { rootRef, pointerHandlers, marqueeBox, takeSkippedClick } = useMarqueeSelection(slide.id, null);

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
      {...pointerHandlers}
      onClick={(e) => {
        if (takeSkippedClick()) return;
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
