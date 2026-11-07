"use server";

import { redirect } from "next/navigation";
import { badLinkDestination, emailLinkPath, emailLinkResult, emailLinkSchema } from "@/lib/emailLinks";
import { createClient } from "@/lib/supabase/server";

/**
 * The Continue button on /auth/confirm: only here is the email link used. Checks the link again (zod), refuses while
 * someone is logged in (back to the page, which says to log out first: a link never swaps the browser into another
 * account), then checks the token with Supabase, which logs the teacher in, and opens the next page (emailLinkResult:
 * it also tells a used link from a banned account, and from Supabase not answering, when the link still works).
 */
export async function openEmailLink(formData: FormData) {
  const type = formData.get("type");
  const link = emailLinkSchema.safeParse({ token_hash: formData.get("token_hash"), type });
  if (!link.success) redirect(badLinkDestination(type));
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims) redirect(emailLinkPath(link.data));
  const { error } = await supabase.auth.verifyOtp({ type: link.data.type, token_hash: link.data.token_hash });
  redirect(emailLinkResult(link.data, error));
}
