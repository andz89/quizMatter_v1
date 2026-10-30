import { getAccount } from "@/lib/account";
import { getMaintenanceStatus } from "@/lib/maintenance";
import { MaintenanceNotice } from "./MaintenanceNotice";

/** "Sat, Nov 1, 10:00 PM" in Philippine time (the app's time zone, like the daily click limits). */
const formatPlanned = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila",
  }).format(new Date(iso));

/**
 * The maintenance notice on every page (root layout): announced maintenance for everyone (Admin → Maintenance →
 * Announce), and "Maintenance is ON" for the super admin, the only one who still gets the app's pages then. Reads
 * the remembered status (src/lib/maintenance.ts: no database call most of the time); the account only while
 * maintenance is on.
 */
export async function MaintenanceBar() {
  const status = await getMaintenanceStatus();
  if (status.isOn) {
    return (await getAccount()).isSuperAdmin ? <MaintenanceNotice isOn /> : null;
  }
  if (!status.plannedAt) return null;
  return <MaintenanceNotice isOn={false} plannedLabel={formatPlanned(status.plannedAt)} message={status.message} />;
}
