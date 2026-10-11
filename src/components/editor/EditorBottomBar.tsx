"use client";

import { LayoutGridIcon, Maximize2Icon } from "lucide-react";
import { useEditorStore, MIN_ZOOM, MAX_ZOOM } from "@/lib/store";

/** Opens the presentation, fullscreen when the browser allows it. */
export async function presentFullscreen() {
  try {
    await document.documentElement.requestFullscreen();
  } catch {
    // Fullscreen isn't available (unsupported/blocked) — presentation still opens.
  }
  useEditorStore.getState().startPresentation();
}

const ICON_BUTTON = "flex h-8 w-8 shrink-0 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page";

/** The bar under the slides (like Canva's): zoom, which slide is showing, the slide grid, and fullscreen. */
export function EditorBottomBar() {
  const zoom = useEditorStore((s) => s.zoom);
  const setZoom = useEditorStore((s) => s.setZoom);
  const resetZoom = useEditorStore((s) => s.resetZoom);
  const openGridView = useEditorStore((s) => s.openGridView);
  const slideCount = useEditorStore((s) => s.presentation.slides.length);
  const slideNumber = useEditorStore((s) => s.presentation.slides.findIndex((slide) => slide.id === s.selectedSlideId) + 1);

  return (
    <div className="flex h-11 shrink-0 items-center justify-end gap-3 border-t border-border-default bg-bg-surface px-4">
      <input
        type="range"
        className="zoom-slider w-36"
        min={MIN_ZOOM}
        max={MAX_ZOOM}
        step={0.01}
        value={zoom}
        onChange={(e) => setZoom(parseFloat(e.target.value))}
        title="Zoom (Ctrl + mouse wheel)"
      />
      <button
        type="button"
        onClick={resetZoom}
        className="w-11 shrink-0 text-center text-xs font-medium text-text-secondary hover:text-text-primary"
        title="Reset zoom"
      >
        {Math.round(zoom * 100)}%
      </button>

      <span className="shrink-0 text-xs font-medium text-text-secondary" title="Slide you're on / all slides">
        {slideNumber} / {slideCount}
      </span>

      <button type="button" onClick={openGridView} className={ICON_BUTTON} title="All slides">
        <LayoutGridIcon size={16} />
      </button>
      <button type="button" onClick={presentFullscreen} className={ICON_BUTTON} title="Present (fullscreen)">
        <Maximize2Icon size={16} />
      </button>
    </div>
  );
}
