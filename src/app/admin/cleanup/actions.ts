"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getAccount } from "@/lib/account";
import { KEEP_NEW_FILES_MS, findUnusedPhotos, nextCleanupRun } from "@/lib/cleanupPhotos";
import { formatBytes, formatUtcDay } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { CleanupFile } from "./CleanupList";

/**
 * The "Find unused photos" button: the photo files nothing uses, which the weekly cleanup will delete, found
 * the same way the cleanup finds them (see lib/cleanupPhotos.ts), and how much is stored in all.
 * Null if it failed. Admins only (admin_used_photo_srcs() also refuses anyone else).
 */
export async function findCleanupFiles(): Promise<{ files: CleanupFile[]; stored: string } | null> {
  if (!(await getAccount()).isAdmin) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_used_photo_srcs");
  if (error) return null;

  const { unused, checked, totalSize } = await findUnusedPhotos(getCloudflareContext().env.PHOTOS_BUCKET, data);
  const nextRun = nextCleanupRun();
  // Files uploaded before this are old enough for the next run to delete.
  const cutoff = nextRun.getTime() - KEEP_NEW_FILES_MS;

  const files: CleanupFile[] = unused
    .sort((a, b) => b.uploaded.getTime() - a.uploaded.getTime())
    .map((file) => {
      const uploaded = file.uploaded.getTime();
      return {
        src: file.src,
        uploaded: formatUtcDay(file.uploaded),
        size: formatBytes(file.size),
        bytes: file.size,
        isNextRun: uploaded < cutoff,
        deleteOn: formatUtcDay(uploaded < cutoff ? nextRun : nextCleanupRun(new Date(uploaded + KEEP_NEW_FILES_MS))),
      };
    });

  return { files, stored: `${checked} ${checked === 1 ? "file" : "files"} stored (${formatBytes(totalSize)})` };
}
