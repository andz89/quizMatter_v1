"use client";

import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  PHOTO_TYPES,
  deleteCategory,
  findOrAddCategory,
  matchesSearch,
  moveSharedPhoto,
  parseTags,
  removeSharedPhoto,
  renameCategory,
  saveSharedPhotoInfo,
  sharePhoto,
  type PhotoCategory,
  type SharedPhoto,
  type SharedPhotoWithInfo,
} from "@/lib/photos";
import { SHARED_PHOTO_TAG_MAX, sharedPhotoInfoSchema, type SharedPhotoInfo } from "@/lib/schema";
import { Modal } from "@/components/Modal";
import { Spinner } from "@/components/Spinner";
import { ViewToggle, useView, type View } from "./ViewToggle";
import { ImageIcon, SearchIcon, XIcon } from "lucide-react";

const byName = (a: PhotoCategory, b: PhotoCategory) => a.name.localeCompare(b.name);

const INPUT_CLASS =
  "rounded-input border border-border-default bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-secondary focus:border-text-secondary";

/**
 * Admin → Photos: every shared photo (filter by category, move one to another category, describe it for
 * Claude, or take it off the list), with buttons that open the Upload photos and Categories modals.
 */
export function AdminPhotos({ initialPhotos, initialCategories }: { initialPhotos: SharedPhotoWithInfo[]; initialCategories: PhotoCategory[] }) {
  // Newest first.
  const [photos, setPhotos] = useState(initialPhotos);
  const [categories, setCategories] = useState(initialCategories);
  const [openModal, setOpenModal] = useState<"upload" | "categories" | null>(null);

  const photoCount = (categoryId: string) => photos.filter((p) => p.categoryId === categoryId).length;

  const addCategory = (category: PhotoCategory) =>
    setCategories((all) => (all.some((c) => c.id === category.id) ? all : [...all, category].sort(byName)));

  const updateInfo = (src: string, info: Partial<SharedPhotoInfo>) =>
    setPhotos((all) => all.map((p) => (p.photo.src === src ? { ...p, ...info } : p)));

  // A new upload goes to the top (or moves there, in its new category, keeping its name and words, if it was
  // already shared: the server only sets the name and source the first time). The upload's tags are added to the
  // ones it has.
  const handleShared = async (shared: SharedPhoto, fileName: string, upload: { tags: string[]; source: string }) => {
    const before = photos.find((p) => p.photo.src === shared.photo.src);
    const info = {
      file_name: before?.file_name || fileName.trim().slice(0, 200),
      description: before?.description ?? "",
      tags: before?.tags ?? [],
      source: before?.source || upload.source,
    };
    setPhotos((all) => [{ ...shared, ...info }, ...all.filter((p) => p.photo.src !== shared.photo.src)]);
    const tags = [...new Set([...info.tags, ...upload.tags])].slice(0, SHARED_PHOTO_TAG_MAX);
    if (tags.length === info.tags.length) return;
    const error = await saveSharedPhotoInfo(shared.photo.src, { tags });
    if (error) toast.error("A photo was uploaded, but its tags couldn't be saved. Add them in the photo list.");
    else updateInfo(shared.photo.src, { tags });
  };

  const closeModal = () => setOpenModal(null);

  return (
    <>
      <PhotosCard
        photos={photos}
        categories={categories}
        photoCount={photoCount}
        setPhotos={setPhotos}
        onInfoSaved={updateInfo}
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
 * Pick or type a category (and, if you like, tags for all these photos), then drop photos (or click to pick
 * them). Each shows the Spinner while it uploads; the modal can't close until they're done. It stays open
 * afterwards, so another batch can follow.
 */
function UploadModal({
  categories,
  onCategoryAdded,
  onShared,
  onClose,
}: {
  categories: PhotoCategory[];
  onCategoryAdded: (category: PhotoCategory) => void;
  onShared: (shared: SharedPhoto, fileName: string, upload: { tags: string[]; source: string }) => Promise<void>;
  onClose: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [categoryName, setCategoryName] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  // The photos still uploading, as previews (object URLs of the picked files).
  const [uploading, setUploading] = useState<{ id: number; url: string }[]>([]);
  const nextId = useRef(0);

  const handleFiles = async (fileList: FileList | null) => {
    const files = [...(fileList ?? [])];
    // Cleared so picking the same file again still counts as a change.
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (files.length === 0) return;
    // The tags and source (required) are checked before anything is uploaded.
    const upload = sharedPhotoInfoSchema.pick({ tags: true, source: true }).safeParse({ tags: parseTags(tagsText), source: sourceText });
    if (!upload.success) return toast.error(upload.error.issues[0].message);
    // The category is found (or made) once, then every photo goes into it.
    const category = await findOrAddCategory(categoryName, categories);
    if (!category) return;
    onCategoryAdded(category);
    // Each photo that fails shows its own error (see sharePhoto); the ones that worked are counted here.
    const results = await Promise.all(
      files.map(async (file) => {
        const item = { id: nextId.current++, url: URL.createObjectURL(file) };
        setUploading((all) => [...all, item]);
        const photo = await sharePhoto(file, category.id, upload.data.source);
        if (photo) await onShared({ photo, categoryId: category.id }, file.name, upload.data);
        setUploading((all) => all.filter((u) => u.id !== item.id));
        URL.revokeObjectURL(item.url);
        return photo;
      })
    );
    const uploaded = results.filter(Boolean).length;
    if (uploaded > 0) toast.success(`${uploaded} ${uploaded === 1 ? "photo" : "photos"} uploaded to ${category.name}.`);
  };

  return (
    <Modal title="Upload photos" onClose={onClose} isBusy={uploading.length > 0}>
      <div className="flex flex-col gap-3">
        <input
          value={categoryName}
          onChange={(e) => setCategoryName(e.target.value)}
          list="shared-photo-categories"
          placeholder="Category: pick one or type a new one, e.g. Animals"
          maxLength={40}
          aria-label="Category"
          className={`${INPUT_CLASS} w-full`}
        />
        <datalist id="shared-photo-categories">
          {categories.map((c) => (
            <option key={c.id} value={c.name} />
          ))}
        </datalist>
        <input
          value={tagsText}
          onChange={(e) => setTagsText(e.target.value)}
          placeholder="Tags for all these photos (optional), e.g. frog, rainforest, animal"
          aria-label="Tags for all these photos"
          className={`${INPUT_CLASS} w-full`}
        />
        <input
          value={sourceText}
          onChange={(e) => setSourceText(e.target.value)}
          placeholder="Source / credit for all these photos (required), e.g. Photo by Juan Cruz, Pexels"
          maxLength={300}
          aria-label="Source or credit for all these photos"
          className={`${INPUT_CLASS} w-full`}
        />
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
          className={`flex flex-col items-center justify-center gap-2 rounded-card border border-dashed px-5 py-12 text-sm transition-colors ${
            isDraggingOver ? "border-accent bg-bg-page" : "border-border-default hover:bg-bg-page"
          }`}
        >
          <span className="text-text-primary">
            <ImageIcon size={16} />
          </span>
          <span className="font-semibold text-text-primary">Drop photos here, or click to pick them</span>
          <span className="text-text-secondary">JPG, PNG or WebP. Several at once is fine.</span>
        </button>
        {uploading.length > 0 && (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
            {uploading.map((u) => (
              <div key={u.id} className="relative aspect-square overflow-hidden rounded-dropdown border border-border-default">
                {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the picked file. */}
                <img src={u.url} alt="" className="h-full w-full object-cover opacity-50" />
                <span className="absolute inset-0 flex items-center justify-center">
                  <Spinner size={20} />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
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
const MISSING_FILTERS: Record<string, { name: string; isMissing: (p: SharedPhotoWithInfo) => boolean }> = {
  "no-description": { name: "No description", isMissing: (p) => !p.description },
  "no-source": { name: "No source", isMissing: (p) => !p.source },
};

/**
 * Every shared photo, with buttons to filter by category (or the ones missing a description or source). Each one
 * can be renamed, move to another category, get a description, tags and source, or come off the list.
 */
function PhotosCard({
  photos,
  categories,
  photoCount,
  setPhotos,
  onInfoSaved,
  buttons,
}: {
  photos: SharedPhotoWithInfo[];
  categories: PhotoCategory[];
  photoCount: (categoryId: string) => number;
  setPhotos: (update: (all: SharedPhotoWithInfo[]) => SharedPhotoWithInfo[]) => void;
  onInfoSaved: (src: string, info: Partial<SharedPhotoInfo>) => void;
  // Upload photos and Categories, next to the List / Grid switch.
  buttons: ReactNode;
}) {
  // The chosen filter button: a category id, a MISSING_FILTERS key, or null = all.
  const [filterId, setFilterId] = useState<string | null>(null);
  // The photos whose new category is being saved (they show the Spinner).
  const [movingSrcs, setMovingSrcs] = useState<Set<string>>(new Set());
  const [view, setView] = useView("admin-photos-view");
  const [search, setSearch] = useState("");

  const chips = [
    { id: null, name: "All", count: photos.length },
    ...categories.map((c) => ({ ...c, count: photoCount(c.id) })),
    ...Object.entries(MISSING_FILTERS).map(([id, { name, isMissing }]) => ({ id, name, count: photos.filter(isMissing).length })),
  ].filter((c) => c.count > 0);
  // A button that's gone (e.g. its last photo moved or removed) counts as "All".
  const shownId = chips.some((c) => c.id === filterId) ? filterId : null;
  const missing = shownId ? MISSING_FILTERS[shownId] : undefined;
  const inFilter = missing ? photos.filter(missing.isMissing) : shownId ? photos.filter((p) => p.categoryId === shownId) : photos;
  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? "";
  // Admins can also search the source, e.g. "pexels" (teachers can't: it says who made a photo, not what it shows).
  const shown = inFilter.filter((p) => matchesSearch(p, search, `${categoryName(p.categoryId)} ${p.source}`));

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
    } catch {
      setPhotos((all) => [shared, ...all]);
      toast.error("Couldn't remove the photo. Please try again.");
    }
  };

  const items = shown.map((shared) => (
    <SharedPhotoItem
      key={shared.photo.src}
      view={view}
      shared={shared}
      categories={categories}
      isMoving={movingSrcs.has(shared.photo.src)}
      onMove={(categoryId) => handleMove(shared, categoryId)}
      onRemove={() => handleRemove(shared)}
      onInfoSaved={(info) => onInfoSaved(shared.photo.src, info)}
    />
  ));

  return (
    <Card
      title={`Shared photos (${photos.length})`}
      action={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {photos.length > 0 && <ViewToggle view={view} onChange={setView} />}
          {buttons}
        </div>
      }
    >
      {photos.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-secondary">No shared photos yet. Click &ldquo;+ Upload photos&rdquo; to add some.</p>
      ) : (
        <>
          <p className="mb-3 text-[13px] text-text-secondary">
            Teachers and Claude find photos by their file name, description and tags, so say what each one shows. Type, then press
            Enter or click away to save.
          </p>
          <label className="relative mb-3 block w-full sm:max-w-sm">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-primary">
              <SearchIcon size={16} />
            </span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, description, tags, category or source"
              aria-label="Search photos"
              className="w-full rounded-input border border-border-default bg-bg-surface py-2 pr-3 pl-9 text-sm text-text-primary outline-none placeholder:text-text-secondary focus:border-text-secondary"
            />
          </label>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <button
                key={c.id ?? "all"}
                type="button"
                aria-pressed={shownId === c.id}
                onClick={() => setFilterId(c.id)}
                className={`rounded-dropdown px-2.5 py-1 text-[13px] font-semibold transition-colors ${
                  shownId === c.id
                    ? "bg-accent text-white"
                    : c.id && c.id in MISSING_FILTERS
                      ? "bg-highlight text-text-primary hover:opacity-90"
                      : "bg-bg-page text-text-primary hover:bg-border-default"
                }`}
              >
                {c.name} <span className="font-normal opacity-70">({c.count})</span>
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className="rounded-card border border-border-default py-8 text-center text-sm text-text-secondary">
              No photos match &ldquo;{search.trim()}&rdquo;.
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
                <span />
              </div>
              {items}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{items}</div>
          )}
        </>
      )}
    </Card>
  );
}

// Photo, file name, category, description, tags, source, remove. On phones: photo, then the five fields stacked, then remove.
const PHOTO_COLUMNS =
  "grid-cols-[48px_minmax(0,1fr)_32px] sm:grid-cols-[48px_minmax(0,2fr)_130px_minmax(0,3fr)_minmax(0,2fr)_minmax(0,2fr)_32px]";

/**
 * One shared photo, as a table row (List) or a tile (Grid): its picture, its file name, a category dropdown to
 * move it, its description and tags, and ✕ to remove it.
 */
function SharedPhotoItem({
  view,
  shared,
  categories,
  isMoving,
  onMove,
  onRemove,
  onInfoSaved,
}: {
  view: View;
  shared: SharedPhotoWithInfo;
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
        <div className="flex min-w-0 flex-col gap-1.5 sm:contents">{fields}</div>
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
