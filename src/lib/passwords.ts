import { z } from "zod";

// The password rules, on their own so `npm test` can load them (userSettings.ts imports .tsx files).

// Supabase's own limits: at least 6 letters (we ask for 8), and at most 72 bytes.
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters for your password.`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters for your password.`);

// Forgot password's limits (may_send_password_reset, 20261231001000_password_reset_limit.sql): same numbers there.
// Here so Admin → Safety can show them.
export const RESETS_PER_DAY = 3;
export const RESET_REQUESTS_PER_ADDRESS = 10;

// The Forgot password page's email box: spaces and capitals don't matter.
export const resetEmailSchema = z.string().trim().toLowerCase().pipe(z.email("Enter a real email address."));

/**
 * Forgot password: the words for Supabase's answer to a reset request, or null to show "Check your email". Supabase's
 * two email limits (this address within a minute, "…only request this after 42 seconds", and the hourly limit for
 * all) refuse only a real account, never an unknown email, so their words would tell who has an account: they
 * count as sent. The other refusals don't depend on the account.
 */
export function resetErrorMessage(error: { code?: string; message?: string; name?: string } | null): string | null {
  if (!error) return null;
  const message = error.message ?? "";
  if (error.code === "over_email_send_rate_limit" || /after \d+ seconds?/i.test(message)) return null;
  if (error.code === "captcha_failed" || /captcha/i.test(message)) return "The security check expired. Please try again.";
  if (error.code === "over_request_rate_limit") return "Too many tries. Please wait a few minutes and try again.";
  if (error.name === "AuthRetryableFetchError") return "Couldn't reach the server. Check your internet and try again.";
  return "Something went wrong. Please try again.";
}

// The Set a new password page: the password, typed twice.
export const newPasswordSchema = z
  .object({ password: passwordSchema, confirmPassword: z.string() })
  .refine((fields) => fields.password === fields.confirmPassword, {
    error: "The two passwords don't match.",
    path: ["confirmPassword"],
  });

// Supabase's same_password: the new password is the one the account already has.
export const SAME_PASSWORD_MESSAGE = "That's your current password. Pick a new one.";

// Supabase's current_password_invalid: the current password typed on the Account page is wrong.
export const WRONG_CURRENT_PASSWORD_MESSAGE = "That isn't your current password.";

// The Account page's Password card: the current password (Supabase checks it), and the new one typed twice.
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Type your current password.").max(PASSWORD_MAX_LENGTH, WRONG_CURRENT_PASSWORD_MESSAGE),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((fields) => fields.password === fields.confirmPassword, {
    error: "The two passwords don't match.",
    path: ["confirmPassword"],
  })
  .refine((fields) => fields.password !== fields.currentPassword, { error: SAME_PASSWORD_MESSAGE, path: ["password"] });
