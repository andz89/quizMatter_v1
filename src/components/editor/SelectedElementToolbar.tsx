"use client";

import { useEditorStore } from "@/lib/store";

const COLOR_SWATCHES = ["#191A2C", "#1E8E4F", "#F2A93B", "#A8A6A1", "#1F1F1F"];

/** Centered header container for the selected SVG element(s)' color, duplicate, and delete controls. */
export function SelectedElementToolbar() {
  const selectedSlideId = useEditorStore((s) => s.selectedSlideId);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const slide = useEditorStore((s) => s.quiz.slides.find((sl) => sl.id === s.selectedSlideId));
  const updateElement = useEditorStore((s) => s.updateElement);
  const deleteElement = useEditorStore((s) => s.deleteElement);
  const duplicateElement = useEditorStore((s) => s.duplicateElement);
  const selectElements = useEditorStore((s) => s.selectElements);

  const elements = slide?.elements.filter((el) => selectedElementIds.includes(el.id)) ?? [];
  if (elements.length === 0) return null;

  const commonColor = elements.every((el) => el.color === elements[0].color) ? elements[0].color : null;

  const handleColor = (color: string) => {
    elements.forEach((el) => updateElement(selectedSlideId, el.id, { color }));
  };

  const handleDuplicate = () => {
    const newIds = elements
      .map((el) => duplicateElement(selectedSlideId, el.id))
      .filter((id): id is string => !!id);
    if (newIds.length > 0) selectElements(newIds);
  };

  const handleDelete = () => {
    elements.forEach((el) => deleteElement(selectedSlideId, el.id));
  };

  return (
    <div
      data-element-toolbar="true"
      className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-button border border-border-default bg-bg-surface px-3 py-1.5"
    >
      {elements.length > 1 && (
        <>
          <span className="pl-1 text-xs font-medium text-text-secondary">{elements.length} selected</span>
          <div className="h-5 w-px bg-border-default" />
        </>
      )}

      {COLOR_SWATCHES.map((swatch) => (
        <button
          key={swatch}
          type="button"
          title={swatch}
          onClick={() => handleColor(swatch)}
          className="h-6 w-6 shrink-0 rounded-full"
          style={{
            background: swatch,
            outline: commonColor === swatch ? "2px solid var(--accent-navy)" : "2px solid transparent",
            outlineOffset: 2,
          }}
        />
      ))}
      <div className="mx-1 h-5 w-px bg-border-default" />
      <button
        type="button"
        title="Duplicate"
        onClick={handleDuplicate}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
      >
        <DuplicateIcon />
      </button>
      <button
        type="button"
        title="Delete"
        onClick={handleDelete}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page hover:text-accent-orange"
      >
        <TrashIcon />
      </button>
    </div>
  );
}

function DuplicateIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="1.5" y="1.5" width="8" height="8" rx="1.2" />
      <path d="M4.5 12.5h6a2 2 0 0 0 2-2v-6" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M2.5 3.5h9M5 3.5V2h4v1.5M5.5 6.5v4M8.5 6.5v4M3.5 3.5l.5 8h6l.5-8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
