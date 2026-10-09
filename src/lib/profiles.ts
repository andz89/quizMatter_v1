import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { EDUCATION_LEVEL_LABELS, EDUCATION_LEVELS, type EducationLevel } from "./userSettings";

// A teacher's profile page (/teachers/<id>): the public part of their settings, which any logged-in user can open
// with the link. It comes from the teacher_profile database function (20261110000000_teacher_profiles.sql), which
// never hands out the contact number or email, and hides admins from teachers.
export type TeacherProfile = {
  displayName: string;
  firstName: string;
  lastName: string;
  educationLevel: string;
  educationField: string;
  bio: string;
};

/** The profile, or null if there's no such teacher (or it's an admin the viewer may not see). Throws if it fails. */
export async function loadTeacherProfile(supabase: SupabaseClient, id: string): Promise<TeacherProfile | null> {
  // A made-up address (e.g. /teachers/abc) isn't an account.
  if (!z.uuid().safeParse(id).success) return null;
  const { data, error } = await supabase.rpc("teacher_profile", { profile_id: id }).maybeSingle<{
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
 * Which of these accounts have a profile the user may open (everyone's except a hidden admin's), so a page links only
 * those names. Empty if the lookup fails: names then just aren't links.
 */
export async function loadVisibleProfiles(supabase: SupabaseClient, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await supabase.rpc("visible_profiles", { profile_ids: ids });
  if (error) return new Set();
  return new Set(data as string[]);
}

export function profileHref(id: string) {
  return `/teachers/${id}`;
}

/** "Master's degree in English", or just the field for "Other" (it says nothing alone). "" when neither is set. */
export function educationLine(level: string, field: string): string {
  const label = EDUCATION_LEVELS.includes(level as EducationLevel) ? EDUCATION_LEVEL_LABELS[level as EducationLevel] : "";
  if (label && field && level !== "other") return `${label} in ${field}`;
  return field || label;
}
