"use client";

import { useEffect, useState } from "react";
import { useEditorStore } from "@/lib/store";
import { checkIsAdmin, loadSharedPhotos, matchesSearch, type PhotoCategory, type SharedPhotoWithInfo } from "@/lib/photos";
import { PHOTO_ID } from "@/lib/svgLibrary";
import { Spinner } from "@/components/Spinner";
import { PhotoTile } from "./PhotoTile";

/**
 * The photos admins shared with every teacher: category chips to filter, and the photos to click or drag onto
 * the slide. `search` (the panel's search bar) filters them by file name, description, tags and category.
 * Admins manage them on the admin page (/admin); here they only get a link to it.
 */
export function SharedPhotos({ search }: { search: string }) {
  const insertElement = useEditorStore((s) => s.insertElement);
  // Newest first. null while loading; "failed" if they couldn't load.
  const [photos, setPhotos] = useState<SharedPhotoWithInfo[] | null | "failed">(null);
  const [categories, setCategories] = useState<PhotoCategory[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  // The chosen category chip. null = all.
  const [filterId, setFilterId] = useState<string | null>(null);

  useEffect(() => {
    loadSharedPhotos().then(
      (data) => {
        setPhotos(data.photos);
        setCategories(data.categories);
      },
      () => setPhotos("failed")
    );
    checkIsAdmin().then(setIsAdmin);
  }, []);

  const list = Array.isArray(photos) ? photos : [];
  const photoCount = (categoryId: string) => list.filter((p) => p.categoryId === categoryId).length;
  // Teachers only see categories that have photos.
  const chips = categories.filter((c) => photoCount(c.id) > 0);
  // A chip that's gone (its last photo removed, or deleted) counts as "All".
  const shownId = chips.some((c) => c.id === filterId) ? filterId : null;
  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? "";
  const shown = (shownId ? list.filter((p) => p.categoryId === shownId) : list).filter((p) =>
    matchesSearch(p, search, categoryName(p.categoryId))
  );

  return (
    <div className="mt-2 flex flex-col gap-3">
      {isAdmin && (
        // A new tab, so the presentation being edited stays open.
        <a href="/admin" target="_blank" className="self-start text-[13px] font-semibold text-accent hover:underline">
          Manage shared photos →
        </a>
      )}

      {photos === null ? (
        <div className="flex justify-center py-4">
          <Spinner size={18} />
        </div>
      ) : photos === "failed" ? (
        <p className="text-xs text-text-secondary">Couldn&apos;t load the photos. Close and open this panel to try again.</p>
      ) : photos.length === 0 ? (
        <p className="text-xs text-text-secondary">No shared photos yet.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {[{ id: null, name: "All" }, ...chips].map((c) => (
              <button
                key={c.id ?? "all"}
                type="button"
                aria-pressed={shownId === c.id}
                onClick={() => setFilterId(c.id)}
                className={`rounded-dropdown px-2.5 py-1 text-[13px] font-semibold transition-colors ${
                  shownId === c.id ? "bg-accent text-white" : "bg-bg-page text-text-primary hover:bg-border-default"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className="text-xs text-text-secondary">No photos match &ldquo;{search.trim()}&rdquo;.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {shown.map((shared) => (
                <PhotoTile
                  key={shared.photo.src}
                  photo={shared.photo}
                  title={[shared.file_name || shared.description, shared.source].filter(Boolean).join(" · ") || undefined}
                  onAdd={() => insertElement(PHOTO_ID, shared.photo)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
