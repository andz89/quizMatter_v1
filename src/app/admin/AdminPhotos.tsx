"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  MAX_SHARED_UPLOADS,
  PHOTO_TYPES,
  deleteCategory,
  findOrAddCategory,
  loadSharedPhotoInfo,
  moveSharedPhoto,
  parseTags,
  removeSharedPhoto,
  renameCategory,
  saveSharedPhotoInfo,
  sharePhoto,
  shrinkSharedPhoto,
  type PhotoCategory,
  type SharedPhoto,
  type SharedPhotoWithInfo,
  type ShrunkPhoto,
} from "@/lib/photos";
import { SHARED_PHOTO_TAG_MAX, photoCategoryNameSchema, sharedPhotoInfoSchema, type SharedPhotoInfo } from "@/lib/schema";
import { Modal } from "@/components/Modal";
import { LinkPending } from "@/components/LinkPending";
import { SearchField, SearchForm, SearchSelect, SearchTextInput } from "@/components/SearchForm";
import { Spinner } from "@/components/Spinner";
import { WITHIN } from "@/lib/search";
import { formatBytes, joinParts } from "@/lib/format";
import { DEFAULT_PHOTO_SEARCH, MISSING, PHOTO_SORTS, PHOTOS_PER_PAGE, photoSearchHref, type PhotoSearch } from "./photoSearch";
import { ViewToggle, useView, type View } from "./ViewToggle";
import { ChevronLeftIcon, ChevronRightIcon, ImageIcon, XIcon } from "lucide-react";

const byName = (a: PhotoCategory, b: PhotoCategory) => a.name.localeCompare(b.name);

const INPUT_CLASS =
  "rounded-input border border-border-default bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-secondary focus:border-text-secondary";

// For the filter buttons: how many shared photos there are, in each category, and missing a description or source.
export type PhotoCounts = { total: number; byCategory: Record<string, number>; noDescription: number; noSource: number };

/**
 * Admin → Photos: one page of the shared photos the search found (page.tsx asks the database), with buttons that
 * open the Upload photos and Categories modals.
 */
export function AdminPhotos({
  photos: serverPhotos,
  fileSizes,
  categories: serverCategories,
  counts,
  matchCount,
  search,
}: {
  photos: SharedPhotoWithInfo[];
  // Each photo's file size in bytes, by its address.
  fileSizes: Record<string, number>;
  categories: PhotoCategory[];
  counts: PhotoCounts;
  // How many photos the search found, on all pages.
  matchCount: number;
  search: PhotoSearch;
}) {
  const router = useRouter();
  // A change shows here at once, then the page asks the server again (router.refresh) so the pages and counts
  // stay right. Whatever the server sends replaces these.
  const [photos, setPhotos] = useState(serverPhotos);
  const [categories, setCategories] = useState(serverCategories);
  const [fromServer, setFromServer] = useState({ serverPhotos, serverCategories });
  if (fromServer.serverPhotos !== serverPhotos || fromServer.serverCategories !== serverCategories) {
    setFromServer({ serverPhotos, serverCategories });
    setPhotos(serverPhotos);
    setCategories(serverCategories);
  }
  const [openModal, setOpenModal] = useState<"upload" | "categories" | null>(null);

  const photoCount = (categoryId: string) => counts.byCategory[categoryId] ?? 0;

  const addCategory = (category: PhotoCategory) =>
    setCategories((all) => (all.some((c) => c.id === category.id) ? all : [...all, category].sort(byName)));

  const updateInfo = (src: string, info: Partial<SharedPhotoInfo>) =>
    setPhotos((all) => all.map((p) => (p.photo.src === src ? { ...p, ...info } : p)));

  // A new upload may have been shared before (and not be on this page), so what it already has is read from the
  // database: the server keeps its old name and source, its description is only filled if it had none, and the
  // new tags are added to its own. Then the list is asked for again, so the new photo shows.
  const handleShared = async (shared: SharedPhoto, upload: SharedPhotoInfo) => {
    if (upload.description || upload.tags.length > 0) {
      const saved = await loadSharedPhotoInfo(shared.photo.src);
      const change: Partial<SharedPhotoInfo> = {};
      if (saved && !saved.description && upload.description) change.description = upload.description;
      const tags = [...new Set([...(saved?.tags ?? []), ...upload.tags])].slice(0, SHARED_PHOTO_TAG_MAX);
      if (saved && tags.length > saved.tags.length) change.tags = tags;
      const error = !saved || (Object.keys(change).length > 0 && (await saveSharedPhotoInfo(shared.photo.src, change)));
      if (error) toast.error("A photo was uploaded, but its description or tags couldn't be saved. Add them in the photo list.");
    }
    router.refresh();
  };

  const closeModal = () => setOpenModal(null);

  return (
    <>
      <PhotosCard
        photos={photos}
        fileSizes={fileSizes}
        categories={categories}
        counts={counts}
        matchCount={matchCount}
        search={search}
        setPhotos={setPhotos}
        onInfoSaved={updateInfo}
        onChanged={() => router.refresh()}
        buttons={
          <>
            <button
              type="button"
              onClick={() => setOpenModal("categories")}
              className="rounded-button border border-border-default px-3.5 py-1.5 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-page"
            >
              Categories
            </button>
            <button
              type="button"
              onClick={() => setOpenModal("upload")}
              className="rounded-button bg-accent btn-press px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover"
            >
              + Upload photos
            </button>
          </>
        }
      />
      {openModal === "upload" && (
        <UploadModal categories={categories} onCategoryAdded={addCategory} onShared={handleShared} onClose={closeModal} />
      )}
      {openModal === "categories" && (
        <CategoriesModal
          categories={categories}
          photoCount={photoCount}
          onCategoryAdded={addCategory}
          onCategoryRenamed={(id, name) => setCategories((all) => all.map((c) => (c.id === id ? { id, name } : c)).sort(byName))}
          onCategoryDeleted={(id) => setCategories((all) => all.filter((c) => c.id !== id))}
          onClose={closeModal}
        />
      )}
    </>
  );
}

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-card border border-border-default bg-bg-surface px-5 py-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-[15px] font-extrabold text-text-primary">{title}</h2>
        <span className="ml-auto">{action}</span>
      </div>
      {children}
    </section>
  );
}

