"use client";

import { useState } from "react";
import { toast } from "sonner";
import { keepPhoto, type PhotoCategory } from "@/lib/photos";
import { Spinner } from "@/components/Spinner";
import { ViewToggle, useView, type View } from "../ViewToggle";

export type CleanupFile = {
  src: string;
  uploaded: string;
  size: string;
  // Old enough for the next run to delete it; otherwise it's deleted on `deleteOn`, a later run.
  isNextRun: boolean;
  deleteOn: string;
};

/** The files the cleanup will delete: the next run's, then the ones still too new. Each can be kept. */
export function CleanupList({ files, categories }: { files: CleanupFile[]; categories: PhotoCategory[] }) {
  // Files kept on this page, taken off the lists.
  const [keptSrcs, setKeptSrcs] = useState<Set<string>>(new Set());
  const shown = files.filter((file) => !keptSrcs.has(file.src));
  const onKept = (src: string) => setKeptSrcs((all) => new Set(all).add(src));

  const nextRun = shown.filter((file) => file.isNextRun);
  const later = shown.filter((file) => !file.isNextRun);
  // One choice for both cards.
  const [view, setView] = useView("admin-cleanup-view");

  return (
    <>
      {files.length > 0 && (
        <div className="-mb-2 flex justify-end">
          <ViewToggle view={view} onChange={setView} />
        </div>
      )}
      <FileCard title={`Deleted on the next run (${nextRun.length})`} empty="Nothing will be deleted on the next run." files={nextRun} {...{ view, categories, onKept }} />
      <FileCard title={`Unused, deleted later (${later.length})`} empty="No new unused files." files={later} {...{ view, categories, onKept }} />
    </>
  );
}

function FileCard({
  title,
  empty,
  files,
  view,
  categories,
  onKept,
}: {
  title: string;
  empty: string;
  files: CleanupFile[];
  view: View;
  categories: PhotoCategory[];
  onKept: (src: string) => void;
}) {
  const items = files.map((file) => <FileItem key={file.src} {...{ file, view, categories }} onKept={() => onKept(file.src)} />);

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
            <span className="text-right">Keep</span>
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
 * in the chosen category; a JPEG one (shared photos must be WebP) goes to your own "My photos".
 */
function FileItem({ file, view, categories, onKept }: { file: CleanupFile; view: View; categories: PhotoCategory[]; onKept: () => void }) {
  const isWebp = file.src.endsWith(".webp");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [isKeeping, setIsKeeping] = useState(false);

  const handleKeep = async () => {
    setIsKeeping(true);
    try {
      // The photo's size in px, read from the file itself.
      const image = new Image();
      image.src = file.src;
      await image.decode();
      await keepPhoto({ src: file.src, width: image.naturalWidth, height: image.naturalHeight }, isWebp ? categoryId : null);
      toast.success(isWebp ? `Kept in shared photos (${categories.find((c) => c.id === categoryId)?.name}).` : "Kept in your My photos.");
      onKept();
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
        disabled={isKeeping || (isWebp && !categoryId)}
        title={isWebp ? "Add it to shared photos, so the cleanup keeps it" : "Add it to your My photos, so the cleanup keeps it"}
        className="flex shrink-0 items-center justify-center gap-2 rounded-button bg-accent btn-press px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
      >
        {isKeeping && <Spinner size={14} />}
        {isWebp ? "Keep" : "Keep in My photos"}
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
