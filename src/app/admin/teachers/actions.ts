"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getAccount } from "@/lib/account";
import { banSchema } from "@/lib/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Supabase's ban lasts this long: 100 years, so until an admin unbans.
const FOREVER = "876000h";

/**
 * Bans a teacher: saves the reason (banned_users stops their saves and photo uploads at once), then sets
 * Supabase's own ban (they can't log in, and their login stops working within the hour). Admins can't be banned
 * (the database refuses it). Returns an error message, or null if it worked.
 */
export async function banTeacher(userId: string, reason: string): Promise<string | null> {
  // Checked with zod before anything is saved (see CLAUDE.md, "Saving Data").
  const parsed = banSchema.safeParse({ user_id: userId, reason });
  if (!parsed.success) return parsed.error.issues[0].message;
  const account = await getAccount();
  if (!account.isAdmin) return "Only admins can ban teachers.";
  if (parsed.data.user_id === account.id) return "You can't ban yourself.";
  const admin = createAdminClient();
  if (!admin) return "The server is missing SUPABASE_SECRET_KEY.";

  const supabase = await createClient();
  const { error } = await supabase.from("banned_users").upsert(parsed.data);
  if (error) {
    refresh();
    return error.code === "42501" ? "Admins can't be banned." : "Couldn't ban this teacher. Please try again.";
  }
  const { error: authError } = await admin.auth.admin.updateUserById(parsed.data.user_id, { ban_duration: FOREVER });
  if (authError) {
    // Don't leave half a ban.
    await supabase.from("banned_users").delete().eq("user_id", parsed.data.user_id);
    refresh();
    return "Couldn't ban this teacher. Please try again.";
  }
  refresh();
  return null;
}

const editorSchema = z.object({ user_id: z.uuid(), isEditor: z.boolean() });

/**
 * Gives a teacher the editor role (they can review QuizMatter presentations) or takes it away. Taking it away
 * cancels any review they have open. Returns an error message, or null if it worked.
 */
export async function setEditor(userId: string, isEditor: boolean): Promise<string | null> {
  // Checked with zod before anything is saved (see CLAUDE.md, "Saving Data").
  const parsed = editorSchema.safeParse({ user_id: userId, isEditor });
  if (!parsed.success) return "Couldn't change the editor role.";
  if (!(await getAccount()).isAdmin) return "Only admins can change the editor role.";

  const supabase = await createClient();
  const { error } = parsed.data.isEditor
    ? await supabase.from("editors").upsert({ user_id: parsed.data.user_id })
    : await supabase.from("editors").delete().eq("user_id", parsed.data.user_id);
  refresh();
  return error ? "Couldn't change the editor role. Please try again." : null;
}

/** Lifts a ban: they can log in and save again. Returns an error message, or null if it worked. */
export async function unbanTeacher(userId: string): Promise<string | null> {
  const parsed = z.uuid().safeParse(userId);
  if (!parsed.success) return "Couldn't unban this teacher.";
  if (!(await getAccount()).isAdmin) return "Only admins can unban teachers.";
  const admin = createAdminClient();
  if (!admin) return "The server is missing SUPABASE_SECRET_KEY.";

  const { error: authError } = await admin.auth.admin.updateUserById(parsed.data, { ban_duration: "none" });
  if (authError) return "Couldn't unban this teacher. Please try again.";
  const supabase = await createClient();
  const { error } = await supabase.from("banned_users").delete().eq("user_id", parsed.data);
  refresh();
  return error ? "Couldn't unban this teacher. Please try again." : null;
}
