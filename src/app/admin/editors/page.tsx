import { notFound } from "next/navigation";
import { getAccount } from "@/lib/account";
import type { User } from "@supabase/supabase-js";
import { joinParts, timeAgo } from "@/lib/format";
import { createAdminClient, listAllUsers } from "@/lib/supabase/admin";
import { AdminEditors, type EditorRow } from "./AdminEditors";

/**
 * Admin → Editors: every teacher who reviews QuizMatter presentations, with how many reviews they've had
 * published and the round they have open, to remove them as editor. (Make editors in Admin → Teachers.)
 * The list of accounts needs the secret key.
 */
export default async function AdminEditorsPage() {
  // The layout checks too, but a layout doesn't run again on every request, so the page checks next to its data.
  if (!(await getAccount()).isAdmin) notFound();
  const admin = createAdminClient();
  if (!admin) {
    return (
      <p className="rounded-card border border-border-default bg-bg-surface px-5 py-12 text-center text-sm text-text-secondary">
        This page needs the secret key SUPABASE_SECRET_KEY on the server.
      </p>
    );
  }

  const [users, editors, settings, bans, published, open] = await Promise.all([
    listAllUsers(admin),
    admin.from("editors").select("user_id, added_at"),
    admin.from("user_settings").select("user_id, display_name"),
    admin.from("banned_users").select("user_id"),
    admin.from("presentation_reviewers").select("reviewer_id, reviewed_on"),
    admin
      .from("presentation_reviews")
      .select("presentation_id, reviewer_id, status, presentations(title)")
      .in("status", ["reviewing", "submitted"]),
  ]);
  if (editors.error) throw editors.error;
  if (settings.error) throw settings.error;
  if (bans.error) throw bans.error;
  if (published.error) throw published.error;
  if (open.error) throw open.error;

  // What each editor made: their presentations (not shared copies, like their own lists) and uploaded photos.
  const editorIds = editors.data.map((row) => row.user_id as string);
  const [made, photos] = await Promise.all([
    admin.from("presentations").select("owner_id").in("owner_id", editorIds).is("shared_from", null),
    admin.from("photos").select("user_id").in("user_id", editorIds),
  ]);
  if (made.error) throw made.error;
  if (photos.error) throw photos.error;

  return (
    <AdminEditors
      rows={buildRows(
        users,
        editors.data as { user_id: string; added_at: string }[],
        settings.data as { user_id: string; display_name: string | null }[],
        bans.data.map((row) => row.user_id as string),
        published.data as { reviewer_id: string | null; reviewed_on: string }[],
        open.data as unknown as OpenRound[],
        made.data.map((row) => row.owner_id as string),
        photos.data.map((row) => row.user_id as string),
      )}
    />
  );
}

type OpenRound = {
  presentation_id: string;
  reviewer_id: string | null;
  status: "reviewing" | "submitted";
  presentations: { title: string } | null;
};

/** One row per editor, by name (or email). */
function buildRows(
  users: User[],
  editors: { user_id: string; added_at: string }[],
  settings: { user_id: string; display_name: string | null }[],
  bannedIds: string[],
  published: { reviewer_id: string | null; reviewed_on: string }[],
  openRounds: OpenRound[],
  // One owner id per presentation, one user id per photo.
  presentationOwners: string[],
  photoOwners: string[],
): EditorRow[] {
  const emails = new Map(users.map((user) => [user.id, user.email ?? ""]));
  const names = new Map(settings.map((row) => [row.user_id, row.display_name ?? ""]));
  const banned = new Set(bannedIds);
  const now = Date.now();

  return editors
    .map((editor) => {
      const reviews = published.filter((row) => row.reviewer_id === editor.user_id);
      // reviewed_on is a date ("2026-10-03"), so the newest is the largest string.
      const lastReview = reviews.reduce<string | null>(
        (last, row) => (!last || row.reviewed_on > last ? row.reviewed_on : last),
        null,
      );
      const round = openRounds.find((row) => row.reviewer_id === editor.user_id);
      const presentationCount = presentationOwners.filter((id) => id === editor.user_id).length;
      const photoCount = photoOwners.filter((id) => id === editor.user_id).length;
      return {
        id: editor.user_id,
        email: emails.get(editor.user_id) ?? "",
        name: names.get(editor.user_id) ?? "",
        meta: joinParts([
          `Editor since ${timeAgo(Date.parse(editor.added_at), now)}`,
          `${reviews.length} published ${reviews.length === 1 ? "review" : "reviews"}`,
          lastReview && `Last review ${timeAgo(Date.parse(lastReview), now)}`,
          `${presentationCount} ${presentationCount === 1 ? "presentation" : "presentations"}`,
          `${photoCount} ${photoCount === 1 ? "photo" : "photos"}`,
        ]),
        isBanned: banned.has(editor.user_id),
        openRound: round
          ? { presentationId: round.presentation_id, title: round.presentations?.title || "Untitled presentation", status: round.status }
          : null,
      };
    })
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
}
