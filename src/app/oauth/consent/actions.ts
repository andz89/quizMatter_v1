"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getAccount } from "@/lib/account";
import { createClient } from "@/lib/supabase/server";
import { isAllowedRedirect, NOT_CLAUDE_MESSAGE } from "./allowedApps";

/**
 * Allow or Deny on the consent page. Supabase records the answer and gives back the link to Claude (with a login
 * code when allowed, or an "access denied" when not), and we send the user there. Only admins can allow for now,
 * and only when the login code goes to Claude's own sites (checked again here, not only on the page).
 * Returns an error message if it failed.
 */
export async function answerConsent(authorizationId: string, allow: boolean): Promise<string> {
  const id = z.string().min(1).max(200).safeParse(authorizationId);
  if (!id.success) return "This link doesn't work anymore. Go back to Claude and click Connect again.";
  if (allow && !(await getAccount()).isAdmin) return "Only QuizMatter admins can connect Claude right now.";

  const supabase = await createClient();
  const failed = "Something went wrong. Go back to Claude and click Connect again.";
  if (allow) {
    const { data: details, error } = await supabase.auth.oauth.getAuthorizationDetails(id.data);
    if (error || !details) return failed;
    if (!isAllowedRedirect("redirect_uri" in details ? details.redirect_uri : details.redirect_url)) {
      return NOT_CLAUDE_MESSAGE;
    }
  }

  const { data, error } = allow
    ? await supabase.auth.oauth.approveAuthorization(id.data, { skipBrowserRedirect: true })
    : await supabase.auth.oauth.denyAuthorization(id.data, { skipBrowserRedirect: true });
  if (error || !data) return failed;
  redirect(data.redirect_url);
}
