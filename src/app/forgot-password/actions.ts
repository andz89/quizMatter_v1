"use server";

import { headers } from "next/headers";
import { resetEmailSchema } from "@/lib/passwords";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * May this email get a reset link now? 3 reset emails a day per teacher, 10 requests an hour per internet address
 * (may_send_password_reset, 20261231001000_password_reset_limit.sql; it runs with the secret key, since it's given the
 * address, which a browser could make up). The address is Cloudflare's own header. When the check can't run the answer
 * is yes: Supabase's own limits still stand, and a teacher is never stuck by our mistake.
 */
export async function mayAskForReset(email: string): Promise<boolean> {
  const checked = resetEmailSchema.safeParse(email);
  if (!checked.success) return false;
  const admin = createAdminClient();
  if (!admin) {
    console.error("Password reset limit: SUPABASE_SECRET_KEY isn't set, so it's off");
    return true;
  }
  const ip = (await headers()).get("cf-connecting-ip");
  if (!ip && process.env.NODE_ENV === "production") console.error("Password reset limit: no visitor address, so that part is off");
  const { data, error } = await admin.rpc("may_send_password_reset", { p_email: checked.data, p_ip: ip ?? "" });
  if (error) {
    console.error("Password reset limit: couldn't check", error);
    return true;
  }
  return data;
}
