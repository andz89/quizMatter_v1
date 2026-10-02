"use server";

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
 * with `isSaved` false. The database only takes presentations I can see that aren't mine, MAX_SAVED at most, and
 * 30 saves or removals a minute (QM429).
 */
export async function setPresentationSaved(
  presentationId: string,
  isSaved: boolean,
): Promise<"done" | "limit" | "tooFast" | "banned" | "failed"> {
  // Checked with zod before it's saved (see CLAUDE.md, "Saving Data").
  const saved = savedPresentationSchema.safeParse({ presentation_id: presentationId });
  if (!saved.success) return "failed";

  const supabase = await createClient();
  const { error } = isSaved
    ? await supabase.from("saved_presentations").insert(saved.data)
    : await supabase.from("saved_presentations").delete().eq("presentation_id", saved.data.presentation_id);
  // 23505 = already saved (e.g. from another tab), which is what was asked for.
  if (!error || error.code === "23505") return "done";
  if (error.code === "QMSAV") return "limit";
  if (error.code === "QM429") return "tooFast";
  if (error.code === "QMBAN") return "banned";
  return "failed";
}
