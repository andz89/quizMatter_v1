import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// The email links the app sends: "Confirm signup" (type=email) and "Reset Password" (type=recovery, from Forgot
// password). Add a type here only if a new email uses it.
const typeSchema = z.enum(["email", "recovery"]);

/**
 * The link in both emails opens this (Supabase dashboard → Authentication → Emails, and locally
 * supabase/templates/recovery.html): {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email (or
 * type=recovery). It checks the link and logs the teacher in (the login cookies are set here). A sign up link opens
 * home; a reset link opens /set-password. An old, used or broken link goes to login with a message
 * (error=reset for a reset link, error=confirm otherwise). If someone is already logged in it does nothing and opens
 * home, so a link can't swap them into another account.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims) redirect("/");

  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = typeSchema.safeParse(request.nextUrl.searchParams.get("type"));
  if (tokenHash && type.success) {
    const { error } = await supabase.auth.verifyOtp({ type: type.data, token_hash: tokenHash });
    if (!error) redirect(type.data === "recovery" ? "/set-password" : "/");
  }
  redirect(type.success && type.data === "recovery" ? "/login?error=reset" : "/login?error=confirm");
}
