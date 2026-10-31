"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getAccount } from "@/lib/account";
import { forgetMaintenanceStatus, MAINTENANCE_MESSAGE_MAX } from "@/lib/maintenance";
import { createClient } from "@/lib/supabase/server";

// Checked with zod before anything is saved (see CLAUDE.md, "Saving Data").
const noteSchema = z.string().trim().max(MAINTENANCE_MESSAGE_MAX, `Keep the note under ${MAINTENANCE_MESSAGE_MAX} characters.`);
const setSchema = z.object({ turn_on: z.boolean(), note: noteSchema });
const announceSchema = z.object({ planned: z.iso.datetime({ offset: true }).nullable(), note: noteSchema });

/** Turns maintenance on or off (the `set_maintenance` rpc adds or removes the database guard). Super admin only. */
export async function setMaintenance(turnOn: boolean, note: string): Promise<string | null> {
  const parsed = setSchema.safeParse({ turn_on: turnOn, note });
  if (!parsed.success) return parsed.error.issues[0].message;
  if (!(await getAccount()).isSuperAdmin) return "Only the super admin can do this.";

  const { error } = await (await createClient()).rpc("set_maintenance", parsed.data);
  if (error) return turnOn ? "Couldn't turn maintenance on. Please try again." : "Couldn't turn maintenance off. Please try again.";
  forgetMaintenanceStatus();
  refresh();
  return null;
}

/** Announces when maintenance starts (null takes the announcement away). Super admin only. */
export async function announceMaintenance(planned: string | null, note: string): Promise<string | null> {
  const parsed = announceSchema.safeParse({ planned, note });
  if (!parsed.success) return parsed.error.issues[0].message;
  if (!(await getAccount()).isSuperAdmin) return "Only the super admin can do this.";

  const { error } = await (await createClient()).rpc(
    "announce_maintenance",
    // planned null takes the announcement away; the generated types can't say an argument may be null.
    parsed.data as { planned: string; note: string }
  );
  // 22023: the time is past, or maintenance is already on (the database's own words).
  if (error) return error.code === "22023" ? error.message : "Couldn't save the announcement. Please try again.";
  forgetMaintenanceStatus();
  refresh();
  return null;
}
