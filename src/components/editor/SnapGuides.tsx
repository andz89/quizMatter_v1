"use client";

import { useEditorStore } from "@/lib/store";

interface SnapGuidesProps {
  slideId: string;
  /** The box this layer belongs to (null = the slide itself). */
  containerId: string | null;
}

/** Thin lines across the box showing what a dragged element has snapped to. */
export function SnapGuides({ slideId, containerId }: SnapGuidesProps) {
  const guides = useEditorStore((s) => s.snapGuides);
  if (!guides || guides.slideId !== slideId || guides.containerId !== containerId) return null;

  return (
    <>
      {guides.xs.map((x) => (
        <div key={`x${x}`} className="absolute inset-y-0 z-40 w-px -translate-x-1/2 bg-[#7CC4FA]" style={{ left: x }} />
      ))}
      {guides.ys.map((y) => (
        <div key={`y${y}`} className="absolute inset-x-0 z-40 h-px -translate-y-1/2 bg-[#7CC4FA]" style={{ top: y }} />
      ))}
    </>
  );
}
