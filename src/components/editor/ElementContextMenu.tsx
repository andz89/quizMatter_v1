"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface ElementContextMenuProps {
  x: number;
  y: number;
  canCopy: boolean;
  canPaste: boolean;
  canFit: boolean;
  onCopy: () => void;
  onPaste: () => void;
  onFit: () => void;
  onLayer: (move: "front" | "back") => void;
  onClose: () => void;
}

/** Right-click menu for copying/pasting SVG elements, fitting them to their box, and layer order, positioned at the cursor. */
export function ElementContextMenu({ x, y, canCopy, canPaste, canFit, onCopy, onPaste, onFit, onLayer, onClose }: ElementContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Capture phase: elements stop their pointerdown from bubbling (drag, resize), so listen before they can.
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const item = (label: string, enabled: boolean, onClick: () => void, shortcut?: ReactNode) => (
    <button
      type="button"
      disabled={!enabled}
      onClick={() => {
        onClick();
        onClose();
      }}
      className="flex w-full items-center px-3 py-2 text-left text-sm text-text-primary hover:bg-bg-page disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {label}
      {shortcut && <span className="ml-auto text-xs text-text-secondary">{shortcut}</span>}
    </button>
  );

  // Rendered via a portal straight into <body>: the slide canvas has CSS `zoom`, which would also
  // multiply the menu's left/top (screen pixels), so rendering it in place would put it in the wrong spot.
  return createPortal(
    <div
      ref={ref}
      data-keep-container-selection="true"
      className="fixed z-50 w-48 overflow-hidden rounded-dropdown border border-border-default bg-bg-surface py-1 shadow-[0_4px_16px_rgba(0,0,0,0.14)]"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      {item("Copy", canCopy, onCopy, "Ctrl+C")}
      {item("Paste", canPaste, onPaste, "Ctrl+V")}
      {item("Fit to box", canFit, onFit)}
      <div className="my-1 h-px bg-border-default" />
      {item("Bring to front", canCopy, () => onLayer("front"), "Ctrl+Alt+]")}
      {item("Send to back", canCopy, () => onLayer("back"), "Ctrl+Alt+[")}
    </div>,
    document.body
  );
}
