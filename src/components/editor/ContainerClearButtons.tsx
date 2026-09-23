"use client";

import { useEditorStore } from "@/lib/store";
import { EraserIcon } from "@/components/icons/EraserIcon";
import { ClearElementsIcon } from "@/components/icons/ClearElementsIcon";

interface ContainerClearButtonsProps {
  slideId: string;
  containerId: string;
  hasText: boolean;
  hasElements: boolean;
  onClearText: () => void;
  className?: string;
}

/**
 * "Clear text" / "Clear elements" buttons for the question or an option box. Only the button with
 * something to clear is shown. The parent box needs `group/box` so these appear on hover.
 */
export function ContainerClearButtons({ slideId, containerId, hasText, hasElements, onClearText, className }: ContainerClearButtonsProps) {
  const clearContainerElements = useEditorStore((s) => s.clearContainerElements);

  if (!hasText && !hasElements) return null;

  const buttonClass =
    "flex h-9 w-9 items-center justify-center rounded-dropdown text-text-primary transition-colors hover:bg-bg-surface";

  return (
    <div
      // Keep clicks here from also selecting the box underneath.
      onClick={(e) => e.stopPropagation()}
      className={`absolute z-10 flex gap-0.5 opacity-0 transition-opacity group-hover/box:opacity-100 ${className ?? ""}`}
    >
      {hasText && (
        <button type="button" title="Clear text" onClick={onClearText} className={buttonClass}>
          <EraserIcon size={18} />
        </button>
      )}
      {hasElements && (
        <button
          type="button"
          title="Clear elements"
          onClick={() => clearContainerElements(slideId, containerId)}
          className={buttonClass}
        >
          <ClearElementsIcon size={18} />
        </button>
      )}
    </div>
  );
}
