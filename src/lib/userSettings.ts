import { z } from "zod";
import { createClient } from "./supabase/client";
import { ELEMENT_PANEL_CATEGORIES, type ElementCategory } from "./svgLibrary";

const favoriteCategoriesSchema = z.array(z.enum(ELEMENT_PANEL_CATEGORIES)).max(ELEMENT_PANEL_CATEGORIES.length);

export const DISPLAY_NAME_MAX_LENGTH = 80;
export const displayNameSchema = z.string().trim().max(DISPLAY_NAME_MAX_LENGTH);

// Supabase's own limits: at least 6 letters (we ask for 8), and at most 72 bytes.
export const PASSWORD_MIN_LENGTH = 8;
export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(72);

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

/** Saves the user's display name (creates the settings row the first time). Throws if it fails. */
export async function saveDisplayName(name: string) {
  const displayName = displayNameSchema.parse(name);
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Not signed in");
  const { error } = await supabase.from("user_settings").upsert({
    user_id: data.session.user.id,
    display_name: displayName,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

/** Changes the signed-in user's password (Supabase keeps it, not our tables). Throws if it fails. */
export async function changePassword(password: string) {
  const { error } = await createClient().auth.updateUser({ password: passwordSchema.parse(password) });
  if (error) throw error;
}
