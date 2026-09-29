"use client";

import { useState, type ReactNode } from "react";
import { moveInLayers, useEditorStore, type LayerMove } from "@/lib/store";
import { getContainerBounds, type BoxLayout } from "@/lib/constants";
import { fitInBox, getOuterEdges } from "@/lib/geometry";
import type { SvgElement } from "@/lib/schema";
import {
  AlignCenterHorizontalIcon,
  AlignCenterVerticalIcon,
  AlignEndHorizontalIcon,
  AlignEndVerticalIcon,
  AlignHorizontalDistributeCenterIcon,
  AlignStartHorizontalIcon,
  AlignStartVerticalIcon,
  AlignVerticalDistributeCenterIcon,
  ArrowDownIcon,
  ArrowDownToLineIcon,
  ArrowUpIcon,
  ArrowUpToLineIcon,
  ScalingIcon,
} from "lucide-react";

type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";

interface ArrangePanelProps {
  slideId: string;
  // The slide's box sizes (question height, layout, shape strip).
  box: BoxLayout;
  /** The selected elements. With just one, it lines up against its own box instead. */
  elements: SvgElement[];
}

/** Layer order, plus align, distribute, and same-size tools for a multi-selection, or align-to-box for a single element.
 *  Renders only the panel's contents — it sits inside a ToolPanelButton. */
