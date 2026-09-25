"use client";

import { useEditorStore } from "@/lib/store";
import { SIDE_CONTAINER_ID } from "@/lib/constants";
import { toCssBackground } from "./ElementSvg";
import { NONE_SWATCH } from "./ColorPanel";

/** Centered header container for the selected shape box's fill and border colors. */
export function ShapeBoxToolbar() {
  const selectedContainerId = useEditorStore((s) => s.selectedContainerId);
  const slide = useEditorStore((s) => s.quiz.slides.find((sl) => sl.id === s.selectedSlideId));
  const isColorPanelOpen = useEditorStore((s) => s.isColorPanelOpen);
  const shapeBoxColorTarget = useEditorStore((s) => s.shapeBoxColorTarget);
  const openShapeBoxColorPanel = useEditorStore((s) => s.openShapeBoxColorPanel);

  if (!slide || selectedContainerId !== SIDE_CONTAINER_ID) return null;

  // Navy ring on the swatch whose color the panel is editing.
  const outline = (target: "fill" | "border") => ({
    outline: isColorPanelOpen && shapeBoxColorTarget === target ? "2px solid var(--accent-navy)" : "2px solid transparent",
    outlineOffset: 2,
  });

  return (
    <div
      // Clicking here shouldn't un-select the box being styled.
      data-keep-container-selection="true"
      className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-3 rounded-button border border-border-default bg-bg-surface px-3 py-1.5"
    >
      <span className="pl-1 text-xs font-medium text-text-secondary">Shape box</span>
      <div className="h-5 w-px bg-border-default" />

      <button
        type="button"
        title="Fill"
        onClick={() => openShapeBoxColorPanel("fill")}
        className="h-6 w-6 shrink-0 rounded-full border border-border-default"
        style={{ background: slide.shapeBoxFill ? toCssBackground(slide.shapeBoxFill) : NONE_SWATCH, ...outline("fill") }}
      />
      <button
        type="button"
        title="Border"
        onClick={() => openShapeBoxColorPanel("border")}
        className="h-6 w-6 shrink-0 rounded-full"
        style={{
          ...(slide.shapeBoxBorder
            ? { border: `4px solid ${slide.shapeBoxBorder}` }
            : { background: NONE_SWATCH, border: "1px solid var(--border-default)" }),
          ...outline("border"),
        }}
      />
    </div>
  );
}
