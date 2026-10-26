"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getAccount } from "@/lib/account";
import { createClient } from "@/lib/supabase/server";

// Checked with zod before anything is saved (see CLAUDE.md, "Saving Data"). The database rules also only let
// admins do these.
const idSchema = z.string().min(1).max(100);
const hiddenSchema = z.object({ id: idSchema, isHidden: z.boolean() });

/** Hides a presentation from every teacher but its owner, or shows it again. False if it failed. */
export async function setHidden(id: string, isHidden: boolean): Promise<boolean> {
  const parsed = hiddenSchema.safeParse({ id, isHidden });
  if (!parsed.success || !(await getAccount()).isAdmin) return false;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("presentations")
    .update({ hidden_at: parsed.data.isHidden ? new Date().toISOString() : null })
    .eq("id", parsed.data.id)
    .select("id");
  refresh();
  return !error && data.length === 1;
}

const dismissSchema = z.object({ id: idSchema, newestShown: z.iso.datetime({ offset: true }) });

/**
 * Clears a presentation's reports, when nothing is wrong with it. Only the reports the admin saw: `newestShown` is
 * the newest report's time on the page, so a report that came in since stays. False if it failed.
 */
export async function dismissReports(id: string, newestShown: string): Promise<boolean> {
  const parsed = dismissSchema.safeParse({ id, newestShown });
  if (!parsed.success || !(await getAccount()).isAdmin) return false;

  const supabase = await createClient();
  const { error } = await supabase
    .from("presentation_reports")
    .delete()
    .eq("presentation_id", parsed.data.id)
    .lte("created_at", parsed.data.newestShown);
  refresh();
  return !error;
}

/**
 * Deletes a reported or hidden presentation for good (its slides and reports go with it). An error message, or
 * null. A teacher's shared copy goes with its original, so the teacher can't just publish it again (see the
 * shared_copy_moderation migration). Only one that is reported or hidden: the database refuses a plain admin the
 * rest too (see the plain_admin_limits migration).
 */
export async function deleteReportedPresentation(id: string): Promise<string | null> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success || !(await getAccount()).isAdmin) return "Couldn't delete it. Please try again.";

  const supabase = await createClient();
  const { data: row, error: readError } = await supabase
    .from("presentations")
    .select("shared_from, hidden_at, reports:presentation_reports(count)")
    .eq("id", parsed.data)
    .maybeSingle();
  if (readError || !row) return "Couldn't delete it. Please try again.";
  if (row.hidden_at === null && (row.reports[0]?.count ?? 0) === 0) {
    return "Only a reported or hidden presentation can be deleted here.";
  }
  const { data, error } = await supabase
    .from("presentations")
    .delete()
    .eq("id", row.shared_from ?? parsed.data)
    .select("id");
  refresh();
  // Locked (see the presentation_reviews and quizmatter_submissions migrations): it has to be let go first.
  if (error?.code === "QMREV") {
    return "It's under review or waiting for QuizMatter. Cancel the review (Under review) or send it back (Submissions) first, then delete it.";
  }
  return !error && data.length === 1 ? null : "Couldn't delete it. Please try again.";
}
