"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getAccount } from "@/lib/account";
import { announcementSchema, type AnnouncementInput } from "@/lib/announcements";
import { forgetMaintenanceStatus } from "@/lib/maintenance";
import { createClient } from "@/lib/supabase/server";

// Admin → Announcements (super admin only). The rules live in the database functions
// (20261221000000_announcements.sql); each action checks with zod first (see CLAUDE.md, "Saving Data").
// forgetMaintenanceStatus: the status carries the announcements key, so this server copy shows the change at once.

const FAILED = "Couldn't save the announcement. Please try again.";

// 22023: a limit the database checks (e.g. at most 20 on at once), in its own words. P0002: deleted meanwhile.
function refusal(error: { code?: string; message: string }) {
  return error.code === "22023" || error.code === "P0002" ? error.message : FAILED;
}

/** Adds (no id) or changes an announcement. Returns its id, or the words to show. */
export async function saveAnnouncement(input: AnnouncementInput): Promise<{ error: string } | { id: string }> {
  const parsed = announcementSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (!(await getAccount()).isSuperAdmin) return { error: "Only the super admin can do this." };

  const { data, error } = await (await createClient()).rpc("save_announcement", { a: parsed.data });
  if (error) return { error: refusal(error) };
  forgetMaintenanceStatus();
  refresh();
  return { id: data as string };
}

const switchSchema = z.object({ target: z.uuid(), turn_on: z.boolean() });

/** Turns an announcement on or off. Returns null, or the words to show. */
export async function setAnnouncementOn(id: string, turnOn: boolean): Promise<string | null> {
  const parsed = switchSchema.safeParse({ target: id, turn_on: turnOn });
  if (!parsed.success) return FAILED;
  if (!(await getAccount()).isSuperAdmin) return "Only the super admin can do this.";

  const { error } = await (await createClient()).rpc("set_announcement_on", parsed.data);
  if (error) return refusal(error);
  forgetMaintenanceStatus();
  refresh();
  return null;
}

/** Deletes an announcement (and who closed it). Returns null, or the words to show. */
export async function deleteAnnouncement(id: string): Promise<string | null> {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return "Couldn't delete the announcement. Please try again.";
  if (!(await getAccount()).isSuperAdmin) return "Only the super admin can do this.";

  const { error } = await (await createClient()).rpc("delete_announcement", { target: parsed.data });
  if (error) return "Couldn't delete the announcement. Please try again.";
  forgetMaintenanceStatus();
  refresh();
  return null;
}

/** "Count again": counts the matches and closes now and keeps them on the row (slow with many teachers). */
export async function recountAnnouncement(id: string): Promise<string | null> {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return "Couldn't count. Please try again.";
  if (!(await getAccount()).isSuperAdmin) return "Only the super admin can do this.";

  const { error } = await (await createClient()).rpc("recount_announcement", { target: parsed.data });
  if (error) return error.code === "P0002" ? error.message : "Couldn't count. Please try again.";
  refresh();
  return null;
}

// Only the filters are needed for a count; the text and times don't matter. (zod can't .pick() from a schema with
// refinements, so the same fields are taken from its shape.)
const S = announcementSchema.shape;
const audienceSchema = z.object({
  genders: S.genders,
  age_min: S.age_min,
  age_max: S.age_max,
  provinces: S.provinces,
  town_words: S.town_words,
  education_levels: S.education_levels,
  field_words: S.field_words,
  presentations_min: S.presentations_min,
  presentations_max: S.presentations_max,
  roles: S.roles,
});

/** How many accounts match these filters now (the form's "Count teachers" button), or null if it can't tell. */
export async function countAudience(input: AnnouncementInput): Promise<number | null> {
  const parsed = audienceSchema.safeParse(input);
  if (!parsed.success) return null;
  if (!(await getAccount()).isSuperAdmin) return null;

  const { data, error } = await (await createClient()).rpc("announcement_audience", { a: parsed.data });
  return error || typeof data !== "number" ? null : data;
}
