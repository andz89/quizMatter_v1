import { MAX_STORED_PHOTO_BYTES, PHOTO_URL_PREFIX } from "@/lib/constants";
import { photoFileName, readPhotoType, savePhotoFile } from "@/lib/photoFiles";
import { readUploadBody } from "@/lib/photoTypes";
import { profilePhotoSchema } from "@/lib/schema";
import { createClient } from "@/lib/supabase/server";

/**
 * Saves an editor's profile photo: the square the account page's "Adjust your photo" box made (see
 * lib/profilePhotos.ts). The browser sends its size in the address: /api/profile-photo?width=400&height=400.
 * Only editors (not banned) get as far as storing it. The file goes to the R2 bucket like every photo, and only
 * then does the database's set_profile_photo check, count (3 a day) and switch the profile to it, so a failed store
 * never leaves the profile pointing at a missing file. It never goes to "My photos" or the shared photos.
 * Returns { src, leftToday }.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return Response.json({ error: "Please log in again." }, { status: 401 });

  // Checked before the file takes up storage (set_profile_photo checks them again).
  const [{ data: isEditor }, { data: isBanned }] = await Promise.all([supabase.rpc("is_editor"), supabase.rpc("is_banned")]);
  if (isBanned === true) return banned();
  if (isEditor !== true) return notEditor();

  // Reading stops as soon as it's too big, so a huge upload is never held in memory.
  const body = await readUploadBody(request, MAX_STORED_PHOTO_BYTES);
  if (!body) return tooBig();

  // The file's first bytes tell what it really is, whatever it claims to be.
  const type = readPhotoType(body);
  if (!type) return Response.json({ error: "Only photos can be uploaded." }, { status: 415 });

  // Checked with zod before it's saved (see CLAUDE.md, "Saving Data").
  const { searchParams } = new URL(request.url);
  const fileName = await photoFileName(body, type);
  const photo = profilePhotoSchema.safeParse({
    src: PHOTO_URL_PREFIX + fileName,
    width: Number(searchParams.get("width")),
    height: Number(searchParams.get("height")),
  });
  if (!photo.success) return Response.json({ error: "This photo's size is wrong." }, { status: 400 });

  // Stored first: if this fails, the profile keeps its old photo and nothing is counted.
  try {
    await savePhotoFile(fileName, body, type);
  } catch {
    return failed();
  }

  // Refused here (e.g. the 4th change today), the stored file is unused, and the weekly cleanup deletes it.
  const { data: leftToday, error } = await supabase.rpc("set_profile_photo", { src: photo.data.src });
  if (error?.code === "QMPPL") {
    return Response.json(
      { error: "You've changed your photo 3 times today. You can change it again tomorrow." },
      { status: 429 },
    );
  }
  if (error?.code === "QMBAN") return banned();
  if (error?.code === "42501") return notEditor();
  if (error) return failed();
  return Response.json({ src: photo.data.src, leftToday });
}

function tooBig() {
  return Response.json({ error: "This photo is too big." }, { status: 413 });
}

function banned() {
  return Response.json({ error: "Your account is blocked, so you can't add photos." }, { status: 403 });
}

function notEditor() {
  return Response.json({ error: "Only editors can add a profile photo." }, { status: 403 });
}

function failed() {
  return Response.json({ error: "Couldn't save the photo. Please try again." }, { status: 500 });
}
