"use client";

import { useEditorStore } from "@/lib/store";
import {
  diagramBoxActions,
  getAssetViewBox,
  getDiagramBoxes,
  getElementAsset,
  type DiagramBoxAdd,
  type DiagramBoxes,
  type DiagramEdge,
} from "@/lib/svgLibrary";
import type { SvgElement } from "@/lib/schema";
import { PlusIcon, XIcon } from "lucide-react";
import { boxToPx, getFrame, keepInPlace } from "./DiagramBoxEditor";

// How far past a box's edge a "+" sits, and how far out from its top-right corner the × sits (px), so
// they never cover the picked box's handles.
const PLUS_OUT = 16;
const REMOVE_OUT = 20;

// A drawing-units side as it shows on screen: mirrored like the picture when the diagram is flipped.
function screenEdge(edge: DiagramEdge, element: SvgElement): DiagramEdge {
  if (element.flipX && (edge === "left" || edge === "right")) return edge === "left" ? "right" : "left";
  if (element.flipY && (edge === "top" || edge === "bottom")) return edge === "top" ? "bottom" : "top";
  return edge;
}

// Stops a button's pointer and clicks from picking a box, starting a drag, deselecting or typing.
const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/**
 * "+" and × on every box of the selected diagram: "+" adds a box next to that one (on the side where it
 * goes), × removes it. Like a box drag, the element is moved and resized so nothing already drawn moves
 * on the slide. Hidden while a box is typed in.
 */
export function DiagramBoxButtons({ slideId, element }: { slideId: string; element: SvgElement }) {
  const updateElement = useEditorStore((s) => s.updateElement);
  const isTyping = useEditorStore((s) => s.editingDiagramBox?.elementId === element.id);
  const isPicked = useEditorStore((s) => s.pickedDiagramBox?.elementId === element.id);
  const setPickedDiagramBox = useEditorStore((s) => s.setPickedDiagramBox);

  const diagram = getDiagramBoxes(element.assetId, element);
  const asset = getElementAsset(element.assetId);
  if (!diagram || !asset || isTyping) return null;
  const viewBox = getAssetViewBox(asset, element);
  const frame = getFrame(element, viewBox);

  // One change with the new boxes and the element's new place, so one undo puts both back. When the
  // boxes already there move by `shift` in the drawing, the old drawing area is moved by it too, so
  // they keep their spot on the slide.
  const apply = (settings: DiagramBoxes["settings"], shift: DiagramBoxAdd["shift"]) => {
    const patch = { [diagram.key]: settings } as Partial<SvgElement>;
    const [minX, minY, width, height] = viewBox.split(" ").map(Number);
    const oldViewBox = shift ? `${minX + shift.x} ${minY + shift.y} ${width} ${height}` : viewBox;
    updateElement(slideId, element.id, { ...patch, ...keepInPlace(element, oldViewBox, getAssetViewBox(asset, patch)) });
    // The boxes shift in their lists, so a picked box would point at the wrong one: let go of it.
    if (isPicked) setPickedDiagramBox(null);
  };

  return (
    <>
      {diagram.boxes.map((box) => {
        const actions = diagramBoxActions(diagram, box);
        const px = boxToPx(box, frame, element);
        const middleX = px.left + px.width / 2;
        const middleY = px.top + px.height / 2;
        const spot: Record<DiagramEdge, { left: number; top: number }> = {
          left: { left: px.left - PLUS_OUT, top: middleY },
          right: { left: px.left + px.width + PLUS_OUT, top: middleY },
          top: { left: middleX, top: px.top - PLUS_OUT },
          bottom: { left: middleX, top: px.top + px.height + PLUS_OUT },
        };
        return (
          <div key={box.path.join(".")}>
            {actions.adds.map((add) => (
              <button
                key={add.title + add.edge}
                type="button"
                title={add.title}
                aria-label={add.title}
                tabIndex={-1}
                onPointerDown={stop}
                // No focus: a later Enter or Space would otherwise repeat the add or remove.
                onMouseDown={(e) => e.preventDefault()}
                onDoubleClick={stop}
                onClick={(e) => {
                  e.stopPropagation();
                  apply(add.settings, add.shift);
                }}
                className="pointer-events-auto absolute flex h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-accent text-white hover:bg-accent-hover"
                style={spot[screenEdge(add.edge, element)]}
              >
                <PlusIcon size={12} />
              </button>
            ))}
            {actions.remove && (
              <button
                type="button"
                title={actions.remove.title}
                aria-label={actions.remove.title}
                tabIndex={-1}
                onPointerDown={stop}
                // No focus: a later Enter or Space would otherwise repeat the add or remove.
                onMouseDown={(e) => e.preventDefault()}
                onDoubleClick={stop}
                onClick={(e) => {
                  e.stopPropagation();
                  if (actions.remove) apply(actions.remove.settings, undefined);
                }}
                className="pointer-events-auto absolute flex h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border-default bg-bg-surface text-text-secondary hover:bg-danger-soft hover:text-danger-strong"
                style={{ left: px.left + px.width + REMOVE_OUT, top: px.top - REMOVE_OUT }}
              >
                <XIcon size={12} />
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}
