"use client";

import { useEffect, useEffectEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Spinner } from "./Spinner";
import { XIcon } from "lucide-react";

/**
 * A white box in the middle of the screen over a dark backdrop, with a title and ✕. Escape, a click outside
 * or ✕ closes it — except while `isBusy` (e.g. uploading), when ✕ shows the Spinner and nothing closes it.
 * Taller content scrolls inside the box; an optional `footer` (e.g. a Save button) stays below it. `isNarrow` makes a
 * small box (e.g. the "Keep QuizMatter free" QR). `canClose={false}` hides ✕ and makes Escape and a click outside do
 * nothing (e.g. an announcement before its close button may show). `hideHeader` leaves out the title row and ✕
 * (the title still names the box for screen readers); the footer then needs its own way to close. `width` gives the
 * box an exact width in px (e.g. an announcement), still shrinking to fit a smaller screen. `noPadding` lets the
 * content reach the box's edges (its corners are clipped round). `corner` floats in the box's top-right corner, over
 * the content and outside its scrolling (e.g. an announcement's close button).
 */
export function Modal({
  title,
  onClose,
  isBusy = false,
  isNarrow = false,
  canClose = true,
  hideHeader = false,
  width,
  noPadding = false,
  corner,
  footer,
  children,
}: {
  title: string;
  onClose: () => void;
  isBusy?: boolean;
  isNarrow?: boolean;
  canClose?: boolean;
  hideHeader?: boolean;
  width?: number;
  noPadding?: boolean;
  corner?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  // Added once, reading the newest props when a key is pressed. Re-adding it on every render (onClose is a new
  // function each time) lost Escape in the editor: its own Escape (deselect) re-renders the page mid-press, and a
  // listener added during a key press doesn't hear that press.
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === "Escape" && !isBusy && canClose) onClose();
  });
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => onKeyDown(e);
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Portal into <body>, so no parent's `zoom` or `transform` shifts this `position: fixed` box.
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4 py-6"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isBusy && canClose) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative flex max-h-full w-full flex-col rounded-card bg-bg-surface ${isNarrow ? "max-w-md" : "max-w-2xl"} ${
          noPadding ? "overflow-hidden" : ""
        }`}
        style={width ? { maxWidth: width } : undefined}
      >
        {corner && <div className="absolute right-3 top-3 z-10">{corner}</div>}
        {!hideHeader && (
          <div className="flex items-center gap-3 border-b border-border-default px-5 py-3.5">
            <h2 className="text-[15px] font-extrabold text-text-primary">{title}</h2>
            {/* Keeps the header's height while ✕ is hidden. */}
            {!canClose && <span className="h-8" />}
            {canClose && (
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
            )}
          </div>
        )}
        <div className={`overflow-y-auto ${noPadding ? "" : "px-5 py-4"}`}>{children}</div>
        {footer && <div className="flex justify-end gap-3 border-t border-border-default px-5 py-3.5">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
