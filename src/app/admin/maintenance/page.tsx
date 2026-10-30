import { notFound } from "next/navigation";
import { getAccount } from "@/lib/account";
import { fetchMaintenanceStatus } from "@/lib/maintenance";
import { MaintenanceControls } from "./MaintenanceControls";

/**
 * Admin → Maintenance (super admin only): turn maintenance on and off, and announce it ahead. How it works: the root
 * CLAUDE.md, "Maintenance".
 */
export default async function AdminMaintenancePage() {
  // The layout checks too, but a layout doesn't run again on every request, so the page checks next to its data.
  if (!(await getAccount()).isSuperAdmin) notFound();
  // Fresh from the database (not the remembered status), so the page always shows the truth.
  const status = await fetchMaintenanceStatus(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  if (!status) throw new Error("Couldn't read the maintenance status.");

  return <MaintenanceControls status={status} />;
}
