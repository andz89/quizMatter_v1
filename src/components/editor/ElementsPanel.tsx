"use client";

import { useEffect } from "react";
import { useEditorStore } from "@/lib/store";
import { ELEMENT_LIBRARY, ELEMENT_CATEGORY_LABELS, type ElementCategory } from "@/lib/svgLibrary";
import { QUESTION_CONTAINER_ID, OPTION_LABELS, ELEMENT_DRAG_MIME } from "@/lib/constants";
import { ElementSvg } from "./ElementSvg";

const CATEGORIES: ElementCategory[] = ["shape", "icon", "decorative", "cloud", "number", "letter", "symbol"];

export function ElementsPanel() {
  const selectedSlideId = useEditorStore((s) => s.selectedSlideId);
  const selectedContainerId = useEditorStore((s) => s.selectedContainerId);
  const slide = useEditorStore((s) => s.quiz.slides.find((sl) => sl.id === s.selectedSlideId));
  const addElement = useEditorStore((s) => s.addElement);
  const closeElementsPanel = useEditorStore((s) => s.closeElementsPanel);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeElementsPanel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeElementsPanel]);

  // Click inserts into whichever container is currently selected; dragging (handled by the
  // question/option boxes themselves) targets whatever it's dropped on instead, so the grid stays
  // usable either way. The panel is left open in both cases so several elements can be added in a row.
  const handleInsert = (assetId: string) => {
    if (!selectedContainerId) return;
    addElement(selectedSlideId, assetId, selectedContainerId);
  };

  const handleDragStart = (e: React.DragEvent, assetId: string) => {
    e.dataTransfer.setData(ELEMENT_DRAG_MIME, assetId);
    e.dataTransfer.effectAllowed = "copy";
  };

  const targetLabel =
    selectedContainerId === QUESTION_CONTAINER_ID
      ? "the question"
      : selectedContainerId
        ? `option ${OPTION_LABELS[slide?.options.findIndex((o) => o.id === selectedContainerId) ?? 0]}`
        : null;

  return (
    <div
      data-keep-container-selection="true"
      className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-border-default bg-bg-surface p-5"
    >
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-text-primary">Elements</h2>
        <button
          type="button"
          onClick={closeElementsPanel}
          title="Close (Esc)"
          className="flex h-8 w-8 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
        >
          <CloseIcon />
        </button>
      </div>
      <p className="mb-4 text-xs text-text-secondary">
        {targetLabel ? (
          <>
            Adding to <span className="font-medium text-text-primary">{targetLabel}</span> — it&apos;ll move with it.
          </>
        ) : (
          "Drag an element onto the question or an option to add it."
        )}
      </p>

      {CATEGORIES.map((category) => (
        <div key={category} className="mb-5 last:mb-0">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-header">
            {ELEMENT_CATEGORY_LABELS[category]}
          </p>
          <div className="grid grid-cols-4 justify-items-center gap-3">
            {ELEMENT_LIBRARY.filter((asset) => asset.category === category).map((asset) => (
              <button
                key={asset.id}
                type="button"
                draggable
                onDragStart={(e) => handleDragStart(e, asset.id)}
                title={asset.label}
                onClick={() => handleInsert(asset.id)}
                className="flex h-12 w-12 items-center justify-center rounded-dropdown border border-border-default bg-bg-page p-2.5 text-text-primary transition-colors hover:border-accent-navy"
              >
                <ElementSvg assetId={asset.id} color="currentColor" />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 4L12 12M12 4L4 12" strokeLinecap="round" />
    </svg>
  );
}
