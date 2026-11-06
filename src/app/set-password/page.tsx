import { createClient } from "@/lib/supabase/server";
import { SetPasswordForm } from "./SetPasswordForm";

/**
 * Forgot password's last step: the reset email's link (/auth/confirm, type=recovery, then Continue) logs the teacher
 * in and opens this. Shows whose account it is ("For …"), so someone who opened another person's forwarded link sees
 * it isn't theirs. Saving the new password logs the account out on every other device (Supabase does this on any
 * password change), then opens home. Needs a login like every page (src/proxy.ts).
 */
export default async function SetPasswordPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims?.email === "string" && data.claims.email !== "" ? data.claims.email : null;
  return <SetPasswordForm email={email} />;
}
