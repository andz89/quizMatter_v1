// Reading an uploaded photo: its body (never more than the limit), what kind of picture it really is (from its first
// bytes, whatever it claims to be), and whether an address is one of our files. Kept apart from photoFiles.ts (which
// needs Cloudflare) so tests can load it.

import { PHOTO_URL_PREFIX } from "./constants";

// A GIF in an announcement is sent as it is (not shrunk), and every teacher who sees it downloads it, often on phone
// data, so it's kept smaller than a photo (MAX_STORED_PHOTO_BYTES, 2 MB).
export const MAX_GIF_BYTES = 1024 * 1024;

export type PhotoType = { contentType: string; extension: "webp" | "jpg" | "gif" };

const firstText = (body: ArrayBuffer, from: number, to: number) =>
  String.fromCharCode(...new Uint8Array(body, 0, Math.min(to, body.byteLength)).subarray(from, to));

/** WebP or JPEG (Safari can't make WebP, so it sends JPEG). null = neither. Every upload but announcements. */
export function readPhotoType(body: ArrayBuffer): PhotoType | null {
  const start = new Uint8Array(body, 0, Math.min(3, body.byteLength));
  if (firstText(body, 0, 4) === "RIFF" && firstText(body, 8, 12) === "WEBP") return { contentType: "image/webp", extension: "webp" };
  if (start[0] === 0xff && start[1] === 0xd8 && start[2] === 0xff) return { contentType: "image/jpeg", extension: "jpg" };
  return null;
}

/** An announcement's picture: WebP, JPEG, or a GIF (sent as it is, so it keeps moving). null = none of them. */
export function readAnnouncementImageType(body: ArrayBuffer): PhotoType | null {
  const header = firstText(body, 0, 6);
  if (header === "GIF87a" || header === "GIF89a") return { contentType: "image/gif", extension: "gif" };
  return readPhotoType(body);
}

/**
 * An upload's body, or null when it's bigger than `max` bytes. It stops reading as soon as the body passes `max`,
 * so a huge upload sent without a Content-Length (in pieces) is never held in memory.
 */
export async function readUploadBody(request: Request, max: number): Promise<ArrayBuffer | null> {
  if (Number(request.headers.get("content-length")) > max) return null;
  if (!request.body) return new ArrayBuffer(0);
  const reader = request.body.getReader();
  const pieces: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    pieces.push(value);
  }
  const body = new Uint8Array(size);
  let at = 0;
  for (const piece of pieces) {
    body.set(piece, at);
    at += piece.byteLength;
  }
  return body.buffer;
}

const OUR_PHOTO_FILE = new RegExp(`^${PHOTO_URL_PREFIX.replaceAll(".", "\\.")}[0-9a-f]{64}\\.(webp|jpg|gif)$`);

/** True for the address of one of our photo files (named after its fingerprint): WebP, JPEG or an announcement's GIF. */
export function isOurPhotoFile(src: string): boolean {
  return OUR_PHOTO_FILE.test(src);
}
