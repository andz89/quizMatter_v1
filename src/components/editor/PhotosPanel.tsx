"use client";

import { useEffect, useRef, useState } from "react";
import { useEditorStore, isPanelEscape } from "@/lib/store";
import { toast } from "sonner";
import { PHOTO_TYPES, addPhotoToSlide, loadMyPhotos, removeMyPhoto, uploadPhoto, uploadPhotoFromLink } from "@/lib/photos";
import { PHOTO_ID } from "@/lib/svgLibrary";
import type { Photo } from "@/lib/schema";
import { PhotoTile } from "./PhotoTile";
import { SharedPhotos } from "./SharedPhotos";
import { Spinner } from "@/components/Spinner";
import { ImageIcon, SearchIcon, XIcon } from "lucide-react";

const TABS = ["Photos", "My Photos"] as const;

/**
 * Adds photos. The "My Photos" tab: pick from the computer (several at once is fine) or paste a link, and
 * below, what the teacher uploaded before, to click or drag onto the slide again. Photos can also be dragged
 * from the computer straight onto the slide (see useElementDropTarget). The "Photos" tab has the photos admins
 * shared with every teacher, by category, and a search bar that filters them (see SharedPhotos).
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
  const [link, setLink] = useState("");
  // How many picked photos are still uploading, to show the Spinner on the button.
  const [uploadingFiles, setUploadingFiles] = useState(0);
  const [isAddingLink, setIsAddingLink] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isPanelEscape(e)) closePhotosPanel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closePhotosPanel]);

  useEffect(() => {
    loadMyPhotos().then(setMyPhotos, () => setMyPhotos("failed"));
  }, []);

  // A new upload goes to the top of the list (or moves there, if it was already in it).
  const showAtTop = (photo: Photo | null) => {
    if (photo) setMyPhotos((list) => (Array.isArray(list) ? [photo, ...list.filter((p) => p.src !== photo.src)] : list));
  };

  // Taken off the list at once; put back if removing fails.
  const handleRemove = async (photo: Photo) => {
    const previous = myPhotos;
    setMyPhotos((list) => (Array.isArray(list) ? list.filter((p) => p.src !== photo.src) : list));
    try {
      await removeMyPhoto(photo.src);
    } catch {
      setMyPhotos(previous);
      toast.error("Couldn't remove the photo. Please try again.");
    }
  };

  const handleFiles = (files: FileList | null) => {
    for (const file of files ?? []) {
      setUploadingFiles((n) => n + 1);
      addPhotoToSlide(() => uploadPhoto(file))
        .then(showAtTop)
        .finally(() => setUploadingFiles((n) => n - 1));
    }
    // Cleared so picking the same file again still counts as a change.
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = link.trim();
    if (!url || isAddingLink) return;
    setIsAddingLink(true);
    const photo = await addPhotoToSlide(() => uploadPhotoFromLink(url));
    if (photo) setLink("");
    showAtTop(photo);
    setIsAddingLink(false);
  };

  return (
    <div
      data-keep-container-selection="true"
      className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-r border-border-default bg-bg-surface p-5"
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
            multiple
            hidden
            onChange={(e) => handleFiles(e.target.files)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center gap-2 rounded-card border border-transparent bg-accent-soft p-2 text-[13px] font-semibold text-text-primary transition-colors hover:border-accent"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-button bg-accent text-white">
              {uploadingFiles > 0 ? <Spinner size={16} /> : <ImageIcon size={16} />}
            </span>
            Upload photo
          </button>

          <form onSubmit={handleLinkSubmit} className="flex items-center gap-1">
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="Or paste a photo link"
              maxLength={2000}
              aria-label="Photo link"
              className="min-w-0 flex-1 rounded-input border border-border-default bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-secondary focus:border-text-secondary"
            />
            <button
              type="submit"
              disabled={!link.trim() || isAddingLink}
              className="flex h-9 w-14 shrink-0 items-center justify-center rounded-button bg-accent btn-press text-sm font-semibold text-white disabled:opacity-40"
            >
              {isAddingLink ? <Spinner size={14} /> : "Add"}
            </button>
          </form>

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
                    removeTitle="Remove from my photos (slides keep it)"
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
