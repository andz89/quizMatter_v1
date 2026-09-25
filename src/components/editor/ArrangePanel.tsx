"use client";

import { useState, type ReactNode } from "react";
import { useEditorStore } from "@/lib/store";
import { getContainerBounds, type BoxLayout } from "@/lib/constants";
import { fitInBox, getOuterEdges } from "@/lib/geometry";
import type { SvgElement } from "@/lib/schema";

type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";

interface ArrangePanelProps {
  slideId: string;
  // The slide's box sizes (question height, layout, shape strip).
  box: BoxLayout;
  /** The selected elements. With just one, it lines up against its own box instead. */
  elements: SvgElement[];
}

/** Align, distribute, and same-size tools for a multi-selection, or align-to-box for a single element.
 *  Renders only the panel's contents — it sits inside a ToolPanelButton. */
export function ArrangePanel({ slideId, box, elements }: ArrangePanelProps) {
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const updateElements = useEditorStore((s) => s.updateElements);
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

  return (
    <>
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
                    alignTo === option ? "bg-accent-navy text-white" : "text-text-secondary hover:text-text-primary"
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
          <AlignIcon d="M2 1.5v13M4.5 4h8M4.5 10h5" />
        </ToolButton>
        <ToolButton title={alignHint ?? "Align center"} disabled={!canAlign} onClick={() => align("center")}>
          <AlignIcon d="M8 1.5v13M3.5 4h9M5 10h6" />
        </ToolButton>
        <ToolButton title={alignHint ?? "Align right"} disabled={!canAlign} onClick={() => align("right")}>
          <AlignIcon d="M14 1.5v13M3.5 4h8M6.5 10h5" />
        </ToolButton>
        <ToolButton title={alignHint ?? "Align top"} disabled={!canAlign} onClick={() => align("top")}>
          <AlignIcon d="M1.5 2h13M4 4.5v8M10 4.5v5" />
        </ToolButton>
        <ToolButton title={alignHint ?? "Align middle"} disabled={!canAlign} onClick={() => align("middle")}>
          <AlignIcon d="M1.5 8h13M4 3.5v9M10 5v6" />
        </ToolButton>
        <ToolButton title={alignHint ?? "Align bottom"} disabled={!canAlign} onClick={() => align("bottom")}>
          <AlignIcon d="M1.5 14h13M4 3.5v8M10 6.5v5" />
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
              <AlignIcon d="M1.5 2v12M14.5 2v12M6 5v6M10 5v6" />
            </ToolButton>
            <ToolButton
              title={alignHint ?? (elements.length < 3 ? "Select 3 or more items" : "Space evenly down")}
              disabled={!isSameContainer || elements.length < 3}
              onClick={() => distribute("y")}
            >
              <AlignIcon d="M2 1.5h12M2 14.5h12M5 6h6M5 10h6" />
            </ToolButton>
          </Section>

          <Section label="Size">
            <button
              type="button"
              title="Make all items the size of the first one you selected"
              onClick={matchSize}
              className="flex h-8 items-center gap-2 rounded-dropdown px-2 text-sm font-semibold text-text-primary hover:bg-bg-page"
            >
              <AlignIcon d="M2 2h5v5H2zM9 9h5v5H9z" />
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

function AlignIcon({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}
