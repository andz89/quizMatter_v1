"use client";

import { useEffect } from "react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import { useEditorStore } from "@/lib/store";
import { getSlideNumbers } from "@/lib/constants";
import { SlideGridItem } from "./SlideGridItem";
import { XIcon } from "lucide-react";

export function SlideGridModal() {
  const presentation = useEditorStore((s) => s.presentation);
  const selectedSlideId = useEditorStore((s) => s.selectedSlideId);
  const selectSlide = useEditorStore((s) => s.selectSlide);
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
    // Bring the picked slide to the middle of the workspace, or the view stays on the old slide.
    document.querySelector(`[data-slide-id="${slideId}"]`)?.scrollIntoView({ block: "center" });
  };

  const slideNumbers = getSlideNumbers(presentation.slides);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeGridView();
      }}
    >
      <div className="flex h-[85vh] w-[90vw] max-w-6xl flex-col rounded-card bg-bg-surface p-6">
        <div className="mb-4 flex shrink-0 items-center justify-between">
          <h2 className="text-[15px] font-extrabold text-text-primary">All slides ({presentation.slides.length})</h2>
          <button
            type="button"
            onClick={closeGridView}
            title="Close (Esc)"
            className="flex h-8 w-8 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
          >
            <XIcon size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={presentation.slides.map((s) => s.id)} strategy={rectSortingStrategy}>
              <div className="grid justify-center gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, 200px)" }}>
                {presentation.slides.map((slide, index) => (
                  <SlideGridItem
                    key={slide.id}
                    slide={slide}
                    questionNumber={slideNumbers.get(slide.id)}
                    index={index}
                    isActive={slide.id === selectedSlideId}
                    canDelete={presentation.slides.length > 1}
                    onSelect={handleSelect}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      </div>
    </div>
  );
}
