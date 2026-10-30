import { notFound } from "next/navigation";
import { getAccount } from "@/lib/account";
import { AnnouncementForm } from "../AnnouncementForm";

/** Admin → Announcements → New (super admin only). */
export default async function NewAnnouncementPage() {
  if (!(await getAccount()).isSuperAdmin) notFound();
  return <AnnouncementForm />;
}
