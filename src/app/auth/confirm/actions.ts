"use server";

import { redirect } from "next/navigation";
import { BAD_LINK_DESTINATION, emailLinkDestination, emailLinkSchema } from "@/lib/emailLinks";
import { createClient } from "@/lib/supabase/server";

/**
 * The Continue button on /auth/confirm: only here is the email link used. Checks the link again (zod), refuses while
 * someone is logged in (back to the page, which says to log out first: a link never swaps the browser into another
 * account), then checks the token with Supabase, which logs the teacher in, and opens the next page.
 */
export async function openEmailLink(formData: FormData) {
  const link = emailLinkSchema.safeParse({ token_hash: formData.get("token_hash"), type: formData.get("type") });
  if (!link.success) redirect(BAD_LINK_DESTINATION);
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims) redirect(`/auth/confirm?${new URLSearchParams(link.data)}`);
  const { error } = await supabase.auth.verifyOtp({ type: link.data.type, token_hash: link.data.token_hash });
  redirect(emailLinkDestination(link.data.type, !error));
}
