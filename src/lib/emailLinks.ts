import { z } from "zod";

// The links in our two emails (/auth/confirm?token_hash=…&type=…): "Confirm signup" (email) and "Reset Password"
// (recovery). Add a type here only if a new email uses it. Only zod, so tests load it.
export const EMAIL_LINK_TYPES = ["email", "recovery"] as const;
export type EmailLinkType = (typeof EMAIL_LINK_TYPES)[number];

export const emailLinkSchema = z.object({
  token_hash: z.string().min(1).max(200),
  type: z.enum(EMAIL_LINK_TYPES),
});
export type EmailLink = z.infer<typeof emailLinkSchema>;

// A link missing its parts, or with a type we don't send.
export const BAD_LINK_DESTINATION = "/login?error=confirm";

/** The link page's own address; `isRetry` makes it say the link still works (Supabase couldn't be reached). */
export function emailLinkPath(link: EmailLink, isRetry = false): string {
  return `/auth/confirm?${new URLSearchParams({ ...link, ...(isRetry && { retry: "1" }) })}`;
}

/** The email in a login's claims, or null when it has none. */
export function claimEmail(claims: { email?: unknown } | null | undefined): string | null {
  return typeof claims?.email === "string" && claims.email !== "" ? claims.email : null;
}

/** Where Continue goes: the next page when the link worked, else login with the right message. */
export function emailLinkDestination(type: EmailLinkType, ok: boolean): string {
  if (type === "recovery") return ok ? "/set-password" : "/login?error=reset";
  return ok ? "/" : "/login?error=confirm";
}
