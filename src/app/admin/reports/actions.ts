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

/** Clears a presentation's reports, when nothing is wrong with it. False if it failed. */
export async function dismissReports(id: string): Promise<boolean> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success || !(await getAccount()).isAdmin) return false;

  const supabase = await createClient();
  const { error } = await supabase.from("presentation_reports").delete().eq("presentation_id", parsed.data);
  refresh();
  return !error;
}

/** Deletes a reported presentation for good (its slides and reports go with it). False if it failed. */
export async function deleteReportedPresentation(id: string): Promise<boolean> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success || !(await getAccount()).isAdmin) return false;

  const supabase = await createClient();
  const { data, error } = await supabase.from("presentations").delete().eq("id", parsed.data).select("id");
  refresh();
  return !error && data.length === 1;
}
