"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CopyIcon, XIcon } from "lucide-react";
import { Spinner } from "@/components/Spinner";
import { ConfirmModal } from "@/components/editor/ConfirmModal";
import type { AnnouncementPhoto } from "@/lib/announcements";
import { deleteAnnouncementPhoto } from "./actions";

/**
 * The announcement photos as a grid. On the Photos tab (no `onPick`): each with "Used by …", its address with Copy,
 * and ✕ Delete (asks first). In the form's "Choose a photo" (`onPick`): click a photo to use it.
 */
export function AnnouncementPhotoGrid({
  photos,
  onPick,
}: {
  photos: AnnouncementPhoto[];
  onPick?: (photo: AnnouncementPhoto) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {photos.map((photo) =>
        onPick ? (
          <button
            key={photo.src}
            type="button"
            onClick={() => onPick(photo)}
            title="Use this photo"
            className="overflow-hidden rounded-dropdown border border-border-default bg-bg-page transition-colors hover:border-accent"
          >
            <Thumbnail photo={photo} />
          </button>
        ) : (
          <PhotoCard key={photo.src} photo={photo} />
        ),
      )}
    </div>
  );
}

function Thumbnail({ photo }: { photo: AnnouncementPhoto }) {
  return (
    <div className="relative aspect-[4/3]">
      {/* eslint-disable-next-line @next/next/no-img-element -- our own R2 file, shown as it is (a GIF keeps moving) */}
      <img src={photo.src} alt="" loading="lazy" className="h-full w-full object-contain" />
      {photo.src.endsWith(".gif") && (
        <span className="absolute bottom-1.5 left-1.5 rounded-dropdown bg-bg-surface px-1.5 text-[11px] font-bold text-text-primary">
          GIF
        </span>
      )}
    </div>
  );
}

function PhotoCard({ photo }: { photo: AnnouncementPhoto }) {
  const [isDeleting, startDeleting] = useTransition();
  const [isConfirming, setIsConfirming] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(photo.src);
      toast.success("Link copied.");
    } catch {
      toast.error("Couldn't copy the link. Please try again.");
    }
  };

  const remove = () => {
    setIsConfirming(false);
    startDeleting(async () => {
      const error = await deleteAnnouncementPhoto(photo.src);
      if (error) toast.error(error);
      else toast.success("Photo deleted.");
    });
  };

  return (
    <div className={`flex flex-col overflow-hidden rounded-dropdown border border-border-default bg-bg-surface ${isDeleting ? "opacity-60" : ""}`}>
      <div className="relative bg-bg-page">
        <Thumbnail photo={photo} />
        <button
          type="button"
          onClick={() => setIsConfirming(true)}
          disabled={isDeleting}
          title="Delete photo"
          aria-label="Delete photo"
          className="absolute top-1.5 right-1.5 rounded-dropdown border border-border-default bg-bg-surface p-1 text-danger-strong hover:bg-danger-soft disabled:opacity-60"
        >
          {isDeleting ? <Spinner size={14} /> : <XIcon size={14} />}
        </button>
      </div>
      <div className="flex flex-col gap-1.5 px-2.5 py-2">
        <p className="truncate text-[12px] text-text-secondary" title={photo.used_by.join(", ")}>
          {photo.used_by.length > 0 ? `Used by: ${photo.used_by.join(", ")}` : "Not used"}
        </p>
        <div className="flex items-center gap-1.5">
          <input
            readOnly
            value={photo.src}
            aria-label="Photo link"
            onFocus={(e) => e.target.select()}
            className="min-w-0 flex-1 rounded-dropdown border border-border-default bg-bg-page px-2 py-1 text-[11px] text-text-primary outline-none"
          />
          <button
            type="button"
            onClick={copy}
            title="Copy link"
            aria-label="Copy link"
            className="rounded-dropdown border border-border-default p-1 text-text-primary hover:bg-bg-page"
          >
            <CopyIcon size={14} />
          </button>
        </div>
      </div>

      {isConfirming && (
        <ConfirmModal
          title="Delete this photo?"
          message="It leaves this list. Announcements can't use it again unless you upload it again."
          confirmLabel="Delete"
          danger
          onConfirm={remove}
          onCancel={() => setIsConfirming(false)}
        />
      )}
    </div>
  );
}
