import { cache } from "react";
import { createClient } from "./supabase/server";
import type { ProfileFields } from "./userSettings";

export type Account = {
  id: string;
  email: string;
  displayName: string;
  // The profile link name made from the display name ("" when there's none, so no profile link).
  profileSlug: string;
  // First and last name, contact number, educational background and bio ("" for each one not set).
  profile: ProfileFields;
  isAdmin: boolean;
  isEditor: boolean;
  isBanned: boolean;
};

/**
 * The logged-in user: id ("" if logged out), email, display name and personal details ("" if not set), and whether
 * they're an admin, an editor (reviews QuizMatter presentations) or banned (Admin → Teachers). Server only.
 * Cached per request, so the top bar and the page share one lookup.
 */
export const getAccount = cache(async (): Promise<Account> => {
  const supabase = await createClient();
  const [{ data: claims }, { data: settings }, { data: isAdmin }, { data: isEditor }, { data: isBanned }] = await Promise.all([
    supabase.auth.getClaims(),
    supabase
      .from("user_settings")
      .select("display_name, profile_slug, first_name, last_name, contact_number, education_level, education_field, bio")
      .maybeSingle(),
    supabase.rpc("is_admin"),
    supabase.rpc("is_editor"),
    supabase.rpc("is_banned"),
  ]);
  return {
    id: claims?.claims.sub ?? "",
    email: typeof claims?.claims.email === "string" ? claims.claims.email : "",
    displayName: settings?.display_name ?? "",
    profileSlug: settings?.profile_slug ?? "",
    profile: {
      firstName: settings?.first_name ?? "",
      lastName: settings?.last_name ?? "",
      contactNumber: settings?.contact_number ?? "",
      educationLevel: settings?.education_level ?? "",
      educationField: settings?.education_field ?? "",
      bio: settings?.bio ?? "",
    },
    isAdmin: isAdmin === true,
    isEditor: isEditor === true,
    isBanned: isBanned === true,
  };
});
