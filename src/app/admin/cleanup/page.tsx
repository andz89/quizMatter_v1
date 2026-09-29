import { getCloudflareContext } from "@opennextjs/cloudflare";
import { KEEP_NEW_FILES_MS, findUnusedPhotos, nextCleanupRun } from "@/lib/cleanupPhotos";
import { createClient } from "@/lib/supabase/server";
import { CleanupList, type CleanupFile } from "./CleanupList";

/**
 * Admin → Photo cleanup: the photo files nothing uses, which the weekly cleanup will delete, found the same
 * way the cleanup finds them (see lib/cleanupPhotos.ts). (../layout.tsx checks the user is an admin.)
 */
export default async function AdminCleanupPage() {
  const supabase = await createClient();
  const [used, categories] = await Promise.all([
    supabase.rpc("admin_used_photo_srcs"),
    supabase.from("photo_categories").select("id, name").order("name"),
  ]);
  if (used.error) throw used.error;
  if (categories.error) throw categories.error;

  const { unused, checked, totalSize } = await findUnusedPhotos(getCloudflareContext().env.PHOTOS_BUCKET, used.data);
  const nextRun = nextCleanupRun();
  // Files uploaded before this are old enough for the next run to delete.
  const cutoff = nextRun.getTime() - KEEP_NEW_FILES_MS;

  const files: CleanupFile[] = unused
    .sort((a, b) => b.uploaded.getTime() - a.uploaded.getTime())
    .map((file) => {
      const uploaded = file.uploaded.getTime();
      return {
        src: file.src,
        uploaded: formatDate(file.uploaded),
        size: formatSize(file.size),
        isNextRun: uploaded < cutoff,
        deleteOn: formatDate(uploaded < cutoff ? nextRun : nextCleanupRun(new Date(uploaded + KEEP_NEW_FILES_MS))),
      };
    });

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-card border border-border-default bg-bg-surface px-5 py-4">
        <h2 className="text-[15px] font-extrabold text-text-primary">Next cleanup: {formatDate(nextRun)}, 3:00 AM UTC</h2>
        <p className="mt-1 text-sm text-text-secondary">
          {checked} {checked === 1 ? "file" : "files"} stored ({formatSize(totalSize)}). The cleanup deletes files that no
          slide, &ldquo;My photos&rdquo; list or shared photo uses, once they&apos;re more than 7 days old. Keep a photo to save it.
        </p>
      </section>
      <CleanupList files={files} categories={categories.data} />
    </div>
  );
}

// Dates in UTC, like the cleanup's timer, e.g. "Sun, Oct 4".
function formatDate(date: Date) {
  return date.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
