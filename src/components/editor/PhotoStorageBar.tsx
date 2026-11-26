import { STORAGE_FULL_MESSAGE, formatStorage, isStorageFull, type PhotoStorage } from "@/lib/photoStorage";

/**
 * The Photos panel's storage bar ("My Photos" tab): how much of the teacher's 50 MB their photos use. Violet,
 * coral when full (with what to do). Only for teachers with a limit (not admins).
 */
export function PhotoStorageBar({ storage }: { storage: PhotoStorage & { limit: number } }) {
  const isFull = isStorageFull(storage);
  const percent = Math.min(100, (storage.used / storage.limit) * 100);
  return (
    <div className="flex flex-col gap-1.5" data-testid="photo-storage">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">Storage</span>
        <span className="text-xs text-text-secondary">
          {formatStorage(storage.used)} of {formatStorage(storage.limit)}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-dropdown bg-accent-soft">
        <div className={`h-full ${isFull ? "bg-danger" : "bg-accent"}`} style={{ width: `${percent}%` }} />
      </div>
      {isFull ? (
        <p className="rounded-dropdown bg-danger-soft px-3 py-2 text-xs font-semibold text-danger-strong">
          {STORAGE_FULL_MESSAGE}
        </p>
      ) : (
        <p className="text-xs text-text-secondary">Counts photos in My photos and on your slides.</p>
      )}
    </div>
  );
}
