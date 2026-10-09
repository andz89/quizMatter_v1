import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * The link in the "Confirm signup" email opens this (Supabase dashboard → Authentication → Emails:
 * {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email). It confirms the email, logs the teacher in
 * (the login cookies are set here) and opens the home page. An old, used or broken link goes to login with a message.
 */
export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;
  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) redirect("/");
  }
  redirect("/login?error=confirm");
}
