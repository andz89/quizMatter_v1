import { toast } from "sonner";
import { Spinner } from "@/components/Spinner";
import { MAX_PHOTO_FILE_BYTES, PHOTO_MAX_SIDE } from "./constants";
import {
  SHARED_PHOTO_COLUMNS,
  photoCategoryNameSchema,
  photoSchema,
  sharedPhotoInfoSchema,
  sharedPhotoSchema,
  toSharedPhoto,
  type Photo,
  type PhotoCategory,
  type SharedPhotoInfo,
  type SharedPhotoWithInfo,
} from "./schema";
import { useEditorStore } from "./store";
import { createClient } from "./supabase/client";
import { PHOTO_ID } from "./svgLibrary";

// Photos teachers add to slides, from their computer or from a link. Either way the browser shrinks the
// photo and saves the copy in our own storage (see app/api/upload-image), so it never breaks later. Each
// upload is also added to the teacher's "My photos" list (the photos table), to add again without uploading.

export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PHOTO_QUALITY = 0.85;
// How many photos the "My photos" list shows (the newest ones).
const MY_PHOTOS_LIMIT = 60;
// How many shared photos are loaded (the newest ones). All at once, so switching category is instant.
const SHARED_PHOTOS_LIMIT = 500;

// A problem the teacher should read as-is (other errors get a general message).
class PhotoError extends Error {}

/**
 * Shrinks the photo (longest side PHOTO_MAX_SIDE), uploads it (adding it to "My photos"), and returns the stored copy.
 * With `shared` (admins only) it's shared with every teacher in that category instead, with that source (who
 * owns it or where it came from), and must be WebP.
 */
export async function uploadPhoto(file: Blob, shared?: { categoryId: string; source: string }): Promise<Photo> {
  if (!PHOTO_TYPES.includes(file.type)) throw new PhotoError("Only JPG, PNG and WebP photos can be added.");
  if (file.size > MAX_PHOTO_FILE_BYTES) throw new PhotoError("This photo is too big (20 MB at most).");

  const bitmap = await createImageBitmap(file).catch(() => {
    throw new PhotoError("This file couldn't be opened as a photo.");
  });
  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  // Safari can't make WebP (it hands back a PNG instead), so it sends a JPEG.
  let shrunk = await toBlob(canvas, "image/webp");
  if (shrunk?.type !== "image/webp") {
    if (shared) throw new PhotoError("This browser can't make WebP photos. Please use Chrome, Edge or Firefox.");
    shrunk = await toBlob(canvas, "image/jpeg");
  }
  if (!shrunk) throw new PhotoError("This file couldn't be opened as a photo.");

  const size = new URLSearchParams({ width: String(canvas.width), height: String(canvas.height) });
  if (shared) {
    size.set("category", shared.categoryId);
    size.set("source", shared.source);
    // A shared photo keeps the name it had on the admin's computer (to show and search).
    if (file instanceof File) size.set("name", file.name);
  }
  const response = await fetch(`/api/upload-image?${size}`, { method: "POST", body: shrunk, headers: { "Content-Type": shrunk.type } });
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

/**
 * Adds a photo to the slide once it's uploaded: where it was dropped (`target`), or else where a clicked
 * element would go. A message with the Spinner shows meanwhile, and one saying what went wrong if it fails.
 * Returns the photo, or null if it wasn't added.
 */
export async function addPhotoToSlide(
  getPhoto: () => Promise<Photo>,
  target?: { slideId: string; containerId: string | null; position: { x: number; y: number } }
): Promise<Photo | null> {
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

/** Every shared photo (newest first, with its name and words, for searching) and every category, by name. Throws if they can't be loaded. */
export async function loadSharedPhotos(): Promise<{ photos: SharedPhotoWithInfo[]; categories: PhotoCategory[] }> {
  const supabase = createClient();
  const [photos, categories] = await Promise.all([
    supabase
      .from("shared_photos")
      .select(SHARED_PHOTO_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(SHARED_PHOTOS_LIMIT),
    supabase.from("photo_categories").select("id, name").order("name"),
  ]);
  if (photos.error) throw photos.error;
  if (categories.error) throw categories.error;
  return { photos: photos.data.map(toSharedPhoto), categories: categories.data };
}

/**
 * Whether a shared photo matches what was typed in a search box: every word must be in its name, description,
 * tags, or `alsoIn` (e.g. its category name), in any case.
 */
export function matchesSearch(shared: SharedPhotoWithInfo, search: string, alsoIn: string): boolean {
  const text = `${shared.file_name} ${shared.description} ${shared.tags.join(" ")} ${alsoIn}`.toLowerCase();
  return search
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word));
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

/** Uploads a photo for every teacher, in this category, with its source. Shows what went wrong and returns null if it fails. */
export async function sharePhoto(file: Blob, categoryId: string, source: string): Promise<Photo | null> {
  try {
    return await uploadPhoto(file, { categoryId, source });
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
 * "My photos". Throws if it fails.
 */
export async function keepPhoto(photo: Photo, categoryId: string | null) {
  const supabase = createClient();
  const { error } = photo.src.endsWith(".webp")
    ? await supabase.from("shared_photos").insert(sharedPhotoSchema.parse({ ...photo, category_id: categoryId }))
    : await supabase.from("photos").insert(photoSchema.parse(photo));
  if (error) throw error;
}

/** Tags typed as one text, e.g. "Frog, rainforest,  animal" → ["frog", "rainforest", "animal"] (no repeats). */
export function parseTags(text: string): string[] {
  return [...new Set(text.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
}

/** Saves a shared photo's description and/or tags. Returns an error message, or null if it worked. */
export async function saveSharedPhotoInfo(src: string, info: Partial<SharedPhotoInfo>): Promise<string | null> {
  const parsed = sharedPhotoInfoSchema.partial().safeParse(info);
  if (!parsed.success) return parsed.error.issues[0].message;
  // The changed row is asked back: the database rules skip a blocked change without an error.
  const { data, error } = await createClient().from("shared_photos").update(parsed.data).eq("src", src).select("src");
  return error || data.length === 0 ? "Couldn't save. Please try again." : null;
}

/** Takes a photo off the shared list. Slides that use it keep it (the file stays). Throws if it fails. */
export async function removeSharedPhoto(src: string) {
  const { error } = await createClient().from("shared_photos").delete().eq("src", src);
  if (error) throw error;
}

function toBlob(canvas: HTMLCanvasElement, type: string) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, PHOTO_QUALITY));
}
