"use client";

import { useRef } from "react";
import { useEditorStore } from "@/lib/store";
import type { SvgElement } from "@/lib/schema";

const MIN_SIZE = 24;

interface ResizeItem {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface GroupSelectionOverlayProps {
  slideId: string;
  elements: SvgElement[];
  bounds: { width: number; height: number };
}

/** Shown instead of per-element handles when 2+ SVG elements (within the same container) are selected together. */
export function GroupSelectionOverlay({ slideId, elements, bounds }: GroupSelectionOverlayProps) {
  const zoom = useEditorStore((s) => s.zoom);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const updateElement = useEditorStore((s) => s.updateElement);

  const resizeState = useRef<{
    x: number;
    items: ResizeItem[];
    groupX: number;
    groupY: number;
    groupWidth: number;
    groupHeight: number;
  } | null>(null);

  const selected = elements.filter((el) => selectedElementIds.includes(el.id));
  if (selected.length < 2) return null;

  const minX = Math.min(...selected.map((el) => el.x));
  const minY = Math.min(...selected.map((el) => el.y));
  const maxX = Math.max(...selected.map((el) => el.x + el.width));
  const maxY = Math.max(...selected.map((el) => el.y + el.height));

  const handleResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    resizeState.current = {
      x: e.clientX,
      items: selected.map((el) => ({ id: el.id, x: el.x, y: el.y, width: el.width, height: el.height })),
      groupX: minX,
      groupY: minY,
      groupWidth: maxX - minX,
      groupHeight: maxY - minY,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleResizePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeState.current) return;
    const { x, items, groupX, groupY, groupWidth, groupHeight } = resizeState.current;
    const delta = (e.clientX - x) / zoom;

    const smallestDimension = Math.min(...items.flatMap((i) => [i.width, i.height]));
    const minScale = MIN_SIZE / smallestDimension;
    const maxScale = Math.min((bounds.width - groupX) / groupWidth, (bounds.height - groupY) / groupHeight);
    const scale = Math.min(maxScale, Math.max(minScale, (groupWidth + delta) / groupWidth));

    items.forEach((item) =>
      updateElement(slideId, item.id, {
        x: groupX + (item.x - groupX) * scale,
        y: groupY + (item.y - groupY) * scale,
        width: item.width * scale,
        height: item.height * scale,
      })
    );
  };

  const stopResize = () => {
    resizeState.current = null;
  };

  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: minX,
        top: minY,
        width: maxX - minX,
        height: maxY - minY,
        outline: "1.5px dashed var(--accent-navy)",
        outlineOffset: 6,
      }}
    >
      <div
        data-svg-element="true"
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={stopResize}
        onPointerLeave={stopResize}
        onClick={(e) => e.stopPropagation()}
        title="Resize group"
        className="pointer-events-auto absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-full border-2 border-white shadow-sm"
        style={{ background: "var(--accent-navy)" }}
      />
    </div>
  );
}
