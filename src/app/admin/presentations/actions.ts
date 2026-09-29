"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getAccount } from "@/lib/account";
import { createClient } from "@/lib/supabase/server";

const idSchema = z.string().min(1).max(100);
const sharedSchema = z.object({ id: idSchema, isShared: z.boolean() });

/**
 * Shares a QuizMatter presentation with every teacher, or makes it a draft again, then reloads the list.
 * The "Own presentations" policy only lets its owner change it. False if it failed.
 */
export async function setShared(id: string, isShared: boolean): Promise<boolean> {
  const parsed = sharedSchema.safeParse({ id, isShared });
  if (!parsed.success) return false;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("presentations")
    .update({ is_published: parsed.data.isShared })
    .eq("id", parsed.data.id)
    .eq("from_admin", true)
    .select("id");
  refresh();
  return !error && data.length === 1;
}

/**
 * Moves one of an admin's own presentations (from their home page) to Admin → Presentations, as a QuizMatter
 * presentation. It comes as a draft (not shared), so teachers only get it once the admin clicks Share. Only admins:
 * the "Only admins save admin presentations" database rule blocks anyone else too. False if it failed.
 */
export async function moveToQuizMatter(id: string): Promise<boolean> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success || !(await getAccount()).isAdmin) return false;

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const { data, error } = await supabase
    .from("presentations")
    .update({ from_admin: true, is_published: false })
    .eq("id", parsed.data)
    .eq("owner_id", claims?.claims.sub ?? "")
    .eq("from_admin", false)
    .select("id");
  refresh();
  return !error && data.length === 1;
}
