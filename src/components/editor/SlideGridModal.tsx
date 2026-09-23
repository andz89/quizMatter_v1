"use client";

import { useEffect } from "react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import { useEditorStore } from "@/lib/store";
import { SlideGridItem } from "./SlideGridItem";

export function SlideGridModal() {
  const quiz = useEditorStore((s) => s.quiz);
  const selectedSlideId = useEditorStore((s) => s.selectedSlideId);
  const selectSlide = useEditorStore((s) => s.selectSlide);
  const addSlide = useEditorStore((s) => s.addSlide);
  const reorderSlides = useEditorStore((s) => s.reorderSlides);
  const closeGridView = useEditorStore((s) => s.closeGridView);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeGridView();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeGridView]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      reorderSlides(String(active.id), String(over.id));
    }
  };

  const handleSelect = (slideId: string) => {
    selectSlide(slideId);
    closeGridView();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeGridView();
      }}
    >
      <div className="flex h-[85vh] w-[90vw] max-w-6xl flex-col rounded-card bg-bg-surface p-6">
        <div className="mb-4 flex shrink-0 items-center justify-between">
          <h2 className="text-[15px] font-semibold text-text-primary">All slides ({quiz.slides.length})</h2>
          <button
            type="button"
            onClick={closeGridView}
            title="Close (Esc)"
            className="flex h-8 w-8 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={quiz.slides.map((s) => s.id)} strategy={rectSortingStrategy}>
              <div className="grid justify-center gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, 200px)" }}>
                {quiz.slides.map((slide, index) => (
                  <SlideGridItem
                    key={slide.id}
                    slide={slide}
                    index={index}
                    isActive={slide.id === selectedSlideId}
                    canDelete={quiz.slides.length > 1}
                    onSelect={handleSelect}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>

        <div className="mt-4 shrink-0 border-t border-border-default pt-4">
          <button
            type="button"
            onClick={() => addSlide()}
            className="rounded-button bg-accent-navy px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            + Add slide
          </button>
        </div>
      </div>
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
