import { createClient } from "@/lib/supabase/server";
import { SignUpForm } from "./SignUpForm";

/**
 * Sign up: a teacher makes their own account (the form is SignUpForm). Reads the throwaway email services from the
 * database's blocked_email_domains table, so the form can refuse them at once. The database's sign up hook checks
 * the same list, so if this read fails the form still sends, and the hook refuses with the same words.
 */
export default async function SignUpPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("blocked_email_domains").select("domain");
  if (error) console.error("Couldn't read the blocked email domains", error);
  const blockedDomains: string[] = (data ?? []).map((row) => row.domain);
  return <SignUpForm blockedDomains={blockedDomains} />;
}
