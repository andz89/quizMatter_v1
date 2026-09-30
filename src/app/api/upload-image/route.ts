import { MAX_STORED_PHOTO_BYTES, PHOTO_URL_PREFIX } from "@/lib/constants";
import { photoFileName, readPhotoType, savePhotoFile } from "@/lib/photoFiles";
import { photoSchema, sharedPhotoBytesSchema, sharedPhotoInfoSchema, sharedPhotoSchema } from "@/lib/schema";
import { createClient } from "@/lib/supabase/server";

/**
 * Saves a photo the browser already shrunk (see lib/photos.tsx) to the R2 bucket, adds it to the teacher's
 * "My photos" list, and returns it. Only logged-in teachers can upload. The file is named after its own
 * fingerprint, so the same photo is stored once however many times it's added.
 * The browser sends the photo's size in the address: /api/upload-image?width=…&height=…
 * With &category=<category id> it's a shared photo instead: only admins can add one, it must be WebP, and it
 * goes to the shared_photos table (for every teacher, with its file size) instead of "My photos". It also needs &source=<who owns it
 * or where it came from>, and &name=<file name> gives it its name (to show and search); both are only set the
 * first time it's shared.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return Response.json({ error: "Please log in again." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const categoryId = searchParams.get("category");
  if (categoryId !== null) {
    const { data: isAdmin } = await supabase.rpc("is_admin");
    if (isAdmin !== true) return Response.json({ error: "Only admins can share photos." }, { status: 403 });
  }

  // The header is checked first so a huge upload is refused before it's read.
  if (Number(request.headers.get("content-length")) > MAX_STORED_PHOTO_BYTES) return tooBig();
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_STORED_PHOTO_BYTES) return tooBig();

  // The file's first bytes tell what it really is, whatever it claims to be.
  const type = readPhotoType(body);
  if (!type) return Response.json({ error: "Only photos can be uploaded." }, { status: 415 });
  if (categoryId !== null && type.extension !== "webp") {
    return Response.json({ error: "Shared photos must be WebP. Please use Chrome, Edge or Firefox." }, { status: 415 });
  }

  // Checked with zod before it's saved (see CLAUDE.md, "Saving Data").
  const size = { width: Number(searchParams.get("width")), height: Number(searchParams.get("height")) };
  const fileName = await photoFileName(body, type);
  const photo = photoSchema.safeParse({ src: PHOTO_URL_PREFIX + fileName, ...size });
  if (!photo.success) return Response.json({ error: "This photo's size is wrong." }, { status: 400 });
  const shared = categoryId === null ? null : sharedPhotoSchema.safeParse({ ...photo.data, category_id: categoryId });
  if (shared && !shared.success) return Response.json({ error: "Please pick a category." }, { status: 400 });
  // A shared photo's name on the admin's computer, cut to the longest allowed.
  const originalName = sharedPhotoInfoSchema.shape.file_name.parse((searchParams.get("name") ?? "").slice(0, 200));
  // A shared photo must say who owns it or where it came from.
  const source = shared ? sharedPhotoInfoSchema.shape.source.safeParse(searchParams.get("source") ?? "") : null;
  if (source && !source.success) return Response.json({ error: source.error.issues[0].message }, { status: 400 });

  // At most 30 photos a minute per teacher (admins: no limit), counted before the file takes up storage.
  const { error: rateError } = await supabase.rpc("count_write", { kind: "photos" });
  if (rateError?.code === "QM429") {
    return Response.json({ error: "You're adding photos too fast. Wait a minute and try again." }, { status: 429 });
  }
  if (rateError) return Response.json({ error: "Couldn't upload the photo. Please try again." }, { status: 500 });

  await savePhotoFile(fileName, body, type);
  // Added again = moves back to the top of the list (a shared one also moves to the new category).
  const created_at = new Date().toISOString();
  const { error } = shared
    ? await supabase
        .from("shared_photos")
        // Its file size too, for the admin page. An admin's upload is approved, even if Claude added it first.
        .upsert(
          { ...shared.data, bytes: sharedPhotoBytesSchema.parse(body.byteLength), approved: true, created_at },
          { onConflict: "src" },
        )
    : await supabase.from("photos").upsert({ ...photo.data, user_id: data.claims.sub, created_at }, { onConflict: "user_id,src" });
  if (error) return Response.json({ error: "Couldn't upload the photo. Please try again." }, { status: 500 });
  // The name and source are only set when the photo has none: uploading it again keeps what an admin may have
  // changed. (Not saved = the photo just has none yet, which the admin can add.)
  if (shared && originalName) {
    await supabase.from("shared_photos").update({ file_name: originalName }).eq("src", shared.data.src).eq("file_name", "");
  }
  if (shared && source?.success) {
    await supabase.from("shared_photos").update({ source: source.data }).eq("src", shared.data.src).eq("source", "");
  }
  return Response.json(photo.data);
}

function tooBig() {
  return Response.json({ error: "This photo is too big." }, { status: 413 });
}
