import { MAX_STORED_PHOTO_BYTES, PHOTO_URL_PREFIX } from "@/lib/constants";
import { photoFileName, readPhotoType, savePhotoFile } from "@/lib/photoFiles";
import { profilePhotoSchema } from "@/lib/schema";
import { createClient } from "@/lib/supabase/server";

/**
 * Saves an editor's profile photo: the square the account page's "Adjust your photo" box made (see
 * lib/profilePhotos.ts). The browser sends its size in the address: /api/profile-photo?width=400&height=400.
 * The database's set_profile_photo checks and counts it (editors only, 3 a day) before the file takes up storage,
 * then the file goes to the R2 bucket like every photo. It never goes to "My photos" or the shared photos.
 * Returns { src, leftToday }.
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

  // Checked and counted before the file is stored, so a refused upload takes no storage.
  const { data: leftToday, error } = await supabase.rpc("set_profile_photo", { src: photo.data.src });
  if (error?.code === "QMPPL") {
    return Response.json(
      { error: "You've changed your photo 3 times today. You can change it again tomorrow." },
      { status: 429 },
    );
  }
  if (error?.code === "QMBAN") {
    return Response.json({ error: "Your account is blocked, so you can't add photos." }, { status: 403 });
  }
  if (error?.code === "42501") return Response.json({ error: "Only editors can add a profile photo." }, { status: 403 });
  if (error) return failed();

  // Rare. The change stays counted; the editor sees it failed and can try again.
  try {
    await savePhotoFile(fileName, body, type);
  } catch {
    return failed();
  }
  return Response.json({ src: photo.data.src, leftToday });
}

function tooBig() {
  return Response.json({ error: "This photo is too big." }, { status: 413 });
}

function failed() {
  return Response.json({ error: "Couldn't save the photo. Please try again." }, { status: 500 });
}
