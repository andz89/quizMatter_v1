import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { R2Bucket } from "@cloudflare/workers-types";

// Saving photo files to the R2 bucket, for /api/upload-image (teachers and admins) and /api/claude-photo (Claude).
// Server-only.

declare global {
  interface CloudflareEnv {
    PHOTOS_BUCKET: R2Bucket;
  }
}

export type PhotoType = { contentType: string; extension: "webp" | "jpg" };

/** WebP or JPEG (Safari can't make WebP, so it sends JPEG), from the file's first bytes. null = neither. */
export function readPhotoType(body: ArrayBuffer): PhotoType | null {
  const start = new Uint8Array(body, 0, Math.min(12, body.byteLength));
  const text = (from: number, to: number) => String.fromCharCode(...start.subarray(from, to));
  if (text(0, 4) === "RIFF" && text(8, 12) === "WEBP") return { contentType: "image/webp", extension: "webp" };
  if (start[0] === 0xff && start[1] === 0xd8 && start[2] === 0xff) return { contentType: "image/jpeg", extension: "jpg" };
  return null;
}

/**
 * The photo's file name: its own fingerprint, so the same photo is stored once however many times it's added.
 */
export async function photoFileName(body: ArrayBuffer, type: PhotoType): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", body);
  return `${[...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("")}.${type.extension}`;
}

/** Stores the file in the bucket under this name (from photoFileName), exactly as it is, unless it's already there. */
export async function savePhotoFile(fileName: string, body: ArrayBuffer, type: PhotoType) {
  const bucket = getCloudflareContext().env.PHOTOS_BUCKET;
  const key = `uploads/${fileName}`;
  if (!(await bucket.head(key))) {
    await bucket.put(key, body, {
      // The file never changes (a new photo gets a new name), so it can stay in caches for a year.
      httpMetadata: { contentType: type.contentType, cacheControl: "public, max-age=31536000, immutable" },
    });
  }
}
