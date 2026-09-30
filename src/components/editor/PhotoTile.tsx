"use client";

import { useState } from "react";
import { PHOTO_DRAG_MIME, thumbnailUrl } from "@/lib/constants";
import type { Photo } from "@/lib/schema";
import { XIcon } from "lucide-react";

/**
 * A photo's small preview (see thumbnailUrl), loaded only when it scrolls into view. If the small copy can't be
 * loaded (e.g. Cloudflare's monthly free amount ran out), it shows the full photo instead.
 */
export function PhotoThumbnail({ src, alt = "", className }: { src: string; alt?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    // eslint-disable-next-line @next/next/no-img-element -- Cloudflare already makes the small copy; nothing for next/image to do.
    <img
      src={failed ? src : thumbnailUrl(src)}
      alt={alt}
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
      className={className}
    />
  );
}

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
        {/* Only the picture is the small copy: a click or drag still adds the full photo. */}
        <PhotoThumbnail src={photo.src} className="h-full w-full object-cover" />
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
