import { notFound } from "next/navigation";
import { getAccount } from "@/lib/account";
import { nextCleanupRun } from "@/lib/cleanupPhotos";
import { formatUtcDay } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { CleanupList } from "./CleanupList";

/**
 * Admin → Photo cleanup: when the weekly cleanup runs next, and a button to find the photo files it will
 * delete (see actions.ts). The search only runs when asked, so opening the page stays quick.
 */
export default async function AdminCleanupPage() {
  // The layout checks too, but a layout doesn't run again on every request, so the page checks next to its data.
  if (!(await getAccount()).isAdmin) notFound();
  const supabase = await createClient();
  const { data: categories, error } = await supabase.from("photo_categories").select("id, name").order("name");
  if (error) throw error;

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-card border border-border-default bg-bg-surface px-5 py-4">
        <h2 className="text-[15px] font-extrabold text-text-primary">Next cleanup: {formatUtcDay(nextCleanupRun())}, 3:00 AM UTC</h2>
        <p className="mt-1 text-sm text-text-secondary">
          The cleanup deletes files that no slide, &ldquo;My photos&rdquo; list or shared photo uses, once they&apos;re more
          than 7 days old. Keep a photo to save it.
        </p>
      </section>
      <CleanupList categories={categories} />
    </div>
  );
}
