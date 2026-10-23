"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useEditorStore } from "@/lib/store";
import {
  SHARED_PHOTOS_PER_PAGE,
  checkIsAdmin,
  loadCategoryRow,
  loadPhotoCategoriesInUse,
  loadSharedPhotoPage,
  type PhotoCategory,
  type SharedPhotoWithInfo,
} from "@/lib/photos";
import { PHOTO_ID } from "@/lib/svgLibrary";
import type { Photo } from "@/lib/schema";
import { Spinner } from "@/components/Spinner";
import { PhotoTile } from "./PhotoTile";
import { ScrollRow } from "./ScrollRow";
import { ChevronLeftIcon } from "lucide-react";

// How long to wait after the last key press before searching, so typing "rabbit" asks the database once, not 6 times.
const SEARCH_DELAY_MS = 300;

/** Shows on hover: the photo's file name (or description) and where it's from. */
const photoTitle = (shared: SharedPhotoWithInfo) =>
  [shared.file_name || shared.description, shared.source].filter(Boolean).join(" · ") || undefined;

/**
 * The photos admins shared with every teacher, to click or drag onto the slide. Like Canva: the photos used last on
 * top, then one row per category with its newest photos, and "See all" for the whole category. `search` (the panel's search bar) finds them by
 * file name, description, tags and category (inside the open category, if one is open).
 * Admins manage them on the admin page (/admin/photos); here they only get a link to it.
 */
export function SharedPhotos({ search }: { search: string }) {
  // Categories that have photos. null while loading.
  const [categories, setCategories] = useState<PhotoCategory[] | null | "failed">(null);
  const [isAdmin, setIsAdmin] = useState(false);
  // The category opened with "See all". null = the rows.
  const [openCategory, setOpenCategory] = useState<PhotoCategory | null>(null);
  // `search`, once the typing stops.
  const [query, setQuery] = useState(search.trim());
  const recentPhotos = useEditorStore((s) => s.recentPhotos);
  const recentItems = useMemo(() => recentPhotos.map((photo) => ({ photo })), [recentPhotos]);

  useEffect(() => {
    loadPhotoCategoriesInUse().then(setCategories, () => setCategories("failed"));
    checkIsAdmin().then(setIsAdmin);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search]);

  return (
    <div className="mt-2 flex flex-col gap-4">
      {isAdmin && (
        // A new tab, so the presentation being edited stays open.
        <a href="/admin/photos" target="_blank" className="self-start text-[13px] font-semibold text-accent hover:underline">
          Manage shared photos →
        </a>
      )}

      {openCategory && (
        <button
          type="button"
          onClick={() => setOpenCategory(null)}
          title="Back to all categories"
          className="flex items-center gap-1 self-start rounded-dropdown py-1 pr-2 text-[13px] font-semibold text-text-primary hover:bg-bg-page"
        >
          <ChevronLeftIcon size={16} />
          {openCategory.name}
        </button>
      )}

      {query || openCategory ? (
        // A new search or category starts a fresh list (the key makes React replace it).
        <SharedPhotoList key={`${openCategory?.id}|${query}`} search={query} categoryId={openCategory?.id ?? null} />
      ) : categories === null ? (
        <div className="flex justify-center py-4">
          <Spinner size={18} />
        </div>
      ) : categories === "failed" ? (
        <p className="text-xs text-text-secondary">Couldn&apos;t load the photos. Close and open this panel to try again.</p>
      ) : categories.length === 0 ? (
        <p className="text-xs text-text-secondary">No shared photos yet.</p>
      ) : (
        <>
          {recentItems.length > 0 && <PhotoRow name="Recently used" items={recentItems} />}
          {categories.map((category) => (
            <CategoryRow key={category.id} category={category} onSeeAll={() => setOpenCategory(category)} />
          ))}
        </>
      )}
    </div>
  );
}

/** One category's row: its newest photos, loaded the first time it shows. */
function CategoryRow({ category, onSeeAll }: { category: PhotoCategory; onSeeAll: () => void }) {
  const [items, setItems] = useState<RowItem[] | null | "failed">(null);

  useEffect(() => {
    // Ignores the answer if React already threw this load away (e.g. it runs effects twice while developing).
    let ignore = false;
    loadCategoryRow(category.id).then(
      (list) => {
        if (!ignore) setItems(list.map((shared) => ({ photo: shared.photo, title: photoTitle(shared) })));
      },
      () => {
        if (!ignore) setItems("failed");
      }
    );
    return () => {
      ignore = true;
    };
  }, [category.id]);

  return <PhotoRow name={category.name} items={items} onSeeAll={onSeeAll} />;
}

type RowItem = { photo: Photo; title?: string };

/** A row of photos (see ScrollRow). `items` is null while loading. */
function PhotoRow({ name, items, onSeeAll }: { name: string; items: RowItem[] | null | "failed"; onSeeAll?: () => void }) {
  const insertElement = useEditorStore((s) => s.insertElement);
  return (
    <ScrollRow name={name} onSeeAll={onSeeAll}>
      {items === null ? (
        <div className="flex h-24 flex-1 items-center justify-center">
          <Spinner size={18} />
        </div>
      ) : items === "failed" ? (
        <p className="text-xs text-text-secondary">Couldn&apos;t load these photos.</p>
      ) : (
        items.map(({ photo, title }) => (
          <PhotoTile key={photo.src} photo={photo} title={title} onAdd={() => insertElement(PHOTO_ID, photo)} inRow />
        ))
      )}
    </ScrollRow>
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
              title={photoTitle(shared)}
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
