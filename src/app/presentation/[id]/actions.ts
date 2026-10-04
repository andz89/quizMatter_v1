"use server";

import { pausedUntilFromError } from "@/lib/clickLimits";
import { reportSchema, savedPresentationSchema } from "@/lib/schema";
import { createClient } from "@/lib/supabase/server";

/**
 * Reports another teacher's published presentation to the admins (Admin → Reports). The database only takes
 * reports of other people's presentations, one per teacher per presentation.
 */
export async function reportPresentation(
  presentationId: string,
  reason: string,
  note: string,
): Promise<"reported" | "already" | "failed"> {
  // Checked with zod before it's saved (see CLAUDE.md, "Saving Data").
  const report = reportSchema.safeParse({ presentation_id: presentationId, reason, note });
  if (!report.success) return "failed";

  const supabase = await createClient();
  const { error } = await supabase.from("presentation_reports").insert(report.data);
  // 23505 = this teacher already reported it (the table allows one report each).
  if (error?.code === "23505") return "already";
  return error ? "failed" : "reported";
}

/**
 * Saves (bookmarks) someone else's published presentation to my "Saved" row on the home page, or takes it off
 * with `isSaved` false. The database (set_saved) only takes presentations I can see that aren't mine, MAX_SAVED at
 * most. Clicking too fast pauses saving for a while ("paused", with `pausedUntil`; see the click_limits migration).
 */
export async function setPresentationSaved(
  presentationId: string,
  isSaved: boolean,
): Promise<{ status: "done" | "limit" | "banned" | "paused" | "failed"; pausedUntil?: number }> {
  // Checked with zod before it's saved (see CLAUDE.md, "Saving Data").
  const saved = savedPresentationSchema.safeParse({ presentation_id: presentationId });
  if (!saved.success) return { status: "failed" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_saved", {
    presentation_id: saved.data.presentation_id,
    is_saved: isSaved,
  });
  const pausedUntil = pausedUntilFromError(error);
  if (pausedUntil) return { status: "paused", pausedUntil };
  if (error) return { status: "failed" };
  return data === "done" || data === "limit" || data === "banned" ? { status: data } : { status: "failed" };
}
