"use client";

import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "@/lib/store";
import {
  SHARED_PHOTOS_PER_PAGE,
  checkIsAdmin,
  loadPhotoCategoriesInUse,
  loadSharedPhotoPage,
  type PhotoCategory,
  type SharedPhotoWithInfo,
} from "@/lib/photos";
import { PHOTO_ID } from "@/lib/svgLibrary";
import { Spinner } from "@/components/Spinner";
import { PhotoTile } from "./PhotoTile";

// How long to wait after the last key press before searching, so typing "rabbit" asks the database once, not 6 times.
const SEARCH_DELAY_MS = 300;

/**
 * The photos admins shared with every teacher: category chips to filter, and the photos to click or drag onto
 * the slide. `search` (the panel's search bar) finds them by file name, description, tags and category.
 * Admins manage them on the admin page (/admin); here they only get a link to it.
 */
export function SharedPhotos({ search }: { search: string }) {
  // Categories that have photos. Empty while loading (or if they couldn't load: the photos still show).
  const [categories, setCategories] = useState<PhotoCategory[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  // The chosen category chip. null = all.
  const [filterId, setFilterId] = useState<string | null>(null);
  // `search`, once the typing stops.
  const [query, setQuery] = useState(search.trim());

  useEffect(() => {
    loadPhotoCategoriesInUse().then(setCategories, () => {});
    checkIsAdmin().then(setIsAdmin);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search]);

  return (
    <div className="mt-2 flex flex-col gap-3">
      {isAdmin && (
        // A new tab, so the presentation being edited stays open.
        <a href="/admin" target="_blank" className="self-start text-[13px] font-semibold text-accent hover:underline">
          Manage shared photos →
        </a>
      )}

      {categories.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {[{ id: null, name: "All" }, ...categories].map((c) => (
            <button
              key={c.id ?? "all"}
              type="button"
              aria-pressed={filterId === c.id}
              onClick={() => setFilterId(c.id)}
              className={`rounded-dropdown px-2.5 py-1 text-[13px] font-semibold transition-colors ${
                filterId === c.id ? "bg-accent text-white" : "bg-bg-page text-text-primary hover:bg-border-default"
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {/* A new search or chip starts a fresh list (the key makes React replace it). */}
      <SharedPhotoList key={`${filterId}|${query}`} search={query} categoryId={filterId} />
    </div>
  );
}

/**
 * The photos for one search and category, SHARED_PHOTOS_PER_PAGE at a time: when the teacher scrolls to the
 * bottom of the list, the next ones load and are added below ("infinite scroll").
 */
function SharedPhotoList({ search, categoryId }: { search: string; categoryId: string | null }) {
  const insertElement = useEditorStore((s) => s.insertElement);
  const [photos, setPhotos] = useState<SharedPhotoWithInfo[]>([]);
  // "more": there may be more photos to load; "end": all are shown.
  const [status, setStatus] = useState<"loading" | "more" | "end" | "failed">("loading");
  // Where the page being loaded starts (0 = the first photos).
  const [from, setFrom] = useState(0);
  // An empty line under the photos. When it scrolls into view, the next page loads.
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Ignores the answer if React already threw this load away (e.g. it runs effects twice while developing).
    let ignore = false;
    loadSharedPhotoPage(search, categoryId, from).then(
      (page) => {
        if (ignore) return;
        setPhotos((list) => [...list, ...page]);
        setStatus(page.length < SHARED_PHOTOS_PER_PAGE ? "end" : "more");
      },
      () => {
        if (!ignore) setStatus("failed");
      }
    );
    return () => {
      ignore = true;
    };
  }, [search, categoryId, from]);

  useEffect(() => {
    const bottom = bottomRef.current;
    if (status !== "more" || !bottom) return;
    // IntersectionObserver is built into the browser: it tells us when the line shows on screen.
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setStatus("loading");
      setFrom(photos.length);
    });
    observer.observe(bottom);
    return () => observer.disconnect();
  }, [status, photos.length]);

  if (status === "end" && photos.length === 0) {
    return (
      <p className="text-xs text-text-secondary">
        {search ? <>No photos match &ldquo;{search}&rdquo;.</> : "No shared photos yet."}
      </p>
    );
  }

  return (
    <>
      {photos.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {photos.map((shared) => (
            <PhotoTile
              key={shared.photo.src}
              photo={shared.photo}
              title={[shared.file_name || shared.description, shared.source].filter(Boolean).join(" · ") || undefined}
              onAdd={() => insertElement(PHOTO_ID, shared.photo)}
            />
          ))}
        </div>
      )}
      {status === "loading" && (
        <div className="flex justify-center py-4">
          <Spinner size={18} />
        </div>
      )}
      {status === "failed" && (
        <p className="text-xs text-text-secondary">Couldn&apos;t load the photos. Close and open this panel to try again.</p>
      )}
      {status === "more" && <div ref={bottomRef} className="h-px" />}
    </>
  );
}
