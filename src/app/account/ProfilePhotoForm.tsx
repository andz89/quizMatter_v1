"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { UserIcon } from "lucide-react";
import { ConfirmModal } from "@/components/editor/ConfirmModal";
import { PhotoThumbnail } from "@/components/editor/PhotoTile";
import { Spinner } from "@/components/Spinner";
import { MAX_PHOTO_FILE_BYTES, PHOTO_TYPES, PROFILE_PHOTO_CHANGES_PER_DAY } from "@/lib/constants";
import { removeProfilePhoto } from "@/lib/profilePhotos";
import { ProfilePhotoCropper } from "./ProfilePhotoCropper";

/**
 * Editors only: the photo on their profile page. Add / Change opens the file picker, then "Adjust your photo"
 * (ProfilePhotoCropper). PROFILE_PHOTO_CHANGES_PER_DAY new photos a day (the database counts; `leftToday` comes from
 * my_profile_photo, then from each save). Remove asks first and doesn't give a change back.
 */
export function ProfilePhotoForm({ src: savedSrc, leftToday: savedLeftToday }: { src: string; leftToday: number }) {
  const [src, setSrc] = useState(savedSrc);
  const [leftToday, setLeftToday] = useState(savedLeftToday);
  // The picked photo while the adjust box is open.
  const [picked, setPicked] = useState<{ bitmap: ImageBitmap; url: string } | null>(null);
  const [isOpening, setIsOpening] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // So picking the same file again still opens it.
    e.target.value = "";
    if (!file) return;
    // Same checks and words as the slide photos (shrinkPhoto in lib/photos.tsx).
    if (!PHOTO_TYPES.includes(file.type)) return toast.error("Only JPG, PNG and WebP photos can be added.");
    if (file.size > MAX_PHOTO_FILE_BYTES) return toast.error("This photo is too big (20 MB at most).");
    setIsOpening(true);
    try {
      // Turned the way the phone took it, like the preview shows it.
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      setPicked({ bitmap, url: URL.createObjectURL(file) });
    } catch {
      toast.error("This file couldn't be opened as a photo.");
    }
    setIsOpening(false);
  };

  const closeCropper = () => {
    if (picked) {
      picked.bitmap.close();
      URL.revokeObjectURL(picked.url);
    }
    setPicked(null);
  };

  const remove = async () => {
    setIsConfirming(false);
    setIsRemoving(true);
    const error = await removeProfilePhoto();
    setIsRemoving(false);
    if (error) return toast.error(error);
    setSrc("");
    toast.success("Profile photo removed.");
  };

  return (
    <section className="flex flex-col gap-4 rounded-card border border-border-default bg-bg-surface p-5">
      <h2 className="text-lg font-extrabold text-text-primary">Profile photo</h2>
      <div className="flex items-center gap-4">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent-soft text-accent">
          {src ? (
            <PhotoThumbnail src={src} alt="Your profile photo" className="h-full w-full object-cover" />
          ) : (
            <UserIcon size={32} />
          )}
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={leftToday === 0 || isOpening || isRemoving}
              className="flex items-center gap-2 rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
            >
              {isOpening && <Spinner size={14} />}
              {src ? "Change photo" : "Add photo"}
            </button>
            {src && (
              <button
                type="button"
                onClick={() => setIsConfirming(true)}
                disabled={isRemoving}
                className="flex items-center gap-2 rounded-button border border-border-default bg-bg-surface px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-page disabled:opacity-60"
              >
                {isRemoving && <Spinner size={14} />}
                Remove
              </button>
            )}
          </div>
          <p className="text-xs text-text-secondary">
            {leftToday > 0 ? (
              <>
                You can change your photo {PROFILE_PHOTO_CHANGES_PER_DAY} times a day.{" "}
                <span className="rounded-dropdown bg-highlight-soft px-2 py-0.5 font-semibold whitespace-nowrap text-highlight-strong">
                  {leftToday} left today
                </span>
              </>
            ) : (
              `You've changed your photo ${PROFILE_PHOTO_CHANGES_PER_DAY} times today. You can change it again tomorrow.`
            )}
          </p>
        </div>
      </div>
      <input ref={fileInput} type="file" accept={PHOTO_TYPES.join(",")} onChange={pick} hidden />
      {picked && (
        <ProfilePhotoCropper
          photo={picked}
          onClose={closeCropper}
          onSaved={(saved) => {
            setSrc(saved.src);
            setLeftToday(saved.leftToday);
            closeCropper();
          }}
        />
      )}
      {isConfirming && (
        <ConfirmModal
          title="Remove your profile photo?"
          message="It will be taken off your profile page. Removing it doesn't give you back a change for today."
          confirmLabel="Remove"
          danger
          onConfirm={remove}
          onCancel={() => setIsConfirming(false)}
        />
      )}
    </section>
  );
}
