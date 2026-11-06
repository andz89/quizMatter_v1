import { z } from "zod";

// The password rules, on their own so `npm test` can load them (userSettings.ts imports .tsx files).

// Supabase's own limits: at least 6 letters (we ask for 8), and at most 72 bytes.
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters for your password.`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters for your password.`);

// The Forgot password page's email box: spaces and capitals don't matter.
export const resetEmailSchema = z.string().trim().toLowerCase().pipe(z.email("Enter a real email address."));

// The Set a new password page: the password, typed twice.
export const newPasswordSchema = z
  .object({ password: passwordSchema, confirmPassword: z.string() })
  .refine((fields) => fields.password === fields.confirmPassword, {
    error: "The two passwords don't match.",
    path: ["confirmPassword"],
  });

// Supabase's same_password: the new password is the one the account already has.
export const SAME_PASSWORD_MESSAGE = "That's your current password. Pick a new one.";
