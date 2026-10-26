import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// The only email link the app sends is "Confirm signup" (type=email). Add a type here only if a new email uses it.
const typeSchema = z.enum(["email"]);

/**
 * The link in the "Confirm signup" email opens this (Supabase dashboard → Authentication → Emails:
 * {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email). It confirms the email, logs the teacher in
 * (the login cookies are set here) and opens the home page. An old, used or broken link goes to login with a message.
 * If someone is already logged in it does nothing and opens home, so a link can't swap them into another account.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims) redirect("/");

  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = typeSchema.safeParse(request.nextUrl.searchParams.get("type"));
  if (tokenHash && type.success) {
    const { error } = await supabase.auth.verifyOtp({ type: type.data, token_hash: tokenHash });
    if (!error) redirect("/");
  }
  redirect("/login?error=confirm");
}
