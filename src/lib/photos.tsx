import { toast } from "sonner";
import { Spinner } from "@/components/Spinner";
import { MAX_PHOTO_FILE_BYTES, PHOTO_MAX_SIDE } from "./constants";
import { photoSchema, type Photo } from "./schema";
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

// A problem the teacher should read as-is (other errors get a general message).
class PhotoError extends Error {}

/** Shrinks the photo (longest side PHOTO_MAX_SIDE), uploads it (adding it to "My photos"), and returns the stored copy. */
export async function uploadPhoto(file: Blob): Promise<Photo> {
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
  if (shrunk?.type !== "image/webp") shrunk = await toBlob(canvas, "image/jpeg");
  if (!shrunk) throw new PhotoError("This file couldn't be opened as a photo.");

  const size = new URLSearchParams({ width: String(canvas.width), height: String(canvas.height) });
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

function toBlob(canvas: HTMLCanvasElement, type: string) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, PHOTO_QUALITY));
}
