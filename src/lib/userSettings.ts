import { z } from "zod";
import { createClient } from "./supabase/client";
import { ELEMENT_PANEL_CATEGORIES, type ElementCategory } from "./svgLibrary";

const favoriteCategoriesSchema = z.array(z.enum(ELEMENT_PANEL_CATEGORIES)).max(ELEMENT_PANEL_CATEGORIES.length);

/** The Elements panel categories the signed-in user starred. Empty if they have none yet. Throws if it fails. */
export async function loadFavoriteCategories(): Promise<ElementCategory[]> {
  const { data, error } = await createClient().from("user_settings").select("favorite_element_categories").maybeSingle();
  if (error) throw error;
  // Drop anything that is no longer a panel category (e.g. one that was renamed).
  const saved: unknown[] = data?.favorite_element_categories ?? [];
  return ELEMENT_PANEL_CATEGORIES.filter((category) => saved.includes(category));
}

/** Saves the starred categories to the user's settings row (creates the row the first time). Throws if it fails. */
export async function saveFavoriteCategories(categories: ElementCategory[]) {
  // Checked with zod first (see CLAUDE.md, "Saving Data"): bad data throws here and is never saved.
  const favorites = favoriteCategoriesSchema.parse(categories);
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Not signed in");
  const { error } = await supabase.from("user_settings").upsert({
    user_id: data.session.user.id,
    favorite_element_categories: favorites,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}
