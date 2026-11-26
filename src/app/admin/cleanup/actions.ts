"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getAccount } from "@/lib/account";
import { KEEP_NEW_FILES_MS, findUnusedPhotos, fixPhotoUploadSizes, isPastKeepTime, nextCleanupRun } from "@/lib/cleanupPhotos";
import { formatBytes, formatUtcDay } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { CleanupFile } from "./CleanupList";

/**
 * The "Find unused photos" button: the photo files nothing uses, which the weekly cleanup will delete, found
 * the same way the cleanup finds them (see lib/cleanupPhotos.ts), and how much is stored in all.
 * Null if it failed. Super admin only (admin_used_photo_srcs() also refuses anyone else).
 * It also sends the real size of photos still counted at 2 MB in teachers' photo storage (uploaded before the
 * limit), the same step the weekly cleanup does, so running it once after the photo storage migration means
 * nobody waits for Sunday. `sizesFixed`: how many (null if that step failed; the list still shows).
 */
export async function findCleanupFiles(): Promise<{ files: CleanupFile[]; stored: string; sizesFixed: number | null } | null> {
  if (!(await getAccount()).isSuperAdmin) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_used_photo_srcs");
  if (error) return null;

  const { unused, checked, totalSize, sizes } = await findUnusedPhotos(getCloudflareContext().env.PHOTOS_BUCKET, data);
  // Secret key: the size functions are the server's only.
  const admin = createAdminClient();
  const fixed = admin ? await fixPhotoUploadSizes(admin, sizes) : null;
  const sizesFixed = typeof fixed === "number" ? fixed : null;
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
        canDelete: isPastKeepTime(file.uploaded),
        deleteOn: formatUtcDay(uploaded < cutoff ? nextRun : nextCleanupRun(new Date(uploaded + KEEP_NEW_FILES_MS))),
      };
    });

  return { files, stored: `${checked} ${checked === 1 ? "file" : "files"} stored (${formatBytes(totalSize)})`, sizesFixed };
}
