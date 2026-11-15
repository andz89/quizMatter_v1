import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { photoCategoryNameSchema } from "./schema";

// Server only: used by Claude's photo tools (/api/claude-photo, and save_photo_details in /api/mcp).

/**
 * The category with this name (not minding capitals, like the photo_categories_name index), made if there's none
 * yet: its id, and whether it was just made. Null if it failed or the name isn't allowed.
 */
export async function findOrCreateCategory(
  supabase: SupabaseClient<Database>,
  name: string,
): Promise<{ id: string; isNew: boolean } | null> {
  const parsed = photoCategoryNameSchema.safeParse(name);
  if (!parsed.success) return null;
  // One row by its name, not the whole table (a request returns 1,000 rows at most). \ % _ are ilike's own signs.
  const pattern = parsed.data.replace(/[\\%_]/g, (sign) => `\\${sign}`);
  const find = async () => {
    const { data } = await supabase.from("photo_categories").select("id").ilike("name", pattern).limit(1).maybeSingle();
    return data ? { id: data.id, isNew: false } : null;
  };
  const found = await find();
  if (found) return found;
  const { data, error } = await supabase.from("photo_categories").insert({ name: parsed.data }).select("id").single();
  // Two photos in the same new category can arrive together: then the other one just made it.
  if (error?.code === "23505") return find();
  return data ? { id: data.id, isNew: true } : null;
}

/**
 * Deletes a category this request just made (isNew) once nothing went into it, so a failed save doesn't leave an
 * empty one. With the secret-key client: plain admins can't delete categories. The database refuses to delete one
 * that has photos, so a category another photo took meanwhile stays.
 */
export async function removeUnusedNewCategory(admin: SupabaseClient<Database>, category: { id: string; isNew: boolean }) {
  if (category.isNew) await admin.from("photo_categories").delete().eq("id", category.id);
}
