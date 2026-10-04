import Link from "next/link";
import { ClipboardCheckIcon } from "lucide-react";
import { LinkPending } from "@/components/LinkPending";
import { getAccount } from "@/lib/account";
import { listDrafts, type DraftSummary } from "@/lib/drafts";
import { joinParts, timeAgo } from "@/lib/format";
import { parseSlide } from "@/lib/schema";
import { createClient } from "@/lib/supabase/server";
import { NewPresentationButton } from "../../PresentationListButtons";
import { AdminPresentations, type AdminPresentationRow } from "./AdminPresentations";
import type { ApprovedReviewer } from "./ReviewersModal";

/**
 * Admin → Presentations: the QuizMatter presentations I made. Shared ones go to every teacher's home page
 * ("From QuizMatter"); drafts only I see. (../layout.tsx checks the user is an admin.)
 */
export default async function AdminPresentationsPage() {
  const supabase = await createClient();
  const account = await getAccount();
  const [drafts, { data, error }, reviews, reviewers] = await Promise.all([
    listDrafts(account.id),
    supabase
      .from("presentations")
      .select("id, title, grade, subject, is_published, created_at, updated_at, slides(count), first_slide:slides(data, position)")
      .eq("from_admin", true)
      .eq("owner_id", account.id)
      .order("updated_at", { ascending: false })
      .order("position", { referencedTable: "first_slide" })
      .limit(1, { referencedTable: "first_slide" }),
    // Admins can read every review row (see the presentation_reviews migration).
    supabase.from("presentation_reviews").select("presentation_id, status, open_to_all"),
    // Everyone whose review an admin published, with the admin who approved it (the Review column).
    supabase.rpc("admin_reviewers"),
  ]);
  if (error) throw error;
  if (reviews.error) throw reviews.error;
  if (reviewers.error) throw reviewers.error;
  const reviewById = new Map(reviews.data.map((row) => [row.presentation_id as string, row as ReviewRow]));
  const reviewersById = new Map<string, ApprovedReviewer[]>();
  for (const row of reviewers.data as AdminReviewerRow[]) {
    const list = reviewersById.get(row.presentation_id) ?? [];
    list.push({
      name: row.name,
      email: row.email,
      background: row.background,
      reviewedOn: row.reviewed_on,
      approvedAt: row.approved_at,
      approverName: row.approver_name,
      approverEmail: row.approver_email,
    });
    reviewersById.set(row.presentation_id, list);
  }
  const openReviews = reviews.data.filter((row) => row.status === "reviewing" || row.status === "submitted").length;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <p className="mr-auto text-sm text-text-secondary">
          Shared presentations show on every teacher&apos;s home page, under “From QuizMatter”.
        </p>
        <Link
          href="/admin/presentations/reviews"
          className="inline-flex items-center gap-2 rounded-button border border-border-default bg-bg-surface px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-page"
        >
          <ClipboardCheckIcon size={16} />
          Under review{openReviews > 0 && ` (${openReviews})`}
          <LinkPending />
        </Link>
        <NewPresentationButton author={account.displayName} fromAdmin />
      </div>

      <AdminPresentations rows={buildRows(data, drafts, reviewById, reviewersById)} />
    </>
  );
}

type ReviewRow = {
  presentation_id: string;
  status: "reviewing" | "submitted" | "canceled" | "published" | null;
  open_to_all: boolean;
};

type AdminReviewerRow = {
  presentation_id: string;
  name: string;
  email: string;
  background: string;
  reviewed_on: string;
  approved_at: string | null;
  approver_name: string;
  approver_email: string;
};

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
function buildRows(
  presentations: SavedPresentation[],
  drafts: DraftSummary[],
  reviewById: Map<string, ReviewRow>,
  reviewersById: Map<string, ApprovedReviewer[]>,
): AdminPresentationRow[] {
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
      reviewStatus: null,
      isOpenToAll: false,
      reviewers: [],
      slideCount: draft.slideCount,
      createdAt: draft.createdAt,
      updatedAt: draft.createdAt,
      createdLabel: timeAgo(draft.createdAt, now),
      updatedLabel: timeAgo(draft.createdAt, now),
    }));
  const savedRows = presentations.map((presentation) => {
    const createdAt = Date.parse(presentation.created_at);
    const updatedAt = Date.parse(presentation.updated_at);
    const review = reviewById.get(presentation.id);
    return {
      id: presentation.id,
      title: presentation.title || "Untitled presentation",
      meta: joinParts([presentation.grade, presentation.subject]),
      isShared: presentation.is_published,
      firstSlide: parseSlide(presentation.first_slide[0]?.data),
      // Under review: reviewing or submitted. Locked until an admin publishes it or the reviewer stops.
      reviewStatus: review?.status === "reviewing" || review?.status === "submitted" ? review.status : null,
      isOpenToAll: review?.open_to_all === true,
      reviewers: reviewersById.get(presentation.id) ?? [],
      slideCount: presentation.slides[0]?.count ?? 0,
      createdAt,
      updatedAt,
      createdLabel: timeAgo(createdAt, now),
      updatedLabel: timeAgo(updatedAt, now),
    };
  });
  return [...draftRows, ...savedRows];
}
