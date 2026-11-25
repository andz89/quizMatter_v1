import { createClient } from "@supabase/supabase-js";
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
  const unknown = await supabase.rpc("photo_uploads_unknown_sizes");
  if (unknown.error) return console.error("Photo cleanup: couldn't read the sizes to fix.", unknown.error);
  const fixes = sizesToFix(z.array(z.string()).parse(unknown.data), sizes);
  if (Object.keys(fixes).length === 0) return;
  const { error: fixError } = await supabase.rpc("set_photo_upload_sizes", { sizes: fixes });
  if (fixError) console.error("Photo cleanup: couldn't fix the sizes.", fixError);
  else console.log(`Photo cleanup: fixed ${Object.keys(fixes).length} photo sizes.`);
}

/** The real sizes (from R2's listing) of the estimated photos that are still in R2: { src: bytes }. */
export function sizesToFix(unknown: string[], sizes: Map<string, number>): Record<string, number> {
  const fixes: Record<string, number> = {};
  for (const src of unknown) {
    const size = sizes.get(src);
    if (size !== undefined) fixes[src] = size;
  }
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
