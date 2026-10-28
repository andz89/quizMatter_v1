"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getAccount } from "@/lib/account";
import { createClient } from "@/lib/supabase/server";

/**
 * Removes an editor's profile photo (Admin → Editors → the editor). Any admin may; their daily count stays as it is.
 * The database logs it in the Admin log (admin_remove_profile_photo). Returns an error message, or null if it worked.
 */
export async function removeEditorPhoto(userId: string): Promise<string | null> {
  // Checked with zod before anything is saved (see CLAUDE.md, "Saving Data").
  const parsed = z.uuid().safeParse(userId);
  if (!parsed.success) return "Couldn't remove the photo.";
  if (!(await getAccount()).isAdmin) return "Only admins can remove a profile photo.";

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_remove_profile_photo", { target: parsed.data });
  refresh();
  return error ? "Couldn't remove the photo. Please try again." : null;
}
