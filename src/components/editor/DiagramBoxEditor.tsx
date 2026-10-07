"use client";

import { useLayoutEffect, useRef } from "react";
import { useEditorStore } from "@/lib/store";
import {
  DIAGRAM_LINE_HEIGHT,
  DIAGRAM_TEXT_COLOR,
  diagramTextRoom,
  fitDiagramText,
  getAssetViewBox,
  getDiagramBoxes,
  getElementAsset,
  moveDiagramBox,
  replaceAtPath,
  sameDiagramPath,
  type DiagramBoxes,
  type DiagramBoxPath,
  type PlacedDiagramBox,
} from "@/lib/svgLibrary";
import { DIAGRAM_BOX_HEIGHT, DIAGRAM_BOX_POSITION_MAX, DIAGRAM_BOX_WIDTH, DIAGRAM_TEXT_MAX } from "@/lib/constants";
import { clamp, overflowAmount } from "@/lib/geometry";
import type { SvgElement } from "@/lib/schema";
import { CORNERS, EDGE_HANDLES, type Corner, type EdgeHandle } from "./handles";

// How a diagram's drawing sits in its element: like the <svg> ("meet"), scaled to fit and centered.
// minX/minY = the drawing area's start (can be below 0), scale = px per drawing unit.
interface DiagramFrame {
  minX: number;
  minY: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

export function getFrame(element: SvgElement, viewBox: string): DiagramFrame {
  const [minX, minY, width, height] = viewBox.split(" ").map(Number);
  const scale = Math.min(element.width / width, element.height / height);
  return { minX, minY, scale, offsetX: (element.width - width * scale) / 2, offsetY: (element.height - height * scale) / 2 };
}

// The element's angle as cos/sin.
function turn(element: SvgElement) {
  const rad = ((element.rotation ?? 0) * Math.PI) / 180;
  return { cos: Math.cos(rad), sin: Math.sin(rad) };
}

/** Which box of a diagram is under the pointer, or null (also for anything that isn't a diagram). */
export function findDiagramBoxAt(
  element: SvgElement,
  clientX: number,
  clientY: number,
  boxEl: HTMLElement,
  zoom: number,
): DiagramBoxPath | null {
  const diagram = getDiagramBoxes(element.assetId, element);
  const asset = getElementAsset(element.assetId);
  if (!diagram || !asset) return null;
  // The element's outline on screen is a turned box; its middle is the element's middle.
  const rect = boxEl.getBoundingClientRect();
  const dx = clientX - (rect.left + rect.width / 2);
  const dy = clientY - (rect.top + rect.height / 2);
  // Turn the pointer back by the element's angle, into the element's own px (0,0 = its top-left).
  const { cos, sin } = turn(element);
  const localX = (dx * cos + dy * sin) / zoom + element.width / 2;
  const localY = (-dx * sin + dy * cos) / zoom + element.height / 2;
  // The picture is mirrored inside the element when flipped.
  const x = element.flipX ? element.width - localX : localX;
  const y = element.flipY ? element.height - localY : localY;
  const frame = getFrame(element, getAssetViewBox(asset, element));
  const unitX = frame.minX + (x - frame.offsetX) / frame.scale;
  const unitY = frame.minY + (y - frame.offsetY) / frame.scale;
  // Later boxes are drawn on top, so they win.
  const hit = [...diagram.boxes]
    .reverse()
    .find((box) => unitX >= box.x && unitX <= box.x + box.width && unitY >= box.y && unitY <= box.y + box.height);
  return hit?.path ?? null;
}

interface UnitBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// A box's spot inside the element, in px, mirrored like the picture when flipped.
export function boxToPx(box: UnitBox, frame: DiagramFrame, element: SvgElement) {
  const width = box.width * frame.scale;
  const height = box.height * frame.scale;
  const left = frame.offsetX + (box.x - frame.minX) * frame.scale;
  const top = frame.offsetY + (box.y - frame.minY) * frame.scale;
  return {
    width,
    height,
    left: element.flipX ? element.width - left - width : left,
    top: element.flipY ? element.height - top - height : top,
  };
}

// A pointer move on screen (px) as a move in drawing units: turned back by the element's angle,
// mirrored when flipped, and scaled.
function screenToUnits(dx: number, dy: number, element: SvgElement, zoom: number, scale: number) {
  const { cos, sin } = turn(element);
  const localX = (dx * cos + dy * sin) / zoom;
  const localY = (-dx * sin + dy * cos) / zoom;
  return { x: (element.flipX ? -localX : localX) / scale, y: (element.flipY ? -localY : localY) / scale };
}

/**
 * The element's new place and size when its drawing area changes from `oldViewBox` to `newViewBox`
 * (a box moved past the edge, or back in): px per drawing unit stays the same, and everything already
 * drawn stays in the same spot on the slide — also when the element is turned or flipped.
 */
export function keepInPlace(element: SvgElement, oldViewBox: string, newViewBox: string) {
  const frame = getFrame(element, oldViewBox);
  const [minX, minY, unitWidth, unitHeight] = newViewBox.split(" ").map(Number);
  // The new drawing area as a box inside the old element (px), mirrored like the picture.
  const area = boxToPx({ x: minX, y: minY, width: unitWidth, height: unitHeight }, frame, element);
  // Its middle, measured from the old element's middle, turned by the element's angle.
  const moveX = area.left + area.width / 2 - element.width / 2;
  const moveY = area.top + area.height / 2 - element.height / 2;
  const { cos, sin } = turn(element);
  const centerX = element.x + element.width / 2 + moveX * cos - moveY * sin;
  const centerY = element.y + element.height / 2 + moveX * sin + moveY * cos;
  return { x: centerX - area.width / 2, y: centerY - area.height / 2, width: area.width, height: area.height };
}

// What a drag on the picked box does: move it, resize it from a corner, or change only its width or
// height from a side handle (the same handles as a text box).
type BoxDrag = { kind: "move" } | { kind: "corner"; corner: Corner } | { kind: "edge"; handle: EdgeHandle };

/**
 * The box after a resize drag of `d` drawing units, like a text box: a corner keeps the box's shape and
 * the opposite corner stays put; a side handle changes only that side, and the opposite side stays put.
 */
function resizeBox(start: UnitBox, d: { x: number; y: number }, drag: Exclude<BoxDrag, { kind: "move" }>, element: SvgElement): UnitBox {
  // Which way is outward in drawing units: the screen direction, mirrored when the picture is flipped.
  const outX = (dir: 1 | -1) => (element.flipX ? -dir : dir);
  const outY = (dir: 1 | -1) => (element.flipY ? -dir : dir);
  let { width, height } = start;
  let ux = 1;
  let uy = 1;
  if (drag.kind === "corner") {
    ux = outX(drag.corner.sx);
    uy = outY(drag.corner.sy);
    // The size follows the pointer along the diagonal, so the handle stays under it.
    const scale = Math.hypot(width + d.x * ux, height + d.y * uy) / Math.hypot(width, height);
    const smallest = Math.max(DIAGRAM_BOX_WIDTH.min / width, DIAGRAM_BOX_HEIGHT.min / height);
    const biggest = Math.min(DIAGRAM_BOX_WIDTH.max / width, DIAGRAM_BOX_HEIGHT.max / height);
    const s = clamp(scale, smallest, biggest);
    width *= s;
    height *= s;
  } else if (drag.handle.axis === "x") {
    ux = outX(drag.handle.dir);
    width = clamp(width + d.x * ux, DIAGRAM_BOX_WIDTH.min, DIAGRAM_BOX_WIDTH.max);
  } else {
    uy = outY(drag.handle.dir);
    height = clamp(height + d.y * uy, DIAGRAM_BOX_HEIGHT.min, DIAGRAM_BOX_HEIGHT.max);
  }
  return {
    x: ux === 1 ? start.x : start.x + start.width - width,
    y: uy === 1 ? start.y : start.y + start.height - height,
    width,
    height,
  };
}

/**
 * Where a diagram box's text is typed on the slide: over the box, in the drawn text's size, centered up
 * and down. The browser wraps the lines itself, so they're measured after each change to center them.
 * Shift+Enter starts a new line; Enter, Escape or clicking outside finishes.
 */
function DiagramTextArea({
  text,
  fontPx,
  sidePaddingPx,
  color,
  onChange,
  onDone,
}: {
  text: string;
  fontPx: number;
  sidePaddingPx: number;
  color: string;
  onChange: (text: string) => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const area = ref.current;
    if (!area) return;
    // With no top padding, scrollHeight is just the lines; the rest of the box is split above and below.
    area.style.paddingTop = "0px";
    area.style.paddingTop = `${Math.max(0, (area.clientHeight - area.scrollHeight) / 2)}px`;
  });

