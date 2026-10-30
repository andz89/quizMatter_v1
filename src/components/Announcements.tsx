import { getMaintenanceStatus } from "@/lib/maintenance";
import { AnnouncementsWatch } from "./AnnouncementsWatch";

/**
 * Announcements for logged-in teachers (root layout). The remembered maintenance status carries a key that's empty
 * when nothing is live, so on most days this adds nothing to the page and asks the database nothing.
 */
export async function Announcements() {
  const { announcementsKey } = await getMaintenanceStatus();
  return announcementsKey ? <AnnouncementsWatch announcementsKey={announcementsKey} /> : null;
}
