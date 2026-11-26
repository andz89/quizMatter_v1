import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { MAX_STORED_PHOTO_BYTES } from "./constants";
import { photoUploadSizesSchema } from "./schema";
import type { Database } from "./database.types";
import { z } from "zod";
import type { R2Bucket } from "@cloudflare/workers-types";

// The weekly photo cleanup, run by Cloudflare on a timer (see worker.ts and "triggers" in wrangler.jsonc).
// It deletes photo files in R2 that no teacher's "My photos" list, no shared photo and no slide uses anymore.
// The admin page "Photo cleanup" (app/admin/cleanup) uses the same steps to show what will be deleted.
// See docs/photo-cleanup.md.

type CleanupEnv = {
  PHOTOS_BUCKET: R2Bucket;
  SUPABASE_URL: string;
  // Supabase secret key (service role): lets the job see every teacher's photos and slides.
  SUPABASE_SECRET_KEY: string;
};

// Files newer than this are kept even if unused: a teacher may have put one on a slide they haven't saved yet.
export const KEEP_NEW_FILES_MS = 7 * 24 * 60 * 60 * 1000;

/** True when a file is old enough to delete (uploaded more than KEEP_NEW_FILES_MS ago). */
export function isPastKeepTime(uploaded: Date, now = Date.now()): boolean {
  return uploaded.getTime() < now - KEEP_NEW_FILES_MS;
}
// A file's address is this + its key ("uploads/…"), like PHOTO_URL_PREFIX in constants.ts.
const PHOTOS_DOMAIN = "https://images.quizmatter.com/";

export type UnusedPhoto = { key: string; src: string; uploaded: Date; size: number };

export async function cleanupPhotos(env: CleanupEnv) {
  // Asked first: if this fails, the job stops before deleting anything.
  const supabase = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const { data, error } = await supabase.rpc("used_photo_srcs");
  if (error) throw error;

  const { unused, checked, sizes } = await findUnusedPhotos(env.PHOTOS_BUCKET, data);
  const keys = unused.filter((file) => isPastKeepTime(file.uploaded)).map((file) => file.key);

  // R2 deletes up to 1000 files per call.
  for (let i = 0; i < keys.length; i += 1000) {
    await env.PHOTOS_BUCKET.delete(keys.slice(i, i + 1000));
  }
  console.log(`Photo cleanup: checked ${checked} files, deleted ${keys.length}.`, keys);

  // Photos uploaded before the storage limit count as 2 MB until their real size is known (photo_uploads): send the
  // sizes this listing just saw. After the first run the list is empty. A failure is only logged: the deletes are done.
  const fixed = await fixPhotoUploadSizes(supabase, sizes);
  if (typeof fixed === "string") console.error(`Photo cleanup: ${fixed}`);
  else if (fixed > 0) console.log(`Photo cleanup: fixed ${fixed} photo sizes.`);
}

/**
 * Sends the real size of every estimated upload record (photo_uploads_unknown_sizes) to set_photo_upload_sizes,
 * from `sizes` (R2's whole listing: src → bytes; a file no longer in R2 gets 1 byte, so it leaves the list). Used by
 * the weekly cleanup and by Admin → Photo cleanup's "Find unused photos". Needs the secret-key client. Answers how
 * many it fixed, or what went wrong.
 */
export async function fixPhotoUploadSizes(
  supabase: SupabaseClient<Database>,
  sizes: Map<string, number>,
): Promise<number | string> {
  const unknown = await supabase.rpc("photo_uploads_unknown_sizes");
  if (unknown.error) return "couldn't read the sizes to fix.";
  const unknownSrcs = z.array(z.string()).safeParse(unknown.data);
  if (!unknownSrcs.success) return "the sizes to fix came back in a wrong shape.";
  // Checked with zod before it's saved (see CLAUDE.md, "Saving Data").
  const fixes = photoUploadSizesSchema.safeParse(sizesToFix(unknownSrcs.data, sizes));
  if (!fixes.success) return "a size to fix is wrong.";
  const count = Object.keys(fixes.data).length;
  if (count === 0) return 0;
  const { error } = await supabase.rpc("set_photo_upload_sizes", { sizes: fixes.data });
  return error ? "couldn't fix the sizes." : count;
}

/**
 * The real size of every estimated photo: { src: bytes }. `sizes` is R2's whole listing, so a photo missing from it
 * is gone for good: it gets 1 byte (it takes no space), so it isn't asked about again every week.
 */
export function sizesToFix(unknown: string[], sizes: Map<string, number>): Record<string, number> {
  const fixes: Record<string, number> = {};
  // Kept between 1 byte and 2 MB (photo_uploads' own limits), so one odd file can't stop the rest.
  for (const src of unknown) fixes[src] = Math.min(Math.max(sizes.get(src) ?? 1, 1), MAX_STORED_PHOTO_BYTES);
  return fixes;
}

/**
 * Every file in R2 under uploads/ that isn't in `usedSrcs` (from used_photo_srcs()), whatever its age, how
 * many files there are in all, and every file's size (src → bytes). The 7-day rule is left to the caller.
 */
export async function findUnusedPhotos(bucket: R2Bucket, usedSrcs: unknown) {
  const used = new Set(z.array(z.string()).parse(usedSrcs));
  const unused: UnusedPhoto[] = [];
  const sizes = new Map<string, number>();
  let checked = 0;
  let totalSize = 0;
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: "uploads/", cursor });
    for (const file of page.objects) {
      checked++;
      totalSize += file.size;
      const src = PHOTOS_DOMAIN + file.key;
      sizes.set(src, file.size);
      if (!used.has(src)) unused.push({ key: file.key, src, uploaded: file.uploaded, size: file.size });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return { unused, checked, totalSize, sizes };
}

/**
 * When the timer next runs the cleanup: Sundays at 3:00 AM UTC.
 * Keep it the same as "triggers" in wrangler.jsonc.
 */
export function nextCleanupRun(now = new Date()) {
  const run = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 3));
  run.setUTCDate(run.getUTCDate() + ((7 - run.getUTCDay()) % 7));
  if (run <= now) run.setUTCDate(run.getUTCDate() + 7);
  return run;
}
