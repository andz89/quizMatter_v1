"use client";

import type { useSortable } from "@dnd-kit/sortable";
import { useEditorStore } from "@/lib/store";
import { GripIcon } from "@/components/icons/GripIcon";
import type { Slide } from "@/lib/schema";

type DragHandleProps = Pick<ReturnType<typeof useSortable>, "attributes" | "listeners">;

interface SlideToolbarProps {
  slide: Slide;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  canDelete: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  dragHandle: DragHandleProps;
}

/** Canva-style per-slide toolbar shown above each slide in the workspace. */
export function SlideToolbar({ slide, index, isFirst, isLast, canDelete, onMoveUp, onMoveDown, dragHandle }: SlideToolbarProps) {
  const duplicateSlide = useEditorStore((s) => s.duplicateSlide);
  const addSlide = useEditorStore((s) => s.addSlide);
  const deleteSlide = useEditorStore((s) => s.deleteSlide);

  return (
    <>
      <div className="absolute bottom-full left-0 mb-3 flex items-center gap-2 rounded-dropdown bg-bg-surface px-3 py-2.5 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
        <span className="px-1.5 text-2xl font-bold uppercase tracking-wide text-text-header">Q{index + 1}</span>
        {canDelete && (
          <button
            type="button"
            onClick={() => deleteSlide(slide.id)}
            title="Delete slide"
            className="flex h-12 w-12 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page hover:text-accent-orange"
          >
            <TrashIcon size={26} />
          </button>
        )}
      </div>

      <div className="absolute bottom-full right-0 mb-3 flex items-center gap-1 rounded-dropdown bg-bg-surface px-2 py-2 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={isFirst}
          title="Move up"
          className="flex h-9 w-9 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <ChevronIcon direction="up" />
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={isLast}
          title="Move down"
          className="flex h-9 w-9 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <ChevronIcon direction="down" />
        </button>
        <button
          type="button"
          onClick={() => duplicateSlide(slide.id)}
          title="Duplicate slide"
          className="flex h-9 w-9 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
        >
          <DuplicateIcon />
        </button>
        <button
          type="button"
          onClick={() => addSlide(slide.id)}
          title="Add slide after"
          className="flex h-9 w-9 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
        >
          <PlusIcon />
        </button>
        <button
          type="button"
          {...dragHandle.attributes}
          {...dragHandle.listeners}
          title="Drag to reorder"
          className="flex h-9 w-9 cursor-grab items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page active:cursor-grabbing"
        >
          <GripIcon size={18} />
        </button>
      </div>
    </>
  );
}

function ChevronIcon({ direction }: { direction: "up" | "down" }) {
  const d = direction === "up" ? "M4 10L9 5L14 10" : "M4 8L9 13L14 8";
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d={d} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DuplicateIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="1.5" y="1.5" width="8" height="8" rx="1.2" />
      <path d="M4.5 12.5h6a2 2 0 0 0 2-2v-6" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M7 2.5V11.5M2.5 7H11.5" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M2.5 3.5h9M5 3.5V2h4v1.5M5.5 6.5v4M8.5 6.5v4M3.5 3.5l.5 8h6l.5-8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
