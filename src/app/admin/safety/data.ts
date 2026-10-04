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
};

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
