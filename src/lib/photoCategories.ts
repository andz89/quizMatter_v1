import type { SupabaseClient } from "@supabase/supabase-js";
import { photoCategoryNameSchema } from "./schema";

// Server only: used by Claude's photo tools (/api/claude-photo, and save_photo_details in /api/mcp).

/**
 * The category with this name (not minding capitals), made if there's none yet: its id, and whether it was just
 * made. Null if it failed.
 */
export async function findOrCreateCategory(
  supabase: SupabaseClient,
  name: string,
): Promise<{ id: string; isNew: boolean } | null> {
  const find = async () => {
    const { data } = await supabase.from("photo_categories").select("id, name");
    const id = data?.find((c) => c.name.toLowerCase() === name.toLowerCase())?.id;
    return id ? { id, isNew: false } : null;
  };
  const found = await find();
  if (found) return found;
  const { data, error } = await supabase
    .from("photo_categories")
    .insert({ name: photoCategoryNameSchema.parse(name) })
    .select("id")
    .single();
  // Two photos in the same new category can arrive together: then the other one just made it.
  if (error?.code === "23505") return find();
  return data ? { id: data.id, isNew: true } : null;
}
