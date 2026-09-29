"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Spinner } from "./Spinner";
import { XIcon } from "lucide-react";

/**
 * A white box in the middle of the screen over a dark backdrop, with a title and ✕. Escape, a click outside
 * or ✕ closes it — except while `isBusy` (e.g. uploading), when ✕ shows the Spinner and nothing closes it.
 * Taller content scrolls inside the box.
 */
export function Modal({
  title,
  onClose,
  isBusy = false,
  children,
}: {
  title: string;
  onClose: () => void;
  isBusy?: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isBusy) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, isBusy]);

  // Portal into <body>, so no parent's `zoom` or `transform` shifts this `position: fixed` box.
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4 py-6"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isBusy) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={title} className="flex max-h-full w-full max-w-2xl flex-col rounded-card bg-bg-surface">
        <div className="flex items-center gap-3 border-b border-border-default px-5 py-3.5">
          <h2 className="text-[15px] font-extrabold text-text-primary">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            title={isBusy ? "Please wait until it's done" : "Close"}
            aria-label="Close"
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-dropdown text-text-primary transition-colors hover:bg-bg-page disabled:hover:bg-transparent"
          >
            {isBusy ? <Spinner size={14} /> : <XIcon size={14} />}
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body
  );
}
