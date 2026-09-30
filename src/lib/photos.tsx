import { toast } from "sonner";
import { z } from "zod";
import { Spinner } from "@/components/Spinner";
import { MAX_PHOTO_FILE_BYTES, MAX_STORED_PHOTO_BYTES, PHOTO_MAX_SIDE } from "./constants";
import {
  SHARED_PHOTO_COLUMNS,
  photoCategoryNameSchema,
  photoSchema,
  sharedPhotoBytesSchema,
  sharedPhotoInfoSchema,
  sharedPhotoSchema,
  toSharedPhoto,
  type Photo,
  type PhotoCategory,
  type SharedPhotoInfo,
  type SharedPhotoWithInfo,
} from "./schema";
import { contains } from "./search";
import { useEditorStore } from "./store";
import { createClient } from "./supabase/client";
import { PHOTO_ID } from "./svgLibrary";

// Photos teachers add to slides, from their computer or from a link. Either way the browser shrinks the
// photo and saves the copy in our own storage (see app/api/upload-image), so it never breaks later. Each
// upload is also added to the teacher's "My photos" list (the photos table), to add again without uploading.

export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PHOTO_QUALITY = 0.85;
// Used for a second try when a very detailed photo is still too big for the server at PHOTO_QUALITY.
const PHOTO_LOW_QUALITY = 0.7;
// How many photos an admin can have waiting in the upload window at once.
export const MAX_SHARED_UPLOADS = 10;
// How many photos the "My photos" list shows (the newest ones).
const MY_PHOTOS_LIMIT = 60;
// How many shared photos the Photos panel loads at a time. More load when the teacher scrolls to the bottom.
export const SHARED_PHOTOS_PER_PAGE = 60;

// A problem the teacher should read as-is (other errors get a general message).
class PhotoError extends Error {}

/** A photo shrunk in the browser, ready to upload, with what the picked file was like before. */
export type ShrunkPhoto = {
  blob: Blob;
  width: number;
  height: number;
  original: { type: string; bytes: number; width: number; height: number };
};

/** Shrinks the photo (longest side PHOTO_MAX_SIDE), uploads it (adding it to "My photos"), and returns the stored copy. */
export async function uploadPhoto(file: Blob): Promise<Photo> {
  return sendPhoto(await shrinkPhoto(file));
}

/**
 * Shrinks the photo so its longest side is at most PHOTO_MAX_SIDE, as WebP (or JPEG where the browser can't
 * make WebP, unless `webpOnly`). Throws a PhotoError if it can't be used.
 */
async function shrinkPhoto(file: Blob, webpOnly = false): Promise<ShrunkPhoto> {
  if (!PHOTO_TYPES.includes(file.type)) throw new PhotoError("Only JPG, PNG and WebP photos can be added.");
  if (file.size > MAX_PHOTO_FILE_BYTES) throw new PhotoError("This photo is too big (20 MB at most).");

  const bitmap = await createImageBitmap(file).catch(() => {
    throw new PhotoError("This file couldn't be opened as a photo.");
  });
  const original = { type: file.type, bytes: file.size, width: bitmap.width, height: bitmap.height };
  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d")!;
  // The default ("low") makes big photos look jagged when they're shrunk a lot.
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  // Safari can't make WebP (it hands back a PNG instead), so it sends a JPEG.
  let type = "image/webp";
  let shrunk = await toBlob(canvas, type, PHOTO_QUALITY);
  if (shrunk?.type !== type) {
    if (webpOnly) {
      bitmap.close();
      throw new PhotoError("This browser can't make WebP photos. Please use Chrome, Edge or Firefox on a computer.");
    }
    // JPEG has no see-through parts (they'd turn black), so the photo is drawn again on white.
    type = "image/jpeg";
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    shrunk = await toBlob(canvas, type, PHOTO_QUALITY);
  }
  if (shrunk && shrunk.size > MAX_STORED_PHOTO_BYTES) shrunk = await toBlob(canvas, type, PHOTO_LOW_QUALITY);
  bitmap.close();
  if (!shrunk) throw new PhotoError("This file couldn't be opened as a photo.");
  if (shrunk.size > MAX_STORED_PHOTO_BYTES) throw new PhotoError("This photo is too detailed to upload. Please try a smaller one.");
  return { blob: shrunk, width: canvas.width, height: canvas.height, original };
}

