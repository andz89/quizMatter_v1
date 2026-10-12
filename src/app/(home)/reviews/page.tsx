import { redirect } from "next/navigation";
import { getAccount } from "@/lib/account";
import { createClient } from "@/lib/supabase/server";
import { ReviewRows, type MyReviewRow } from "../../MyReviews";
import { CARD_COLUMNS, loadCardContext, myId, orderBy } from "../cards";
import { Empty, PartLabel, SavableCards } from "../CardGrid";

/** "My reviews" (editors only): my open and canceled review rounds, and the live presentations I reviewed. */
export default async function ReviewsPage() {
  const account = await getAccount();
  if (!account.isEditor) redirect("/");
  const supabase = await createClient();
  const me = await myId(supabase);

  const [myReviews, reviewed] = await Promise.all([
    // My open and canceled reviews (see the review migrations).
    supabase.rpc("my_reviews"),
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
  const rows = myReviews.data as MyReviewRow[];
  const openReviews = rows.filter((row) => row.status !== "canceled");
  const canceledReviews = rows.filter((row) => row.status === "canceled");

  return (
    <section className="mb-10">
      {openReviews.length > 0 && (
        <>
          <PartLabel>In progress</PartLabel>
          <ReviewRows rows={openReviews} />
        </>
      )}
      {canceledReviews.length > 0 && (
        <>
          <PartLabel className={openReviews.length > 0 ? "mt-6" : ""}>Canceled</PartLabel>
          <ReviewRows rows={canceledReviews} />
        </>
      )}
      {reviewed.data.length > 0 ? (
        <>
          <PartLabel className={rows.length > 0 ? "mt-6" : ""}>Published</PartLabel>
          <SavableCards cards={reviewed.data.map(toSavableCard)} empty="" />
        </>
      ) : (
        rows.length === 0 && <Empty>You haven&apos;t reviewed any presentations yet.</Empty>
      )}
    </section>
  );
}
