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

/** Where a link missing its parts goes (or one with a type we don't send): login, with the reset words for a reset link. */
export function badLinkDestination(type: unknown): string {
  return type === "recovery" ? "/login?error=reset" : "/login?error=confirm";
}

/** The link page's own address; `isRetry` makes it say the link still works (Supabase couldn't be reached). */
export function emailLinkPath(link: EmailLink, isRetry = false): string {
  return `/auth/confirm?${new URLSearchParams({ ...link, ...(isRetry && { retry: "1" }) })}`;
}

/** The email in a login's claims, or null when it has none. */
export function claimEmail(claims: { email?: unknown } | null | undefined): string | null {
  return typeof claims?.email === "string" && claims.email !== "" ? claims.email : null;
}

/**
 * Where Continue goes after Supabase's answer: the next page; for a banned account, login with the blocked words;
 * back to the page when Supabase didn't really check the link (no answer, too many requests, a server error), since
 * the link still works; else login with the "expired" words.
 */
export function emailLinkResult(link: EmailLink, error: { code?: string; status?: number } | null): string {
  if (!error) return link.type === "recovery" ? "/set-password" : "/";
  if (error.code === "user_banned") return "/login?error=blocked";
  const status = error.status ?? 0;
  if (status === 0 || status === 429 || status >= 500) return emailLinkPath(link, true);
  return badLinkDestination(link.type);
}
