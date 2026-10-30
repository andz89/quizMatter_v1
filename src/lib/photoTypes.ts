// What kind of picture an uploaded file really is, from its first bytes (whatever it claims to be). Kept apart from
// photoFiles.ts (which needs Cloudflare) so tests can load it.

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
