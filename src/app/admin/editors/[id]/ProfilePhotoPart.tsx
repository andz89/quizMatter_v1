"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ConfirmModal } from "@/components/editor/ConfirmModal";
import { PhotoThumbnail } from "@/components/editor/PhotoTile";
import { Spinner } from "@/components/Spinner";
import { removeEditorPhoto } from "../actions";

/** The editor's profile photo with Remove photo (asks first), or "No profile photo." */
export function ProfilePhotoPart({ userId, src }: { userId: string; src: string }) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  const remove = async () => {
    setIsConfirming(false);
    setIsRemoving(true);
    const error = await removeEditorPhoto(userId);
    setIsRemoving(false);
    if (error) toast.error(error);
    else toast.success("Profile photo removed.");
  };

  if (!src) {
    return (
      <p className="rounded-card border border-border-default bg-bg-surface px-5 py-8 text-center text-sm text-text-secondary">
        No profile photo.
      </p>
    );
  }
  return (
    <div className="flex items-center gap-4 rounded-card border border-border-default bg-bg-surface px-5 py-4">
      {/* The full photo, in a new tab. */}
      <a href={src} target="_blank" rel="noreferrer" className="shrink-0">
        <PhotoThumbnail src={src} alt="" className="h-16 w-16 rounded-full border border-border-default bg-bg-page object-cover" />
      </a>
      <button
        type="button"
        onClick={() => setIsConfirming(true)}
        disabled={isRemoving}
        className="flex items-center gap-2 rounded-button border border-border-default bg-bg-surface px-4 py-2 text-sm font-semibold text-danger-strong transition-colors hover:bg-danger-soft disabled:opacity-60"
      >
        {isRemoving && <Spinner size={14} />}
        Remove photo
      </button>
      {isConfirming && (
        <ConfirmModal
          title="Remove this profile photo?"
          message="It will be taken off the editor's profile page. They can add a new one (it still counts toward their 3 a day)."
          confirmLabel="Remove photo"
          danger
          onConfirm={remove}
          onCancel={() => setIsConfirming(false)}
        />
      )}
    </div>
  );
}
