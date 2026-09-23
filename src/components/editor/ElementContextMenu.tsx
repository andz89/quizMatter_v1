"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

interface ElementContextMenuProps {
  x: number;
  y: number;
  canCopy: boolean;
  canPaste: boolean;
  onCopy: () => void;
  onPaste: () => void;
  onClose: () => void;
}

/** Right-click menu for copying/pasting SVG elements, positioned at the cursor. */
export function ElementContextMenu({ x, y, canCopy, canPaste, onCopy, onPaste, onClose }: ElementContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  // Rendered via a portal straight into <body>: `position: fixed` stops being relative to the
  // viewport once any ancestor has a `transform` (which the zoomed slide canvas always does), so
  // rendering the menu in place would offset it by however much the canvas is scaled/panned.
  return createPortal(
    <div
      ref={ref}
      data-keep-container-selection="true"
      className="fixed z-50 w-40 overflow-hidden rounded-dropdown border border-border-default bg-bg-surface py-1 shadow-[0_4px_16px_rgba(0,0,0,0.14)]"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        disabled={!canCopy}
        onClick={() => {
          onCopy();
          onClose();
        }}
        className="flex w-full items-center px-3 py-2 text-left text-sm text-text-primary hover:bg-bg-page disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      >
        Copy
        <span className="ml-auto text-xs text-text-secondary">Ctrl+C</span>
      </button>
      <button
        type="button"
        disabled={!canPaste}
        onClick={() => {
          onPaste();
          onClose();
        }}
        className="flex w-full items-center px-3 py-2 text-left text-sm text-text-primary hover:bg-bg-page disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      >
        Paste
        <span className="ml-auto text-xs text-text-secondary">Ctrl+V</span>
      </button>
    </div>,
    document.body
  );
}
