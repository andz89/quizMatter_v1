"use client";

import type { ReactNode } from "react";
import { useEditorStore } from "@/lib/store";
import { getContainerBounds } from "@/lib/constants";
import type { SvgElement } from "@/lib/schema";

type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";

interface ArrangePanelProps {
  slideId: string;
  questionHeight: number;
  /** The selected elements (2 or more). */
  elements: SvgElement[];
}

/** Align, distribute, and same-size tools for a multi-selection. */
export function ArrangePanel({ slideId, questionHeight, elements }: ArrangePanelProps) {
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const updateElement = useEditorStore((s) => s.updateElement);

  // Each box measures positions from its own corner, so lining up only makes sense within one box.
  const isSameContainer = elements.every((el) => el.containerId === elements[0].containerId);
  const alignHint = isSameContainer ? undefined : "Select items in the same box to align";

  const minX = Math.min(...elements.map((el) => el.x));
  const minY = Math.min(...elements.map((el) => el.y));
  const maxX = Math.max(...elements.map((el) => el.x + el.width));
  const maxY = Math.max(...elements.map((el) => el.y + el.height));

  const align = (mode: AlignMode) => {
    elements.forEach((el) => {
      const patch: Partial<SvgElement> = {};
      if (mode === "left") patch.x = minX;
      if (mode === "center") patch.x = (minX + maxX) / 2 - el.width / 2;
      if (mode === "right") patch.x = maxX - el.width;
      if (mode === "top") patch.y = minY;
      if (mode === "middle") patch.y = (minY + maxY) / 2 - el.height / 2;
      if (mode === "bottom") patch.y = maxY - el.height;
      updateElement(slideId, el.id, patch);
    });
  };

  // Equal gaps between items: the first stays put, the rest are laid out one after another.
  const distribute = (axis: "x" | "y") => {
    const size = axis === "x" ? "width" : "height";
    const sorted = [...elements].sort((a, b) => a[axis] - b[axis]);
    const span = axis === "x" ? maxX - minX : maxY - minY;
    const totalSize = sorted.reduce((sum, el) => sum + el[size], 0);
    const gap = (span - totalSize) / (sorted.length - 1);
    let cursor = axis === "x" ? minX : minY;
    sorted.forEach((el) => {
      updateElement(slideId, el.id, { [axis]: cursor });
      cursor += el[size] + gap;
    });
  };

  // Copy the first-selected item's size onto the rest, keeping each one's center in place.
  const matchSize = () => {
    const reference = elements.find((el) => el.id === selectedElementIds[0]) ?? elements[0];
    elements.forEach((el) => {
      const bounds = getContainerBounds(el.containerId, questionHeight);
      // Shrink (keeping the shape) if the box is too small to fit the reference size.
      const fit = Math.min(1, bounds.width / reference.width, bounds.height / reference.height);
      const width = reference.width * fit;
      const height = reference.height * fit;
      const x = el.x + el.width / 2 - width / 2;
      const y = el.y + el.height / 2 - height / 2;
      updateElement(slideId, el.id, {
        width,
        height,
        x: Math.min(bounds.width - width, Math.max(0, x)),
        y: Math.min(bounds.height - height, Math.max(0, y)),
      });
    });
  };

  return (
    <div className="absolute left-1/2 top-full z-30 mt-3 flex w-64 -translate-x-1/2 flex-col gap-3 rounded-card border border-border-default bg-bg-surface px-4 py-3">
      <Section label="Align">
        <ToolButton title={alignHint ?? "Align left"} disabled={!isSameContainer} onClick={() => align("left")}>
          <AlignIcon d="M2 1.5v13M4.5 4h8M4.5 10h5" />
        </ToolButton>
        <ToolButton title={alignHint ?? "Align center"} disabled={!isSameContainer} onClick={() => align("center")}>
          <AlignIcon d="M8 1.5v13M3.5 4h9M5 10h6" />
        </ToolButton>
        <ToolButton title={alignHint ?? "Align right"} disabled={!isSameContainer} onClick={() => align("right")}>
          <AlignIcon d="M14 1.5v13M3.5 4h8M6.5 10h5" />
        </ToolButton>
        <ToolButton title={alignHint ?? "Align top"} disabled={!isSameContainer} onClick={() => align("top")}>
          <AlignIcon d="M1.5 2h13M4 4.5v8M10 4.5v5" />
        </ToolButton>
        <ToolButton title={alignHint ?? "Align middle"} disabled={!isSameContainer} onClick={() => align("middle")}>
          <AlignIcon d="M1.5 8h13M4 3.5v9M10 5v6" />
        </ToolButton>
        <ToolButton title={alignHint ?? "Align bottom"} disabled={!isSameContainer} onClick={() => align("bottom")}>
          <AlignIcon d="M1.5 14h13M4 3.5v8M10 6.5v5" />
        </ToolButton>
      </Section>

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
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-[0.05em] text-text-header">{label}</span>
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
