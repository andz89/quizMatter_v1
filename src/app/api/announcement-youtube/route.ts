import { z } from "zod";
import { modalAttachmentSchema } from "@/lib/announcements";
import { MAX_STORED_PHOTO_BYTES, PHOTO_URL_PREFIX } from "@/lib/constants";
import { photoFileName, readPhotoType, savePhotoFile } from "@/lib/photoFiles";
import { createClient } from "@/lib/supabase/server";
import { youTubeVideoId, youTubeWatchUrl } from "@/lib/youtube";

const bodySchema = z.object({ url: z.string().max(500) });
// YouTube's thumbnails, sharpest first: maxresdefault isn't there for every video; hqdefault always is.
const THUMBNAILS = [
  { name: "maxresdefault", width: 1280, height: 720 },
  { name: "hqdefault", width: 480, height: 360 },
];
const WAIT_MS = 8000;

/**
 * Makes a YouTube card for an announcement's modal (Admin → Announcements; super admin only), from a pasted link:
 * the title from YouTube's public oEmbed, and the thumbnail copied into our R2 bucket like any photo, so teachers'
 * browsers load our copy and never contact YouTube unless they click (spec
 * docs/superpowers/specs/2026-10-31-announcement-post-design.md). Body: { url }. Returns the card
 * { kind: "youtube", video_id, title, src, width, height }. The weekly cleanup keeps the thumbnail while an
 * announcement uses it (used_photo_srcs).
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return Response.json({ error: "Please log in again." }, { status: 401 });
  const { data: isSuperAdmin } = await supabase.rpc("is_super_admin");
  if (isSuperAdmin !== true) return Response.json({ error: "Only the super admin can do this." }, { status: 403 });

  const body = bodySchema.safeParse(await request.json().catch(() => null));
  const videoId = body.success ? youTubeVideoId(body.data.url) : null;
  if (!videoId) return Response.json({ error: "That isn't a YouTube video link." }, { status: 400 });

  // Counted like a photo before anything is fetched or stored: 30 a minute.
  const { error: rateError } = await supabase.rpc("count_write", { kind: "photos" });
  if (rateError?.code === "QM429") {
    return Response.json({ error: "You're adding photos too fast. Wait a minute and try again." }, { status: 429 });
  }
  if (rateError) return failed();

  // The title. YouTube answers 401/403/404 for a private, removed or not-embeddable video.
  let title: string;
  try {
    const oembed = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(youTubeWatchUrl(videoId))}`,
      { signal: AbortSignal.timeout(WAIT_MS) },
    );
    if (oembed.status === 401 || oembed.status === 403 || oembed.status === 404) {
      return Response.json(
        { error: "This video is private, removed, or can't be shown outside YouTube." },
        { status: 404 },
      );
    }
    if (!oembed.ok) return unreachable();
    const info = z.object({ title: z.string() }).safeParse(await oembed.json());
    title = info.success ? info.data.title.trim().slice(0, 200) : "";
  } catch {
    return unreachable();
  }

  // The thumbnail, stored in R2 under its own fingerprint like every photo.
  for (const thumbnail of THUMBNAILS) {
    let file: ArrayBuffer;
    try {
      const response = await fetch(`https://i.ytimg.com/vi/${videoId}/${thumbnail.name}.jpg`, {
        signal: AbortSignal.timeout(WAIT_MS),
      });
      if (!response.ok) continue;
      file = await response.arrayBuffer();
    } catch {
      continue;
    }
    const type = readPhotoType(file);
    if (!type || file.byteLength > MAX_STORED_PHOTO_BYTES) continue;
    const fileName = await photoFileName(file, type);
    // Checked with zod before it's stored (see CLAUDE.md, "Saving Data").
    const card = modalAttachmentSchema.safeParse({
      kind: "youtube",
      video_id: videoId,
      title,
      src: PHOTO_URL_PREFIX + fileName,
      width: thumbnail.width,
      height: thumbnail.height,
    });
    if (!card.success) return failed();
    try {
      await savePhotoFile(fileName, file, type);
    } catch {
      return failed();
    }
    return Response.json(card.data);
  }
  return unreachable();
}

function unreachable() {
  return Response.json({ error: "Couldn't reach YouTube. Please try again." }, { status: 502 });
}

function failed() {
  return Response.json({ error: "Couldn't add the video. Please try again." }, { status: 500 });
}
