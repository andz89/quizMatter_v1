import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The display names of these presentation owners, by user id (see the publisher_names database function).
 * Owners without a display name are missing from the map. Works with the server or the browser Supabase client.
 * A failed lookup gives an empty map: the name is a nice extra, not worth breaking the page for.
 */
export async function loadPublisherNames(supabase: SupabaseClient, ownerIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(ownerIds)];
  if (ids.length === 0) return new Map();
  const { data } = await supabase.rpc("publisher_names", { owner_ids: ids });
  return new Map((data ?? []).map((row: { user_id: string; display_name: string }) => [row.user_id, row.display_name]));
}
