"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlusIcon } from "lucide-react";
import { Spinner } from "@/components/Spinner";
import { ANNOUNCEMENT_PHOTOS_MAX, type AnnouncementPhoto } from "@/lib/announcements";
import { PHOTO_TYPES } from "@/lib/constants";
import { uploadAnnouncementPhoto } from "@/lib/photos";
import { AnnouncementPhotoGrid } from "../AnnouncementPhotoGrid";

/** The Photos tab: "+ Upload" (one or more photos or GIFs) and the grid of every announcement photo. */
export function AnnouncementPhotos({ photos }: { photos: AnnouncementPhoto[] }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  // "2 of 5" while uploading, else null.
  const [progress, setProgress] = useState<string | null>(null);

  // One at a time, like the form (each goes through /api/announcement-image, which lists it).
  const upload = async (files: File[]) => {
    let added = 0;
    for (const [i, file] of files.entries()) {
      setProgress(`${i + 1} of ${files.length}`);
      try {
        await uploadAnnouncementPhoto(file);
        added++;
      } catch (error) {
        toast.error(`${file.name}: ${(error as Error).message}`);
      }
    }
    setProgress(null);
    if (added > 0) toast.success(added === 1 ? "Photo uploaded." : `${added} photos uploaded.`);
    router.refresh();
  };

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-extrabold text-text-primary">Photos</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Every picture and GIF uploaded for an announcement ({photos.length} of {ANNOUNCEMENT_PHOTOS_MAX}). They stay
            here until you delete them; pick one again with &quot;Picture or GIF&quot; in the form.
          </p>
        </div>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={progress !== null}
          className="inline-flex items-center gap-2 rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
        >
          {progress ? <Spinner size={14} /> : <PlusIcon size={16} />}
          {progress ? `Uploading ${progress}…` : "Upload"}
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={[...PHOTO_TYPES, "image/gif"].join(",")}
          className="hidden"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (files.length > 0) void upload(files);
          }}
        />
      </div>

      {photos.length === 0 ? (
        <div className="rounded-card border border-border-default bg-bg-surface px-5 py-12 text-center text-sm font-semibold text-text-primary">
          No photos yet.
        </div>
      ) : (
        <AnnouncementPhotoGrid photos={photos} />
      )}
    </div>
  );
}
