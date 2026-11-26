"use client";

import { useEffect, useRef, useState } from "react";
import { useEditorStore, isPanelEscape } from "@/lib/store";
import { UPLOAD_PAUSE_FEATURES, useIsPaused } from "@/lib/clickLimits";
import { toast } from "sonner";
import { PHOTO_TYPES } from "@/lib/constants";
import {
  PHOTO_LOCKED_MESSAGE,
  addPhotoToSlide,
  isPhotoLocked,
  loadMyPhotos,
  loadPhotoStorage,
  removeMyPhoto,
  uploadPhoto,
  watchPhotoStorage,
} from "@/lib/photos";
import { STILL_COUNTS_TOAST, isStorageFull, stillUsedMessage, type PhotoStorage } from "@/lib/photoStorage";
import { PHOTO_ID } from "@/lib/svgLibrary";
import type { Photo } from "@/lib/schema";
import { PhotoTile } from "./PhotoTile";
import { PhotoStorageBar } from "./PhotoStorageBar";
import { ConfirmModal } from "./ConfirmModal";
import { SharedPhotos } from "./SharedPhotos";
import { Spinner } from "@/components/Spinner";
import { ImageIcon, SearchIcon, XIcon } from "lucide-react";

const TABS = ["Photos", "My Photos"] as const;

/**
 * Adds photos. The "My Photos" tab: pick one photo from the computer, and
 * below, what the teacher uploaded before, to click or drag onto the slide again. Photos can also be dragged
 * from the computer straight onto the slide (see useElementDropTarget). The "Photos" tab has the photos admins
 * shared with every teacher, in a row per category, and a search bar that filters them (see SharedPhotos).
 * The panel stays open so several can be added in a row.
 */