/**
 * Drop photos (or click to pick them). Each is shrunk right away and shown as a card with its type, size and
 * file size before and after, and its own file name, category, tags, description and source (a new card starts
 * with the category, tags and source of the one above). The Upload button checks each card and sends the good
 * ones. Uploaded cards leave (so the list empties when all worked; the others stay, with what went wrong); the
 * modal can't close while uploading.
 */
function UploadModal({
  categories,
  onCategoryAdded,
  onShared,
  onClose,
}: {
  categories: PhotoCategory[];
  onCategoryAdded: (category: PhotoCategory) => void;
  onShared: (shared: SharedPhoto, info: SharedPhotoInfo) => Promise<void>;
  onClose: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const nextId = useRef(0);

  const updateRow = (id: number, change: Partial<UploadRow>) =>
    setRows((all) => all.map((row) => (row.id === id ? { ...row, ...change } : row)));

  // A changed detail clears the problem shown for it.
  const updateDetails = (row: UploadRow, change: Partial<UploadDetails>) =>
    updateRow(row.id, { details: { ...row.details, ...change }, error: row.status === "unusable" ? row.error : undefined });

  const removeRow = (row: UploadRow) => {
    URL.revokeObjectURL(row.previewUrl);
    setRows((all) => all.filter((r) => r.id !== row.id));
  };

  const handleFiles = async (fileList: FileList | null) => {
    const picked = [...(fileList ?? [])];
    // Cleared so picking the same file again still counts as a change.
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (picked.length === 0 || isUploading) return;
    const files = picked.slice(0, Math.max(0, MAX_SHARED_UPLOADS - rows.length));
    if (picked.length > files.length) {
      toast.error(`You can upload ${MAX_SHARED_UPLOADS} photos at a time.${files.length > 0 ? ` Only the first ${files.length} were added.` : ""}`);
    }
    // New cards start with the category, tags and source of the last card, so a batch is typed once.
    const last = rows.at(-1)?.details;
    const added: UploadRow[] = files.map((file) => ({
      id: nextId.current++,
      file,
      previewUrl: URL.createObjectURL(file),
      status: "shrinking",
      details: { file_name: file.name, category: last?.category ?? "", tags: last?.tags ?? "", description: "", source: last?.source ?? "" },
    }));
    setRows((all) => [...all, ...added]);
    // One after another: a photo needs a lot of memory while it's shrunk.
    for (const row of added) {
      const result = await shrinkSharedPhoto(row.file);
      updateRow(row.id, typeof result === "string" ? { status: "unusable", error: result } : { status: "ready", shrunk: result });
    }
  };

  // The ones ready to go, and the ones that failed before (to try again).
  const toUpload = rows.flatMap((row) =>
    row.shrunk && (row.status === "ready" || row.status === "failed") ? [{ ...row, shrunk: row.shrunk }] : []
  );
  const isShrinking = rows.some((row) => row.status === "shrinking");

  const handleUpload = async () => {
    if (toUpload.length === 0 || isUploading) return;
    // Each card is checked first; one with a problem shows it and stays, the others go.
    const checked = toUpload.flatMap((row) => {
      const category = photoCategoryNameSchema.safeParse(row.details.category);
      const info = sharedPhotoInfoSchema.safeParse({ ...row.details, tags: parseTags(row.details.tags) });
      const problem = !category.success ? category.error.issues[0].message : !info.success ? info.error.issues[0].message : null;
      if (problem) updateRow(row.id, { status: "failed", error: problem });
      return category.success && info.success ? [{ row, categoryName: category.data, info: info.data }] : [];
    });
    if (checked.length === 0) return;
    setIsUploading(true);
    // Each category is found (or made) once, one after another, so two cards with the same new name make one.
    const known = [...categories];
    const categoryByName = new Map<string, PhotoCategory | null>();
    for (const { categoryName } of checked) {
      const key = categoryName.toLowerCase();
      if (categoryByName.has(key)) continue;
      const category = await findOrAddCategory(categoryName, known);
      categoryByName.set(key, category);
      if (category) {
        known.push(category);
        onCategoryAdded(category);
      }
    }
    // Each photo that fails shows its own error (see sharePhoto); the ones that worked are counted here.
    const results = await Promise.all(
      checked.map(async ({ row, categoryName, info }) => {
        const category = categoryByName.get(categoryName.toLowerCase());
        if (!category) {
          updateRow(row.id, { status: "failed", error: "Couldn't add the category. Please try again." });
          return null;
        }
        updateRow(row.id, { status: "uploading", error: undefined });
        const photo = await sharePhoto(row.shrunk, info.file_name, category.id, info.source);
        if (photo) await onShared({ photo, categoryId: category.id }, info);
        // An uploaded photo leaves the list (it's in the photo list now); a failed one stays to try again.
        if (photo) removeRow(row);
        else updateRow(row.id, { status: "failed" });
        return photo;
      })
    );
    setIsUploading(false);
    const uploaded = results.filter(Boolean).length;
    if (uploaded > 0) toast.success(`${uploaded} ${uploaded === 1 ? "photo" : "photos"} uploaded.`);
  };

  const close = () => {
    rows.forEach((row) => URL.revokeObjectURL(row.previewUrl));
    onClose();
  };

  const shrunk = rows.flatMap((row) => (row.shrunk ? [row.shrunk] : []));
  const totalBefore = shrunk.reduce((sum, s) => sum + s.original.bytes, 0);
  const totalAfter = shrunk.reduce((sum, s) => sum + s.blob.size, 0);

  return (
    <Modal title="Upload photos" onClose={close} isBusy={isUploading}>
      <div className="flex flex-col gap-3">
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
          disabled={isUploading}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDraggingOver(true);
          }}
          onDragLeave={() => setIsDraggingOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDraggingOver(false);
            handleFiles(e.dataTransfer.files);
          }}
          className={`flex flex-col items-center justify-center gap-2 rounded-card border border-dashed px-5 text-sm transition-colors disabled:opacity-40 ${
            rows.length > 0 ? "py-5" : "py-10"
          } ${isDraggingOver ? "border-accent bg-bg-page" : "border-border-default hover:bg-bg-page"}`}
        >
          <span className="text-text-primary">
            <ImageIcon size={16} />
          </span>
          <span className="font-semibold text-text-primary">Drop photos here, or click to pick them</span>
          <span className="text-text-secondary">
            JPG, PNG or WebP. Up to {MAX_SHARED_UPLOADS} at a time. You&apos;ll see each photo&apos;s size before uploading.
          </span>
        </button>
        <datalist id="shared-photo-categories">
          {categories.map((c) => (
            <option key={c.id} value={c.name} />
          ))}
        </datalist>
        {rows.map((row) => (
          <UploadCard
            key={row.id}
            row={row}
            isUploading={isUploading}
            onChange={(change) => updateDetails(row, change)}
            onRemove={() => removeRow(row)}
          />
        ))}
        {rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-xs font-semibold text-text-primary">
              {shrunk.length > 1 && (
                <>
                  All {shrunk.length} photos: {formatBytes(totalBefore)} → {formatBytes(totalAfter)}
                  <SavedPill before={totalBefore} after={totalAfter} />
                </>
              )}
            </span>
            <button
              type="button"
              onClick={handleUpload}
              disabled={toUpload.length === 0 || isShrinking || isUploading}
              className="flex items-center justify-center gap-2 rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
            >
              {(isShrinking || isUploading) && <Spinner size={14} />}
              {isShrinking
                ? "Shrinking photos…"
                : isUploading
                  ? "Uploading…"
                  : `Upload ${toUpload.length} ${toUpload.length === 1 ? "photo" : "photos"}`}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

// What an admin types for one photo before uploading it (tags as one text, e.g. "frog, animal").
type UploadDetails = { file_name: string; category: string; tags: string; description: string; source: string };

// A photo in the upload list: shrinking → ready (or unusable, with why) → uploading → gone (or failed, with why).
type UploadRow = {
  id: number;
  file: File;
  previewUrl: string;
  status: "shrinking" | "unusable" | "ready" | "uploading" | "failed";
  details: UploadDetails;
  shrunk?: ShrunkPhoto;
  error?: string;
};

/**
 * One photo in the upload list: its picture, file name and ✕, its type and size before → after, what's
 * happening to it, and its category, tags, description and source.
 */
function UploadCard({
  row,
  isUploading,
  onChange,
  onRemove,
}: {
  row: UploadRow;
  isUploading: boolean;
  onChange: (change: Partial<UploadDetails>) => void;
  onRemove: () => void;
}) {
  const { shrunk, details } = row;
  const status = row.error ? (
    <span className="text-danger-strong">{row.error}</span>
  ) : (
    {
      shrinking: <span className="text-text-secondary">Shrinking…</span>,
      unusable: null,
      ready: <span className="text-text-secondary">Ready to upload</span>,
      uploading: (
        <span className="flex items-center gap-1.5 text-text-secondary">
          <Spinner size={12} /> Uploading…
        </span>
      ),
      failed: <span className="text-danger-strong">Failed. Press Upload to try again.</span>,
    }[row.status]
  );
  // The width and height before are known once the photo is opened to shrink it.
  const before = shrunk?.original ?? { type: row.file.type, bytes: row.file.size, width: 0, height: 0 };
  const isLocked = isUploading || row.status === "uploading";
  const field = (key: keyof UploadDetails, label: string, placeholder: string, maxLength?: number) => (
    <input
      value={details[key]}
      onChange={(e) => onChange({ [key]: e.target.value })}
      disabled={isLocked}
      list={key === "category" ? "shared-photo-categories" : undefined}
      placeholder={placeholder}
      maxLength={maxLength}
      aria-label={label}
      className={`${INPUT_CLASS} w-full min-w-0 disabled:opacity-60`}
    />
  );

  return (
    <div className="flex gap-3 rounded-card border border-border-default px-4 py-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the picked file. */}
      <img src={row.previewUrl} alt="" className="h-16 w-16 shrink-0 rounded-dropdown border border-border-default object-cover" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          {field("file_name", "File name", "File name, e.g. red-eyed-tree-frog.jpg", 200)}
          <button
            type="button"
            onClick={onRemove}
            disabled={isLocked}
            aria-label={`Take ${row.file.name} out`}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-primary transition-colors hover:bg-bg-page disabled:opacity-40"
          >
            <XIcon size={12} />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="text-text-secondary">{photoFacts(before.type, before.bytes, before.width, before.height)}</span>
          {row.status === "shrinking" && <Spinner size={12} />}
          {shrunk && (
            <>
              <span className="text-text-secondary">→</span>
              <span className="font-semibold text-text-primary">
                {photoFacts(shrunk.blob.type, shrunk.blob.size, shrunk.width, shrunk.height)}
              </span>
              <SavedPill before={shrunk.original.bytes} after={shrunk.blob.size} />
            </>
          )}
        </div>
        {status && <div className="text-xs">{status}</div>}
        {row.status !== "unusable" && (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              {field("category", "Category", "Category: pick or type a new one", 40)}
              {field("tags", "Tags", "Tags (optional), e.g. frog, animal")}
            </div>
            {field("description", "Description", "Description (optional): what does it show?", 300)}
            {field("source", "Source or credit", "Source / credit (required), e.g. Photo by Juan Cruz, Pexels", 300)}
          </>
        )}
      </div>
    </div>
  );
}

/** e.g. "PNG · 5.8 MB · 4032×3024" (the width × height once known). */
function photoFacts(type: string, bytes: number, width: number, height: number) {
  return joinParts([typeName(type), formatBytes(bytes), width > 0 && `${width}×${height}`]);
}

/** How much smaller the photo got, e.g. "−93%" in Mint (or "+12%" in grey if it got bigger). */
function SavedPill({ before, after }: { before: number; after: number }) {
  const change = Math.round((after / before - 1) * 100);
  return (
    <span
      className={`inline-block rounded-dropdown px-1.5 py-0.5 text-[11px] font-bold ${
        change < 0 ? "bg-success-soft text-success-strong" : "bg-bg-page text-text-secondary"
      }`}
    >
      {change < 0 ? `−${-change}%` : `+${change}%`}
    </span>
  );
}

/** e.g. "image/jpeg" → "JPG". */
function typeName(type: string) {
  return type === "image/jpeg" ? "JPG" : type.replace("image/", "").toUpperCase();
}

/** Every category with its photo count, to rename or delete (only an empty one), and a box to add one. */
function CategoriesModal({
  categories,
  photoCount,
  onCategoryAdded,
  onCategoryRenamed,
  onCategoryDeleted,
  onClose,
}: {
  categories: PhotoCategory[];
  photoCount: (categoryId: string) => number;
  onCategoryAdded: (category: PhotoCategory) => void;
  onCategoryRenamed: (id: string, name: string) => void;
  onCategoryDeleted: (id: string) => void;
  onClose: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const handleAdd = async () => {
    setIsAdding(true);
    const category = await findOrAddCategory(newName, categories);
    setIsAdding(false);
    if (!category) return;
    onCategoryAdded(category);
    setNewName("");
    toast.success(`Category "${category.name}" is ready.`);
  };

  return (
    <Modal title="Categories" onClose={onClose}>
      <div className="overflow-hidden rounded-card border border-border-default">
        <div className="grid grid-cols-[minmax(0,1fr)_64px_36px] items-center gap-4 border-b border-border-default px-4 py-3 text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">
          <span>Name</span>
          <span>Photos</span>
          <span />
        </div>
        {categories.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-text-secondary">No categories yet. Add one below, or type one when you upload.</p>
        ) : (
          categories.map((c) => (
            <CategoryRow
              key={c.id}
              category={c}
              photoCount={photoCount(c.id)}
              onRenamed={(name) => onCategoryRenamed(c.id, name)}
              onDeleted={() => onCategoryDeleted(c.id)}
            />
          ))
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleAdd();
        }}
        className="mt-3 flex gap-2"
      >
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New category name"
          maxLength={40}
          aria-label="New category name"
          className={`${INPUT_CLASS} min-w-0 flex-1 sm:max-w-xs`}
        />
        <button
          type="submit"
          disabled={!newName.trim() || isAdding}
          className="flex items-center gap-2 rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
        >
          {isAdding && <Spinner size={14} />}+ Add category
        </button>
      </form>
    </Modal>
  );
}

/** One category to rename (type, then Enter or click away) or delete (only when it has no photos). */
function CategoryRow({
  category,
  photoCount,
  onRenamed,
  onDeleted,
}: {
  category: PhotoCategory;
  photoCount: number;
  onRenamed: (name: string) => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(category.name);
  const [isBusy, setIsBusy] = useState(false);

  const handleRename = async () => {
    if (name.trim() === category.name) return;
    setIsBusy(true);
    const error = await renameCategory(category.id, name);
    setIsBusy(false);
    if (error) {
      toast.error(error);
      setName(category.name);
    } else {
      onRenamed(name.trim());
      toast.success(`Renamed to "${name.trim()}".`);
    }
  };

  const handleDelete = async () => {
    setIsBusy(true);
    try {
      await deleteCategory(category.id);
      onDeleted();
      toast.success(`Category "${category.name}" deleted.`);
    } catch {
      toast.error("Couldn't delete the category. Please try again.");
      setIsBusy(false);
    }
  };

  return (
    <div className="grid min-h-13 grid-cols-[minmax(0,1fr)_64px_36px] items-center gap-4 border-b border-border-default px-4 py-2 last:border-b-0">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={handleRename}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        maxLength={40}
        aria-label="Category name"
        className="min-w-0 rounded-input border border-transparent bg-transparent px-2 py-1.5 text-sm text-text-primary outline-none hover:border-border-default focus:border-text-secondary"
      />
      <span className="text-sm text-text-secondary">{photoCount}</span>
      <button
        type="button"
        onClick={handleDelete}
        disabled={photoCount > 0 || isBusy}
        title={photoCount > 0 ? "Move or remove its photos first" : "Delete category"}
        aria-label={`Delete ${category.name}`}
        className="flex h-8 w-8 items-center justify-center rounded-dropdown text-text-primary transition-colors hover:bg-bg-page disabled:opacity-30 disabled:hover:bg-transparent"
      >
        {isBusy ? <Spinner size={14} /> : <XIcon size={14} />}
      </button>
    </div>
  );
}

// Filter buttons (orange) for photos still missing something: no description yet, or no source (required, but
// photos shared before it was added have none).
/**
 * One page of the shared photos the search found, with the search box, buttons to filter by category (or the
 * ones missing a description or source), and Previous / Next. Each one can be renamed, move to another
 * category, get a description, tags and source, or come off the list.
 */
function PhotosCard({
  photos,
  fileSizes,
  categories,
  counts,
  matchCount,
  search,
  setPhotos,
  onInfoSaved,
  onChanged,
  buttons,
}: {
  photos: SharedPhotoWithInfo[];
  fileSizes: Record<string, number>;
  categories: PhotoCategory[];
  counts: PhotoCounts;
  matchCount: number;
  search: PhotoSearch;
  setPhotos: (update: (all: SharedPhotoWithInfo[]) => SharedPhotoWithInfo[]) => void;
  onInfoSaved: (src: string, info: Partial<SharedPhotoInfo>) => void;
  // After a move or remove: asks the server for the page again.
  onChanged: () => void;
  // Upload photos and Categories, next to the List / Grid switch.
  buttons: ReactNode;
}) {
  // The photos whose new category is being saved (they show the Spinner).
  const [movingSrcs, setMovingSrcs] = useState<Set<string>>(new Set());
  const [view, setView] = useView("admin-photos-view");

  const pageCount = Math.max(1, Math.ceil(matchCount / PHOTOS_PER_PAGE));
  // A link to this search with some options changed, back on page 1 unless it says otherwise.
  const hrefWith = (change: Partial<PhotoSearch>) => photoSearchHref({ ...search, page: 1, ...change });
  const isSearching = hrefWith({ sort: DEFAULT_PHOTO_SEARCH.sort }) !== "/admin";

  // Quick filters: each sets the search's Category or Missing option, and keeps the rest of the search.
  const chips: { key: string; name: string; count: number; isOn: boolean; change: Partial<PhotoSearch>; isMissing?: boolean }[] = [
    { key: "all", name: "All", count: counts.total, isOn: !search.category && search.missing === "any", change: { category: "", missing: "any" } },
    ...categories.map((c) => ({
      key: c.id,
      name: c.name,
      count: counts.byCategory[c.id] ?? 0,
      isOn: search.category === c.id,
      change: { category: c.id, missing: "any" } as const,
    })),
    {
      key: "no-description",
      name: "No description",
      count: counts.noDescription,
      isOn: !search.category && search.missing === "description",
      change: { category: "", missing: "description" },
      isMissing: true,
    },
    {
      key: "no-source",
      name: "No source",
      count: counts.noSource,
      isOn: !search.category && search.missing === "source",
      change: { category: "", missing: "source" },
      isMissing: true,
    },
  ];

  // Both change the list at once, and put it back if saving fails.
  const handleMove = async (shared: SharedPhotoWithInfo, categoryId: string) => {
    const moved = (id: string) => (all: SharedPhotoWithInfo[]) =>
      all.map((p) => (p.photo.src === shared.photo.src ? { ...p, categoryId: id } : p));
    const src = shared.photo.src;
    setPhotos(moved(categoryId));
    setMovingSrcs((all) => new Set(all).add(src));
    try {
      await moveSharedPhoto(src, categoryId);
      toast.success(`Photo moved to ${categories.find((c) => c.id === categoryId)?.name}.`);
      onChanged();
    } catch {
      setPhotos(moved(shared.categoryId));
      toast.error("Couldn't move the photo. Please try again.");
    }
    setMovingSrcs((all) => {
      const next = new Set(all);
      next.delete(src);
      return next;
    });
  };

  const handleRemove = async (shared: SharedPhotoWithInfo) => {
    setPhotos((all) => all.filter((p) => p.photo.src !== shared.photo.src));
    try {
      await removeSharedPhoto(shared.photo.src);
      toast.success("Photo removed from shared photos.");
      onChanged();
    } catch {
      setPhotos((all) => [shared, ...all]);
      toast.error("Couldn't remove the photo. Please try again.");
    }
  };

  const items = photos.map((shared) => (
    <SharedPhotoItem
      key={shared.photo.src}
      view={view}
      shared={shared}
      bytes={fileSizes[shared.photo.src]}
      categories={categories}
      isMoving={movingSrcs.has(shared.photo.src)}
      onMove={(categoryId) => handleMove(shared, categoryId)}
      onRemove={() => handleRemove(shared)}
      onInfoSaved={(info) => onInfoSaved(shared.photo.src, info)}
    />
  ));

  return (
    <Card
      title={`Shared photos (${counts.total})`}
      action={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {counts.total > 0 && <ViewToggle view={view} onChange={setView} />}
          {buttons}
        </div>
      }
    >
      {counts.total === 0 ? (
        <p className="py-6 text-center text-sm text-text-secondary">No shared photos yet. Click &ldquo;+ Upload photos&rdquo; to add some.</p>
      ) : (
        <>
          <p className="mb-3 text-[13px] text-text-secondary">
            Teachers and Claude find photos by their file name, description and tags, so say what each one shows. Type, then press
            Enter or click away to save.
          </p>
          {/* Keyed by the search, so Back (or Clear search) puts the right text back in the box. */}
          <PhotoSearchForm key={hrefWith({})} search={search} categories={categories} />
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            {chips
              .filter((c) => c.count > 0 || c.isOn)
              .map((c) => (
                <Link
                  key={c.key}
                  href={hrefWith(c.change)}
                  scroll={false}
                  aria-current={c.isOn ? "true" : undefined}
                  className={`rounded-dropdown px-2.5 py-1 text-[13px] font-semibold transition-colors ${
                    c.isOn
                      ? "bg-accent text-white"
                      : c.isMissing
                        ? "bg-highlight text-text-primary hover:opacity-90"
                        : "bg-bg-page text-text-primary hover:bg-border-default"
                  }`}
                >
                  {c.name} <span className="font-normal opacity-70">({c.count})</span>
                  <LinkPending />
                </Link>
              ))}
            {isSearching && (
              <Link
                href="/admin"
                scroll={false}
                className="ml-auto flex items-center gap-2 rounded-dropdown px-2.5 py-1 text-[13px] font-semibold text-text-secondary hover:text-text-primary"
              >
                <XIcon size={14} />
                Clear search ({matchCount} found)
                <LinkPending />
              </Link>
            )}
          </div>
          {photos.length === 0 ? (
            <p className="rounded-card border border-border-default py-8 text-center text-sm text-text-secondary">
              No photos match your search.
            </p>
          ) : view === "list" ? (
            <div className="overflow-hidden rounded-card border border-border-default">
              <div className={`grid ${PHOTO_COLUMNS} items-center gap-4 border-b border-border-default px-4 py-3 text-[11px] font-bold tracking-[0.05em] text-text-header uppercase`}>
                <span>Photo</span>
                <span className="sm:hidden">Details</span>
                <span className="hidden sm:block">File name</span>
                <span className="hidden sm:block">Category</span>
                <span className="hidden sm:block">Description</span>
                <span className="hidden sm:block">Tags</span>
                <span className="hidden sm:block">Source / credit</span>
                <span className="hidden sm:block">Size</span>
                <span />
              </div>
              {items}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{items}</div>
          )}
          {pageCount > 1 && (
            <div className="mt-4 flex items-center justify-center gap-3">
              <PageLink href={search.page > 1 ? hrefWith({ page: search.page - 1 }) : null}>
                <ChevronLeftIcon size={16} />
                Previous
              </PageLink>
              <span className="text-sm text-text-secondary">
                Page {search.page} of {pageCount}
              </span>
              <PageLink href={search.page < pageCount ? hrefWith({ page: search.page + 1 }) : null}>
                Next
                <ChevronRightIcon size={16} />
              </PageLink>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/** Previous or Next: a link to that page, or faded out (href null) when there's no page that way. */
function PageLink({ href, children }: { href: string | null; children: ReactNode }) {
  const className =
    "flex items-center gap-1.5 rounded-button border border-border-default px-3.5 py-1.5 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-page";
  if (!href) {
    return (
      <span aria-disabled="true" className={`${className} pointer-events-none opacity-40`}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
      <LinkPending />
    </Link>
  );
}

/**
 * The photo search box and its options. Enter or Search puts the search in the page link, and the server looks it
 * up in the database (page.tsx), starting again at page 1.
 */
function PhotoSearchForm({ search, categories }: { search: PhotoSearch; categories: PhotoCategory[] }) {
  const router = useRouter();
  const [values, setValues] = useState(search);
  const [isPending, startTransition] = useTransition();
  const set = (change: Partial<PhotoSearch>) => setValues({ ...values, ...change });

  return (
    <SearchForm
      query={values.q}
      onQueryChange={(q) => set({ q })}
      placeholder="Search photos"
      hasOptions={photoSearchHref({ ...values, q: "", page: 1 }) !== "/admin"}
      isPending={isPending}
      // The top line and spinner show at once, and stay until the server sends the results.
      onSearch={() => startTransition(() => router.push(photoSearchHref({ ...values, page: 1 }), { scroll: false }))}
      onClear={() => setValues(DEFAULT_PHOTO_SEARCH)}
      className="mb-3 sm:max-w-xl"
    >
      <SearchField label="Includes the words">
        <SearchTextInput value={values.q} onChange={(q) => set({ q })} />
      </SearchField>
      <SearchField label="File name">
        <SearchTextInput value={values.name} onChange={(name) => set({ name })} />
      </SearchField>
      <SearchField label="Description">
        <SearchTextInput value={values.description} onChange={(description) => set({ description })} />
      </SearchField>
      <SearchField label="Tags">
        <SearchTextInput value={values.tags} onChange={(tags) => set({ tags })} />
      </SearchField>
      <SearchField label="Source / credit">
        <SearchTextInput value={values.source} onChange={(source) => set({ source })} />
      </SearchField>
      <SearchField label="Doesn't have">
        <SearchTextInput value={values.not} onChange={(not) => set({ not })} />
      </SearchField>
      <SearchField label="Category">
        <SearchSelect
          value={values.category}
          options={[{ id: "", label: "Any category" }, ...categories.map((c) => ({ id: c.id, label: c.name }))]}
          onChange={(category) => set({ category })}
        />
      </SearchField>
      <SearchField label="Missing">
        <SearchSelect value={values.missing} options={MISSING} onChange={(missing) => set({ missing })} />
      </SearchField>
      <SearchField label="Added within">
        <SearchSelect value={values.within} options={WITHIN} onChange={(within) => set({ within })} />
      </SearchField>
      <SearchField label="Sort by">
        <SearchSelect value={values.sort} options={PHOTO_SORTS} onChange={(sort) => set({ sort })} />
      </SearchField>
    </SearchForm>
  );
}

// Photo, file name, category, description, tags, source, size, remove. On phones: photo, then the rest stacked, then remove.
const PHOTO_COLUMNS =
  "grid-cols-[48px_minmax(0,1fr)_32px] sm:grid-cols-[48px_minmax(0,2fr)_130px_minmax(0,3fr)_minmax(0,2fr)_minmax(0,2fr)_80px_32px]";

/**
 * One shared photo, as a table row (List) or a tile (Grid): its picture, its file name, a category dropdown to
 * move it, its description, tags and source, its file size and width × height, and ✕ to remove it.
 */
function SharedPhotoItem({
  view,
  shared,
  bytes,
  categories,
  isMoving,
  onMove,
  onRemove,
  onInfoSaved,
}: {
  view: View;
  shared: SharedPhotoWithInfo;
  // Unknown if its file wasn't found.
  bytes: number | undefined;
  categories: PhotoCategory[];
  isMoving: boolean;
  onMove: (categoryId: string) => void;
  onRemove: () => void;
  onInfoSaved: (info: Partial<SharedPhotoInfo>) => void;
}) {
  const picture = (
    <div className={`relative overflow-hidden rounded-dropdown border border-border-default bg-bg-page ${view === "list" ? "h-12 w-12" : "aspect-square"}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- already shrunk when it was uploaded; nothing for next/image to do. */}
      <img src={shared.photo.src} alt={shared.description} loading="lazy" className="h-full w-full object-cover" />
      {isMoving && (
        <span className="absolute inset-0 flex items-center justify-center bg-bg-surface/60">
          <Spinner size={view === "list" ? 16 : 20} />
        </span>
      )}
    </div>
  );
  const fields = (
    <>
      {/* Keyed by the saved words, so each box shows them again when they change elsewhere (e.g. upload tags). */}
      <InfoField key={`f:${shared.file_name}`} src={shared.photo.src} field="file_name" saved={shared.file_name} onSaved={onInfoSaved} />
      <select
        value={shared.categoryId}
        onChange={(e) => onMove(e.target.value)}
        disabled={isMoving}
        aria-label="Category"
        className="min-w-0 rounded-input border border-border-default bg-bg-surface px-2 py-1.5 text-[13px] text-text-primary outline-none focus:border-text-secondary"
      >
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <InfoField key={`d:${shared.description}`} src={shared.photo.src} field="description" saved={shared.description} onSaved={onInfoSaved} />
      <InfoField key={`t:${shared.tags.join()}`} src={shared.photo.src} field="tags" saved={shared.tags.join(", ")} onSaved={onInfoSaved} />
      <InfoField key={`s:${shared.source}`} src={shared.photo.src} field="source" saved={shared.source} onSaved={onInfoSaved} />
    </>
  );
  const dimensions = `${shared.photo.width}×${shared.photo.height}`;
  const size = bytes === undefined ? undefined : formatBytes(bytes);
  const removeButton = (className: string) => (
    <button
      type="button"
      onClick={onRemove}
      title="Remove from shared photos (slides keep it)"
      aria-label="Remove from shared photos"
      className={`flex h-7 w-7 items-center justify-center rounded-full text-text-primary ${className}`}
    >
      <XIcon size={12} />
    </button>
  );

  if (view === "list") {
    return (
      <div className={`grid min-h-13 ${PHOTO_COLUMNS} items-center gap-4 border-b border-border-default px-4 py-2 last:border-b-0`}>
        {picture}
        <div className="flex min-w-0 flex-col gap-1.5 sm:contents">
          {fields}
          <div className="flex gap-1.5 text-xs sm:flex-col sm:gap-0">
            <span className="font-semibold text-text-primary">{size ?? "—"}</span>
            <span className="text-text-secondary">{dimensions}</span>
          </div>
        </div>
        {removeButton("transition-colors hover:bg-bg-page")}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        {picture}
        {removeButton("absolute top-1.5 right-1.5 border border-border-default bg-bg-surface")}
      </div>
      {fields}
      <p className="text-xs text-text-secondary">{joinParts([size, dimensions])}</p>
    </div>
  );
}

// The words an admin can change on a shared photo. Tags are typed comma-separated.
const INFO_FIELDS = {
  file_name: { label: "File name", placeholder: "e.g. red-eyed-tree-frog.jpg", maxLength: 200, savedMessage: "File name saved." },
  description: { label: "Description", placeholder: "What does it show?", maxLength: 300, savedMessage: "Description saved." },
  tags: { label: "Tags", placeholder: "Tags, e.g. frog, animal", maxLength: undefined, savedMessage: "Tags saved." },
  source: {
    label: "Source / credit",
    placeholder: "Who owns it or where it came from, e.g. Photo by Juan Cruz, Pexels",
    maxLength: 300,
    savedMessage: "Source saved.",
  },
};

/**
 * A shared photo's file name, description, tags or source: saved when you press Enter or click away. A source
 * that's a link gets a ↗ button to open it.
 */
function InfoField({
  src,
  field,
  saved,
  onSaved,
}: {
  src: string;
  field: keyof typeof INFO_FIELDS;
  saved: string;
  onSaved: (info: Partial<SharedPhotoInfo>) => void;
}) {
  const [text, setText] = useState(saved);
  const [isSaving, setIsSaving] = useState(false);
  const { label, placeholder, maxLength, savedMessage } = INFO_FIELDS[field];
  const link = field === "source" && /^https?:\/\/\S+$/.test(saved) ? saved : null;

  const handleSave = async () => {
    if (text.trim() === saved) return;
    const info = field === "tags" ? { tags: parseTags(text) } : { [field]: text.trim() };
    setIsSaving(true);
    const error = await saveSharedPhotoInfo(src, info);
    setIsSaving(false);
    if (error) {
      toast.error(error);
      setText(saved);
    } else {
      onSaved(info);
      toast.success(savedMessage);
    }
  };

  return (
    <div className="relative flex min-w-0 items-center gap-1">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={handleSave}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        disabled={isSaving}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-label={label}
        title={text || undefined}
        className="w-full min-w-0 rounded-input border border-border-default bg-bg-surface py-1.5 pr-7 pl-2 text-[13px] text-text-primary outline-none placeholder:text-text-secondary focus:border-text-secondary disabled:opacity-60"
      />
      {isSaving && (
        <span className={`absolute top-1/2 flex -translate-y-1/2 ${link ? "right-10" : "right-2"}`}>
          <Spinner size={12} />
        </span>
      )}
      {link && (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          title="Open the source"
          aria-label="Open the source"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-dropdown text-[13px] text-text-primary transition-colors hover:bg-bg-page"
        >
          ↗
        </a>
      )}
    </div>
  );
}