  return (
    <textarea
      ref={(area) => {
        ref.current = area;
        // On opening only: focus, with the cursor after the text.
        if (area && document.activeElement !== area) {
          area.focus();
          area.setSelectionRange(area.value.length, area.value.length);
        }
      }}
      value={text}
      maxLength={DIAGRAM_TEXT_MAX}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) {
          e.preventDefault();
          onDone();
        }
      }}
      onBlur={onDone}
      // Clicks inside place the cursor; they don't move the box.
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className="absolute inset-0 h-full w-full cursor-text resize-none overflow-hidden bg-transparent pb-0 text-center font-semibold outline-none"
      style={{
        fontSize: fontPx,
        lineHeight: DIAGRAM_LINE_HEIGHT,
        color,
        paddingLeft: sidePaddingPx,
        paddingRight: sidePaddingPx,
      }}
    />
  );
}

interface DiagramBoxEditorProps {
  slideId: string;
  element: SvgElement;
  // The box the element sits in (canvas, question, option or side box), and how far it may stick out.
  bounds: { width: number; height: number };
  overhang: number;
}

/**
 * The picked box of the selected diagram: a violet outline to drag it by, and the same resize handles as a
 * text box (corners keep its shape, side handles change its width or height). Double-click to type.
 * Each drag writes the box's own place and size (and in the Factor Tree moves the boxes under it too); if
 * the drawing area changes, the element is moved and resized too so nothing else moves on the slide. Nothing shows when no box of this diagram is picked.
 */
