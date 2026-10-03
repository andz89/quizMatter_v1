import type { User } from "@supabase/supabase-js";
import { joinParts, timeAgo } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { AdminTeachers, type TeacherRow } from "./AdminTeachers";

/**
 * Admin → Teachers: everyone who can log in, to ban those who misuse QuizMatter (and unban them).
 * The list of accounts needs the secret key. (../layout.tsx checks the user is an admin.)
 */
export default async function AdminTeachersPage() {
  const admin = createAdminClient();
  if (!admin) {
    return (
      <p className="rounded-card border border-border-default bg-bg-surface px-5 py-12 text-center text-sm text-text-secondary">
        This page needs the secret key SUPABASE_SECRET_KEY on the server.
      </p>
    );
  }

  const supabase = await createClient();
  const [users, bans, admins, settings] = await Promise.all([
    // Teachers are added by hand, so one page of 1,000 is plenty.
    admin.auth.admin.listUsers({ perPage: 1000 }),
    supabase.from("banned_users").select("user_id, reason, banned_at, is_automatic"),
    admin.from("admins").select("user_id"),
    admin.from("user_settings").select("user_id, display_name"),
  ]);
  if (users.error) throw users.error;
  if (bans.error) throw bans.error;
  if (admins.error) throw admins.error;
  if (settings.error) throw settings.error;

  return (
    <AdminTeachers
      rows={buildRows(
        users.data.users,
        bans.data as Ban[],
        admins.data.map((row) => row.user_id as string),
        settings.data as { user_id: string; display_name: string | null }[],
      )}
    />
  );
}

// is_automatic: banned by the database for clicking too fast (see the click_auto_ban migration), not by an admin.
type Ban = { user_id: string; reason: string; banned_at: string; is_automatic: boolean };

/** One row per account: banned teachers first, then by email. */
function buildRows(
  users: User[],
  bans: Ban[],
  adminIds: string[],
  settings: { user_id: string; display_name: string | null }[],
): TeacherRow[] {
  const banByUser = new Map(bans.map((ban) => [ban.user_id, ban]));
  const admins = new Set(adminIds);
  const names = new Map(settings.map((row) => [row.user_id, row.display_name ?? ""]));
  const now = Date.now();

  return users
    .map((user) => {
      const ban = banByUser.get(user.id);
      return {
        id: user.id,
        email: user.email ?? "",
        name: names.get(user.id) ?? "",
        meta: joinParts([
          `Joined ${timeAgo(Date.parse(user.created_at), now)}`,
          user.last_sign_in_at && `Last login ${timeAgo(Date.parse(user.last_sign_in_at), now)}`,
        ]),
        isAdmin: admins.has(user.id),
        ban: ban ? { reason: ban.reason, when: timeAgo(Date.parse(ban.banned_at), now), isAutomatic: ban.is_automatic } : null,
      };
    })
    .sort((a, b) => Number(Boolean(b.ban)) - Number(Boolean(a.ban)) || a.email.localeCompare(b.email));
}
