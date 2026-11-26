// Photo storage: each teacher may keep 50 MB (an editor 500 MB) of photos they uploaded and still use (in "My photos" or on their
// own slides). The database counts and refuses (supabase/migrations/20261231002600_photo_storage.sql); this file
// holds the app's side: the limit, the words and how sizes are shown. No imports, so tests load it.

/** 50 MB. Same number as the database's photo_storage_limit(target): change both together. */
export const PHOTO_STORAGE_LIMIT_BYTES = 50 * 1024 * 1024;

/** An editor's limit, 500 MB. Same number as the database's photo_storage_limit(target): change both together. */
export const EDITOR_PHOTO_STORAGE_LIMIT_BYTES = 500 * 1024 * 1024;

/** How much a teacher uses and their own limit (50 MB, 500 MB for an editor). `limit` is null for an admin. */
export type PhotoStorage = { used: number; limit: number | null };

/**
 * The words when an upload would pass the limit (QMSTO), with the teacher's own limit. Without it (the upload route
 * couldn't read it) the number is left out.
 */
export function storageFullMessage(limit: number | null): string {
  const size = limit === null ? "" : ` (${formatStorage(limit)})`;
  return `Your photo storage is full${size}. To free space, remove photos from My photos and from your slides.`;
}

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

/**
 * Full (at or past the limit), or with `addBytes`: a photo that big wouldn't fit (the database's rule in
 * photo_upload_fits: used + size <= limit fits).
 */
export function isStorageFull(storage: PhotoStorage, addBytes = 0): boolean {
  if (storage.limit === null) return false;
  return addBytes > 0 ? storage.used + addBytes > storage.limit : storage.used >= storage.limit;
}

/** One of my own presentations whose slides still have the photo (from remove_my_photo). */
type StillUsedIn = { title: string; is_shared_copy: boolean; slides: number[]; hidden: number[] };

/**
 * The "This photo is still on your slides" box's words: where it is, then why removing it from My photos frees
 * nothing. `unsavedHere`: the open presentation has it but its saved copy isn't in `uses` (not saved yet).
 */
export function stillUsedMessage(uses: StillUsedIn[], bytes: number | null, unsavedHere: boolean): string {
  const lines = uses.map((use) => {
    // A hidden slide is easy to miss in the slide grid, so it says so.
    const numbers = use.slides.map((n) => (use.hidden.includes(n) ? `${n} (hidden)` : String(n)));
    const where = `${use.slides.length === 1 ? "slide" : "slides"} ${numbers.join(", ")}`;
    const title = use.title || "Untitled presentation";
    return use.is_shared_copy
      ? `• ${title}, published version (${where}): open it and click Update shared presentation to take it out there too`
      : `• ${title} (${where})`;
  });
  if (unsavedHere) lines.push("• This presentation (not saved yet)");
  const size = bytes === null ? "" : ` (${formatStorage(bytes)})`;
  return (
    `It's used in:\n${lines.join("\n")}\n\n` +
    `Removing it from My photos won't free storage. It still counts${size} until it's gone from these slides too.`
  );
}
