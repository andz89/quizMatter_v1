"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "@/lib/constants";
import { SlideCanvas } from "./SlideCanvas";
import { SlideToolbar } from "./SlideToolbar";
import type { Slide } from "@/lib/schema";

interface SlideWorkspaceItemProps {
  slide: Slide;
  index: number;
  zoom: number;
  isFirst: boolean;
  isLast: boolean;
  canDelete: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  registerNode: (slideId: string, node: HTMLDivElement | null) => void;
}

/** One slide in the scrollable workspace: its drag-sortable wrapper, toolbar, and scaled canvas. */
export function SlideWorkspaceItem({
  slide,
  index,
  zoom,
  isFirst,
  isLast,
  canDelete,
  onMoveUp,
  onMoveDown,
  registerNode,
}: SlideWorkspaceItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: slide.id });

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        registerNode(slide.id, node);
      }}
      data-slide-id={slide.id}
      style={{
        width: CANVAS_WIDTH * zoom,
        height: CANVAS_HEIGHT * zoom,
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      <div
        className="relative"
        style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, transform: `scale(${zoom})`, transformOrigin: "top left" }}
      >
        <SlideToolbar
          slide={slide}
          index={index}
          isFirst={isFirst}
          isLast={isLast}
          canDelete={canDelete}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
          dragHandle={{ attributes, listeners }}
        />
        <SlideCanvas slide={slide} />
      </div>
    </div>
  );
}
