import { notFound } from "next/navigation";
import { getAccount } from "@/lib/account";
import type { AnnouncementPhoto } from "@/lib/announcements";
import { createClient } from "@/lib/supabase/server";
import { AnnouncementTabs } from "../AnnouncementTabs";
import { AnnouncementPhotos } from "./AnnouncementPhotos";

/**
 * Admin → Announcements → Photos (super admin only): every announcement photo, newest first, from
 * admin_announcement_photos. Spec: docs/superpowers/specs/2026-11-01-announcement-photos-design.md.
 */
export default async function AnnouncementPhotosPage() {
  // The layout checks too, but a layout doesn't run again on every request, so the page checks next to its data.
  if (!(await getAccount()).isSuperAdmin) notFound();
  const { data, error } = await (await createClient()).rpc("admin_announcement_photos");
  if (error) throw error;
  return (
    <div className="flex flex-col gap-5">
      <AnnouncementTabs />
      <AnnouncementPhotos photos={data as AnnouncementPhoto[]} />
    </div>
  );
}
