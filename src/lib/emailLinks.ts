import { z } from "zod";

// The links in our two emails (/auth/confirm?token_hash=…&type=…): "Confirm signup" (email) and "Reset Password"
// (recovery). Add a type here only if a new email uses it. Only zod, so tests load it.
export const EMAIL_LINK_TYPES = ["email", "recovery"] as const;
export type EmailLinkType = (typeof EMAIL_LINK_TYPES)[number];

export const emailLinkSchema = z.object({
  token_hash: z.string().min(1).max(200),
  type: z.enum(EMAIL_LINK_TYPES),
});

// A link missing its parts, or with a type we don't send.
export const BAD_LINK_DESTINATION = "/login?error=confirm";

/** Where Continue goes: the next page when the link worked, else login with the right message. */
export function emailLinkDestination(type: EmailLinkType, ok: boolean): string {
  if (type === "recovery") return ok ? "/set-password" : "/login?error=reset";
  return ok ? "/" : "/login?error=confirm";
}
