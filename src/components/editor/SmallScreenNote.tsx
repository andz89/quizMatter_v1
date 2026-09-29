"use client";

import { useState } from "react";
import { MonitorSmartphoneIcon, PlayIcon } from "lucide-react";
import { presentFullscreen } from "./EditorTopBar";

/**
 * Covers the editor on phone-sized screens (held upright), where the slides are too small to edit. Presenting
 * still works, and "Edit anyway" hides the note until the page is opened again. Hidden on wider screens
 * (a phone turned sideways, tablets, computers).
 */
export function SmallScreenNote() {
  const [isHidden, setIsHidden] = useState(false);
  if (isHidden) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-bg-page px-4 sm:hidden">
      <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-card border border-border-default bg-bg-surface px-5 py-6 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-button bg-accent-soft text-accent">
          <MonitorSmartphoneIcon size={24} />
        </span>
        <h2 className="text-lg font-extrabold text-text-primary">The editor needs a bigger screen</h2>
        <p className="text-sm text-text-secondary">Turn your phone sideways, or open this presentation on a tablet or computer. You can still present it from here.</p>
        <div className="mt-2 flex w-full flex-col gap-2">
          <button
            type="button"
            onClick={presentFullscreen}
            className="flex items-center justify-center gap-2 rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
          >
            <PlayIcon size={14} fill="currentColor" />
            Present
          </button>
          <button
            type="button"
            onClick={() => setIsHidden(true)}
            className="rounded-button border border-border-default px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-page"
          >
            Edit anyway
          </button>
        </div>
      </div>
    </div>
  );
}
