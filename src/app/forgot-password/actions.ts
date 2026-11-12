"use server";

import { headers } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { resetEmailSchema, resetErrorMessage } from "@/lib/passwords";
import { createAdminClient } from "@/lib/supabase/admin";

// Every answer takes at least this long, so a skipped send (over our limit) isn't told apart by its speed.
const ANSWER_MS = 1500;

/**
 * Forgot password's one request: checks our limit and asks Supabase to send the reset email, all on the server, so
 * the browser never learns whether the email has an account. It answers null ("Check your email") for a real
 * account, an unknown email, our limit and Supabase's email limits alike; a message only for refusals that don't
 * depend on the account (the security check expired, too many tries, Supabase can't be reached).
 */
export async function askForReset(email: string, captchaToken: string): Promise<string | null> {
  const checked = z.object({ email: resetEmailSchema, captchaToken: z.string().min(1).max(4096) }).safeParse({ email, captchaToken });
  if (!checked.success) return "Enter a real email address.";
  const [answer] = await Promise.all([
    sendReset(checked.data.email, checked.data.captchaToken),
    new Promise((resolve) => setTimeout(resolve, ANSWER_MS)),
  ]);
  return answer;
}

async function sendReset(email: string, captchaToken: string) {
  // Over our limit: no email, and the same answer.
  if (!(await mayAskForReset(email))) return null;
  // A plain client with no login and no cookies: the reset link logs the teacher in later, on the link's page.
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await supabase.auth.resetPasswordForEmail(email, { captchaToken });
  const message = resetErrorMessage(error);
  if (message) console.error("Password reset: Supabase refused", error?.code, error?.message);
  return message;
}

/**
 * May this email get a reset link now? 3 reset emails a day per teacher, 10 requests an hour per internet address
 * (may_send_password_reset, 20261231001000_password_reset_limit.sql; it runs with the secret key, since it's given the
 * address, which a browser could make up). The address is Cloudflare's own header. When the check can't run the answer
 * is yes: Supabase's own limits still stand, and a teacher is never stuck by our mistake. Never sent to the browser:
 * after 3 real emails it would tell who has an account.
 */
async function mayAskForReset(email: string): Promise<boolean> {
  const admin = createAdminClient();
  if (!admin) {
    console.error("Password reset limit: SUPABASE_SECRET_KEY isn't set, so it's off");
    return true;
  }
  const ip = (await headers()).get("cf-connecting-ip");
  if (!ip && process.env.NODE_ENV === "production") console.error("Password reset limit: no visitor address, so that part is off");
  const { data, error } = await admin.rpc("may_send_password_reset", { p_email: email, p_ip: ip ?? "" });
  if (error) {
    console.error("Password reset limit: couldn't check", error);
    return true;
  }
  return data;
}
