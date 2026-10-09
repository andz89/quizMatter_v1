import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { DISPLAY_NAME_MAX_LENGTH, EDUCATION_LEVEL_LABELS, EDUCATION_LEVELS, type EducationLevel } from "./userSettings";

// A teacher's profile page (/teachers/<link name>, e.g. /teachers/teacher-ria, made from the display name by the
// database's profile_slug): the public part of their settings, which any logged-in user can open
// with the link. It comes from the teacher_profile database function (20261112000000_profile_name_links.sql), which
// never hands out the contact number or email, and hides admins from teachers.
export type TeacherProfile = {
  displayName: string;
  firstName: string;
  lastName: string;
  educationLevel: string;
  educationField: string;
  bio: string;
};

// A link name: lowercase letters and digits in groups joined by "-" (what profile_slug makes), at most the display
// name's length.
const profileSlugSchema = z.string().max(DISPLAY_NAME_MAX_LENGTH).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

/** The profile, or null if no teacher has this link (or it's an admin the viewer may not see). Throws if it fails. */
export async function loadTeacherProfile(supabase: SupabaseClient, slug: string): Promise<TeacherProfile | null> {
  // Capitals in a typed link still work; anything else that isn't a link name (e.g. /teachers/a%20b) isn't anyone.
  const checked = profileSlugSchema.safeParse(slug.toLowerCase());
  if (!checked.success) return null;
  const { data, error } = await supabase.rpc("teacher_profile", { slug: checked.data }).maybeSingle<{
    display_name: string;
    first_name: string;
    last_name: string;
    education_level: string;
    education_field: string;
    bio: string;
  }>();
  if (error) throw error;
  if (!data) return null;
  return {
    displayName: data.display_name,
    firstName: data.first_name,
    lastName: data.last_name,
    educationLevel: data.education_level,
    educationField: data.education_field,
    bio: data.bio,
  };
}

/**
 * The link names of these accounts' profiles the user may open (everyone's except a hidden admin's, and only if they
 * have a display name), by account id, so a page links only those names. Empty if the lookup fails: names then just
 * aren't links.
 */
export async function loadVisibleProfiles(supabase: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.rpc("visible_profiles", { profile_ids: ids });
  if (error) return new Map();
  return new Map((data as { id: string; slug: string }[]).map((row) => [row.id, row.slug]));
}

export function profileHref(slug: string) {
  return `/teachers/${slug}`;
}

/** "Master's degree in English", or just the field for "Other" (it says nothing alone). "" when neither is set. */
export function educationLine(level: string, field: string): string {
  const label = EDUCATION_LEVELS.includes(level as EducationLevel) ? EDUCATION_LEVEL_LABELS[level as EducationLevel] : "";
  if (label && field && level !== "other") return `${label} in ${field}`;
  return field || label;
}