export function PhotosPanel() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Photos");
  const [searchText, setSearchText] = useState("");
  const closePhotosPanel = useEditorStore((s) => s.closePhotosPanel);
  const insertElement = useEditorStore((s) => s.insertElement);
  // The "My photos" list, newest first. null while loading; "failed" if it couldn't load.
  const [myPhotos, setMyPhotos] = useState<Photo[] | null | "failed">(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // How many picked photos are still uploading, to show the Spinner on the button.
  const [uploadingFiles, setUploadingFiles] = useState(0);
  // Uploaded too fast: paused for a while (the photo_upload and photo_rows click limits, each a minute and a day).
  const isUploadPaused = useIsPaused(...UPLOAD_PAUSE_FEATURES);
  // How much of the teacher's limit (50 MB, 500 MB for an editor) their photos use (src/lib/photoStorage.ts). null until read; limit null = an admin.
  const [storage, setStorage] = useState<PhotoStorage | null>(null);
  // A photo still on the teacher's slides, waiting for "Remove from My photos" in the confirm box.
  const [stillUsed, setStillUsed] = useState<{ photo: Photo; message: string } | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isPanelEscape(e)) closePhotosPanel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closePhotosPanel]);

  // Uploads (also a photo dropped onto a slide) and removes send the new total.
  useEffect(() => watchPhotoStorage(setStorage), []);

  // Loaded the first time the "My Photos" tab is opened, not with the panel.
  const isMyPhotosTab = tab === "My Photos";
  useEffect(() => {
    if (isMyPhotosTab && myPhotos === null) loadMyPhotos().then(setMyPhotos, () => setMyPhotos("failed"));
  }, [isMyPhotosTab, myPhotos]);
  // Read each time the tab opens and after each save while it's open (taking a photo off the slides and saving
  // frees space). If it fails, the bar keeps what it had (or doesn't show).
  const savedAt = useEditorStore((s) => s.savedAt);
  useEffect(() => {
    if (isMyPhotosTab) loadPhotoStorage().then(setStorage, () => {});
  }, [isMyPhotosTab, savedAt]);
  const isFull = storage !== null && isStorageFull(storage);

  // A new upload goes to the top of the list (or moves there, if it was already in it).
  const showAtTop = (photo: Photo | null) => {
    if (photo) setMyPhotos((list) => (Array.isArray(list) ? [photo, ...list.filter((p) => p.src !== photo.src)] : list));
  };

  // Takes the photo off the list and returns how to put it back where it was. Putting back adds only that photo, so
  // a photo uploaded meanwhile stays.
  const removeFromList = (photo: Photo) => {
    const index = Array.isArray(myPhotos) ? myPhotos.findIndex((p) => p.src === photo.src) : -1;
    setMyPhotos((list) => (Array.isArray(list) ? list.filter((p) => p.src !== photo.src) : list));
    return () =>
      setMyPhotos((list) =>
        Array.isArray(list) && index >= 0 && !list.some((p) => p.src === photo.src)
          ? [...list.slice(0, index), photo, ...list.slice(index)]
          : list,
      );
  };

  // Removed at once when none of the teacher's slides has it (one request). If their slides still have it, a box
  // says where and that it keeps counting toward their storage. The open presentation may have it on a slide not
  // saved yet, which the database can't see: then the database only answers ("ask") and the box always shows. A
  // review draft is someone else's lesson and never counts, so it isn't asked about.
  const handleRemove = async (photo: Photo) => {
    const { presentation, review } = useEditorStore.getState();
    const usedHere = review === null && presentation.slides.some((slide) => JSON.stringify(slide).includes(photo.src));
    const putBack = usedHere ? null : removeFromList(photo);
    try {
      const result = await removeMyPhoto(photo.src, usedHere ? "ask" : "if_unused");
      if (result.removed) return;
      // Already gone (removed in another tab): it stays off the list.
      if (!usedHere && result.uses.length === 0) return;
      // It counts for nothing (an admin, or a photo they didn't upload): nothing to warn about, so it just goes.
      if (result.bytes === null || result.limit === null) return removeAnyway(photo, putBack, false);
      putBack?.();
      const unsavedHere = usedHere && !result.uses.some((use) => use.id === presentation.id);
      setStillUsed({ photo, message: stillUsedMessage(result.uses, result.bytes, unsavedHere) });
    } catch (error) {
      putBack?.();
      toast.error(isPhotoLocked(error) ? PHOTO_LOCKED_MESSAGE : "Couldn't remove the photo. Please try again.");
    }
  };

  // Removes it even though slides have it. `putBack`: the photo is already off the list (else it's taken off now).
  const removeAnyway = async (photo: Photo, putBack: (() => void) | null, stillCounts: boolean) => {
    const undo = putBack ?? removeFromList(photo);
    try {
      const result = await removeMyPhoto(photo.src, "remove");
      // Not removed = it was already gone (another tab): nothing changed, so no toast.
      if (stillCounts && result.removed) toast(STILL_COUNTS_TOAST);
    } catch (error) {
      undo();
      toast.error(isPhotoLocked(error) ? PHOTO_LOCKED_MESSAGE : "Couldn't remove the photo. Please try again.");
    }
  };

  const confirmRemove = () => {
    if (!stillUsed) return;
    setStillUsed(null);
    removeAnyway(stillUsed.photo, null, true);
  };

  // One photo at a time (addPhotoToSlide refuses another while one is uploading).
  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) {
      setUploadingFiles((n) => n + 1);
      addPhotoToSlide(() => uploadPhoto(file))
        .then(showAtTop)
        .finally(() => setUploadingFiles((n) => n - 1));
    }
    // Cleared so picking the same file again still counts as a change.
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div
      data-keep-container-selection="true"
      className="flex shrink-0 flex-col gap-3 overflow-y-auto border-r border-border-default bg-bg-surface side-panel"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-extrabold text-text-primary">Photos</h2>
        <button
          type="button"
          onClick={closePhotosPanel}
          title="Close (Esc)"
          className="flex h-8 w-8 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
        >
          <XIcon size={16} />
        </button>
      </div>

      <div role="tablist" className="flex gap-1 rounded-button bg-bg-page p-1">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-dropdown py-1.5 text-[13px] font-semibold transition-colors ${
              tab === t ? "bg-bg-surface text-text-primary shadow-xs" : "text-text-secondary hover:text-text-primary"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Photos" ? (
        <>
          {/* Filters the shared photos as you type (see SharedPhotos). */}
          <form onSubmit={(e) => e.preventDefault()} className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-primary">
              <SearchIcon size={16} />
            </span>
            <input
              type="search"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search photos"
              maxLength={100}
              aria-label="Search photos"
              className="w-full rounded-input border border-border-default bg-bg-surface py-2 pr-3 pl-9 text-sm text-text-primary outline-none placeholder:text-text-secondary focus:border-text-secondary"
            />
          </form>
          <SharedPhotos search={searchText} />
        </>
      ) : (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept={PHOTO_TYPES.join(",")}
            hidden
            onChange={(e) => handleFiles(e.target.files)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploadPaused || isFull}
            className="flex items-center justify-center gap-2 rounded-card border border-transparent bg-accent-soft p-2 text-[13px] font-semibold text-text-primary transition-colors hover:border-accent disabled:pointer-events-none disabled:opacity-40"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-button bg-accent text-white">
              {uploadingFiles > 0 ? <Spinner size={16} /> : <ImageIcon size={16} />}
            </span>
            Upload photo
          </button>

          {storage && storage.limit !== null && (
            <PhotoStorageBar storage={{ used: storage.used, limit: storage.limit }} />
          )}
          <p className="text-xs text-text-secondary">You can also drag photos from your computer onto the slide.</p>
          <p className="text-xs text-text-secondary">Only use photos you have the right to use.</p>

          <div className="mt-2">
            {myPhotos === null ? (
              <div className="flex justify-center py-4">
                <Spinner size={18} />
              </div>
            ) : myPhotos === "failed" ? (
              <p className="text-xs text-text-secondary">Couldn&apos;t load your photos. Close and open this panel to try again.</p>
            ) : myPhotos.length === 0 ? (
              <p className="text-xs text-text-secondary">Photos you upload show here.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {myPhotos.map((photo) => (
                  <PhotoTile
                    key={photo.src}
                    photo={photo}
                    onAdd={() => insertElement(PHOTO_ID, photo)}
                    onRemove={() => handleRemove(photo)}
                    removeTitle="Remove from my photos"
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
      {stillUsed && (
        <ConfirmModal
          title="This photo is still on your slides"
          message={stillUsed.message}
          confirmLabel="Remove from My photos"
          onConfirm={confirmRemove}
          onCancel={() => setStillUsed(null)}
        />
      )}
    </div>
  );
}
