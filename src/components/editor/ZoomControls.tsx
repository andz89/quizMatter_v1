"use client";

import { useEditorStore, MIN_ZOOM, MAX_ZOOM } from "@/lib/store";

export function ZoomControls() {
  const zoom = useEditorStore((s) => s.zoom);
  const zoomIn = useEditorStore((s) => s.zoomIn);
  const zoomOut = useEditorStore((s) => s.zoomOut);
  const resetZoom = useEditorStore((s) => s.resetZoom);
  const setZoom = useEditorStore((s) => s.setZoom);

  return (
    <div className="absolute bottom-5 right-5 flex items-center gap-2 rounded-button border border-border-default bg-bg-surface px-3 py-1.5">
      <button
        type="button"
        onClick={zoomOut}
        disabled={zoom <= MIN_ZOOM}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page disabled:opacity-30"
        title="Zoom out"
      >
        −
      </button>

      <input
        type="range"
        className="zoom-slider w-28"
        min={MIN_ZOOM}
        max={MAX_ZOOM}
        step={0.01}
        value={zoom}
        onChange={(e) => setZoom(parseFloat(e.target.value))}
        title="Zoom"
      />

      <button
        type="button"
        onClick={resetZoom}
        className="w-11 shrink-0 text-center text-xs font-medium text-text-secondary hover:text-text-primary"
        title="Reset zoom"
      >
        {Math.round(zoom * 100)}%
      </button>

      <button
        type="button"
        onClick={zoomIn}
        disabled={zoom >= MAX_ZOOM}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page disabled:opacity-30"
        title="Zoom in"
      >
        +
      </button>
    </div>
  );
}
