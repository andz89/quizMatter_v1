import type { AuthError } from "@supabase/supabase-js";

/**
 * Two-step login (admins): an authenticator app's code after the password (Supabase's TOTP MFA). The database's
 * is_admin() / is_super_admin() are true only after the code (the login's `aal` is `aal2`), see
 * supabase/migrations/20261231001300_admin_second_factor.sql. Set up on /account/two-step, asked on /login/verify.
 * Browser-safe (the pages import it); the server's check is `hasVerifiedFactor` in account.ts.
 */

/** Plain words for a code that didn't pass. */
export function codeErrorMessage(error: AuthError): string {
  if (error.code === "mfa_verification_failed" || /invalid totp code/i.test(error.message)) {
    return "That code didn't work. Check the time on your phone and try the newest code.";
  }
  if (error.code === "over_request_rate_limit" || error.code === "mfa_verification_rejected") {
    return "Too many tries. Please wait a minute and try again.";
  }
  return "Couldn't check the code. Please try again.";
}
