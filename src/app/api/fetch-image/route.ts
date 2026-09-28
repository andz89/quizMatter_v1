import { z } from "zod";
import { MAX_PHOTO_FILE_BYTES } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({ url: z.url({ protocol: /^https$/ }).max(2000) });
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Downloads a photo from a link the teacher pasted and hands it to the browser, which then shrinks and
 * uploads it like any other photo (see lib/photos.tsx). The browser can't download it itself: most sites
 * don't let other sites read their images. Only public addresses can be reached ("global_fetch_strictly_public"
 * in wrangler.jsonc), so this can't be used to peek into private networks.
 */
export async function POST(request: Request) {
  const { data } = await (await createClient()).auth.getClaims();
  if (!data?.claims) return Response.json({ error: "Please log in again." }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failed("Paste a photo link that starts with https://");

  let response: Response;
  try {
    response = await fetch(parsed.data.url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": "quizMatter/1.0 (+https://quizmatter.com)", Accept: PHOTO_TYPES.join(", ") },
    });
  } catch {
    return failed("Couldn't get a photo from this link.");
  }
  const contentType = response.headers.get("content-type")?.split(";")[0].trim() ?? "";
  if (!response.ok || !response.body) return failed("Couldn't get a photo from this link.");
  if (!PHOTO_TYPES.includes(contentType)) {
    return failed('This link isn\'t a JPG, PNG or WebP photo. Tip: right-click the picture and choose "Copy image address".');
  }

  const bytes = await readUpTo(response.body, MAX_PHOTO_FILE_BYTES);
  if (!bytes) return failed("This photo is too big (20 MB at most).");
  return new Response(bytes, { headers: { "Content-Type": contentType } });
}

function failed(error: string) {
  return Response.json({ error }, { status: 400 });
}

/** The whole body, or null as soon as it passes `limit` bytes (so a huge file is never fully read). */
async function readUpTo(body: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let part = await reader.read(); !part.done; part = await reader.read()) {
    size += part.value.byteLength;
    if (size > limit) {
      // Stops the download.
      await reader.cancel();
      return null;
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
