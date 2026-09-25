"use client";

import { useRef, useState } from "react";
import { useEditorStore, withoutHistory } from "@/lib/store";
import { getElementAsset } from "@/lib/svgLibrary";
import { ElementSvg, TRIM_PADDING } from "./ElementSvg";
import { TextBoxContent } from "./TextBoxContent";
import { findSnap, fitInBox, getOuterEdges, maxScaleFor, MIN_ELEMENT_SIZE, type Snap } from "@/lib/geometry";
import type { SvgElement } from "@/lib/schema";

const ROTATE_SNAP = 15;
// How close (in screen pixels) an edge or center must get to a line before it snaps onto it.
const SNAP_DISTANCE = 6;
/** A text box's, line's or stretchable shape's edge handle: "x" changes the width, "y" the height; dir = which way is outward. */
interface EdgeHandle {
  axis: "x" | "y";
  dir: 1 | -1;
  className: string;
}

const EDGE_HANDLES: EdgeHandle[] = [
  { axis: "x", dir: -1, className: "top-1/2 -left-[5px] h-6 w-2.5 -translate-y-1/2 cursor-ew-resize" },
  { axis: "x", dir: 1, className: "top-1/2 -right-[5px] h-6 w-2.5 -translate-y-1/2 cursor-ew-resize" },
  { axis: "y", dir: -1, className: "left-1/2 -top-[5px] h-2.5 w-6 -translate-x-1/2 cursor-ns-resize" },
  { axis: "y", dir: 1, className: "left-1/2 -bottom-[5px] h-2.5 w-6 -translate-x-1/2 cursor-ns-resize" },
];

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
  // Just "is exactly one element selected?", so a click elsewhere doesn't redraw every element.
  const isSingleSelection = useEditorStore((s) => s.selectedElementIds.length === 1);
  const selectElement = useEditorStore((s) => s.selectElement);
  const selectElements = useEditorStore((s) => s.selectElements);
  const updateElement = useEditorStore((s) => s.updateElement);
  const updateElements = useEditorStore((s) => s.updateElements);
  const setDragOverContainerId = useEditorStore((s) => s.setDragOverContainerId);
  const setElementDragGhosts = useEditorStore((s) => s.setElementDragGhosts);
  const setSnapGuides = useEditorStore((s) => s.setSnapGuides);
  // While ghost previews show the dragged element(s) in a different box, hide the real ones so they're not duplicated.
  const isGhosting = useEditorStore((s) => s.elementDragGhosts.some((g) => g.id === element.id));

  const dragState = useRef<DragState | null>(null);
  const resizeState = useRef<
    { pointerX: number; pointerY: number; x: number; y: number; w: number; h: number; sx: 1 | -1; sy: 1 | -1 } | null
  >(null);
  const edgeResizeState = useRef<
    { pointerX: number; pointerY: number; x: number; y: number; w: number; h: number; handle: EdgeHandle } | null
  >(null);
  const isRotating = useRef(false);
  const boxRef = useRef<HTMLDivElement>(null);
  // Text boxes only: where the user double-clicked to start typing; null = not typing.
  const [editStart, setEditStart] = useState<{ x: number; y: number } | null>(null);

  const asset = getElementAsset(element.assetId);
  // Solids turn in 3D from the toolbar instead, so they don't get the flat spin.
  const canRotate = !asset?.is3d;
  const angle = element.rotation ?? 0;
  const isOnlySelected = isSelected && isSingleSelection;

  const handleBodyPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    // While typing, clicks and drags place the cursor or select words instead of moving the box.
    if (editStart) return;

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

    const { minX, minY, maxX, maxY } = getOuterEdges(items);

    let rawDx = (e.clientX - x) / zoom;
    let rawDy = (e.clientY - y) / zoom;

    // Snap the moved selection's edges/center onto the box's edges/center or another element's
    // edges/center. Alt turns snapping off for fine placement.
    let snap: { x: Snap; y: Snap } | null = null;
    if (!e.altKey) {
      const others = allElements.filter((el) => !items.some((item) => item.id === el.id));
      const threshold = SNAP_DISTANCE / zoom;
      snap = {
        x: findSnap(
          [minX, (minX + maxX) / 2, maxX].map((v) => v + rawDx),
          [0, bounds.width / 2, bounds.width, ...others.flatMap((el) => [el.x, el.x + el.width / 2, el.x + el.width])],
          threshold
        ),
        y: findSnap(
          [minY, (minY + maxY) / 2, maxY].map((v) => v + rawDy),
          [0, bounds.height / 2, bounds.height, ...others.flatMap((el) => [el.y, el.y + el.height / 2, el.y + el.height])],
          threshold
        ),
      };
      rawDx += snap.x.shift;
      rawDy += snap.y.shift;
    }

    const dx = Math.min(bounds.width - maxX, Math.max(-minX, rawDx));
    const dy = Math.min(bounds.height - maxY, Math.max(-minY, rawDy));
    state.dx = dx;
    state.dy = dy;

    updateElements(slideId, Object.fromEntries(items.map((item) => [item.id, { x: item.x + dx, y: item.y + dy }])));

    // Which box (if any other than this element's own) is under the pointer right now — drives
    // the "drop here" highlight and, on release, where the element ends up.
    // Only boxes on this same slide count — other slides reuse the "question" id, and an option id
    // from another slide would leave the element bound to a box that doesn't exist here.
    const pointed = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-container-id]") ?? null;
    const hovered = pointed && state.canvasRootEl?.contains(pointed) ? pointed : null;
    const hoveredId = hovered?.dataset.containerId ?? null;
    const isOtherContainer = hovered !== null && hoveredId !== element.containerId;
    const nextHoverId = isOtherContainer ? hoveredId : null;

    // No lines while the drag is headed into another box — the ghost preview shows it there instead.
    setSnapGuides(
      snap && !isOtherContainer && (snap.x.lines.length > 0 || snap.y.lines.length > 0)
        ? { slideId, containerId: element.containerId, xs: snap.x.lines, ys: snap.y.lines }
        : null
    );

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
    setSnapGuides(null);

    // Released over a different box — move the dragged element(s) there, landing the one actually
    // under the cursor exactly where the ghost preview showed it (same grab point under the cursor),
    // and shifting the rest of a multi-selected group by that same amount to keep their layout.
    if (!state.hoverContainerEl || !state.hoverContainerId) return;

    // Measure from the box's elements area (it can be inset, e.g. past an option's ✓/A button).
    const targetRect = (state.hoverContainerEl.querySelector("[data-element-layer]") ?? state.hoverContainerEl).getBoundingClientRect();
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

    const containerId = state.hoverContainerId;
    updateElements(
      slideId,
      Object.fromEntries(
        finalItems.map((item) => {
          const shifted = { width: item.width, height: item.height, x: item.x + shiftX, y: item.y + shiftY };
          // Too big for the new box — shrink evenly (keeping the shape) so it fits.
          const patch = { ...fitInBox(shifted, targetBounds), containerId, ...(leavesGroup(item.id) && { groupId: undefined }) };
          return [item.id, patch];
        })
      )
    );
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
    const minScale = Math.max(MIN_ELEMENT_SIZE / w, MIN_ELEMENT_SIZE / h);
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
    edgeResizeState.current = null;
  };

  // Text boxes, lines, squares and rectangles only: the side handles change the width alone, the top/bottom ones the height alone.
  const handleEdgePointerDown = (e: React.PointerEvent<HTMLDivElement>, handle: EdgeHandle) => {
    e.stopPropagation();
    edgeResizeState.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      x: element.x,
      y: element.y,
      w: element.width,
      h: element.height,
      handle,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleEdgePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!edgeResizeState.current) return;
    const { pointerX, pointerY, x, y, w, h, handle } = edgeResizeState.current;
    const rad = (angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    // The direction the handle's side faces on screen (the box's own width or height direction,
    // turned with the box), flipped so dragging outward always grows it.
    const ux = (handle.axis === "x" ? cos : -sin) * handle.dir;
    const uy = (handle.axis === "x" ? sin : cos) * handle.dir;
    const grow = ((e.clientX - pointerX) * ux + (e.clientY - pointerY) * uy) / zoom;
    // The opposite side stays put, so the center moves half the growth toward the dragged side.
    // The box's outer edges then move in a straight line with the growth g, which gives a simple
    // largest g that keeps it inside the bounds (same idea as the corner resize).
    const centerX = x + w / 2;
    const centerY = y + h / 2;
    const halfX = (w * Math.abs(cos) + h * Math.abs(sin)) / 2;
    const halfY = (w * Math.abs(sin) + h * Math.abs(cos)) / 2;
    const maxGrow = Math.min(
      maxScaleFor(centerX - halfX, (ux - Math.abs(ux)) / 2, 0, bounds.width), // left edge
      maxScaleFor(centerX + halfX, (ux + Math.abs(ux)) / 2, 0, bounds.width), // right edge
      maxScaleFor(centerY - halfY, (uy - Math.abs(uy)) / 2, 0, bounds.height), // top edge
      maxScaleFor(centerY + halfY, (uy + Math.abs(uy)) / 2, 0, bounds.height), // bottom edge
    );
    const size = handle.axis === "x" ? w : h;
    const g = Math.min(maxGrow, Math.max(MIN_ELEMENT_SIZE - size, grow));
    const width = handle.axis === "x" ? w + g : w;
    const height = handle.axis === "y" ? h + g : h;
    updateElement(slideId, element.id, {
      width,
      height,
      x: centerX + (g / 2) * ux - width / 2,
      y: centerY + (g / 2) * uy - height / 2,
    });
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

  // Element boxes start square, but most drawings aren't. Shrink the box's short side to the
  // drawing's shape (keeping its center), so the 2px gap is the same on all four sides. Only ever
  // shrinks, so the box can't grow past its question/option box.
  const fitBoxToDrawing = (drawWidth: number, drawHeight: number) => {
    const { width, height } = element;
    const pad = TRIM_PADDING * 2;
    const scale = Math.min((width - pad) / drawWidth, (height - pad) / drawHeight);
    const fitWidth = drawWidth * scale + pad;
    const fitHeight = drawHeight * scale + pad;
    // Already fitted (this runs again after every resize), or too thin to still be grabbed.
    if (Math.abs(fitWidth - width) < 0.5 && Math.abs(fitHeight - height) < 0.5) return;
    if (fitWidth < MIN_ELEMENT_SIZE || fitHeight < MIN_ELEMENT_SIZE) return;
    // Not an undo step of its own: it's the box tidying itself, and it runs again after every undo.
    withoutHistory(() =>
      updateElement(slideId, element.id, {
        width: fitWidth,
        height: fitHeight,
        x: element.x + (width - fitWidth) / 2,
        y: element.y + (height - fitHeight) / 2,
      })
    );
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
        // On a text box it also starts typing.
        onDoubleClick={(e) => {
          if (element.groupId) selectElements([element.id]);
          // Already typing: leave it be, so a double-click selects a word instead of moving the cursor.
          if (asset?.isTextBox) setEditStart((current) => current ?? { x: e.clientX, y: e.clientY });
        }}
        className={`h-full w-full ${editStart ? "cursor-text" : "cursor-move"}`}
        style={{ opacity: (element.opacity ?? 100) / 100 }}
      >
        {asset?.isTextBox ? (
          <TextBoxContent
            html={element.text?.html ?? ""}
            fontSize={element.text?.fontSize}
            target={{ kind: "textBox", slideId, elementId: element.id }}
            color={element.color}
            editStart={editStart}
            onChange={(html) => updateElement(slideId, element.id, { text: { ...element.text, html } })}
            onStopEditing={() => setEditStart(null)}
          />
        ) : (
          <ElementSvg assetId={element.assetId} color={element.color} settings={element} onMeasure={fitBoxToDrawing} />
        )}
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

      {isOnlySelected &&
        (asset?.isTextBox || asset?.isLine || asset?.stretchX) &&
        // Lines, squares and rectangles only get the left/right handles (lines grow longer, never thicker).
        EDGE_HANDLES.filter((handle) => asset.isTextBox || handle.axis === "x").map((handle) => (
          <div
            key={handle.className}
            onPointerDown={(e) => handleEdgePointerDown(e, handle)}
            onPointerMove={handleEdgePointerMove}
            onPointerUp={stopResize}
            onPointerLeave={stopResize}
            onClick={(e) => e.stopPropagation()}
            title={handle.axis === "x" ? "Change width" : "Change height"}
            className={`absolute rounded-full border-2 border-white shadow-sm ${handle.className}`}
            style={{ background: "var(--accent-navy)" }}
          />
        ))}
    </div>
  );
}

export function RotateIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 8a5 5 0 1 1-1.5-3.55" />
      <path d="M13 2.5v3h-3" />
    </svg>
  );
}
