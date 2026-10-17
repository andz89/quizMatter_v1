import { redirect } from "next/navigation";
import { getAccount } from "@/lib/account";
import { loadMySubmissions } from "@/lib/submissions";
import { createClient } from "@/lib/supabase/server";
import { ReviewsTable, type MyReviewRow } from "../../MyReviews";
import { SubmissionsTable } from "../../MySubmissions";
import { myId } from "../cards";
import { Empty, PartLabel } from "../CardGrid";

/**
 * "Reviews & submissions" (editors only): my review rounds (open, canceled, and the live presentations I reviewed)
 * and my presentations sent to QuizMatter, as tables.
 */
export default async function ReviewsSubmissionsPage() {
  const account = await getAccount();
  if (!account.isEditor) redirect("/");
  const supabase = await createClient();
  const me = await myId(supabase);

  const [myReviews, submissions, reviewed] = await Promise.all([
    // My open and canceled reviews (see the review migrations).
    supabase.rpc("my_reviews"),
    // My presentations sent to QuizMatter (see the quizmatter_submissions migration).
    loadMySubmissions(supabase),
    // The live QuizMatter presentations I reviewed (an admin published my review, so I'm in its "Reviewed by"
    // list). "!inner" keeps only the ones with my presentation_reviewers row.
    supabase
      .from("presentations")
      .select("id, title, presentation_reviewers!inner(reviewer_id)")
      .eq("presentation_reviewers.reviewer_id", me)
      .eq("is_published", true)
      .is("hidden_at", null)
      .eq("from_admin", true)
      .order("updated_at", { ascending: false }),
  ]);
  if (myReviews.error) throw myReviews.error;
  if (reviewed.error) throw reviewed.error;

  // Open and canceled rounds first, then the published ones (newest first).
  const reviews: MyReviewRow[] = [
    ...(myReviews.data as MyReviewRow[]),
    ...reviewed.data.map((p) => ({
      presentation_id: p.id,
      title: p.title,
      status: "published" as const,
      admin_note: null,
      canceled_by_admin: false,
    })),
  ];

  if (reviews.length === 0 && submissions.length === 0) {
    return (
      <section className="mb-10">
        <Empty>You haven&apos;t reviewed or submitted any presentations yet.</Empty>
      </section>
    );
  }
  return (
    <section className="mb-10">
      {reviews.length > 0 && (
        <>
          <PartLabel>Reviews</PartLabel>
          <ReviewsTable rows={reviews} />
        </>
      )}
      {submissions.length > 0 && (
        <>
          <PartLabel className={reviews.length > 0 ? "mt-6" : ""}>Submissions</PartLabel>
          <SubmissionsTable rows={submissions} />
        </>
      )}
    </section>
  );
}
