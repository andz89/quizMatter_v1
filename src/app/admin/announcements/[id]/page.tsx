import { notFound } from "next/navigation";
import { z } from "zod";
import { getAccount } from "@/lib/account";
import { announcementSchema } from "@/lib/announcements";
import { createClient } from "@/lib/supabase/server";
import { AnnouncementForm } from "../AnnouncementForm";
import type { AnnouncementRow } from "../AnnouncementList";

/** Admin → Announcements → Edit (super admin only). Reads it through admin_announcements (no one reads the table). */
export default async function EditAnnouncementPage({ params }: PageProps<"/admin/announcements/[id]">) {
  if (!(await getAccount()).isSuperAdmin) notFound();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { data, error } = await (await createClient()).rpc("admin_announcements");
  if (error) throw error;
  const row = (data as AnnouncementRow[]).find((a) => a.id === id);
  if (!row) notFound();
  // Only the form's fields (the row also has its status and counts).
  const initial = Object.fromEntries(
    Object.keys(announcementSchema.shape).map((key) => [key, row[key as keyof AnnouncementRow]]),
  ) as z.infer<typeof announcementSchema>;
  return <AnnouncementForm initial={initial} />;
}
