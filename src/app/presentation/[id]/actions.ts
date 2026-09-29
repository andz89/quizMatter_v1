"use server";

import { reportSchema } from "@/lib/schema";
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
