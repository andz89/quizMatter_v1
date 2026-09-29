"use client";

import { useState } from "react";
import { toast } from "sonner";
import { deletePhotoFile, keepPhoto, type PhotoCategory } from "@/lib/photos";
import { Spinner } from "@/components/Spinner";
import { ViewToggle, useView, type View } from "../ViewToggle";
import { findCleanupFiles } from "./actions";
import { SearchIcon, Trash2Icon } from "lucide-react";

export type CleanupFile = {
  src: string;
  uploaded: string;
  size: string;
  // The same in bytes (saved with it if it's kept as a shared photo).
  bytes: number;
  // Old enough for the next run to delete it; otherwise it's deleted on `deleteOn`, a later run.
  isNextRun: boolean;
  deleteOn: string;
};

/**
 * A button that finds the files the cleanup will delete, then lists them: the next run's, then the ones still
 * too new. Each can be kept or deleted now.
 */
export function CleanupList({ categories }: { categories: PhotoCategory[] }) {
  // The last search's result; null until the button is clicked.
  const [result, setResult] = useState<{ files: CleanupFile[]; stored: string } | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  // Files kept or deleted on this page, taken off the lists.
  const [doneSrcs, setDoneSrcs] = useState<Set<string>>(new Set());
  const onDone = (src: string) => setDoneSrcs((all) => new Set(all).add(src));
  // One choice for both cards.
  const [view, setView] = useView("admin-cleanup-view");

  const handleSearch = async () => {
    setIsSearching(true);
    const found = await findCleanupFiles().catch(() => null);
    setIsSearching(false);
    if (!found) {
      toast.error("Couldn't look for unused photos. Please try again.");
      return;
    }
    setResult(found);
    setDoneSrcs(new Set());
  };

  const shown = result?.files.filter((file) => !doneSrcs.has(file.src)) ?? [];
  const nextRun = shown.filter((file) => file.isNextRun);
  const later = shown.filter((file) => !file.isNextRun);

  return (
    <>
      <div className="-mb-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSearch}
          disabled={isSearching}
          className="flex items-center gap-2 rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
        >
          {isSearching ? <Spinner size={16} /> : <SearchIcon size={16} />}
          {result ? "Search again" : "Find unused photos"}
        </button>
        {result && <span className="text-sm text-text-secondary">{result.stored}</span>}
        {result && result.files.length > 0 && (
          <div className="ml-auto">
            <ViewToggle view={view} onChange={setView} />
          </div>
        )}
      </div>
      {result && (
        <>
          <FileCard title={`Deleted on the next run (${nextRun.length})`} empty="Nothing will be deleted on the next run." files={nextRun} {...{ view, categories, onDone }} />
          <FileCard title={`Unused, deleted later (${later.length})`} empty="No new unused files." files={later} {...{ view, categories, onDone }} />
        </>
      )}
    </>
  );
}

function FileCard({
  title,
  empty,
  files,
  view,
  categories,
  onDone,
}: {
  title: string;
  empty: string;
  files: CleanupFile[];
  view: View;
  categories: PhotoCategory[];
  onDone: (src: string) => void;
}) {
  const items = files.map((file) => <FileItem key={file.src} {...{ file, view, categories }} onDone={() => onDone(file.src)} />);

  return (
    <section className="rounded-card border border-border-default bg-bg-surface px-5 py-4">
      <h2 className="mb-3 text-[15px] font-extrabold text-text-primary">{title}</h2>
      {files.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-secondary">{empty}</p>
      ) : view === "list" ? (
        <div className="overflow-hidden rounded-card border border-border-default">
          <div className={`grid ${FILE_COLUMNS} items-center gap-4 border-b border-border-default px-4 py-3 text-[11px] font-bold tracking-[0.05em] text-text-header uppercase`}>
            <span>Photo</span>
            <span className="hidden sm:block">Uploaded</span>
            <span className="hidden sm:block">File size</span>
            <span className="hidden sm:block">Deleted on</span>
            <span className="text-right">Keep or delete</span>
          </div>
          {items}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{items}</div>
      )}
    </section>
  );
}

// Photo, uploaded, file size, deleted on, keep. On phones: photo, then the rest in one cell.
const FILE_COLUMNS = "grid-cols-[48px_minmax(0,1fr)] sm:grid-cols-[48px_100px_80px_100px_minmax(0,1fr)]";

