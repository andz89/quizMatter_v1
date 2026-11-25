// Photo storage: each teacher may keep 50 MB of photos they uploaded and still use (in "My photos" or on their
// own slides). The database counts and refuses (supabase/migrations/20261231002600_photo_storage.sql); this file
// holds the app's side: the limit, the words and how sizes are shown. No imports, so tests load it.

/** 50 MB. Same number as the database's photo_storage_limit(): change both together. */
export const PHOTO_STORAGE_LIMIT_BYTES = 50 * 1024 * 1024;

/** How much a teacher uses. `limit` is null for an admin (no limit). */
export type PhotoStorage = { used: number; limit: number | null };

/** The upload route's words when an upload would pass the limit (QMSTO). */
export const STORAGE_FULL_MESSAGE =
  "Your photo storage is full (50 MB). To free space, remove photos from My photos and from your slides.";

/** After removing a photo from "My photos" that's still on slides. */
export const STILL_COUNTS_TOAST =
  "Removed from My photos. It still counts toward your storage until you remove it from your slides.";

const MB = 1024 * 1024;

/**
 * "1.8 MB" under 10 MB, "45 MB" from 10 MB. Always rounded down, so "50 MB of 50 MB" shows only when it's really
 * full.
 */
export function formatStorage(bytes: number): string {
  const mb = bytes / MB;
  if (mb < 10) return `${Math.floor(mb * 10) / 10} MB`;
  return `${Math.floor(mb)} MB`;
}

export function isStorageFull(storage: PhotoStorage): boolean {
  return storage.limit !== null && storage.used >= storage.limit;
}
