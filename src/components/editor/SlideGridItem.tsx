"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEditorStore } from "@/lib/store";
import type { Slide } from "@/lib/schema";
import { SlideThumbnailPreview } from "./SlideThumbnailPreview";
import { GripIcon } from "@/components/icons/GripIcon";

interface SlideGridItemProps {
  slide: Slide;
  index: number;
  isActive: boolean;
  canDelete: boolean;
  onSelect: (slideId: string) => void;
}

export function SlideGridItem({ slide, index, isActive, canDelete, onSelect }: SlideGridItemProps) {
  const duplicateSlide = useEditorStore((s) => s.duplicateSlide);
  const deleteSlide = useEditorStore((s) => s.deleteSlide);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: slide.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="group relative"
    >
      <button
        type="button"
        onClick={() => onSelect(slide.id)}
        className="flex w-full flex-col gap-1.5 rounded-dropdown p-1.5 text-left"
      >
        <div
          className="overflow-hidden rounded-dropdown"
          style={{ outline: isActive ? "2px solid var(--accent-navy)" : "2px solid transparent", outlineOffset: 2 }}
        >
          <SlideThumbnailPreview slide={slide} />
        </div>
        <span className="text-xs font-medium text-text-header">Slide {index + 1}</span>
      </button>

      <div
        {...attributes}
        {...listeners}
        title="Drag to reorder"
        className="absolute right-2.5 top-2.5 flex h-9 w-9 cursor-grab items-center justify-center rounded-dropdown bg-bg-surface/90 text-text-primary opacity-0 group-hover:opacity-100 active:cursor-grabbing"
      >
        <GripIcon size={16} />
      </div>

      <div className="absolute bottom-7 left-2.5 flex items-center gap-2 opacity-0 group-hover:opacity-100">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            duplicateSlide(slide.id);
          }}
          className="rounded-dropdown bg-bg-surface/90 px-2 py-0.5 text-xs text-text-secondary hover:text-text-primary"
        >
          Duplicate
        </button>
        {canDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              deleteSlide(slide.id);
            }}
            className="rounded-dropdown bg-bg-surface/90 px-2 py-0.5 text-xs text-text-secondary hover:text-accent-orange"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
