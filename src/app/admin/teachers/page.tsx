import { notFound } from "next/navigation";
import { getAccount } from "@/lib/account";
import { ageOn, todayInManila } from "@/lib/age";
import type { User } from "@supabase/supabase-js";
import { joinParts, timeAgo } from "@/lib/format";
import { createAdminClient, listAllUsers } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { educationLine, placeLine } from "@/lib/profiles";
import { GENDER_LABELS, type Gender } from "@/lib/userSettings";
import { AdminTeachers, type TeacherRow } from "./AdminTeachers";

/**
 * Admin → Teachers: everyone who can log in, to ban those who misuse QuizMatter (and unban them), and to make
 * editors (they review QuizMatter presentations).
 * The list of accounts needs the secret key.
 */
export default async function AdminTeachersPage() {
  // The layout checks too, but a layout doesn't run again on every request, so the page checks next to its data.
  if (!(await getAccount()).isSuperAdmin) notFound();
  const admin = createAdminClient();
  if (!admin) {
    return (
      <p className="rounded-card border border-border-default bg-bg-surface px-5 py-12 text-center text-sm text-text-secondary">
        This page needs the secret key SUPABASE_SECRET_KEY on the server.
      </p>
    );
  }

  const supabase = await createClient();
  // Bans and settings can be many rows (one per teacher), so they're read a page at a time; admins and editors are
  // a handful, given by hand.
  const [users, bans, admins, editors, settings] = await Promise.all([
    listAllUsers(admin),
    readAll((from, to) =>
      supabase.from("banned_users").select("user_id, reason, banned_at, is_automatic").order("user_id").range(from, to),
    ),
    admin.from("admins").select("user_id"),
    admin.from("editors").select("user_id"),
    readAll((from, to) =>
      admin
        .from("user_settings")
        .select(
          "user_id, display_name, first_name, last_name, contact_number, education_level, education_field, birth_date, gender, province, town",
        )
        .order("user_id")
        .range(from, to),
    ),
  ]);
  if (admins.error) throw admins.error;
  if (editors.error) throw editors.error;

  return (
    <AdminTeachers
      rows={buildRows(
        users,
        bans as Ban[],
        admins.data.map((row) => row.user_id as string),
        editors.data.map((row) => row.user_id as string),
        settings as Settings[],
      )}
    />
  );
}

// Supabase sends at most 1,000 rows per request.
const PAGE_SIZE = 1000;

/** Every row of a read, a page at a time: `page` reads rows `from` to `to` (in a fixed order). Throws if one fails. */
async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: Error | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

// is_automatic: banned by the database for clicking too fast (see the click_auto_ban migration), not by an admin.
type Ban = { user_id: string; reason: string; banned_at: string; is_automatic: boolean };

type Settings = {
  user_id: string;
  display_name: string;
  first_name: string;
  last_name: string;
  contact_number: string;
  education_level: string;
  education_field: string;
  birth_date: string | null;
  gender: string;
  province: string;
  town: string;
};

/**
 * "Ana Cruz · 34 · Female · Quezon City, Metro Manila · +63 917 123 4567 · Master's degree in English" ("" when the
 * teacher gave no details; a missing part is left out).
 */
function detailsLine(row: Settings) {
  return joinParts([
    `${row.first_name} ${row.last_name}`.trim(),
    row.birth_date && String(ageOn(row.birth_date, todayInManila())),
    GENDER_LABELS[row.gender as Gender],
    placeLine(row.town, row.province),
    row.contact_number,
    educationLine(row.education_level, row.education_field),
  ]);
}

/** One row per account: banned teachers first, then by email. */
function buildRows(
  users: User[],
  bans: Ban[],
  adminIds: string[],
  editorIds: string[],
  settings: Settings[],
): TeacherRow[] {
  const banByUser = new Map(bans.map((ban) => [ban.user_id, ban]));
  const admins = new Set(adminIds);
  const editors = new Set(editorIds);
  const settingsByUser = new Map(settings.map((row) => [row.user_id, row]));
  const now = Date.now();

  return users
    .map((user) => {
      const ban = banByUser.get(user.id);
      const settingsRow = settingsByUser.get(user.id);
      return {
        id: user.id,
        email: user.email ?? "",
        name: settingsRow?.display_name ?? "",
        details: settingsRow ? detailsLine(settingsRow) : "",
        // Signed up but hasn't clicked the link in the email yet.
        isConfirmed: Boolean(user.email_confirmed_at),
        meta: joinParts([
          `Joined ${timeAgo(Date.parse(user.created_at), now)}`,
          user.last_sign_in_at && `Last login ${timeAgo(Date.parse(user.last_sign_in_at), now)}`,
        ]),
        isAdmin: admins.has(user.id),
        isEditor: editors.has(user.id),
        ban: ban ? { reason: ban.reason, when: timeAgo(Date.parse(ban.banned_at), now), isAutomatic: ban.is_automatic } : null,
      };
    })
    .sort((a, b) => Number(Boolean(b.ban)) - Number(Boolean(a.ban)) || a.email.localeCompare(b.email));
}
