import { redirect } from "next/navigation";
import { getAccount } from "@/lib/account";
import { loadMySubmissions } from "@/lib/submissions";
import { createClient } from "@/lib/supabase/server";
import { ReviewsTable, type MyReviewRow } from "../../MyReviews";
import { SubmissionsTable } from "../../MySubmissions";
import { CARD_COLUMNS, loadCardContext, myId, orderBy } from "../cards";
import { Empty, PartLabel, SavableCards } from "../CardGrid";

/**
 * "Reviews & submissions" (editors only): my review rounds and my presentations sent to QuizMatter, as tables,
 * then the live presentations I reviewed.
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
    orderBy(
      supabase
        .from("presentations")
        .select(`${CARD_COLUMNS}, presentation_reviewers!inner(reviewer_id)`)
        .eq("presentation_reviewers.reviewer_id", me)
        .eq("is_published", true)
        .is("hidden_at", null)
        .eq("from_admin", true),
      "updated"
    ),
  ]);
  if (myReviews.error) throw myReviews.error;
  if (reviewed.error) throw reviewed.error;

  const { toSavableCard } = await loadCardContext(supabase, reviewed.data, me);
  const reviews = myReviews.data as MyReviewRow[];

  if (reviews.length === 0 && submissions.length === 0 && reviewed.data.length === 0) {
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
      {reviewed.data.length > 0 && (
        <>
          <PartLabel className={reviews.length > 0 || submissions.length > 0 ? "mt-6" : ""}>Published</PartLabel>
          <SavableCards cards={reviewed.data.map(toSavableCard)} empty="" />
        </>
      )}
    </section>
  );
}
