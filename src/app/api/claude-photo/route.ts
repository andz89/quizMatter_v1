import type { SupabaseClient } from "@supabase/supabase-js";
import { imageSize } from "image-size";
import { z } from "zod";
import { MAX_STORED_PHOTO_BYTES, PHOTO_MAX_SIDE, PHOTO_URL_PREFIX } from "@/lib/constants";
import { photoFileName, readPhotoType, savePhotoFile } from "@/lib/photoFiles";
import { deletePhotoTicket, getPhotoTicket } from "@/lib/photoTickets";
import { claudePhotoSchema, photoCategoryNameSchema, sharedPhotoBytesSchema, sharedPhotoSchema } from "@/lib/schema";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Where Claude sends a photo for the shared photo library: POST /api/claude-photo?ticket=<id>, with the WebP file
 * as the body. The ticket (from prepare_photo_upload in /api/mcp, which only admins can call) holds the photo's
 * name, description, tags, category and source, so this needs no login — the proxy lets it through, and the
 * ticket is the permission. Claude converted the photo to WebP in its sandbox, like the admin page does in the
 * browser; the file is stored exactly as it arrives. It waits for an admin's review (approved: false) before
 * teachers see it, unless the ticket says it's for a presentation (then it's approved right away, so it can go on
 * the slides Claude sends next). The answers are plain sentences, as Claude reads them.
 */
export async function POST(request: Request) {
  const ticketId = z.uuid().safeParse(new URL(request.url).searchParams.get("ticket"));
  const ticket = ticketId.success ? await getPhotoTicket(ticketId.data) : null;
  if (!ticketId.success || !ticket) {
    return answer(404, "This upload link is wrong, already used or expired (links work for an hour). Call prepare_photo_upload again.");
  }

  // The header is checked first so a huge upload is refused before it's read.
  if (Number(request.headers.get("content-length")) > MAX_STORED_PHOTO_BYTES) return tooBig();
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_STORED_PHOTO_BYTES) return tooBig();

  // The file's first bytes tell what it really is, and its real size comes from the file, not from Claude.
  if (readPhotoType(body)?.extension !== "webp") {
    return answer(415, 'The file isn\'t a WebP photo. Save it with Pillow as "WEBP" (quality 85) and send that file.');
  }
  let size: { width: number; height: number };
  try {
    size = imageSize(new Uint8Array(body));
  } catch {
    return answer(415, "This file couldn't be read as a photo.");
  }
  // Like the admin page: bigger photos are shrunk to this first (Claude does it), smaller ones keep their size.
  if (Math.max(size.width, size.height) > PHOTO_MAX_SIDE) {
    return answer(
      400,
      `This photo is ${size.width}×${size.height} px, so it wasn't added. Shrink it so its longest side is ${PHOTO_MAX_SIDE} px ` +
        `(img.thumbnail((${PHOTO_MAX_SIDE}, ${PHOTO_MAX_SIDE}), Image.LANCZOS)), save it as WebP again and send that.`,
    );
  }

  const supabase = createAdminClient();
  if (!supabase) return answer(500, "The photo library isn't available right now. Try again later.");

  // Checked with zod right before it's saved (see CLAUDE.md, "Saving Data").
  const details = claudePhotoSchema.safeParse(ticket.details);
  if (!details.success) return answer(400, `The photo's details are wrong: ${details.error.issues[0].message}`);
  const { category, ...info } = details.data;

  const type = { contentType: "image/webp", extension: "webp" } as const;
  const fileName = await photoFileName(body, type);
  const src = PHOTO_URL_PREFIX + fileName;

  // The same photo is already shared: it's left as it is (an admin may have changed its details), except that a
  // photo still waiting for review is approved when it's for a presentation. Its size comes back so it can go on slides.
  const { data: existing, error: existingError } = await supabase
    .from("shared_photos")
    .select("file_name, width, height, approved")
    .eq("src", src)
    .maybeSingle();
  if (existingError) return answer(500, "Couldn't add the photo. Send it again.");
  if (existing) {
    const shared = { src, width: existing.width, height: existing.height };
    if (ticket.approved && !existing.approved) {
      // Approved before the ticket is used up, so a failure can be sent again with the same link.
      const { error } = await supabase.from("shared_photos").update({ approved: true }).eq("src", src);
      if (error) return answer(500, "Couldn't approve the photo. Send it again.");
      await deletePhotoTicket(ticketId.data);
      return answer(
        200,
        `This photo was already in the library, as "${existing.file_name}", waiting for review. It's approved now, so it can go on slides.`,
        shared,
      );
    }
    await deletePhotoTicket(ticketId.data);
    return answer(200, `This photo is already in the library, as "${existing.file_name}". Nothing was changed.`, shared);
  }

  // The ticket is used up here, before anything is saved, so the same link sent twice at once adds only one photo.
  if (!(await deletePhotoTicket(ticketId.data))) {
    return answer(404, "This upload link was already used. Call prepare_photo_upload again if the photo is still missing.");
  }
  const failed = "Couldn't add the photo. Call prepare_photo_upload again and send it with the new link.";
  const found = await findOrCreateCategory(supabase, category);
  if (!found) return answer(500, `Couldn't make the category "${category}". ${failed}`);
  const photo = sharedPhotoSchema.safeParse({ src, ...size, category_id: found.id });

  let saved = false;
  if (photo.success) {
    await savePhotoFile(fileName, body, type);
    const { error } = await supabase
      .from("shared_photos")
      .insert({ ...photo.data, ...info, bytes: sharedPhotoBytesSchema.parse(body.byteLength), approved: ticket.approved });
    saved = !error;
  }
  if (!saved) {
    // A category made just for this photo shouldn't stay empty. (The database won't delete one that has photos.)
    if (found.isNew) await supabase.from("photo_categories").delete().eq("id", found.id);
    return answer(500, failed);
  }

  const kb = Math.round(body.byteLength / 1024);
  const added = `Added "${info.file_name}" (${size.width}×${size.height} px, ${kb} KB) to "${category}"`;
  const review = ticket.approved ? "It's approved, so it can go on slides now." : "It waits for an admin's review before teachers see it.";
  return answer(200, `${added}. ${review}`, { src, width: size.width, height: size.height });
}

/**
 * The category with this name (not minding capitals), made if there's none yet: its id, and whether it was just
 * made. Null if it failed.
 */
async function findOrCreateCategory(
  supabase: SupabaseClient,
  name: string,
): Promise<{ id: string; isNew: boolean } | null> {
  const find = async () => {
    const { data } = await supabase.from("photo_categories").select("id, name");
    const id = data?.find((c) => c.name.toLowerCase() === name.toLowerCase())?.id;
    return id ? { id, isNew: false } : null;
  };
  const found = await find();
  if (found) return found;
  const { data, error } = await supabase
    .from("photo_categories")
    .insert({ name: photoCategoryNameSchema.parse(name) })
    .select("id")
    .single();
  // Two photos in the same new category can arrive together: then the other one just made it.
  if (error?.code === "23505") return find();
  return data ? { id: data.id, isNew: true } : null;
}

function answer(status: number, message: string, extra?: object) {
  return Response.json({ ok: status === 200, message, ...extra }, { status });
}

function tooBig() {
  return answer(413, "The file is over 2 MB. Save it again as WebP at quality 70 (don't resize it) and send that.");
}
