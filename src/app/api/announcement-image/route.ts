import { MAX_STORED_PHOTO_BYTES, PHOTO_URL_PREFIX } from "@/lib/constants";
import { photoFileName, savePhotoFile } from "@/lib/photoFiles";
import { readAnnouncementImageType } from "@/lib/photoTypes";
import { photoSchema } from "@/lib/schema";
import { createClient } from "@/lib/supabase/server";

/**
 * Saves a picture for an announcement's modal (Admin → Announcements; super admin only), already shrunk by the
 * browser (see lib/photos.tsx), or a GIF sent as it is (so it keeps moving; 2 MB at most, like any stored photo). The browser sends its size in the address: /api/announcement-image?width=…&height=…
 * The file goes to the R2 bucket like every photo and nowhere else (no photo list): the weekly cleanup keeps it
 * while an announcement's modal_html uses it (used_photo_srcs). Returns { src }.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return Response.json({ error: "Please log in again." }, { status: 401 });
  const { data: isSuperAdmin } = await supabase.rpc("is_super_admin");
  if (isSuperAdmin !== true) return Response.json({ error: "Only the super admin can do this." }, { status: 403 });

  // The header is checked first so a huge upload is refused before it's read.
  if (Number(request.headers.get("content-length")) > MAX_STORED_PHOTO_BYTES) return tooBig();
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_STORED_PHOTO_BYTES) return tooBig();

  // The file's first bytes tell what it really is, whatever it claims to be.
  const type = readAnnouncementImageType(body);
  if (!type) return Response.json({ error: "Only photos and GIFs can be uploaded." }, { status: 415 });

  // Checked with zod before it's saved (see CLAUDE.md, "Saving Data").
  const { searchParams } = new URL(request.url);
  const fileName = await photoFileName(body, type);
  const photo = photoSchema.safeParse({
    src: PHOTO_URL_PREFIX + fileName,
    width: Number(searchParams.get("width")),
    height: Number(searchParams.get("height")),
  });
  if (!photo.success) return Response.json({ error: "This photo's size is wrong." }, { status: 400 });

  // Counted like a shared photo before the file takes up storage: 30 a minute, never paused.
  const { error } = await supabase.rpc("count_write", { kind: "photos" });
  if (error?.code === "QM429") {
    return Response.json({ error: "You're adding photos too fast. Wait a minute and try again." }, { status: 429 });
  }
  if (error) return failed();

  try {
    await savePhotoFile(fileName, body, type);
  } catch {
    return failed();
  }
  return Response.json({ src: photo.data.src });
}

function tooBig() {
  return Response.json({ error: "This photo is too big." }, { status: 413 });
}

function failed() {
  return Response.json({ error: "Couldn't upload the photo. Please try again." }, { status: 500 });
}
