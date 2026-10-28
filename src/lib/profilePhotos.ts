import { z } from "zod";
import { PROFILE_PHOTO_SIZE } from "./constants";
import { profilePhotoSchema } from "./schema";
import { createClient } from "./supabase/client";

// An editor's profile photo, in the browser (the account page's Profile photo box). The rules (editors only, 3 a day)
// live in the database (20261214000000_profile_photos.sql); the upload goes through /api/profile-photo.
// Kept apart from photos.tsx, which loads the editor.

const PHOTO_QUALITY = 0.85;

const savedSchema = z.object({ src: profilePhotoSchema.shape.src, leftToday: z.number().int().min(0) });

/**
 * Draws this square of the photo (`source`, from cropSource in photoCrop.ts) as a PROFILE_PHOTO_SIZE square: WebP,
 * or JPEG on white where the browser can't make WebP (Safari), like the slide photos.
 */
export async function makeProfilePhoto(bitmap: ImageBitmap, source: { x: number; y: number; size: number }): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = PROFILE_PHOTO_SIZE;
  canvas.height = PROFILE_PHOTO_SIZE;
  const context = canvas.getContext("2d")!;
  context.imageSmoothingQuality = "high";
  const draw = () =>
    context.drawImage(bitmap, source.x, source.y, source.size, source.size, 0, 0, PROFILE_PHOTO_SIZE, PROFILE_PHOTO_SIZE);
  draw();
  let blob = await toBlob(canvas, "image/webp");
  if (blob?.type !== "image/webp") {
    // JPEG has no see-through parts (they'd turn black), so the photo is drawn again on white.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, PROFILE_PHOTO_SIZE, PROFILE_PHOTO_SIZE);
    draw();
    blob = await toBlob(canvas, "image/jpeg");
  }
  if (!blob) throw new Error("This file couldn't be opened as a photo.");
  return blob;
}

/** Uploads it as the editor's profile photo. Throws an Error with a message to show if it's refused or fails. */
export async function uploadProfilePhoto(blob: Blob): Promise<{ src: string; leftToday: number }> {
  const params = new URLSearchParams({ width: String(PROFILE_PHOTO_SIZE), height: String(PROFILE_PHOTO_SIZE) });
  const response = await fetch(`/api/profile-photo?${params}`, {
    method: "POST",
    body: blob,
    headers: { "Content-Type": blob.type },
  });
  const result = await response.json().catch(() => null);
  const saved = savedSchema.safeParse(result);
  if (!response.ok || !saved.success) throw new Error(result?.error ?? "Couldn't save the photo. Please try again.");
  return saved.data;
}

/** Removes the editor's own profile photo (today's count stays). Returns null if it worked, else a message. */
export async function removeProfilePhoto(): Promise<string | null> {
  const { error } = await createClient().rpc("remove_profile_photo");
  return error ? "Couldn't remove the photo. Please try again." : null;
}

function toBlob(canvas: HTMLCanvasElement, type: string) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, PHOTO_QUALITY));
}