export function ArrangePanel({ slideId, box, elements }: ArrangePanelProps) {
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const updateElements = useEditorStore((s) => s.updateElements);
  const moveElementsInLayers = useEditorStore((s) => s.moveElementsInLayers);
  const slideElements = useEditorStore((s) => s.presentation.slides.find((sl) => sl.id === slideId)?.elements);
  // Line items up against each other ("selection") or against their box — the slide itself for free items.
  const [alignTo, setAlignTo] = useState<"selection" | "box">("selection");

  // A single item has nothing to line up with but its box.
  const isSingle = elements.length === 1;
  const isBoxAlign = isSingle || alignTo === "box";
  const boxName = elements.every((el) => el.containerId === null) ? "slide" : "box";

  // Each box measures positions from its own corner, so lining items up with each other only makes
  // sense within one box. Aligning to the box works anywhere: each item uses its own box.
  const isSameContainer = elements.every((el) => el.containerId === elements[0].containerId);
  const canAlign = isBoxAlign || isSameContainer;
  const alignHint = canAlign ? undefined : `Select items in the same box, or align to the ${boxName}`;

  const { minX, minY, maxX, maxY } = getOuterEdges(elements);

  const align = (mode: AlignMode) => {
    const patches: Record<string, Partial<SvgElement>> = {};
    elements.forEach((el) => {
      // The area to line up inside: the item's box, or the outline around the whole selection.
      const bounds = getContainerBounds(el.containerId, box);
      const [left, top, right, bottom] = isBoxAlign ? [0, 0, bounds.width, bounds.height] : [minX, minY, maxX, maxY];
      const patch: Partial<SvgElement> = {};
      if (mode === "left") patch.x = left;
      if (mode === "center") patch.x = (left + right) / 2 - el.width / 2;
      if (mode === "right") patch.x = right - el.width;
      if (mode === "top") patch.y = top;
      if (mode === "middle") patch.y = (top + bottom) / 2 - el.height / 2;
      if (mode === "bottom") patch.y = bottom - el.height;
      patches[el.id] = patch;
    });
    updateElements(slideId, patches);
  };

  // Equal gaps between items: the first stays put, the rest are laid out one after another.
  const distribute = (axis: "x" | "y") => {
    const size = axis === "x" ? "width" : "height";
    const sorted = [...elements].sort((a, b) => a[axis] - b[axis]);
    const span = axis === "x" ? maxX - minX : maxY - minY;
    const totalSize = sorted.reduce((sum, el) => sum + el[size], 0);
    const gap = (span - totalSize) / (sorted.length - 1);
    let cursor = axis === "x" ? minX : minY;
    const patches: Record<string, Partial<SvgElement>> = {};
    sorted.forEach((el) => {
      patches[el.id] = { [axis]: cursor };
      cursor += el[size] + gap;
    });
    updateElements(slideId, patches);
  };

  // Copy the first-selected item's size onto the rest, keeping each one's center in place.
  const matchSize = () => {
    const reference = elements.find((el) => el.id === selectedElementIds[0]) ?? elements[0];
    const patches = elements.map((el) => {
      const { width, height } = reference;
      const resized = { width, height, x: el.x + el.width / 2 - width / 2, y: el.y + el.height / 2 - height / 2 };
      // Shrink (keeping the shape) if the box is too small to fit the reference size.
      return [el.id, fitInBox(resized, getContainerBounds(el.containerId, box), true)];
    });
    updateElements(slideId, Object.fromEntries(patches));
  };

  const ids = elements.map((el) => el.id);
  // A button is off when the move would change nothing (e.g. "to front" on the top element).
  const layerButton = (move: LayerMove, title: string, icon: ReactNode) => {
    const canMove = !!slideElements && moveInLayers(slideElements, ids, move) !== slideElements;
    return (
      <ToolButton title={title} disabled={!canMove} onClick={() => moveElementsInLayers(slideId, ids, move)}>
        {icon}
      </ToolButton>
    );
  };

  return (
    <>
      <Section label="Layer">
        {layerButton("forward", "Bring forward (Ctrl+])", <ArrowUpIcon size={16} />)}
        {layerButton("front", "Bring to front (Ctrl+Alt+])", <ArrowUpToLineIcon size={16} />)}
        {layerButton("backward", "Send backward (Ctrl+[)", <ArrowDownIcon size={16} />)}
        {layerButton("back", "Send to back (Ctrl+Alt+[)", <ArrowDownToLineIcon size={16} />)}
      </Section>

      <Section
        label={isSingle ? `Align to ${boxName}` : "Align"}
        action={
          !isSingle && (
            <div className="flex rounded-dropdown border border-border-default p-0.5">
              {(["selection", "box"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setAlignTo(option)}
                  className={`rounded-[6px] px-2 py-0.5 text-xs font-semibold capitalize ${
                    alignTo === option ? "bg-accent text-white" : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  {option === "box" ? boxName : option}
                </button>
              ))}
            </div>
          )
        }
      >
        <ToolButton title={alignHint ?? "Align left"} disabled={!canAlign} onClick={() => align("left")}>
          <AlignStartVerticalIcon size={16} />
        </ToolButton>
        <ToolButton title={alignHint ?? "Align center"} disabled={!canAlign} onClick={() => align("center")}>
          <AlignCenterVerticalIcon size={16} />
        </ToolButton>
        <ToolButton title={alignHint ?? "Align right"} disabled={!canAlign} onClick={() => align("right")}>
          <AlignEndVerticalIcon size={16} />
        </ToolButton>
        <ToolButton title={alignHint ?? "Align top"} disabled={!canAlign} onClick={() => align("top")}>
          <AlignStartHorizontalIcon size={16} />
        </ToolButton>
        <ToolButton title={alignHint ?? "Align middle"} disabled={!canAlign} onClick={() => align("middle")}>
          <AlignCenterHorizontalIcon size={16} />
        </ToolButton>
        <ToolButton title={alignHint ?? "Align bottom"} disabled={!canAlign} onClick={() => align("bottom")}>
          <AlignEndHorizontalIcon size={16} />
        </ToolButton>
      </Section>

      {!isSingle && (
        <>
          <Section label="Distribute">
            <ToolButton
              title={alignHint ?? (elements.length < 3 ? "Select 3 or more items" : "Space evenly across")}
              disabled={!isSameContainer || elements.length < 3}
              onClick={() => distribute("x")}
            >
              <AlignHorizontalDistributeCenterIcon size={16} />
            </ToolButton>
            <ToolButton
              title={alignHint ?? (elements.length < 3 ? "Select 3 or more items" : "Space evenly down")}
              disabled={!isSameContainer || elements.length < 3}
              onClick={() => distribute("y")}
            >
              <AlignVerticalDistributeCenterIcon size={16} />
            </ToolButton>
          </Section>

          <Section label="Size">
            <button
              type="button"
              title="Make all items the size of the first one you selected"
              onClick={matchSize}
              className="flex h-8 items-center gap-2 rounded-dropdown px-2 text-sm font-semibold text-text-primary hover:bg-bg-page"
            >
              <ScalingIcon size={16} />
              Same size
            </button>
          </Section>
        </>
      )}
    </>
  );
}

function Section({ label, action, children }: { label: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-[0.05em] text-text-header">{label}</span>
        {action}
      </div>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

interface ToolButtonProps {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}

function ToolButton({ title, disabled, onClick, children }: ToolButtonProps) {
  return (
    // The title sits on a wrapper so the hint still shows when the button is disabled.
    <span title={title}>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="flex h-8 w-8 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      >
        {children}
      </button>
    </span>
  );
}
