"use client";

import { useRef } from "react";
import { useEditorStore, selectedIdsOn } from "@/lib/store";
import { getOuterEdges, MIN_ELEMENT_SIZE } from "@/lib/geometry";
import type { SvgElement } from "@/lib/schema";
import { CORNERS, type Corner } from "./SvgElementItem";

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

/** Shown instead of per-element handles when 2+ SVG elements (within the same container) are selected together, or a group is selected. */
export function GroupSelectionOverlay({ slideId, elements, bounds }: GroupSelectionOverlayProps) {
  const zoom = useEditorStore((s) => s.zoom);
  const selectedElementIds = useEditorStore(selectedIdsOn(slideId));
  const updateElements = useEditorStore((s) => s.updateElements);
  // Hidden while the group is being dragged into another box — the ghost previews show it there instead.
  const isGhosting = useEditorStore((s) => s.elementDragGhosts.length > 0);

  const resizeState = useRef<{
    x: number;
    y: number;
    items: ResizeItem[];
    groupX: number;
    groupY: number;
    groupWidth: number;
    groupHeight: number;
    sx: 1 | -1;
    sy: 1 | -1;
  } | null>(null);

  const selected = elements.filter((el) => selectedElementIds.includes(el.id));
  if (selected.length < 2 || isGhosting) return null;

  const { minX, minY, maxX, maxY } = getOuterEdges(selected);
  // A saved group gets a solid outline; a temporary multi-select keeps the dashed one.
  const isSavedGroup = !!selected[0].groupId && selected.every((el) => el.groupId === selected[0].groupId);

  const handleResizePointerDown = (e: React.PointerEvent<HTMLDivElement>, corner: Corner) => {
    e.stopPropagation();
    resizeState.current = {
      x: e.clientX,
      y: e.clientY,
      items: selected.map((el) => ({ id: el.id, x: el.x, y: el.y, width: el.width, height: el.height })),
      groupX: minX,
      groupY: minY,
      groupWidth: maxX - minX,
      groupHeight: maxY - minY,
      sx: corner.sx,
      sy: corner.sy,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleResizePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeState.current) return;
    const { x, y, items, groupX, groupY, groupWidth, groupHeight, sx, sy } = resizeState.current;
    // The group's opposite corner stays fixed. Flipping the movement by the corner's direction means
    // dragging "outward" always grows the group, and following the diagonal (both axes) keeps the
    // handle under the cursor.
    const dx = ((e.clientX - x) / zoom) * sx;
    const dy = ((e.clientY - y) / zoom) * sy;
    const originalDistance = Math.hypot(groupWidth, groupHeight);
    const newDistance = Math.hypot(groupWidth + dx, groupHeight + dy);

    // Fixed corner every element scales toward/away from.
    const anchorX = sx > 0 ? groupX : groupX + groupWidth;
    const anchorY = sy > 0 ? groupY : groupY + groupHeight;
    // Room between the fixed corner and the bounds edge on the side being dragged toward.
    const roomX = sx > 0 ? bounds.width - anchorX : anchorX;
    const roomY = sy > 0 ? bounds.height - anchorY : anchorY;

    const smallestDimension = Math.min(...items.flatMap((i) => [i.width, i.height]));
    const minScale = MIN_ELEMENT_SIZE / smallestDimension;
    const maxScale = Math.min(roomX / groupWidth, roomY / groupHeight);
    const scale = Math.min(maxScale, Math.max(minScale, newDistance / originalDistance));

    updateElements(
      slideId,
      Object.fromEntries(
        items.map((item) => [
          item.id,
          {
            x: anchorX + (item.x - anchorX) * scale,
            y: anchorY + (item.y - anchorY) * scale,
            width: item.width * scale,
            height: item.height * scale,
          },
        ])
      )
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
        outline: `1.5px ${isSavedGroup ? "solid" : "dashed"} var(--accent-navy)`,
        outlineOffset: 6,
      }}
    >
      {CORNERS.map((corner) => (
        <div
          key={corner.className}
          data-svg-element="true"
          onPointerDown={(e) => handleResizePointerDown(e, corner)}
          onPointerMove={handleResizePointerMove}
          onPointerUp={stopResize}
          onPointerLeave={stopResize}
          onClick={(e) => e.stopPropagation()}
          title="Resize group"
          className={`pointer-events-auto absolute h-4 w-4 rounded-full border-2 border-white shadow-sm ${corner.className}`}
          style={{ background: "var(--accent-navy)" }}
        />
      ))}
    </div>
  );
}
