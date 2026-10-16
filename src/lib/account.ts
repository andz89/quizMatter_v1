import { cache } from "react";
import { createClient } from "./supabase/server";
import { DISPLAY_NAME_CHANGE_DAYS, type ProfileFields } from "./userSettings";

export type Account = {
  id: string;
  email: string;
  displayName: string;
  // The profile link name made from the display name ("" when there's none, so no profile link).
  profileSlug: string;
  // When the display name can be changed again (Unix ms), or null if it can be changed now (always null for the super admin).
  nextNameChangeAt: number | null;
  // First and last name, contact number, educational background and bio ("" for each one not set).
  profile: ProfileFields;
  isAdmin: boolean;
  // The one admin who can do everything (admins.is_super). Plain admins can't manage teachers, safety or the
  // photo cleanup, and only manage the shared photos they uploaded.
  isSuperAdmin: boolean;
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
  const [{ data: claims }, { data: settings }, { data: isAdmin }, { data: isSuperAdmin }, { data: isEditor }, { data: isBanned }] = await Promise.all([
    supabase.auth.getClaims(),
    supabase
      .from("user_settings")
      .select("display_name, profile_slug, display_name_changed_at, first_name, last_name, contact_number, education_level, education_field, bio")
      .maybeSingle(),
    supabase.rpc("is_admin"),
    supabase.rpc("is_super_admin"),
    supabase.rpc("is_editor"),
    supabase.rpc("is_banned"),
  ]);
  const changedAt = settings?.display_name_changed_at ? Date.parse(settings.display_name_changed_at) : null;
  const nextNameChangeAt = changedAt === null ? null : changedAt + DISPLAY_NAME_CHANGE_DAYS * 24 * 60 * 60 * 1000;
  return {
    id: claims?.claims.sub ?? "",
    email: typeof claims?.claims.email === "string" ? claims.claims.email : "",
    displayName: settings?.display_name ?? "",
    profileSlug: settings?.profile_slug ?? "",
    nextNameChangeAt: isSuperAdmin !== true && nextNameChangeAt !== null && nextNameChangeAt > Date.now() ? nextNameChangeAt : null,
    profile: {
      firstName: settings?.first_name ?? "",
      lastName: settings?.last_name ?? "",
      contactNumber: settings?.contact_number ?? "",
      educationLevel: settings?.education_level ?? "",
      educationField: settings?.education_field ?? "",
      bio: settings?.bio ?? "",
    },
    isAdmin: isAdmin === true,
    isSuperAdmin: isSuperAdmin === true,
    isEditor: isEditor === true,
    isBanned: isBanned === true,
  };
});
