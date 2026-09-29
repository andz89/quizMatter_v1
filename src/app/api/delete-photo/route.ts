import { getCloudflareContext } from "@opennextjs/cloudflare";
import { z } from "zod";
import { PHOTO_URL_PREFIX } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";

// Only our own photo files (named after their fingerprint), so nothing else in the bucket can be deleted.
const bodySchema = z.object({ src: z.string().regex(new RegExp(`^${PHOTO_URL_PREFIX.replaceAll(".", "\\.")}[0-9a-f]{64}\\.(webp|jpg)$`)) });

/**
 * Deletes a photo file from the R2 bucket now, for the admin page "Photo cleanup" (instead of waiting for the
 * weekly cleanup). Admins only. A photo still in use (on a slide, in a "My photos" list or shared) isn't deleted.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (isAdmin !== true) return Response.json({ error: "Only admins can delete photos." }, { status: 403 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "This isn't one of our photos." }, { status: 400 });
  const { src } = parsed.data;

  // Checked now, not when the page loaded: a teacher may have put it on a slide since.
  const { data: used, error } = await supabase.rpc("admin_used_photo_srcs");
  if (error) return Response.json({ error: "Couldn't delete the photo. Please try again." }, { status: 500 });
  if (used.includes(src)) {
    return Response.json({ error: "This photo is still used on a slide or a photo list, so it wasn't deleted." }, { status: 409 });
  }

  await getCloudflareContext().env.PHOTOS_BUCKET.delete(`uploads/${src.slice(PHOTO_URL_PREFIX.length)}`);
  return Response.json({ deleted: true });
}
