import { z } from "zod";
import { isBlockedEmail } from "./blockedEmailDomains";
import { createClient } from "./supabase/client";
import { ELEMENT_PANEL_CATEGORIES, type ElementCategory } from "./svgLibrary";

const favoriteCategoriesSchema = z.array(z.enum(ELEMENT_PANEL_CATEGORIES)).max(ELEMENT_PANEL_CATEGORIES.length);

export const DISPLAY_NAME_MAX_LENGTH = 80;
// The display name also makes the profile link (/teachers/teacher-ria), so it needs a letter or number a–z / 0–9
// once accents are taken off (the database's profile_slug rule: "Ría" → "ria", "★★★" → no link). Empty = no link.
export const displayNameSchema = z
  .string()
  .trim()
  .max(DISPLAY_NAME_MAX_LENGTH)
  .refine(
    (name) => name === "" || /[a-z0-9]/.test(name.normalize("NFD").toLowerCase()),
    "Use at least one letter or number (a–z, 0–9) in your display name.",
  );
// Display names are unique (by link name): set_display_name answers "taken".
export const DISPLAY_NAME_TAKEN_MESSAGE = "That display name is taken. Please pick another one.";
// Days between display name changes on the Account page (the first change after sign up is free). Same as
// set_display_name in 20261113000000_display_name_rules.sql.
export const DISPLAY_NAME_CHANGE_DAYS = 30;

// Supabase's own limits: at least 6 letters (we ask for 8), and at most 72 bytes.
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters for your password.`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters for your password.`);

// The details a teacher gives when they sign up (and can change on the Account page).
export const NAME_MAX_LENGTH = 35;
export const CONTACT_NUMBER_MAX_LENGTH = 20;
export const EDUCATION_FIELD_MAX_LENGTH = 100;
// The bio on a teacher's profile page (optional).
export const BIO_MAX_LENGTH = 300;

// The Educational background dropdown. The values are saved in user_settings.education_level.
export const EDUCATION_LEVELS = ["bachelor", "master", "doctorate", "other"] as const;
export type EducationLevel = (typeof EDUCATION_LEVELS)[number];
export const EDUCATION_LEVEL_LABELS: Record<EducationLevel, string> = {
  bachelor: "Bachelor's degree",
  master: "Master's degree",
  doctorate: "Doctorate",
  other: "Other",
};

export const profileSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, "Enter your first name.")
    .max(NAME_MAX_LENGTH, `Use at most ${NAME_MAX_LENGTH} characters for your first name.`),
  lastName: z
    .string()
    .trim()
    .min(1, "Enter your last name.")
    .max(NAME_MAX_LENGTH, `Use at most ${NAME_MAX_LENGTH} characters for your last name.`),
  // e.g. "+63 917 123 4567" or "(02) 8123-4567".
  contactNumber: z
    .string()
    .trim()
    .max(CONTACT_NUMBER_MAX_LENGTH, `Use at most ${CONTACT_NUMBER_MAX_LENGTH} characters for your contact number.`)
    .regex(/^[0-9+\-() ]*$/, "A contact number can only have digits, spaces and + - ( ).")
    .refine((number) => number.replace(/\D/g, "").length >= 7, "Enter a contact number with at least 7 digits."),
  educationLevel: z.enum(EDUCATION_LEVELS, { error: "Pick your educational background." }),
  educationField: z
    .string()
    .trim()
    .min(1, "Enter your field or major.")
    .max(EDUCATION_FIELD_MAX_LENGTH, `Use at most ${EDUCATION_FIELD_MAX_LENGTH} characters for your field or major.`),
  bio: z.string().trim().max(BIO_MAX_LENGTH, `Use at most ${BIO_MAX_LENGTH} characters for your bio.`),
});

// Sign up doesn't ask for a bio (added later on the Account page) or a display name (made from the first + last
// name by handle_new_user, 20261113000000_display_name_rules.sql).
export const signUpSchema = profileSchema
  .omit({ bio: true })
  .extend({
    email: z
      .email("Enter a real email address.")
      .refine((email) => !isBlockedEmail(email), "Please use your real email address (school or personal), not a throwaway one."),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((fields) => fields.password === fields.confirmPassword, {
    error: "The two passwords don't match.",
    path: ["confirmPassword"],
  });

// What the forms hold: plain text in every box ("" in the dropdown until a level is picked).
export type ProfileFields = { [K in keyof z.input<typeof profileSchema>]: string };
export type SignUpFields = { [K in keyof z.input<typeof signUpSchema>]: string };

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

export type DisplayNameResult = { status: "saved" } | { status: "taken" } | { status: "wait"; until: number };

/**
 * Changes the user's display name through set_display_name, which counts it against the click limit and keeps the
 * 30 days between changes. Throws if it fails (e.g. QMBLK while paused: read it with pausedUntilFromError).
 */
export async function saveDisplayName(name: string): Promise<DisplayNameResult> {
  const displayName = displayNameSchema.parse(name);
  const { data, error } = await createClient().rpc("set_display_name", { name: displayName });
  if (error) throw error;
  return data as DisplayNameResult;
}

/**
 * Makes a new account. Supabase emails a link to confirm it; the teacher can log in only after clicking it. The
 * details ride along as user metadata, and the handle_new_user trigger (20261113000000_display_name_rules.sql) copies
 * them into user_settings and makes the display name from the first + last name. If the email already has an
 * account, Supabase answers the same way and sends nothing, so strangers can't find out who has one. Throws if it
 * fails.
 */
export async function signUp(fields: SignUpFields, captchaToken: string) {
  // Checked with zod first (see CLAUDE.md, "Saving Data"): bad data throws here and is never saved.
  const { email, password, firstName, lastName, contactNumber, educationLevel, educationField } =
    signUpSchema.parse(fields);
  const { error } = await createClient().auth.signUp({
    email,
    password,
    options: {
      captchaToken,
      data: {
        first_name: firstName,
        last_name: lastName,
        contact_number: contactNumber,
        education_level: educationLevel,
        education_field: educationField,
      },
    },
  });
  if (error) throw error;
}

/** Saves the user's personal details (creates the settings row the first time). Throws if it fails. */
export async function saveProfile(fields: ProfileFields) {
  const profile = profileSchema.parse(fields);
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Not signed in");
  const { error } = await supabase.from("user_settings").upsert({
    user_id: data.session.user.id,
    first_name: profile.firstName,
    last_name: profile.lastName,
    contact_number: profile.contactNumber,
    education_level: profile.educationLevel,
    education_field: profile.educationField,
    bio: profile.bio,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

/** Changes the signed-in user's password (Supabase keeps it, not our tables). Throws if it fails. */
export async function changePassword(password: string) {
  const { error } = await createClient().auth.updateUser({ password: passwordSchema.parse(password) });
  if (error) throw error;
}
