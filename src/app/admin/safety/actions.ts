"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getAccount } from "@/lib/account";
import { createAdminClient } from "@/lib/supabase/admin";

// Checked with zod before anything is saved (see CLAUDE.md, "Saving Data").
const releaseSchema = z.object({ user_id: z.uuid(), feature: z.string().min(1).max(50) });
// The Release / Reset count row on the History tab (the click_history table).
const releaseHistorySchema = releaseSchema.extend({ kind: z.literal("release") });

/**
 * Ends a teacher's pause on a feature now and starts their chain of pauses again from 0, so they're no longer close
 * to an automatic ban (see the click_auto_ban migration). Admins only. Returns an error message, or null if it worked.
 */
export async function releasePause(userId: string, feature: string): Promise<string | null> {
  const parsed = releaseSchema.safeParse({ user_id: userId, feature });
  if (!parsed.success) return "Couldn't release this teacher.";
  if (!(await getAccount()).isAdmin) return "Only admins can release teachers.";
  // click_rate has no policies (only the database's own functions change it), so this needs the secret key.
  const admin = createAdminClient();
  if (!admin) return "The server is missing SUPABASE_SECRET_KEY.";

  // Only rows that are paused or still count toward a ban, so a second Release (e.g. from another admin) changes
  // nothing and isn't written to the history.
  const { data, error } = await admin
    .from("click_rate")
    .update({ paused_until: null, pause_streak: 0, clicks: 0 })
    .eq("user_id", parsed.data.user_id)
    .eq("feature", parsed.data.feature)
    .gt("pause_streak", 0)
    .select("user_id");
  if (error) return "Couldn't release this teacher. Please try again.";
  refresh();
  if (data.length === 0) return "This teacher isn't paused any more.";

  // Shown on the History tab. The release itself already worked, so a failure here only leaves it out.
  await admin.from("click_history").insert(releaseHistorySchema.parse({ ...parsed.data, kind: "release" }));
  return null;
}
