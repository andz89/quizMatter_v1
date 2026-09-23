"use client";

import { useEffect, useRef, useState } from "react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import { useEditorStore, withGroupMembers } from "@/lib/store";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "@/lib/constants";
import { isTypingTarget } from "@/lib/dom";
import { QuestionContainer } from "./QuestionContainer";
import { OptionCard } from "./OptionCard";
import { SvgElementItem } from "./SvgElementItem";
import { GroupSelectionOverlay } from "./GroupSelectionOverlay";
import { ElementContextMenu } from "./ElementContextMenu";
import { ElementDragGhost } from "./ElementDragGhost";
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
  const clearClipboard = useEditorStore((s) => s.clearClipboard);
  const groupSelectedElements = useEditorStore((s) => s.groupSelectedElements);
  const ungroupSelectedElements = useEditorStore((s) => s.ungroupSelectedElements);

  const selectElements = useEditorStore((s) => s.selectElements);
  const zoom = useEditorStore((s) => s.zoom);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; containerId: string | null } | null>(null);

  // Rectangle selection: while Ctrl (Cmd on Mac) is held, a see-through layer covers the slide
  // so text, option cards and elements are "locked", and dragging anywhere draws a rectangle.
  // Every element the rectangle touches gets selected. All points are screen (client) pixels.
  const rootRef = useRef<HTMLDivElement>(null);
  const [isCtrlDown, setIsCtrlDown] = useState(false);
  // originX/Y = the canvas's top-left on screen when the drag began, for drawing the rectangle.
  const [marquee, setMarquee] = useState<{
    originX: number;
    originY: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => setIsCtrlDown(e.ctrlKey || e.metaKey);
    // Switching windows while holding Ctrl never sends the key-up, so reset on blur.
    const handleBlur = () => setIsCtrlDown(false);
    window.addEventListener("keydown", handleKey);
    window.addEventListener("keyup", handleKey);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("keyup", handleKey);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  const handleMarqueePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    // The layer covers the whole canvas, so its box is the canvas's box.
    const origin = e.currentTarget.getBoundingClientRect();
    setMarquee({
      originX: origin.left,
      originY: origin.top,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
    });
  };

  const handleMarqueePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (marquee) setMarquee({ ...marquee, x: e.clientX, y: e.clientY });
  };

  const handleMarqueePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!marquee || !rootRef.current) return;
    setMarquee(null);
    const left = Math.min(marquee.startX, e.clientX);
    const right = Math.max(marquee.startX, e.clientX);
    const top = Math.min(marquee.startY, e.clientY);
    const bottom = Math.max(marquee.startY, e.clientY);
    // A tiny drag is just a click — leave the selection alone.
    if (right - left < 4 && bottom - top < 4) return;

    // Compare on-screen boxes, so this works at any zoom and inside any box (question, option, canvas).
    const touchedIds = Array.from(rootRef.current.querySelectorAll<HTMLElement>("[data-element-id]"))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.left < right && r.right > left && r.top < bottom && r.bottom > top;
      })
      .map((el) => el.dataset.elementId!);

    // Shift adds to what's already selected on this slide; otherwise the rectangle replaces it.
    const kept = e.shiftKey && selectedSlideId === slide.id ? selectedElementIds : [];
    selectContainer(null, slide.id);
    // Touching any part of a group selects the whole group.
    selectElements(withGroupMembers(slide.elements, [...new Set([...kept, ...touchedIds])]));
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
    });
  };

  // Delete/Backspace removes the selected element(s), Escape deselects, Ctrl/Cmd+G groups,
  // Ctrl/Cmd+Shift+G ungroups, Ctrl/Cmd+C copies and Ctrl/Cmd+V pastes — but never while typing. Paste only acts when this is the active slide,
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
        // No box clicked since copying → undefined, so each element returns to its own box.
        pasteClipboard(slide.id, selectedContainerId ?? undefined);
        return;
      }

      if (isTypingTarget(e.target)) return;

      if (isMeta && e.key.toLowerCase() === "c") {
        if (selectedElementIds.length === 0 || slide.id !== selectedSlideId) return;
        // Highlighted text wins over the selected element, so normal text copy still works.
        if (window.getSelection()?.toString()) return;
        e.preventDefault();
        copySelectedElements();
      } else if (isMeta && e.key.toLowerCase() === "g") {
        if (selectedElementIds.length === 0 || slide.id !== selectedSlideId)
          return;
        // Stops the browser's own Ctrl+G ("find next").
        e.preventDefault();
        if (e.shiftKey) ungroupSelectedElements();
        else groupSelectedElements();
      } else if (selectedElementIds.length > 0 && (e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault();
        selectedElementIds.forEach((id) => deleteElement(slide.id, id));
      } else if (e.key === "Escape") {
        clearElementSelection();
      }
    };

    // A native text copy/cut means the user now wants text on the clipboard, so drop the copied
    // element — otherwise the Ctrl+V branch above would keep pasting the old element instead.
    // (Element copy calls preventDefault on keydown, so it never fires this event.)
    const handleNativeCopy = () => clearClipboard();

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("copy", handleNativeCopy);
    document.addEventListener("cut", handleNativeCopy);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("copy", handleNativeCopy);
      document.removeEventListener("cut", handleNativeCopy);
    };
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
    clearClipboard,
    groupSelectedElements,
    ungroupSelectedElements,
  ]);

  return (
    <div
      ref={rootRef}
      data-canvas-root="true"
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
        {slide.id === selectedSlideId && <ElementDragGhost />}
      </div>

      {(isCtrlDown || marquee) && (
        // data-keep-container-selection stops the editor's "click outside deselects" from firing.
        <div
          data-keep-container-selection="true"
          onPointerDown={handleMarqueePointerDown}
          onPointerMove={handleMarqueePointerMove}
          onPointerUp={handleMarqueePointerUp}
          className="absolute inset-0 z-40 cursor-crosshair"
        >
          {marqueeBox && (
            <div
              className="absolute border border-accent-navy"
              style={{ ...marqueeBox, background: "rgba(25, 26, 44, 0.08)" }}
            />
          )}
        </div>
      )}

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