/**
 * One unused file, as a table row (List) or a tile (Grid). Keep saves it: a WebP one becomes a shared photo
 * in the chosen category; a JPEG one (shared photos must be WebP) goes to your own "My photos". Delete deletes
 * the file now, unless a slide or photo list has started using it since the page loaded.
 */
function FileItem({ file, view, categories, onDone }: { file: CleanupFile; view: View; categories: PhotoCategory[]; onDone: () => void }) {
  const isWebp = file.src.endsWith(".webp");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [isKeeping, setIsKeeping] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm("Delete this photo forever? This can't be undone.")) return;
    setIsDeleting(true);
    const error = await deletePhotoFile(file.src);
    if (error) {
      toast.error(error);
      setIsDeleting(false);
      return;
    }
    toast.success("Photo deleted.");
    onDone();
  };

  const handleKeep = async () => {
    setIsKeeping(true);
    try {
      // The photo's size in px, read from the file itself.
      const image = new Image();
      image.src = file.src;
      await image.decode();
      await keepPhoto({ src: file.src, width: image.naturalWidth, height: image.naturalHeight }, file.bytes, isWebp ? categoryId : null);
      toast.success(isWebp ? `Kept in shared photos (${categories.find((c) => c.id === categoryId)?.name}).` : "Kept in your My photos.");
      onDone();
    } catch {
      toast.error("Couldn't keep the photo. Please try again.");
      setIsKeeping(false);
    }
  };

  const picture = (
    <div className={`overflow-hidden rounded-dropdown border border-border-default bg-bg-page ${view === "list" ? "h-12 w-12" : "aspect-square"}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- already shrunk when it was uploaded; nothing for next/image to do. */}
      <img src={file.src} alt="" loading="lazy" className="h-full w-full object-cover" />
    </div>
  );
  const keepControls = (
    <div className={`flex gap-1.5 ${view === "list" ? "items-center sm:justify-end" : "flex-col"}`}>
      {isWebp && (
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          disabled={categories.length === 0}
          aria-label="Category to keep it in"
          className="min-w-0 rounded-input border border-border-default bg-bg-surface px-2 py-1.5 text-[13px] text-text-primary outline-none focus:border-text-secondary"
        >
          {categories.length === 0 && <option value="">Add a category first</option>}
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        onClick={handleKeep}
        disabled={isKeeping || isDeleting || (isWebp && !categoryId)}
        title={isWebp ? "Add it to shared photos, so the cleanup keeps it" : "Add it to your My photos, so the cleanup keeps it"}
        className="flex shrink-0 items-center justify-center gap-2 rounded-button bg-accent btn-press px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
      >
        {isKeeping && <Spinner size={14} />}
        {isWebp ? "Keep" : "Keep in My photos"}
      </button>
      <button
        type="button"
        onClick={handleDelete}
        disabled={isKeeping || isDeleting}
        title="Delete the file now (only if nothing uses it)"
        className="flex shrink-0 items-center justify-center gap-2 rounded-button border border-danger px-3 py-1.5 text-sm font-semibold text-danger-strong transition-colors hover:bg-danger-soft disabled:opacity-40"
      >
        {isDeleting ? <Spinner size={14} /> : <Trash2Icon size={14} />}
        Delete
      </button>
    </div>
  );

  if (view === "list") {
    return (
      <div className={`grid min-h-13 ${FILE_COLUMNS} items-center gap-4 border-b border-border-default px-4 py-2 last:border-b-0`}>
        {picture}
        <div className="flex min-w-0 flex-col gap-1.5 sm:contents">
          {/* On phones the other columns are hidden, so their facts go here. */}
          <p className="text-[13px] text-text-secondary sm:hidden">
            Uploaded {file.uploaded} · {file.size} · Deleted {file.deleteOn}
          </p>
          <span className="hidden text-sm text-text-primary sm:block">{file.uploaded}</span>
          <span className="hidden text-sm text-text-secondary sm:block">{file.size}</span>
          <span className="hidden text-sm text-text-primary sm:block">{file.deleteOn}</span>
          {keepControls}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      {picture}
      <p className="text-[13px] text-text-secondary">
        Uploaded {file.uploaded} · {file.size}
        {!file.isNextRun && (
          <>
            <br />
            Deleted {file.deleteOn}
          </>
        )}
      </p>
      {keepControls}
    </div>
  );
}
