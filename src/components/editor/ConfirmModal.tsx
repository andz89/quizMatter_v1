"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Small centered "Are you sure?" box with Cancel and a confirm button. Escape or a click outside cancels. */
export function ConfirmModal({ title, message, confirmLabel, onConfirm, onCancel }: ConfirmModalProps) {
  // Caught on the way down (capture) and stopped here, so the editor's shortcuts (Delete, arrows…)
  // don't act behind the box. Enter still presses the focused button.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onCancel]);

  // Portal into <body>, so no parent's `zoom` or `transform` shifts this `position: fixed` box.
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4"
      onClick={(e) => {
        // React sends portal clicks up to the slide, which would change the selection.
        e.stopPropagation();
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div role="dialog" aria-modal="true" className="flex w-[420px] flex-col gap-3 rounded-card bg-bg-surface px-6 py-5">
        <h2 className="text-base font-semibold text-text-primary">{title}</h2>
        <p className="text-sm leading-relaxed text-text-primary">{message}</p>
        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-9 rounded-button border border-border-default px-4 text-sm font-semibold text-text-primary hover:bg-bg-page"
          >
            Cancel
          </button>
          <button
            type="button"
            autoFocus
            onClick={onConfirm}
            className="h-9 rounded-button bg-accent-navy px-4 text-sm font-semibold text-white hover:opacity-90"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
