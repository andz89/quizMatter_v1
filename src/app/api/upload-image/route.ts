import { pausedUntilFromError } from "@/lib/clickLimits";
import { MAX_STORED_PHOTO_BYTES, PHOTO_URL_PREFIX } from "@/lib/constants";
import { photoFileName, readPhotoType, savePhotoFile } from "@/lib/photoFiles";
import { readUploadBody } from "@/lib/photoTypes";
import { storageFullMessage } from "@/lib/photoStorage";
import {
  photoSchema,
  reserveAnswerSchema,
  type UploadReservation,
  uploadBytesSchema,
  photoStorageSchema,
  sharedPhotoBytesSchema,
  sharedPhotoInfoSchema,
  sharedPhotoSchema,
} from "@/lib/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Saves a photo the browser already shrunk (see lib/photos.tsx) to the R2 bucket, adds it to the teacher's
 * "My photos" list, and returns it. Every teacher can upload their own photos. The file is named after its own
 * fingerprint, so the same photo is stored once however many times it's added.
 * The browser sends the photo's size in the address: /api/upload-image?width=…&height=…
 * With &category=<category id> it's a shared photo instead: only admins can add one, it must be WebP, and it
 * goes to the shared_photos table (for every teacher, with its file size) instead of "My photos". It also needs &source=<who owns it
 * or where it came from>, and &name=<file name> gives it its name (to show and search); both are only set the
 * first time it's shared. Each shared photo remembers who uploaded it (uploaded_by, filled in by the database).
 * An own photo must fit the teacher's photo storage (reserve_photo_upload, before the click limit counts it; 50 MB,
 * 500 MB for an editor; 413 with code QMSTO when full, refused tries counted with count_write; the space is given
 * back with release_photo_upload if anything after it refuses: the click limit, storing the file or the My photos
 * row; only while the record is still this upload's), and the answer (also the 413) carries their total (`storage`).
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
  } else {
    // A teacher's own photo: every teacher may upload (their photo storage limits it, below). A banned one is
    // refused before the file takes up storage (the photos table refuses them too).
    const { data: isBanned, error: banError } = await supabase.rpc("is_banned");
    // Unknown (the check failed) is not "not banned": stop before the file is read or stored.
    if (banError) return Response.json({ error: "Couldn't upload the photo. Please try again." }, { status: 500 });
    if (isBanned === true) return banned();
  }

  // Reading stops as soon as it's too big, so a huge upload is never held in memory.
  const body = await readUploadBody(request, MAX_STORED_PHOTO_BYTES);
  if (!body) return tooBig();

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

  // A photo another admin already shared stays as it is (its category, name and owner), so a plain admin's upload
  // of it is refused with a clear message. The super admin's upload moves it, as before. (The database refuses the
  // change anyway.)
  if (shared) {
    const [{ data: existing }, { data: isSuperAdmin }] = await Promise.all([
      supabase.from("shared_photos").select("uploaded_by, is_public").eq("src", shared.data.src).maybeSingle(),
      supabase.rpc("is_super_admin"),
    ]);
    if (existing && existing.uploaded_by !== data.claims.sub && isSuperAdmin !== true) {
      const error = existing.is_public
        ? "Another admin already shared this photo, so it was left as it is."
        : "An editor uploaded this photo. It's waiting in Admin → Photos for the super admin.";
      return Response.json({ error }, { status: 409 });
    }
  }

  // An own photo must fit the teacher's photo storage (50 MB, an editor 500 MB; admins have no limit). Reserved
  // before the click limit counts it: a size limit is never a click limit, so refused tries must not pause or ban.
  // The database checks one upload at a time and holds its space for 10 minutes while the file is stored, so two
  // uploads at once can't both slip past. Secret key: the functions are the server's only (teachers can't write
  // their own upload records).
  const admin = shared ? null : createAdminClient();
  let reservation: ({ target: string; target_src: string } & UploadReservation) | null = null;
  if (!shared) {
    if (!admin) return Response.json({ error: "Couldn't upload the photo. Please try again." }, { status: 500 });
    // Checked with zod before it's saved (see CLAUDE.md, "Saving Data").
    const fileBytes = uploadBytesSchema.parse(body.byteLength);
    const { data: reserved, error: storageError } = await admin.rpc("reserve_photo_upload", {
      target: data.claims.sub,
      target_src: photo.data.src,
      file_bytes: fileBytes,
    });
    if (storageError?.code === "QMSTO") {
      // Refused tries are counted too (30 a minute, never paused or banned: an honest teacher never gets near it),
      // so a script sending uploads to a full account is slowed down.
      const { error: refusedError } = await supabase.rpc("count_write", { kind: "photos" });
      if (refusedError?.code === "QMBAN") return banned();
      if (refusedError?.code === "QM429") {
        return Response.json({ error: "You're adding photos too fast. Wait a minute and try again." }, { status: 429 });
      }
      return storageFull(supabase);
    }
    if (storageError) return Response.json({ error: "Couldn't upload the photo. Please try again." }, { status: 500 });
    const answer = reserveAnswerSchema.safeParse(reserved);
    // Never expected (the answer is the database's own). The space was held but the answer can't say how to give it
    // back exactly, so it's held for its 10 minutes.
    if (!answer.success) return Response.json({ error: "Couldn't upload the photo. Please try again." }, { status: 500 });
    reservation = { target: data.claims.sub, target_src: photo.data.src, ...answer.data };
  }
  // Gives the reserved space back (the row as it was before), when the upload stops after the reservation. The
  // database changes the row only while it still has this reservation's time (`written_at`), so a later upload of
  // the same file keeps its own.
  const release = async () => {
    if (admin && reservation) await admin.rpc("release_photo_upload", reservation);
  };

  // Counted before the file takes up storage (the super admin: no limit). Own photos: 30 in a minute or 300 in a
  // day pauses uploads for a while, and the 3rd time in a row bans (the photo_upload and photo_upload_daily click
  // limits). Shared photos (admins only, often many at once): 30 a minute, never paused (count_write).
  const { error: rateError } = shared
    ? await supabase.rpc("count_write", { kind: "photos" })
    : await supabase.rpc("count_photo_upload");
  if (rateError) await release();
  if (rateError?.code === "QMBAN") return banned();
  if (rateError?.code === "QM429") {
    return Response.json({ error: "You're adding photos too fast. Wait a minute and try again." }, { status: 429 });
  }
  if (pausedUntilFromError(rateError)) return paused();
  if (rateError) return Response.json({ error: "Couldn't upload the photo. Please try again." }, { status: 500 });

  // Rare. The upload stays counted (its space is given back); the teacher sees it failed and can try again.
  try {
    await savePhotoFile(fileName, body, type);
  } catch {
    await release();
    return Response.json({ error: "Couldn't upload the photo. Please try again." }, { status: 500 });
  }
  // Added again = moves back to the top of the list (a shared one also moves to the new category).
  const created_at = new Date().toISOString();
  const { error } = shared
    ? await supabase
        .from("shared_photos")
        // Its file size too, for the admin page. An admin sharing it makes an editor's waiting photo public.
        .upsert(
          { ...shared.data, bytes: sharedPhotoBytesSchema.parse(body.byteLength), created_at, is_public: true },
          { onConflict: "src" },
        )
    : await supabase.from("photos").upsert({ ...photo.data, user_id: data.claims.sub, created_at }, { onConflict: "user_id,src" });
  // Not in My photos (and not on a slide yet): the reserved space is given back.
  if (error) await release();
  // The photos table has its own click limit (photo_rows), for rows sent by hand.
  if (pausedUntilFromError(error)) return paused();
  if (error) return Response.json({ error: "Couldn't upload the photo. Please try again." }, { status: 500 });
  // The name and source are only set when the photo has none: uploading it again keeps what an admin may have
  // changed. (Not saved = the photo just has none yet, which the admin can add.)
  if (shared && originalName) {
    await supabase.from("shared_photos").update({ file_name: originalName }).eq("src", shared.data.src).eq("file_name", "");
  }
  if (shared && source?.success) {
    await supabase.from("shared_photos").update({ source: source.data }).eq("src", shared.data.src).eq("source", "");
  }
  if (shared) return Response.json(photo.data);
  // The teacher's new total, so the Photos panel's bar updates without asking again (left out if it can't be read).
  const { data: storageData } = await supabase.rpc("my_photo_storage");
  const storage = photoStorageSchema.safeParse(storageData);
  return Response.json(storage.success ? { ...photo.data, storage: storage.data } : photo.data);
}

/**
 * 413 with the teacher's own limit in the words, and their total (`storage`), so the Photos panel's bar shows how
 * full it really is (both left out if it can't be read). Only asked when full.
 */
async function storageFull(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase.rpc("my_photo_storage");
  const storage = photoStorageSchema.safeParse(data);
  const error = storageFullMessage(storage.success ? storage.data.limit : null);
  return Response.json(
    storage.success ? { error, code: "QMSTO", storage: storage.data } : { error, code: "QMSTO" },
    { status: 413 },
  );
}

function tooBig() {
  return Response.json({ error: "This photo is too big." }, { status: 413 });
}

function banned() {
  return Response.json({ error: "Your account is blocked, so you can't add photos." }, { status: 403 });
}

// The browser asks which features are paused (checkPauses), so the notice at the bottom shows when it ends.
function paused() {
  return Response.json(
    { error: "Uploading photos is paused for now. The notice at the bottom says until when." },
    { status: 429 },
  );
}