/**
 * Uploads a shrunk photo and returns the stored copy. With `shared` (admins only) it's shared with every teacher
 * in that category instead of added to "My photos", with its source (who owns it or where it came from) and its
 * name on the admin's computer (to show and search).
 */
async function sendPhoto(shrunk: ShrunkPhoto, shared?: { categoryId: string; source: string; name: string }): Promise<Photo> {
  const params = new URLSearchParams({ width: String(shrunk.width), height: String(shrunk.height) });
  if (shared) {
    params.set("category", shared.categoryId);
    params.set("source", shared.source);
    params.set("name", shared.name);
  }
  const response = await fetch(`/api/upload-image?${params}`, {
    method: "POST",
    body: shrunk.blob,
    headers: { "Content-Type": shrunk.blob.type },
  });
  const result = await response.json().catch(() => null);
  const photo = photoSchema.safeParse(result);
  if (!response.ok || !photo.success) throw new PhotoError(result?.error ?? "Couldn't upload the photo. Please try again.");
  return photo.data;
}

/** Gets the photo a link points to (through our server — see app/api/fetch-image), then uploads it. */
export async function uploadPhotoFromLink(url: string): Promise<Photo> {
  const response = await fetch("/api/fetch-image", {
    method: "POST",
    body: JSON.stringify({ url }),
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new PhotoError(result?.error ?? "Couldn't get a photo from this link.");
  }
  return uploadPhoto(await response.blob());
}

// Whether a teacher's photo is uploading now: teachers add one photo at a time.
let isAddingPhoto = false;

/**
 * Adds a photo to the slide once it's uploaded: where it was dropped (`target`), or else where a clicked
 * element would go. A message with the Spinner shows meanwhile, and one saying what went wrong if it fails.
 * Only one photo is added at a time. Returns the photo, or null if it wasn't added.
 */
export async function addPhotoToSlide(
  getPhoto: () => Promise<Photo>,
  target?: { slideId: string; containerId: string | null; position: { x: number; y: number } }
): Promise<Photo | null> {
  if (isAddingPhoto) {
    toast.error("Please wait until the photo that's uploading is added.");
    return null;
  }
  isAddingPhoto = true;
  const toastId = toast("Adding photo…", { icon: <Spinner size={16} />, duration: Infinity });
  try {
    const photo = await getPhoto();
    const store = useEditorStore.getState();
    if (target) store.addElement(target.slideId, PHOTO_ID, target.containerId, target.position, undefined, photo);
    else store.insertElement(PHOTO_ID, photo);
    return photo;
  } catch (error) {
    toast.error(error instanceof PhotoError ? error.message : "Couldn't add the photo. Please try again.");
    return null;
  } finally {
    isAddingPhoto = false;
    toast.dismiss(toastId);
  }
}

/** The teacher's "My photos" list, newest first. Throws if it can't be loaded. */
export async function loadMyPhotos(): Promise<Photo[]> {
  const { data, error } = await createClient()
    .from("photos")
    .select("src, width, height")
    .order("created_at", { ascending: false })
    .limit(MY_PHOTOS_LIMIT);
  if (error) throw error;
  return data;
}

/** Takes a photo off the teacher's list. Slides that use it keep it (the file stays). Throws if it fails. */
export async function removeMyPhoto(src: string) {
  const { error } = await createClient().from("photos").delete().eq("src", src);
  if (error) throw error;
}

// ─── Shared photos: uploaded by admins, for every teacher, in categories (tables shared_photos, photo_categories).

// Defined in schema.ts, so the admin page (a server page) can use them without this file's editor code.
export type { PhotoCategory, SharedPhoto, SharedPhotoWithInfo } from "./schema";

/** The categories that have at least one shared photo, by name (for the Photos panel's chips). Throws if they can't be loaded. */
export async function loadPhotoCategoriesInUse(): Promise<PhotoCategory[]> {
  const supabase = createClient();
  const [categories, counts] = await Promise.all([
    supabase.from("photo_categories").select("id, name").order("name"),
    supabase.from("shared_photo_counts").select("category_id, photos, waiting"),
  ]);
  if (categories.error) throw categories.error;
  if (counts.error) throw counts.error;
  // Photos waiting for review don't count: the panel doesn't show them (admins see every row).
  const inUse = new Set(counts.data.filter((row) => row.photos > row.waiting).map((row) => row.category_id));
  return categories.data.filter((c) => inUse.has(c.id));
}

/**
 * One page of shared photos (SHARED_PHOTOS_PER_PAGE of them, newest first), starting at photo number `from`.
 * Every word of `search` must be in the photo's name, description, tags or category name, in any case.
 * `categoryId` (if given) keeps only that category. Throws if they can't be loaded.
 */
export async function loadSharedPhotoPage(search: string, categoryId: string | null, from: number): Promise<SharedPhotoWithInfo[]> {
  // Only approved photos: the ones waiting for review are only on Admin → Photos (teachers can't read them anyway).
  let query = createClient().from("shared_photos_search").select(SHARED_PHOTO_COLUMNS).eq("approved", true);
  for (const word of search.split(/\s+/).filter(Boolean)) {
    const pattern = contains(word);
    query = query.or(`file_name.ilike.${pattern},description.ilike.${pattern},tags_text.ilike.${pattern},category_name.ilike.${pattern}`);
  }
  if (categoryId) query = query.eq("category_id", categoryId);
  // Photos added at the same time keep one order, so no photo shows twice.
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("src")
    .range(from, from + SHARED_PHOTOS_PER_PAGE - 1);
  if (error) throw error;
  return data.map(toSharedPhoto);
}

/** Whether the logged-in user is an admin (can share photos and change categories). false if unsure. */
export async function checkIsAdmin(): Promise<boolean> {
  const { data } = await createClient().rpc("is_admin");
  return data === true;
}

/** The category with this name (any case), made first if it's new. Shows what went wrong and returns null if it fails. */
export async function findOrAddCategory(name: string, categories: PhotoCategory[]): Promise<PhotoCategory | null> {
  const parsed = photoCategoryNameSchema.safeParse(name);
  if (!parsed.success) {
    toast.error(parsed.error.issues[0].message);
    return null;
  }
  const found = categories.find((c) => c.name.toLowerCase() === parsed.data.toLowerCase());
  if (found) return found;
  const { data, error } = await createClient().from("photo_categories").insert({ name: parsed.data }).select("id, name").single();
  if (error) toast.error("Couldn't add the category. Please try again.");
  return data;
}

/** Shrinks a photo an admin picked to share (it must become WebP). Returns it, or what's wrong with it. */
export async function shrinkSharedPhoto(file: File): Promise<ShrunkPhoto | string> {
  try {
    return await shrinkPhoto(file, true);
  } catch (error) {
    return error instanceof PhotoError ? error.message : "This file couldn't be opened as a photo.";
  }
}

/**
 * Uploads a shrunk photo for every teacher, in this category, with its source and file name. Shows what went
 * wrong and returns null if it fails.
 */
export async function sharePhoto(shrunk: ShrunkPhoto, name: string, categoryId: string, source: string): Promise<Photo | null> {
  try {
    return await sendPhoto(shrunk, { categoryId, source, name });
  } catch (error) {
    toast.error(error instanceof PhotoError ? error.message : "Couldn't upload the photo. Please try again.");
    return null;
  }
}

/** Renames a category. Returns an error message, or null if it worked. */
export async function renameCategory(id: string, name: string): Promise<string | null> {
  const parsed = photoCategoryNameSchema.safeParse(name);
  if (!parsed.success) return parsed.error.issues[0].message;
  const { error } = await createClient().from("photo_categories").update({ name: parsed.data }).eq("id", id);
  if (error?.code === "23505") return "A category with this name already exists.";
  return error ? "Couldn't rename the category. Please try again." : null;
}

/** Deletes a category (only an empty one: the database refuses otherwise). Throws if it fails. */
export async function deleteCategory(id: string) {
  const { error } = await createClient().from("photo_categories").delete().eq("id", id);
  if (error) throw error;
}

/** Moves a shared photo to another category. Throws if it fails, or if no photo was changed. */
export async function moveSharedPhoto(src: string, categoryId: string) {
  const category_id = sharedPhotoSchema.shape.category_id.parse(categoryId);
  // The changed row is asked back: the database rules skip a blocked change without an error.
  const { data, error } = await createClient().from("shared_photos").update({ category_id }).eq("src", src).select("src");
  if (error) throw error;
  if (data.length === 0) throw new Error("The photo wasn't moved.");
}

/**
 * Saves a file the weekly cleanup would delete (admin page "Photo cleanup"), so something uses it: a WebP one
 * becomes a shared photo in this category; a JPEG one (shared photos must be WebP) goes to the admin's own
 * "My photos". `bytes` is its file size, saved with a shared photo. Throws if it fails.
 */
export async function keepPhoto(photo: Photo, bytes: number, categoryId: string | null) {
  const supabase = createClient();
  const { error } = photo.src.endsWith(".webp")
    ? await supabase
        .from("shared_photos")
        .insert({ ...sharedPhotoSchema.parse({ ...photo, category_id: categoryId }), bytes: sharedPhotoBytesSchema.parse(bytes) })
    : await supabase.from("photos").insert(photoSchema.parse(photo));
  if (error) throw error;
}

/**
 * Deletes a photo file for good (admin page "Photo cleanup"), unless something still uses it (see
 * app/api/delete-photo). Returns an error message, or null if it worked.
 */
export async function deletePhotoFile(src: string): Promise<string | null> {
  const response = await fetch("/api/delete-photo", {
    method: "POST",
    body: JSON.stringify({ src }),
    headers: { "Content-Type": "application/json" },
  }).catch(() => null);
  if (response?.ok) return null;
  const result = await response?.json().catch(() => null);
  return result?.error ?? "Couldn't delete the photo. Please try again.";
}

/** Tags typed as one text, e.g. "Frog, rainforest,  animal" → ["frog", "rainforest", "animal"] (no repeats). */
export function parseTags(text: string): string[] {
  return [...new Set(text.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
}

/** A shared photo's saved description and tags, or null if they couldn't be read. */
export async function loadSharedPhotoInfo(src: string): Promise<Pick<SharedPhotoInfo, "description" | "tags"> | null> {
  const { data, error } = await createClient().from("shared_photos").select("description, tags").eq("src", src).single();
  return error ? null : data;
}

/** Saves a shared photo's description and/or tags. Returns an error message, or null if it worked. */
export async function saveSharedPhotoInfo(src: string, info: Partial<SharedPhotoInfo>): Promise<string | null> {
  const parsed = sharedPhotoInfoSchema.partial().safeParse(info);
  if (!parsed.success) return parsed.error.issues[0].message;
  // The changed row is asked back: the database rules skip a blocked change without an error.
  const { data, error } = await createClient().from("shared_photos").update(parsed.data).eq("src", src).select("src");
  return error || data.length === 0 ? "Couldn't save. Please try again." : null;
}

/**
 * Approves these shared photos waiting for review (Claude's uploads), so teachers see them. Only the ones the
 * admin was shown: a photo Claude adds meanwhile waits for its own check. Returns how many were approved.
 * Throws if it fails.
 */
export async function approveSharedPhotos(srcs: string[]): Promise<number> {
  const { data, error } = await createClient()
    .from("shared_photos")
    .update({ approved: true })
    .eq("approved", false)
    .in("src", z.array(photoSchema.shape.src).min(1).max(100).parse(srcs))
    // The changed rows are asked back: the database rules skip a blocked change without an error.
    .select("src");
  if (error) throw error;
  return data.length;
}

/** Takes a photo off the shared list. Slides that use it keep it (the file stays). Throws if it fails. */
export async function removeSharedPhoto(src: string) {
  const { error } = await createClient().from("shared_photos").delete().eq("src", src);
  if (error) throw error;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}
