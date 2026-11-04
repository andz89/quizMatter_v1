import { getCloudflareContext } from "@opennextjs/cloudflare";
import { z } from "zod";
import { isPastKeepTime } from "@/lib/cleanupPhotos";
import { PHOTO_URL_PREFIX } from "@/lib/constants";
import { isOurPhotoFile } from "@/lib/photoTypes";
import { createClient } from "@/lib/supabase/server";

// Only our own photo files (named after their fingerprint, GIFs too), so nothing else in the bucket can be deleted.
const bodySchema = z.object({ src: z.string().refine(isOurPhotoFile) });

/**
 * Deletes a photo file from the R2 bucket now, for the admin page "Photo cleanup" (instead of waiting for the
 * weekly cleanup). Super admin only. A photo still in use (on a slide, in a "My photos" list or shared) isn't
 * deleted, and neither is one uploaded in the last 7 days (the cleanup's own rule: it may be on a slide a teacher
 * hasn't saved yet).
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: isSuperAdmin } = await supabase.rpc("is_super_admin");
  if (isSuperAdmin !== true) return Response.json({ error: "Only the super admin can delete photos." }, { status: 403 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "This isn't one of our photos." }, { status: 400 });
  const { src } = parsed.data;

  const bucket = getCloudflareContext().env.PHOTOS_BUCKET;
  const key = `uploads/${src.slice(PHOTO_URL_PREFIX.length)}`;
  const file = await bucket.head(key);
  if (!file) return Response.json({ deleted: true });
  if (!isPastKeepTime(file.uploaded)) {
    return Response.json(
      { error: "This photo was uploaded less than 7 days ago, so it wasn't deleted. It may be on a slide that isn't saved yet." },
      { status: 409 },
    );
  }

  // Checked now, not when the page loaded: a teacher may have put it on a slide since.
  const { data: used, error } = await supabase.rpc("admin_used_photo_srcs");
  if (error) return Response.json({ error: "Couldn't delete the photo. Please try again." }, { status: 500 });
  if (used.includes(src)) {
    return Response.json({ error: "This photo is still used on a slide or a photo list, so it wasn't deleted." }, { status: 409 });
  }

  await bucket.delete(key);
  return Response.json({ deleted: true });
}
