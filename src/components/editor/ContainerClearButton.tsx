"use client";

import { useEditorStore } from "@/lib/store";
import { EraserIcon } from "@/components/icons/EraserIcon";

interface ContainerClearButtonProps {
  slideId: string;
  containerId: string;
  hasElements: boolean;
  // Placement, e.g. "absolute right-1 top-1".
  className?: string;
  // Bigger button and icon, for the wide shape box.
  large?: boolean;
}

/**
 * "Clear all" button for a box with no text of its own (the shape box): removes its elements.
 * Hidden when the box is empty. The parent box needs `group/box` so it appears on hover.
 */
export function ContainerClearButton({ slideId, containerId, hasElements, className, large = false }: ContainerClearButtonProps) {
  const clearContainerElements = useEditorStore((s) => s.clearContainerElements);

  if (!hasElements) return null;

  const handleClick = (e: React.MouseEvent) => {
    // Keep the click from also selecting the box underneath.
    e.stopPropagation();
    clearContainerElements(slideId, containerId);
  };

  return (
    <button
      type="button"
      title="Clear all"
      onClick={handleClick}
      className={`z-10 flex ${large ? "h-12 w-12" : "h-7 w-9"} items-center justify-center rounded-dropdown text-text-primary opacity-0 transition-[opacity,background-color] hover:bg-bg-surface group-hover/box:opacity-100 ${className ?? ""}`}
    >
      <EraserIcon size={large ? 30 : 20} />
    </button>
  );
}
