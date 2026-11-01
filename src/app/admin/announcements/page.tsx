import { notFound } from "next/navigation";
import { getAccount } from "@/lib/account";
import { createClient } from "@/lib/supabase/server";
import { AnnouncementList, type AnnouncementRow } from "./AnnouncementList";
import { AnnouncementTabs } from "./AnnouncementTabs";

/**
 * Admin → Announcements (super admin only): every announcement, newest first, with its status, how many accounts
 * match it now and how many closed each part. How it works: root CLAUDE.md, "Announcements".
 */
export default async function AdminAnnouncementsPage() {
  // The layout checks too, but a layout doesn't run again on every request, so the page checks next to its data.
  if (!(await getAccount()).isSuperAdmin) notFound();
  const { data, error } = await (await createClient()).rpc("admin_announcements");
  if (error) throw error;
  return (
    <div className="flex flex-col gap-5">
      <AnnouncementTabs />
      <AnnouncementList rows={data as AnnouncementRow[]} />
    </div>
  );
}
