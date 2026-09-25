"use client";

import { useRef } from "react";
import { useEditorStore } from "@/lib/store";

interface ResizeHandleProps {
  // The box's current height, in canvas px.
  height: number;
  // Called while dragging with the new height the pointer asks for (the store clamps it).
  onResize: (height: number) => void;
}

/** The small bar on a box's bottom edge: drag it down to make the box taller, up to make it shorter. */
export function ResizeHandle({ height, onResize }: ResizeHandleProps) {
  const zoom = useEditorStore((s) => s.zoom);
  const dragStart = useRef<{ y: number; height: number } | null>(null);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    dragStart.current = { y: e.clientY, height };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    // The pointer moves in screen px; divide by zoom to get canvas px.
    onResize(dragStart.current.height + (e.clientY - dragStart.current.y) / zoom);
  };

  const stopResize = () => {
    dragStart.current = null;
  };

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopResize}
      onPointerLeave={stopResize}
      onClick={(e) => e.stopPropagation()}
      title="Drag to resize"
      className="group absolute -bottom-1.5 left-1/2 z-20 flex h-3 w-16 -translate-x-1/2 cursor-ns-resize items-center justify-center"
    >
      <div className="h-1 w-10 rounded-full bg-border-default transition-colors group-hover:bg-accent-navy" />
    </div>
  );
}
