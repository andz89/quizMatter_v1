import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { R2Bucket } from "@cloudflare/workers-types";

// The weekly photo cleanup, run by Cloudflare on a timer (see worker.ts and "triggers" in wrangler.jsonc).
// It deletes photo files in R2 that no teacher's "My photos" list and no slide uses anymore.
// See docs/photo-cleanup.md.

type CleanupEnv = {
  PHOTOS_BUCKET: R2Bucket;
  SUPABASE_URL: string;
  // Supabase secret key (service role): lets the job see every teacher's photos and slides.
  SUPABASE_SECRET_KEY: string;
};

// Files newer than this are kept even if unused: a teacher may have put one on a slide they haven't saved yet.
const KEEP_NEW_FILES_MS = 7 * 24 * 60 * 60 * 1000;
// A file's address is this + its key ("uploads/…"), like PHOTO_URL_PREFIX in constants.ts.
const PHOTOS_DOMAIN = "https://images.quizmatter.com/";

export async function cleanupPhotos(env: CleanupEnv) {
  // Asked first: if this fails, the job stops before deleting anything.
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const { data, error } = await supabase.rpc("used_photo_srcs");
  if (error) throw error;
  const used = new Set(z.array(z.string()).parse(data));

  const cutoff = Date.now() - KEEP_NEW_FILES_MS;
  const unused: string[] = [];
  let checked = 0;
  let cursor: string | undefined;
  do {
    const page = await env.PHOTOS_BUCKET.list({ prefix: "uploads/", cursor });
    for (const file of page.objects) {
      checked++;
      if (file.uploaded.getTime() < cutoff && !used.has(PHOTOS_DOMAIN + file.key)) unused.push(file.key);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  // R2 deletes up to 1000 files per call.
  for (let i = 0; i < unused.length; i += 1000) {
    await env.PHOTOS_BUCKET.delete(unused.slice(i, i + 1000));
  }
  console.log(`Photo cleanup: checked ${checked} files, deleted ${unused.length}.`, unused);
}
