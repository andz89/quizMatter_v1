import { notFound } from "next/navigation";
import { getAccount } from "@/lib/account";
import { joinParts, timeAgo } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { AdminEditors, type EditorRow } from "./AdminEditors";

/**
 * Admin → Editors: every teacher who reviews QuizMatter presentations, with how many reviews they've had
 * published and the round they have open, to remove them as editor. (Make editors in Admin → Teachers.)
 * Their emails and numbers come from the database in one call (`admin_editors`), and only the editors' own rows are
 * read, so nothing is cut at Supabase's 1,000 rows. Names, bans and open rounds need the secret key.
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

  // Asked as the logged-in admin: the database gives these emails and numbers to admins only.
  const supabase = await createClient();
  const editors = await supabase.rpc("admin_editors");
  if (editors.error) throw editors.error;
  const editorRows = editors.data as EditorCounts[];
  const editorIds = editorRows.map((row) => row.user_id);

  const [settings, bans, open] = await Promise.all([
    admin.from("user_settings").select("user_id, display_name").in("user_id", editorIds),
    admin.from("banned_users").select("user_id").in("user_id", editorIds),
    admin
      .from("presentation_reviews")
      .select("presentation_id, reviewer_id, status, presentations(title)")
      .in("reviewer_id", editorIds)
      .in("status", ["reviewing", "submitted"]),
  ]);
  if (settings.error) throw settings.error;
  if (bans.error) throw bans.error;
  if (open.error) throw open.error;

  return (
    <AdminEditors
      rows={buildRows(
        editorRows,
        settings.data as { user_id: string; display_name: string | null }[],
        bans.data.map((row) => row.user_id as string),
        open.data as unknown as OpenRound[],
      )}
    />
  );
}

// One editor from admin_editors (see the admin_overview_counts migration). last_review: "2026-10-03", or null.
type EditorCounts = {
  user_id: string;
  email: string;
  added_at: string;
  presentations: number;
  photos: number;
  published_reviews: number;
  last_review: string | null;
};

type OpenRound = {
  presentation_id: string;
  reviewer_id: string | null;
  status: "reviewing" | "submitted";
  presentations: { title: string } | null;
};

/** One row per editor, by name (or email). */
function buildRows(
  editors: EditorCounts[],
  settings: { user_id: string; display_name: string | null }[],
  bannedIds: string[],
  openRounds: OpenRound[],
): EditorRow[] {
  const names = new Map(settings.map((row) => [row.user_id, row.display_name ?? ""]));
  const banned = new Set(bannedIds);
  const now = Date.now();

  return editors
    .map((editor) => {
      const round = openRounds.find((row) => row.reviewer_id === editor.user_id);
      return {
        id: editor.user_id,
        email: editor.email,
        name: names.get(editor.user_id) ?? "",
        meta: joinParts([
          `Editor since ${timeAgo(Date.parse(editor.added_at), now)}`,
          `${editor.published_reviews} published ${editor.published_reviews === 1 ? "review" : "reviews"}`,
          editor.last_review && `Last review ${timeAgo(Date.parse(editor.last_review), now)}`,
          `${editor.presentations} ${editor.presentations === 1 ? "presentation" : "presentations"}`,
          `${editor.photos} ${editor.photos === 1 ? "photo" : "photos"}`,
        ]),
        isBanned: banned.has(editor.user_id),
        openRound: round
          ? { presentationId: round.presentation_id, title: round.presentations?.title || "Untitled presentation", status: round.status }
          : null,
      };
    })
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
}
