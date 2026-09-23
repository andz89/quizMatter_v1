"use client";

import { useRef } from "react";
import { useEditorStore } from "@/lib/store";
import { getElementAsset } from "@/lib/svgLibrary";
import { ElementSvg } from "./ElementSvg";
import type { SvgElement } from "@/lib/schema";

const MIN_SIZE = 24;
const ROTATE_SNAP = 15;

/** A resize handle corner: sx/sy say which way "outward" is (+1 = right/down, -1 = left/up). */
export interface Corner {
  sx: 1 | -1;
  sy: 1 | -1;
  className: string;
}

export const CORNERS: Corner[] = [
  { sx: -1, sy: -1, className: "-top-2 -left-2 cursor-nwse-resize" },
  { sx: 1, sy: -1, className: "-top-2 -right-2 cursor-nesw-resize" },
  { sx: -1, sy: 1, className: "-bottom-2 -left-2 cursor-nesw-resize" },
  { sx: 1, sy: 1, className: "-bottom-2 -right-2 cursor-nwse-resize" },
];

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

interface DragState {
  x: number;
  y: number;
  items: DragItem[];
  dx: number;
  dy: number;
  /** The box (other than this element's own) the pointer is currently over, if any — set while dragging, read on drop. */
  hoverContainerEl: HTMLElement | null;
  hoverContainerId: string | null;
  /** The canvas root, used to convert cursor position into canvas-wide coordinates for the drag ghost. */
  canvasRootEl: HTMLElement | null;
  /** Where inside this element the pointer grabbed it — keeps that same spot under the cursor in another box. */
  grabOffsetX: number;
  grabOffsetY: number;
}

