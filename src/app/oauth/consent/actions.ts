"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getAccount } from "@/lib/account";
import { createClient } from "@/lib/supabase/server";

/**
 * Allow or Deny on the consent page. Supabase records the answer and gives back the link to Claude (with a login
 * code when allowed, or an "access denied" when not), and we send the user there. Only admins can allow for now.
 * Returns an error message if it failed.
 */
export async function answerConsent(authorizationId: string, allow: boolean): Promise<string> {
  const id = z.string().min(1).max(200).safeParse(authorizationId);
  if (!id.success) return "This link doesn't work anymore. Go back to Claude and click Connect again.";
  if (allow && !(await getAccount()).isAdmin) return "Only QuizMatter admins can connect Claude right now.";

  const supabase = await createClient();
  const { data, error } = allow
    ? await supabase.auth.oauth.approveAuthorization(id.data, { skipBrowserRedirect: true })
    : await supabase.auth.oauth.denyAuthorization(id.data, { skipBrowserRedirect: true });
  if (error || !data) return "Something went wrong. Go back to Claude and click Connect again.";
  redirect(data.redirect_url);
}
