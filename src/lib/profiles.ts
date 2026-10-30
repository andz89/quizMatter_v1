import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { DISPLAY_NAME_MAX_LENGTH, EDUCATION_LEVEL_LABELS, EDUCATION_LEVELS, type EducationLevel } from "./userSettings";

// A teacher's profile page (/teachers/<link name>, e.g. /teachers/teacher-ria, made from the display name by the
// database's profile_slug): the public part of their settings, which any logged-in user can open
// with the link. It comes from the teacher_profile database function (newest: 20261220000000_age_gender_address.sql),
// which never hands out the contact number, email, birthday or gender, and hides admins from teachers. A field the teacher made private
// comes back "" for everyone but its owner.
export type TeacherProfile = {
  displayName: string;
  firstName: string;
  lastName: string;
  educationLevel: string;
  educationField: string;
  bio: string;
  // Editors' profile photo ("" when none; only editors have one, see 20261214000000_profile_photos.sql).
  photoSrc: string;
  // Whether others see the full name, educational background and bio (the teacher's "Show on my profile"; always
  // true for an editor). Off with the field filled in = the owner looking at their own profile.
  fullNamePublic: boolean;
  educationPublic: boolean;
  bioPublic: boolean;
  // City or town and province ("" when not given or hidden), and whether others see them (always for an editor).
  town: string;
  province: string;
  townPublic: boolean;
};

// A link name: lowercase letters and digits in groups joined by "-" (what profile_slug makes), at most the display
// name's length.
export const profileSlugSchema = z.string().max(DISPLAY_NAME_MAX_LENGTH).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

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
    photo_src: string;
    full_name_public: boolean;
    education_public: boolean;
    bio_public: boolean;
    town: string;
    province: string;
    town_public: boolean;
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
    photoSrc: data.photo_src,
    fullNamePublic: data.full_name_public,
    educationPublic: data.education_public,
    bioPublic: data.bio_public,
    town: data.town,
    province: data.province,
    townPublic: data.town_public,
  };
}

/**
 * The ids of the presentations this teacher published (their shared copies, not hidden), last changed first; empty
 * for a link that isn't anyone, a hidden admin, or if it fails. See the teacher_shared_presentations migration.
 */
export async function loadSharedPresentationIds(supabase: SupabaseClient, slug: string): Promise<string[]> {
  const checked = profileSlugSchema.safeParse(slug.toLowerCase());
  if (!checked.success) return [];
  const { data, error } = await supabase.rpc("teacher_shared_presentations", { slug: checked.data });
  if (error) return [];
  return (data as { id: string }[]).map((row) => row.id);
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

/** "Quezon City, Metro Manila", or whichever of the two is set. "" when neither is. */
export function placeLine(town: string, province: string): string {
  return [town, province].filter(Boolean).join(", ");
}

/** "Master's degree in English", or just the field for "Other" (it says nothing alone). "" when neither is set. */
export function educationLine(level: string, field: string): string {
  const label = EDUCATION_LEVELS.includes(level as EducationLevel) ? EDUCATION_LEVEL_LABELS[level as EducationLevel] : "";
  if (label && field && level !== "other") return `${label} in ${field}`;
  return field || label;
}
