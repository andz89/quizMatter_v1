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
  if (!account.isSuperAdmin) return "Only the super admin can ban teachers.";
  if (parsed.data.user_id === account.id) return "You can't ban yourself.";
  const admin = createAdminClient();
  if (!admin) return "The server is missing SUPABASE_SECRET_KEY.";

  const supabase = await createClient();
  // Someone already banned keeps their ban if Supabase's step fails below, so remember whether the row was there.
  const { data: existing, error: readError } = await supabase
    .from("banned_users")
    .select("user_id")
    .eq("user_id", parsed.data.user_id)
    .maybeSingle();
  if (readError) return "Couldn't ban this teacher. Please try again.";
  // A ban by hand is never marked automatic (even when it replaces an automatic one).
  const { error } = await supabase.from("banned_users").upsert({ ...parsed.data, is_automatic: false });
  if (error) {
    refresh();
    return error.code === "42501" ? "Admins can't be banned." : "Couldn't ban this teacher. Please try again.";
  }
  const { error: authError } = await admin.auth.admin.updateUserById(parsed.data.user_id, { ban_duration: FOREVER });
  if (authError) {
    // Don't leave half a ban, but never drop one that was already there.
    if (!existing) await supabase.from("banned_users").delete().eq("user_id", parsed.data.user_id);
    refresh();
    return "Couldn't ban this teacher. Please try again.";
  }
  // Shown in Admin → Admin log. The ban already worked, so a failure here only leaves it out.
  await supabase.rpc("log_ban", { target: parsed.data.user_id });
  refresh();
  return null;
}

const editorSchema = z.object({ user_id: z.uuid(), isEditor: z.boolean() });

/**
 * Gives a teacher the editor role (they can review QuizMatter presentations) or takes it away. Only the super admin
 * gives it (it removes the teacher's published copies), never to an admin or a banned teacher; any admin takes it
 * away (Admin → Editors), which cancels any review they have open. The database checks the same (see the
 * plain_admin_limits migration). Returns an error message, or null if it worked.
 */
export async function setEditor(userId: string, isEditor: boolean): Promise<string | null> {
  // Checked with zod before anything is saved (see CLAUDE.md, "Saving Data").
  const parsed = editorSchema.safeParse({ user_id: userId, isEditor });
  if (!parsed.success) return "Couldn't change the editor role.";
  const account = await getAccount();
  if (!account.isAdmin) return "Only admins can change the editor role.";
  if (parsed.data.isEditor && !account.isSuperAdmin) return "Only the super admin can make editors.";

  const supabase = await createClient();
  // Someone who is already an editor stays as they are ("on conflict do nothing": nobody may change a row).
  const { error } = parsed.data.isEditor
    ? await supabase.from("editors").upsert({ user_id: parsed.data.user_id }, { ignoreDuplicates: true })
    : await supabase.from("editors").delete().eq("user_id", parsed.data.user_id);
  refresh();
  // The database refuses an admin or a banned teacher ("Make editor" is hidden on those rows).
  if (parsed.data.isEditor && error?.code === "42501") return "Admins and banned teachers can't be editors.";
  return error ? "Couldn't change the editor role. Please try again." : null;
}

/** Lifts a ban: they can log in and save again. Returns an error message, or null if it worked. */
export async function unbanTeacher(userId: string): Promise<string | null> {
  const parsed = z.uuid().safeParse(userId);
  if (!parsed.success) return "Couldn't unban this teacher.";
  if (!(await getAccount()).isSuperAdmin) return "Only the super admin can unban teachers.";
  const admin = createAdminClient();
  if (!admin) return "The server is missing SUPABASE_SECRET_KEY.";

  const { error: authError } = await admin.auth.admin.updateUserById(parsed.data, { ban_duration: "none" });
  if (authError) return "Couldn't unban this teacher. Please try again.";
  const supabase = await createClient();
  const { error } = await supabase.from("banned_users").delete().eq("user_id", parsed.data);
  if (!error) await supabase.rpc("log_unban", { target: parsed.data });
  refresh();
  return error ? "Couldn't unban this teacher. Please try again." : null;
}
