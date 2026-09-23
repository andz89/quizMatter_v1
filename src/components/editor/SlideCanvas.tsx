"use client";

import { useEffect, useState } from "react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import { useEditorStore } from "@/lib/store";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "@/lib/constants";
import { isTypingTarget } from "@/lib/dom";
import { QuestionContainer } from "./QuestionContainer";
import { OptionCard } from "./OptionCard";
import { SvgElementItem } from "./SvgElementItem";
import { GroupSelectionOverlay } from "./GroupSelectionOverlay";
import { ElementContextMenu } from "./ElementContextMenu";
import type { Slide } from "@/lib/schema";

const CANVAS_BOUNDS = { width: CANVAS_WIDTH, height: CANVAS_HEIGHT };

interface SlideCanvasProps {
  slide: Slide;
}

export function SlideCanvas({ slide }: SlideCanvasProps) {
  const reorderOptions = useEditorStore((s) => s.reorderOptions);
  const selectedSlideId = useEditorStore((s) => s.selectedSlideId);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const selectedContainerId = useEditorStore((s) => s.selectedContainerId);
  const clearElementSelection = useEditorStore((s) => s.clearElementSelection);
  const selectContainer = useEditorStore((s) => s.selectContainer);
  const deleteElement = useEditorStore((s) => s.deleteElement);
  const clipboard = useEditorStore((s) => s.clipboard);
  const copySelectedElements = useEditorStore((s) => s.copySelectedElements);
  const pasteClipboard = useEditorStore((s) => s.pasteClipboard);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; containerId: string | null } | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const freeElements = slide.elements.filter((el) => el.containerId === null);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      reorderOptions(slide.id, String(active.id), String(over.id));
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const containerEl = (e.target as HTMLElement).closest<HTMLElement>("[data-container-id]");
    setContextMenu({ x: e.clientX, y: e.clientY, containerId: containerEl?.dataset.containerId ?? null });
  };

  // Delete/Backspace removes the selected element(s), Escape deselects, Ctrl/Cmd+C copies and
  // Ctrl/Cmd+V pastes — but never while typing. Paste only acts when this is the active slide,
  // since every slide's canvas mounts at once in the scrollable workspace and would otherwise all
  // paste the clipboard at the same time.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMeta = e.ctrlKey || e.metaKey;

      // Paste an element even while a text field has focus: clicking a box's own text is the
      // normal way to "aim" a paste at it, and clicking there focuses its contentEditable — so
      // gating this on isTypingTarget would silently swallow the paste whenever it's aimed at an
      // option/question the user just clicked into. Only applies when there's actually an element
      // to paste; with an empty clipboard this falls through so normal text paste still works.
      if (isMeta && e.key.toLowerCase() === "v" && clipboard) {
        if (slide.id !== selectedSlideId) return;
        e.preventDefault();
        pasteClipboard(slide.id, selectedContainerId);
        return;
      }

      if (isTypingTarget(e.target)) return;

      if (isMeta && e.key.toLowerCase() === "c") {
        if (selectedElementIds.length === 0 || slide.id !== selectedSlideId) return;
        e.preventDefault();
        copySelectedElements();
      } else if (selectedElementIds.length > 0 && (e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault();
        selectedElementIds.forEach((id) => deleteElement(slide.id, id));
      } else if (e.key === "Escape") {
        clearElementSelection();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    selectedElementIds,
    selectedSlideId,
    selectedContainerId,
    slide.id,
    deleteElement,
    clearElementSelection,
    clipboard,
    copySelectedElements,
    pasteClipboard,
  ]);

  return (
    <div
      className="relative flex select-none flex-col gap-6 overflow-hidden rounded-card border border-border-default bg-bg-surface p-10"
      style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          clearElementSelection();
          selectContainer(null, slide.id);
        }
      }}
      onContextMenu={handleContextMenu}
    >
      <QuestionContainer slide={slide} />

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={slide.options.map((o) => o.id)} strategy={rectSortingStrategy}>
          <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-5">
            {slide.options.map((option, index) => (
              <OptionCard
                key={option.id}
                slideId={slide.id}
                option={option}
                index={index}
                isCorrect={option.id === slide.correctOptionId}
                elements={slide.elements}
                questionHeight={slide.questionHeight}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

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
      </div>

      {contextMenu && (
        <ElementContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          canCopy={selectedElementIds.length > 0}
          canPaste={clipboard !== null}
          onCopy={copySelectedElements}
          onPaste={() => pasteClipboard(slide.id, contextMenu.containerId)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
