import type { createAdminClient } from "@/lib/supabase/admin";

// Used by Admin → Safety and its History page.

export type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>;

/** A row of the click_limits table. */
export type ClickLimit = {
  feature: string;
  label: string;
  max_clicks: number;
  per_seconds: number;
  first_pause_minutes: number;
  repeat_pause_minutes: number;
  repeat_within_hours: number;
  ban_after_pauses: number | null;
  // Set (e.g. "Asia/Manila"): counted per day, starting again at midnight there, and paused until that midnight.
  daily_reset_time_zone: string | null;
};

/** Each teacher's name by id (display name, else first and last name), in one read. A deleted account has none. */
export async function lookUpNames(admin: AdminClient, userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const { data, error } = await admin
    .from("user_settings")
    .select("user_id, display_name, first_name, last_name")
    .in("user_id", [...new Set(userIds)]);
  if (error) throw error;
  return new Map(
    (data as { user_id: string; display_name: string; first_name: string; last_name: string }[]).map((row) => [
      row.user_id,
      row.display_name || `${row.first_name} ${row.last_name}`.trim(),
    ])
  );
}

/** Each teacher's email by id. Only a few teachers are ever in these lists, so each one is looked up on its own. */
export async function lookUpEmails(admin: AdminClient, userIds: string[]): Promise<Map<string, string>> {
  return new Map(
    await Promise.all(
      [...new Set(userIds)].map(
        async (id) => {
          const { data, error } = await admin.auth.admin.getUserById(id);
          // 404 = the account is gone. Any other error (e.g. the Auth API is busy) isn't a deleted account.
          const missing = error && error.status !== 404 ? "(couldn't load email)" : "(deleted account)";
          return [id, data.user?.email ?? missing] as const;
        }
      )
    )
  );
}
