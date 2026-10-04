"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getAccount } from "@/lib/account";
import { reviewNoteSchema } from "@/lib/schema";
import { createClient } from "@/lib/supabase/server";

const idSchema = z.string().min(1).max(100);
const sharedSchema = z.object({ id: idSchema, isShared: z.boolean() });
const reviewOpenSchema = z.object({ id: idSchema, isOpen: z.boolean() });
const sendBackSchema = z.object({ id: idSchema, note: reviewNoteSchema });

/**
 * Shares a QuizMatter presentation with every teacher, or makes it a draft again, then reloads the list.
 * The "Own presentations" policy only lets its owner change it. False if it failed.
 */
export async function setShared(id: string, isShared: boolean): Promise<boolean> {
  const parsed = sharedSchema.safeParse({ id, isShared });
  if (!parsed.success || !(await getAccount()).isAdmin) return false;

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

/** The "Open to all editors" switch: any editor may start the next review. False if it failed. */
export async function setReviewOpen(id: string, isOpen: boolean): Promise<boolean> {
  // Checked with zod before anything is saved (see CLAUDE.md, "Saving Data").
  const parsed = reviewOpenSchema.safeParse({ id, isOpen });
  if (!parsed.success || !(await getAccount()).isAdmin) return false;

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_review_open", { target_id: parsed.data.id, is_open: parsed.data.isOpen });
  refresh();
  return !error;
}

/** Publishes a submitted review: its changes go live and its reviewer is listed. An error message, or null. */
export async function publishReview(id: string): Promise<string | null> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success || !(await getAccount()).isAdmin) return "Only admins can publish reviews.";

  const supabase = await createClient();
  const { error } = await supabase.rpc("publish_review", { target_id: parsed.data });
  refresh();
  if (error?.code === "QMRVW") return "This review isn't waiting to be published anymore.";
  if (error?.code === "QMBRV") return "This reviewer is banned, so their review can't be published. Send it back or cancel it.";
  return error ? "Couldn't publish the review. Please try again." : null;
}

/**
 * Ends a review that's going on or waiting (e.g. its editor stopped answering): the draft is thrown away and the
 * live presentation stays as it was, like the reviewer's Stop review. An error message, or null.
 */
export async function cancelReview(id: string): Promise<string | null> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success || !(await getAccount()).isAdmin) return "Only admins can cancel reviews.";

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_cancel_review", { target_id: parsed.data });
  refresh();
  return error ? "Couldn't cancel the review. Please try again." : null;
}

/** Sends a submitted review back to its reviewer with a note. An error message, or null. */
export async function sendBackReview(id: string, note: string): Promise<string | null> {
  // Checked with zod before anything is saved (see CLAUDE.md, "Saving Data").
  const parsed = sendBackSchema.safeParse({ id, note });
  if (!parsed.success) return parsed.error.issues[0].message;
  if (!(await getAccount()).isAdmin) return "Only admins can send reviews back.";

  const supabase = await createClient();
  const { error } = await supabase.rpc("send_back_review", { target_id: parsed.data.id, note: parsed.data.note });
  refresh();
  if (error?.code === "QMRVW") return "This review isn't waiting to be published anymore.";
  return error ? "Couldn't send the review back. Please try again." : null;
}
