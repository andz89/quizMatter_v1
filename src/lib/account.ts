import { cache } from "react";
import { createClient } from "./supabase/server";
import { DISPLAY_NAME_CHANGE_DAYS, type ProfileFields, type ProfileVisibility } from "./userSettings";

export type Account = {
  id: string;
  email: string;
  displayName: string;
  // The profile link name made from the display name ("" when there's none, so no profile link).
  profileSlug: string;
  // When the display name can be changed again (Unix ms), or null if it can be changed now (always null for the super admin).
  nextNameChangeAt: number | null;
  // First and last name, contact number, educational background, bio, birthday ("YYYY-MM-DD") and gender ("" for
  // each one not set).
  profile: ProfileFields;
  // Which of those the profile page shows to others (all on until the teacher turns one off).
  visibility: ProfileVisibility;
  isAdmin: boolean;
  // The one admin who can do everything (admins.is_super). Plain admins can't manage teachers, safety or the
  // photo cleanup, and only manage the shared photos they uploaded.
  isSuperAdmin: boolean;
  // In the admins table ('super' / 'admin'), whatever the login's level. isAdmin / isSuperAdmin are true only after
  // the second step (two-step login, src/lib/secondFactor.ts); this says who must be sent to set it up or verify.
  adminRole: "super" | "admin" | "none";
  isEditor: boolean;
  isBanned: boolean;
};

/** Whether the logged-in account has a working (verified) authenticator app (two-step login). Asks Supabase. */
export async function hasVerifiedFactor(): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.auth.mfa.listFactors();
  return (data?.totp ?? []).some((factor) => factor.status === "verified");
}

/**
 * The logged-in user: id ("" if logged out), email, display name and personal details ("" if not set), and whether
 * they're an admin, an editor (reviews QuizMatter presentations) or banned (Admin → Teachers). Server only.
 * Cached per request, so the top bar and the page share one lookup.
 */
export const getAccount = cache(async (): Promise<Account> => {
  const supabase = await createClient();
  const [{ data: claims }, { data: settings }, { data: isAdmin }, { data: isSuperAdmin }, { data: membership }, { data: isEditor }, { data: isBanned }] = await Promise.all([
    supabase.auth.getClaims(),
    supabase
      .from("user_settings")
      .select(
        "display_name, profile_slug, display_name_changed_at, first_name, last_name, contact_number, education_level, education_field, bio, birth_date, gender, full_name_public, education_public, bio_public",
      )
      .maybeSingle(),
    supabase.rpc("is_admin"),
    supabase.rpc("is_super_admin"),
    supabase.rpc("admin_membership"),
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
      birthDate: settings?.birth_date ?? "",
      gender: settings?.gender ?? "",
    },
    visibility: {
      fullNamePublic: settings?.full_name_public ?? true,
      educationPublic: settings?.education_public ?? true,
      bioPublic: settings?.bio_public ?? true,
    },
    isAdmin: isAdmin === true,
    isSuperAdmin: isSuperAdmin === true,
    adminRole: membership === "super" || membership === "admin" ? membership : "none",
    isEditor: isEditor === true,
    isBanned: isBanned === true,
  };
});
