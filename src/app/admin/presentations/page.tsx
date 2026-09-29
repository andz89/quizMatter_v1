import { getAccount } from "@/lib/account";
import { listDrafts, type DraftSummary } from "@/lib/drafts";
import { joinParts, timeAgo } from "@/lib/format";
import { parseSlide } from "@/lib/schema";
import { createClient } from "@/lib/supabase/server";
import { NewPresentationButton } from "../../PresentationListButtons";
import { AdminPresentations, type AdminPresentationRow } from "./AdminPresentations";

/**
 * Admin → Presentations: the QuizMatter presentations I made. Shared ones go to every teacher's home page
 * ("From QuizMatter"); drafts only I see. (../layout.tsx checks the user is an admin.)
 */
export default async function AdminPresentationsPage() {
  const supabase = await createClient();
  const [{ data: claims }, account, drafts] = await Promise.all([supabase.auth.getClaims(), getAccount(), listDrafts()]);
  const { data, error } = await supabase
    .from("presentations")
    .select("id, title, grade, subject, is_published, created_at, updated_at, slides(count), first_slide:slides(data, position)")
    .eq("from_admin", true)
    .eq("owner_id", claims?.claims.sub ?? "")
    .order("updated_at", { ascending: false })
    .order("position", { referencedTable: "first_slide" })
    .limit(1, { referencedTable: "first_slide" });
  if (error) throw error;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <p className="mr-auto text-sm text-text-secondary">
          Shared presentations show on every teacher&apos;s home page, under “From QuizMatter”.
        </p>
        <NewPresentationButton author={account.displayName} fromAdmin />
      </div>

      <AdminPresentations rows={buildRows(data, drafts)} />
    </>
  );
}

type SavedPresentation = {
  id: string;
  title: string;
  grade: string;
  subject: string;
  is_published: boolean;
  created_at: string;
  updated_at: string;
  slides: { count: number }[];
  first_slide: { data: unknown }[];
};

/** The QuizMatter presentations, and Claude's drafts that aren't saved yet (an admin's become QuizMatter ones). */
function buildRows(presentations: SavedPresentation[], drafts: DraftSummary[]): AdminPresentationRow[] {
  const now = Date.now();
  const savedIds = new Set(presentations.map((presentation) => presentation.id));
  const draftRows = drafts
    // A saved draft took the draft's id (see /presentation/new).
    .filter((draft) => !savedIds.has(draft.id))
    .map((draft) => ({
      id: draft.id,
      title: draft.title || "Untitled presentation",
      meta: joinParts([draft.grade, draft.subject]),
      isShared: false,
      firstSlide: null,
      claudeDraft: draft.state,
      slideCount: draft.slideCount,
      createdAt: draft.createdAt,
      updatedAt: draft.createdAt,
      createdLabel: timeAgo(draft.createdAt, now),
      updatedLabel: timeAgo(draft.createdAt, now),
    }));
  const savedRows = presentations.map((presentation) => {
    const createdAt = Date.parse(presentation.created_at);
    const updatedAt = Date.parse(presentation.updated_at);
    return {
      id: presentation.id,
      title: presentation.title || "Untitled presentation",
      meta: joinParts([presentation.grade, presentation.subject]),
      isShared: presentation.is_published,
      firstSlide: parseSlide(presentation.first_slide[0]?.data),
      slideCount: presentation.slides[0]?.count ?? 0,
      createdAt,
      updatedAt,
      createdLabel: timeAgo(createdAt, now),
      updatedLabel: timeAgo(updatedAt, now),
    };
  });
  return [...draftRows, ...savedRows];
}
