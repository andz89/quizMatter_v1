"use client";

import { PHOTO_DRAG_MIME } from "@/lib/constants";
import type { Photo } from "@/lib/schema";
import { XIcon } from "lucide-react";

/**
 * One photo in a list of the Photos panel: click to add it, drag it onto a box or the slide, ✕ to take it off the
 * list (if allowed). `title` (e.g. its file name) shows on hover.
 */
export function PhotoTile({
  photo,
  title,
  onAdd,
  onRemove,
  removeTitle,
}: {
  photo: Photo;
  title?: string;
  onAdd: () => void;
  onRemove?: () => void;
  removeTitle?: string;
}) {
  return (
    <div className="group relative">
      <button
        type="button"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(PHOTO_DRAG_MIME, JSON.stringify(photo));
          e.dataTransfer.effectAllowed = "copy";
        }}
        onClick={onAdd}
        title={title ? `${title} (click or drag to add)` : "Click or drag to add"}
        className="block aspect-square w-full cursor-grab overflow-hidden rounded-dropdown border border-border-default bg-bg-page transition-colors hover:border-accent"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- already shrunk when it was uploaded; nothing for next/image to do. */}
        <img src={photo.src} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover" />
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          title={removeTitle}
          className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full border border-border-default bg-bg-surface text-text-primary opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        >
          <XIcon size={12} />
        </button>
      )}
    </div>
  );
}
