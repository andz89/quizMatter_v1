import type { User } from "@supabase/supabase-js";
import { joinParts, timeAgo } from "@/lib/format";

export type AdminRow = {
  id: string;
  email: string;
  // Display name ("" if not set).
  name: string;
  isSuper: boolean;
  // Has a verified authenticator app (the second step of the admin login).
  hasTwoStep: boolean;
  // "Joined 2 months ago · Last login 3 hr ago".
  meta: string;
};

/**
 * One row per admin: super admins first, then by email. An admin whose account can't be found (`users` has no entry)
 * is left out.
 */
export function buildAdminRows(
  admins: { user_id: string; is_super: boolean }[],
  users: Map<string, User>,
  names: Map<string, string>,
  now = Date.now(),
): AdminRow[] {
  return admins
    .flatMap((admin) => {
      const user = users.get(admin.user_id);
      if (!user) return [];
      return {
        id: user.id,
        email: user.email ?? "",
        name: names.get(user.id) ?? "",
        isSuper: admin.is_super,
        hasTwoStep: user.factors?.some((factor) => factor.status === "verified") ?? false,
        meta: joinParts([
          `Joined ${timeAgo(Date.parse(user.created_at), now)}`,
          user.last_sign_in_at && `Last login ${timeAgo(Date.parse(user.last_sign_in_at), now)}`,
        ]),
      };
    })
    .sort((a, b) => Number(b.isSuper) - Number(a.isSuper) || a.email.localeCompare(b.email));
}
