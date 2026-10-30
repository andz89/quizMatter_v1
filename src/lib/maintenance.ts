import { z } from "zod";

// Maintenance mode (supabase/migrations/20261219000000_maintenance.sql; notes: the root CLAUDE.md, "Maintenance").
// Read by the proxy, the root layout's bar, the maintenance page, Claude's connector and the cleanup timers.

/** The note's longest length. Same as the database's check on maintenance.message. */
export const MAINTENANCE_MESSAGE_MAX = 300;

/** Sent on `window` right before an open tab goes to /maintenance, so the editor can keep unsaved work first. */
export const MAINTENANCE_EVENT = "qm:maintenance";

/** The refusal code for everything stopped by maintenance (the database guard and the proxy). */
export const MAINTENANCE_CODE = "QMMNT";

/** The proxy's header on a refused request (a server action, an in-app page load, /api/*). */
export const MAINTENANCE_HEADER = "x-qm-maintenance";

export const MAINTENANCE_WORDS = "QuizMatter is under maintenance. Please try again later.";

export type MaintenanceStatus = {
  isOn: boolean;
  message: string;
  // When it was turned on (ISO time), or null.
  startedAt: string | null;
  // The announced start, only while it's still ahead, or null.
  plannedAt: string | null;
};

const statusSchema = z.object({
  is_on: z.boolean(),
  message: z.string(),
  started_at: z.string().nullable(),
  planned_at: z.string().nullable(),
});

/**
 * Asks the database (the `maintenance_status` rpc; anyone may call it, and the guard lets it through). Null when it
 * can't be read; each caller decides what that means. Plain fetch, so the worker's timers can use it too.
 */
export async function fetchMaintenanceStatus(url: string, key: string): Promise<MaintenanceStatus | null> {
  try {
    const response = await fetch(`${url}/rest/v1/rpc/maintenance_status`, {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
    });
    if (!response.ok) return null;
    const row = statusSchema.parse(await response.json());
    return { isOn: row.is_on, message: row.message, startedAt: row.started_at, plannedAt: row.planned_at };
  } catch {
    return null;
  }
}

// Kept in this server copy's memory for 60 seconds, so the proxy and the layout ask the database at most once a
// minute per copy, and only when someone opens a page. The database guard has no such delay.
const REMEMBER_MS = 60_000;
let remembered: { status: MaintenanceStatus; at: number } | null = null;

const OFF: MaintenanceStatus = { isOn: false, message: "", startedAt: null, plannedAt: null };

/**
 * The status for the app's server (proxy, pages). If the database can't be read it counts as off, so a hiccup
 * doesn't send everyone to the maintenance page (the database guard still stops them if it's really on).
 */
export async function getMaintenanceStatus(): Promise<MaintenanceStatus> {
  if (remembered && Date.now() - remembered.at < REMEMBER_MS) return remembered.status;
  const status = await fetchMaintenanceStatus(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  if (!status) return remembered?.status ?? OFF;
  remembered = { status, at: Date.now() };
  return status;
}

/** Forgets the remembered status (after the super admin changes it), so this server copy shows the change at once. */
export function forgetMaintenanceStatus() {
  remembered = null;
}