export function SvgElementItem({ slideId, element, allElements, isSelected, bounds }: SvgElementItemProps) {
  const zoom = useEditorStore((s) => s.zoom);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const selectElement = useEditorStore((s) => s.selectElement);
  const selectElements = useEditorStore((s) => s.selectElements);
  const updateElement = useEditorStore((s) => s.updateElement);
  const setDragOverContainerId = useEditorStore((s) => s.setDragOverContainerId);
  const setElementDragGhosts = useEditorStore((s) => s.setElementDragGhosts);
  // While ghost previews show the dragged element(s) in a different box, hide the real ones so they're not duplicated.
  const isGhosting = useEditorStore((s) => s.elementDragGhosts.some((g) => g.id === element.id));

  const dragState = useRef<DragState | null>(null);
  const resizeState = useRef<
    { pointerX: number; pointerY: number; x: number; y: number; w: number; h: number; sx: 1 | -1; sy: 1 | -1 } | null
  >(null);
  const isRotating = useRef(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Solids turn in 3D from the toolbar instead, so they don't get the flat spin.
  const canRotate = !getElementAsset(element.assetId)?.is3d;
  const angle = element.rotation ?? 0;
  const isOnlySelected = isSelected && selectedElementIds.length === 1;

  const handleBodyPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();

    if (e.shiftKey) {
      selectElement(slideId, element.id, true);
      return;
    }

    // Already selected (alone, as part of a multi-select, or picked out of its group by a
    // double-click) — keep that selection. Otherwise select it, which pulls in its whole group.
    if (!isSelected) selectElement(slideId, element.id, false);
    const idsToMove = useEditorStore.getState().selectedElementIds;

    const elementRect = e.currentTarget.getBoundingClientRect();
    dragState.current = {
      x: e.clientX,
      y: e.clientY,
      items: idsToMove
        .map((id) => allElements.find((el) => el.id === id))
        .filter((el): el is SvgElement => !!el)
        .map((el) => ({ id: el.id, x: el.x, y: el.y, width: el.width, height: el.height })),
      dx: 0,
      dy: 0,
      hoverContainerEl: null,
      hoverContainerId: null,
      canvasRootEl: e.currentTarget.closest<HTMLElement>("[data-canvas-root]"),
      grabOffsetX: (e.clientX - elementRect.left) / zoom,
      grabOffsetY: (e.clientY - elementRect.top) / zoom,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleBodyPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current) return;
    const state = dragState.current;
    const { x, y, items } = state;

    const minX = Math.min(...items.map((i) => i.x));
    const minY = Math.min(...items.map((i) => i.y));
    const maxX = Math.max(...items.map((i) => i.x + i.width));
    const maxY = Math.max(...items.map((i) => i.y + i.height));

    const dx = Math.min(bounds.width - maxX, Math.max(-minX, (e.clientX - x) / zoom));
    const dy = Math.min(bounds.height - maxY, Math.max(-minY, (e.clientY - y) / zoom));
    state.dx = dx;
    state.dy = dy;

    items.forEach((item) => updateElement(slideId, item.id, { x: item.x + dx, y: item.y + dy }));

    // Which box (if any other than this element's own) is under the pointer right now — drives
    // the "drop here" highlight and, on release, where the element ends up.
    // Only boxes on this same slide count — other slides reuse the "question" id, and an option id
    // from another slide would leave the element bound to a box that doesn't exist here.
    const pointed = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-container-id]") ?? null;
    const hovered = pointed && state.canvasRootEl?.contains(pointed) ? pointed : null;
    const hoveredId = hovered?.dataset.containerId ?? null;
    const isOtherContainer = hovered !== null && hoveredId !== element.containerId;
    const nextHoverId = isOtherContainer ? hoveredId : null;

    if (state.hoverContainerId !== nextHoverId) {
      state.hoverContainerEl = isOtherContainer ? hovered : null;
      state.hoverContainerId = nextHoverId;
      setDragOverContainerId(nextHoverId);
    }

    // Once the drag has crossed into a different box, show a preview of every dragged element
    // following the cursor — otherwise the move isn't visible until the elements snap into place on drop.
    // The grabbed element sits under the cursor; the rest keep their offset from it, matching the drop.
    if (isOtherContainer && state.canvasRootEl) {
      const canvasRect = state.canvasRootEl.getBoundingClientRect();
      const primaryX = (e.clientX - canvasRect.left) / zoom - state.grabOffsetX;
      const primaryY = (e.clientY - canvasRect.top) / zoom - state.grabOffsetY;
      const primary = items.find((item) => item.id === element.id) ?? items[0];
      setElementDragGhosts(
        items
          .map((item) => ({ item, el: allElements.find((el) => el.id === item.id) }))
          .filter((pair): pair is { item: DragItem; el: SvgElement } => !!pair.el)
          .map(({ item, el }) => ({
            id: el.id,
            assetId: el.assetId,
            color: el.color,
            x: primaryX + item.x - primary.x,
            y: primaryY + item.y - primary.y,
            width: el.width,
            height: el.height,
            rotation: el.rotation ?? 0,
            settings: el,
          }))
      );
    } else if (useEditorStore.getState().elementDragGhosts.length > 0) {
      setElementDragGhosts([]);
    }
  };

  const stopDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = dragState.current;
    dragState.current = null;
    if (!state) return;
    setDragOverContainerId(null);
    setElementDragGhosts([]);

    // Released over a different box — move the dragged element(s) there, landing the one actually
    // under the cursor exactly where the ghost preview showed it (same grab point under the cursor),
    // and shifting the rest of a multi-selected group by that same amount to keep their layout.
    if (!state.hoverContainerEl || !state.hoverContainerId) return;

    const targetRect = state.hoverContainerEl.getBoundingClientRect();
    const targetBounds = { width: targetRect.width / zoom, height: targetRect.height / zoom };

    const finalItems = state.items.map((item) => ({ ...item, x: item.x + state.dx, y: item.y + state.dy }));
    const primary = finalItems.find((item) => item.id === element.id) ?? finalItems[0];
    const dropX = (e.clientX - targetRect.left) / zoom - state.grabOffsetX;
    const dropY = (e.clientY - targetRect.top) / zoom - state.grabOffsetY;
    const shiftX = dropX - primary.x;
    const shiftY = dropY - primary.y;

    // A group lives in one box, so an element moved without the rest of its group leaves the group.
    const movedIds = finalItems.map((item) => item.id);
    const leavesGroup = (id: string) => {
      const groupId = allElements.find((el) => el.id === id)?.groupId;
      return !!groupId && allElements.some((el) => el.groupId === groupId && !movedIds.includes(el.id));
    };

    finalItems.forEach((item) => {
      // Too big for the new box — shrink evenly (keeping the shape) so it fits.
      const scale = Math.min(1, targetBounds.width / item.width, targetBounds.height / item.height);
      const width = item.width * scale;
      const height = item.height * scale;
      updateElement(slideId, item.id, {
        ...(leavesGroup(item.id) && { groupId: undefined }),
        containerId: state.hoverContainerId,
        width,
        height,
        x: Math.min(targetBounds.width - width, Math.max(0, item.x + shiftX)),
        y: Math.min(targetBounds.height - height, Math.max(0, item.y + shiftY)),
      });
    });
  };

  const handleResizePointerDown = (e: React.PointerEvent<HTMLDivElement>, corner: Corner) => {
    e.stopPropagation();
    resizeState.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      x: element.x,
      y: element.y,
      w: element.width,
      h: element.height,
      sx: corner.sx,
      sy: corner.sy,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleResizePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeState.current) return;
    const { pointerX, pointerY, x, y, w, h, sx, sy } = resizeState.current;
    // The opposite corner stays fixed. Flipping the movement by the corner's direction means
    // dragging "outward" always grows the shape, whichever corner is grabbed. The resize amount
    // follows the cursor along the diagonal (both axes) so the handle stays under the cursor.
    // On a turned shape, the mouse movement is turned back first so it lines up with the shape's own sides.
    const rad = (angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const screenDx = (e.clientX - pointerX) / zoom;
    const screenDy = (e.clientY - pointerY) / zoom;
    const dx = (screenDx * cos + screenDy * sin) * sx;
    const dy = (-screenDx * sin + screenDy * cos) * sy;
    const originalDistance = Math.hypot(w, h);
    const newDistance = Math.hypot(w + dx, h + dy);
    // The shape spins around its center, and the center moves when the size changes. The center
    // shifts by the growth (turned by the angle) so the opposite corner stays put on screen.
    // For a scale s: center = (x + w/2, y + h/2) + (s - 1) * (moveX, moveY).
    const moveX = (sx * w * cos - sy * h * sin) / 2;
    const moveY = (sx * w * sin + sy * h * cos) / 2;
    // Each box edge is a straight line in s (start + s * rate), so each gives a simple largest s
    // that keeps the box inside the bounds. This works for any angle.
    const maxScale = Math.min(
      maxScaleFor(x + w / 2 - moveX, moveX - w / 2, 0, bounds.width), // left edge
      maxScaleFor(x + w / 2 - moveX, moveX + w / 2, 0, bounds.width), // right edge
      maxScaleFor(y + h / 2 - moveY, moveY - h / 2, 0, bounds.height), // top edge
      maxScaleFor(y + h / 2 - moveY, moveY + h / 2, 0, bounds.height), // bottom edge
    );
    const minScale = Math.max(MIN_SIZE / w, MIN_SIZE / h);
    const scale = Math.min(maxScale, Math.max(minScale, newDistance / originalDistance));
    const width = w * scale;
    const height = h * scale;
    const centerX = x + w / 2 + (scale - 1) * moveX;
    const centerY = y + h / 2 + (scale - 1) * moveY;
    updateElement(slideId, element.id, {
      width,
      height,
      x: centerX - width / 2,
      y: centerY - height / 2,
    });
  };

  const stopResize = () => {
    resizeState.current = null;
  };

  const handleRotatePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    isRotating.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleRotatePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isRotating.current || !boxRef.current) return;
    // The screen box of a turned element still has the same center as the element itself.
    const rect = boxRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    // The handle sits straight above the center, so "mouse straight up" = 0°. The +90 makes that so.
    let next = (Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180) / Math.PI + 90;
    if (e.shiftKey) next = Math.round(next / ROTATE_SNAP) * ROTATE_SNAP;
    // Keep it in -180..180 so the toolbar slider can show it.
    next = ((((next + 180) % 360) + 360) % 360) - 180;
    updateElement(slideId, element.id, { rotation: Math.round(next) });
  };

  const stopRotate = () => {
    isRotating.current = false;
  };

  return (
    <div
      ref={boxRef}
      data-svg-element="true"
      data-element-id={element.id}
      className="pointer-events-auto absolute"
      style={{
        left: element.x,
        top: element.y,
        width: element.width,
        height: element.height,
        transform: `rotate(${angle}deg)`,
        visibility: isGhosting ? "hidden" : "visible",
        outline: isOnlySelected ? "1.5px dashed var(--accent-gray)" : "1.5px dashed transparent",
        outlineOffset: 3,
      }}
    >
      <div
        onPointerDown={handleBodyPointerDown}
        onPointerMove={handleBodyPointerMove}
        onPointerUp={stopDrag}
        onPointerLeave={stopDrag}
        onClick={(e) => e.stopPropagation()}
        // Double-click picks just this one element out of its group, to edit it on its own.
        onDoubleClick={() => element.groupId && selectElements([element.id])}
        className="h-full w-full cursor-move"
      >
        <ElementSvg assetId={element.assetId} color={element.color} settings={element} />
      </div>

      {isOnlySelected && canRotate && (
        <div
          onPointerDown={handleRotatePointerDown}
          onPointerMove={handleRotatePointerMove}
          onPointerUp={stopRotate}
          onPointerLeave={stopRotate}
          onClick={(e) => e.stopPropagation()}
          title="Rotate (hold Shift to snap)"
          className="absolute -top-12 left-1/2 flex h-8 w-8 -translate-x-1/2 cursor-grab items-center justify-center rounded-full border border-border-default bg-bg-surface text-text-primary active:cursor-grabbing"
        >
          <RotateIcon />
        </div>
      )}

      {isOnlySelected &&
        CORNERS.map((corner) => (
          <div
            key={corner.className}
            onPointerDown={(e) => handleResizePointerDown(e, corner)}
            onPointerMove={handleResizePointerMove}
            onPointerUp={stopResize}
            onPointerLeave={stopResize}
            onClick={(e) => e.stopPropagation()}
            title="Resize"
            className={`absolute h-4 w-4 rounded-full border-2 border-white shadow-sm ${corner.className}`}
            style={{ background: "var(--accent-navy)" }}
          />
        ))}
    </div>
  );
}

/** Largest scale s where `start + s * rate` stays within [min, max]. */
function maxScaleFor(start: number, rate: number, min: number, max: number) {
  if (rate > 0) return (max - start) / rate;
  if (rate < 0) return (min - start) / rate;
  return Infinity;
}

export function RotateIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 8a5 5 0 1 1-1.5-3.55" />
      <path d="M13 2.5v3h-3" />
    </svg>
  );
}