export function DiagramBoxEditor({ slideId, element, bounds, overhang }: DiagramBoxEditorProps) {
  const zoom = useEditorStore((s) => s.zoom);
  const picked = useEditorStore((s) => s.pickedDiagramBox);
  const updateElement = useEditorStore((s) => s.updateElement);
  const editing = useEditorStore((s) => s.editingDiagramBox);
  const setEditing = useEditorStore((s) => s.setEditingDiagramBox);
  // Where the drag started: pointer, the diagram and box then, and what the drag does.
  const drag = useRef<{
    pointerX: number;
    pointerY: number;
    start: UnitBox;
    action: BoxDrag;
    scale: number;
    diagram: DiagramBoxes;
    box: PlacedDiagramBox;
  } | null>(null);

  const diagram = getDiagramBoxes(element.assetId, element);
  const asset = getElementAsset(element.assetId);
  if (!diagram || !asset || picked?.elementId !== element.id) return null;
  // The picked box may be gone (e.g. the panel removed it).
  const box: PlacedDiagramBox | undefined = diagram.boxes.find((b) => sameDiagramPath(b.path, picked.path));
  if (!box) return null;
  const viewBox = getAssetViewBox(asset, element);
  const frame = getFrame(element, viewBox);
  const px = boxToPx(box, frame, element);

  const startDrag = (e: React.PointerEvent<HTMLDivElement>, action: BoxDrag) => {
    e.stopPropagation();
    drag.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      start: { x: box.x, y: box.y, width: box.width, height: box.height },
      action,
      scale: frame.scale,
      diagram,
      box,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const moveDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    // A handle's move would also reach the outline it sits in; handle it once.
    e.stopPropagation();
    const d = screenToUnits(e.clientX - state.pointerX, e.clientY - state.pointerY, element, zoom, state.scale);
    const next =
      state.action.kind === "move"
        ? { ...state.start, x: state.start.x + d.x, y: state.start.y + d.y }
        : resizeBox(state.start, d, state.action, element);
    next.x = clamp(next.x, -DIAGRAM_BOX_POSITION_MAX, DIAGRAM_BOX_POSITION_MAX);
    next.y = clamp(next.y, -DIAGRAM_BOX_POSITION_MAX, DIAGRAM_BOX_POSITION_MAX);
    // From the diagram as it was when the drag started (its setting, or the default when nothing is saved
    // yet). A move also takes the boxes under this one along (Factor Tree).
    const settings =
      state.action.kind === "move"
        ? moveDiagramBox(state.diagram, state.box, next)
        : replaceAtPath(state.diagram.settings, state.box.path, { ...state.box.item, ...next });
    const patch = { [diagram.key]: settings } as Partial<SvgElement>;
    const place = keepInPlace(element, viewBox, getAssetViewBox(asset, patch));
    // Inside a question, option or side box the diagram can't grow past its edge: the drag stops there.
    // Compared with how far it already sticks out (a turned diagram near the edge may), so moves that
    // don't make it worse still work. On the slide itself elements may stick out (overhang), so there it may grow.
    const angle = element.rotation ?? 0;
    if (!overhang && overflowAmount(place, angle, bounds) > overflowAmount(element, angle, bounds) + 0.5) return;
    // One change with both parts, so one undo puts back the box and the element together.
    updateElement(slideId, element.id, { ...patch, ...place });
  };

  const stopDrag = () => {
    drag.current = null;
  };

  // Typing on the slide: the new text goes into the box. Like a text box, the box keeps its size (the
  // text shrinks to fit), so the drawing area and the element don't change.
  const isEditing = editing?.elementId === element.id && sameDiagramPath(box.path, editing.path);
  const typeText = (text: string) => {
    const settings = replaceAtPath(diagram.settings, [...box.path, "text"], text);
    updateElement(slideId, element.id, { [diagram.key]: settings } as Partial<SvgElement>);
  };
  // The typing area uses the drawn text's size (on screen).
  const fontPx = fitDiagramText(box, document.fonts.status === "loaded").fontSize * frame.scale;

  return (
    <div
      onPointerDown={(e) => startDrag(e, { kind: "move" })}
      onPointerMove={moveDrag}
      onPointerUp={stopDrag}
      onPointerLeave={stopDrag}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditing({ elementId: element.id, path: box.path });
      }}
      title={isEditing ? undefined : "Drag to move this box, double-click to type"}
      className="pointer-events-auto absolute cursor-move rounded-dropdown"
      style={{ left: px.left, top: px.top, width: px.width, height: px.height, outline: "1.5px solid var(--accent)", outlineOffset: 1 }}
    >
      {isEditing && (
        <DiagramTextArea
          text={box.item.text}
          fontPx={fontPx}
          sidePaddingPx={((box.width - diagramTextRoom(box).width) / 2) * frame.scale}
          color={box.item.textColor ?? DIAGRAM_TEXT_COLOR}
          onChange={typeText}
          onDone={() => setEditing(null)}
        />
      )}
      {/* The same handles, in the same look, as a text box. */}
      {CORNERS.map((corner) => (
        <div
          key={corner.className}
          onPointerDown={(e) => startDrag(e, { kind: "corner", corner })}
          onPointerMove={moveDrag}
          onPointerUp={stopDrag}
          onPointerLeave={stopDrag}
          title="Resize this box"
          className={`absolute h-4 w-4 rounded-full border-2 border-white shadow-sm ${corner.className}`}
          style={{ background: "var(--accent)" }}
        />
      ))}
      {EDGE_HANDLES.map((handle) => (
        <div
          key={handle.className}
          onPointerDown={(e) => startDrag(e, { kind: "edge", handle })}
          onPointerMove={moveDrag}
          onPointerUp={stopDrag}
          onPointerLeave={stopDrag}
          title={handle.axis === "x" ? "Change width" : "Change height"}
          className={`absolute rounded-full border-2 border-white shadow-sm ${handle.className}`}
          style={{ background: "var(--accent)" }}
        />
      ))}
    </div>
  );
}
