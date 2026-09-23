"use client";

import { useRef } from "react";
import { useEditorStore } from "@/lib/store";
import { ElementSvg } from "./ElementSvg";
import type { SvgElement } from "@/lib/schema";

const MIN_SIZE = 24;

interface SvgElementItemProps {
  slideId: string;
  element: SvgElement;
  allElements: SvgElement[];
  isSelected: boolean;
  /** The coordinate space element.x/y/width/height are relative to (canvas, or a container's own box). */
  bounds: { width: number; height: number };
}

interface DragItem {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function SvgElementItem({ slideId, element, allElements, isSelected, bounds }: SvgElementItemProps) {
  const zoom = useEditorStore((s) => s.zoom);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const selectElement = useEditorStore((s) => s.selectElement);
  const updateElement = useEditorStore((s) => s.updateElement);

  const dragState = useRef<{ x: number; y: number; items: DragItem[] } | null>(null);
  const resizeState = useRef<{ x: number; w: number; h: number } | null>(null);

  const handleBodyPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();

    if (e.shiftKey) {
      selectElement(slideId, element.id, true);
      return;
    }

    const isPartOfGroup = isSelected && selectedElementIds.length > 1;
    const idsToMove = isPartOfGroup ? selectedElementIds : [element.id];
    if (!isPartOfGroup) selectElement(slideId, element.id, false);

    dragState.current = {
      x: e.clientX,
      y: e.clientY,
      items: idsToMove
        .map((id) => allElements.find((el) => el.id === id))
        .filter((el): el is SvgElement => !!el)
        .map((el) => ({ id: el.id, x: el.x, y: el.y, width: el.width, height: el.height })),
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleBodyPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current) return;
    const { x, y, items } = dragState.current;

    const minX = Math.min(...items.map((i) => i.x));
    const minY = Math.min(...items.map((i) => i.y));
    const maxX = Math.max(...items.map((i) => i.x + i.width));
    const maxY = Math.max(...items.map((i) => i.y + i.height));

    const dx = Math.min(bounds.width - maxX, Math.max(-minX, (e.clientX - x) / zoom));
    const dy = Math.min(bounds.height - maxY, Math.max(-minY, (e.clientY - y) / zoom));

    items.forEach((item) => updateElement(slideId, item.id, { x: item.x + dx, y: item.y + dy }));
  };

  const stopDrag = () => {
    dragState.current = null;
  };

  const handleResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    resizeState.current = { x: e.clientX, w: element.width, h: element.height };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleResizePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeState.current) return;
    const { x, w, h } = resizeState.current;
    const delta = (e.clientX - x) / zoom;
    const maxScale = Math.min((bounds.width - element.x) / w, (bounds.height - element.y) / h);
    const minScale = Math.max(MIN_SIZE / w, MIN_SIZE / h);
    const scale = Math.min(maxScale, Math.max(minScale, (w + delta) / w));
    updateElement(slideId, element.id, { width: w * scale, height: h * scale });
  };

  const stopResize = () => {
    resizeState.current = null;
  };

  return (
    <div
      data-svg-element="true"
      className="pointer-events-auto absolute"
      style={{ left: element.x, top: element.y, width: element.width, height: element.height }}
    >
      <div
        onPointerDown={handleBodyPointerDown}
        onPointerMove={handleBodyPointerMove}
        onPointerUp={stopDrag}
        onPointerLeave={stopDrag}
        onClick={(e) => e.stopPropagation()}
        className="h-full w-full cursor-move"
      >
        <ElementSvg assetId={element.assetId} color={element.color} />
      </div>

      {isSelected && selectedElementIds.length === 1 && (
        <div
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={stopResize}
          onPointerLeave={stopResize}
          onClick={(e) => e.stopPropagation()}
          title="Resize"
          className="absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-full border-2 border-white shadow-sm"
          style={{ background: "var(--accent-navy)" }}
        />
      )}
    </div>
  );
}
