import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { R2Bucket } from "@cloudflare/workers-types";
import { MAX_STORED_PHOTO_BYTES, PHOTO_URL_PREFIX } from "@/lib/constants";
import { photoSchema } from "@/lib/schema";
import { createClient } from "@/lib/supabase/server";

declare global {
  interface CloudflareEnv {
    PHOTOS_BUCKET: R2Bucket;
  }
}

/**
 * Saves a photo the browser already shrunk (see lib/photos.tsx) to the R2 bucket, adds it to the teacher's
 * "My photos" list, and returns it. Only logged-in teachers can upload. The file is named after its own
 * fingerprint, so the same photo is stored once however many times it's added.
 * The browser sends the photo's size in the address: /api/upload-image?width=…&height=…
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return Response.json({ error: "Please log in again." }, { status: 401 });

  // The header is checked first so a huge upload is refused before it's read.
  if (Number(request.headers.get("content-length")) > MAX_STORED_PHOTO_BYTES) return tooBig();
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_STORED_PHOTO_BYTES) return tooBig();

  // The file's first bytes tell what it really is, whatever it claims to be.
  const type = readPhotoType(new Uint8Array(body, 0, Math.min(12, body.byteLength)));
  if (!type) return Response.json({ error: "Only photos can be uploaded." }, { status: 415 });

  const hash = await crypto.subtle.digest("SHA-256", body);
  const fileName = `${[...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("")}.${type.extension}`;
  // Checked with zod before it's saved (see CLAUDE.md, "Saving Data").
  const { searchParams } = new URL(request.url);
  const photo = photoSchema.safeParse({
    src: PHOTO_URL_PREFIX + fileName,
    width: Number(searchParams.get("width")),
    height: Number(searchParams.get("height")),
  });
  if (!photo.success) return Response.json({ error: "This photo's size is wrong." }, { status: 400 });

  const bucket = getCloudflareContext().env.PHOTOS_BUCKET;
  const key = `uploads/${fileName}`;
  if (!(await bucket.head(key))) {
    await bucket.put(key, body, {
      // The file never changes (a new photo gets a new name), so it can stay in caches for a year.
      httpMetadata: { contentType: type.contentType, cacheControl: "public, max-age=31536000, immutable" },
    });
  }
  // Added again = moves back to the top of the list.
  const { error } = await supabase
    .from("photos")
    .upsert({ ...photo.data, user_id: data.claims.sub, created_at: new Date().toISOString() }, { onConflict: "user_id,src" });
  if (error) return Response.json({ error: "Couldn't upload the photo. Please try again." }, { status: 500 });
  return Response.json(photo.data);
}

function tooBig() {
  return Response.json({ error: "This photo is too big." }, { status: 413 });
}

/** WebP or JPEG (Safari can't make WebP, so it sends JPEG), from the file's first bytes. null = neither. */
function readPhotoType(start: Uint8Array) {
  const text = (from: number, to: number) => String.fromCharCode(...start.subarray(from, to));
  if (text(0, 4) === "RIFF" && text(8, 12) === "WEBP") return { contentType: "image/webp", extension: "webp" };
  if (start[0] === 0xff && start[1] === 0xd8 && start[2] === 0xff) return { contentType: "image/jpeg", extension: "jpg" };
  return null;
}
