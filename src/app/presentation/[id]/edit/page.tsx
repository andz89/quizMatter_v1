import { notFound, redirect } from "next/navigation";
import { PeopleArtGate } from "@/components/PeopleArtGate";
import { getAccount } from "@/lib/account";
import { fetchPresentation } from "@/lib/fetchPresentation";
import { usesPeopleArt } from "@/lib/peopleArt";
import { presentationSchema, type ReviewerFields } from "@/lib/schema";
import { createClient } from "@/lib/supabase/server";
import type { EditorReview } from "@/lib/store";
import { PresentationEditor } from "./PresentationEditor";
import { ReviewSubmittedView } from "./ReviewSubmittedView";

export default async function PresentationPage({ params }: PageProps<"/presentation/[id]/edit">) {
  const { id } = await params;
  const result = await fetchPresentation(id);
  // Also covers someone else's private presentation: the database hides it, so it looks like it doesn't exist.
  if (!result) notFound();
  // My own presentation, unless it's under review (then only its reviewer may change it).
  if (result.isMine && !result.review.isLocked) return <PresentationEditor presentation={result.presentation} />;
  // Someone else's published presentation can be viewed, not edited (saving it would be refused anyway), unless
  // I'm reviewing it.
  if (!result.review.isMine) redirect(`/presentation/${id}`);

  // My review: open my draft (or the live presentation, before my first save), keeping the live author.
  const supabase = await createClient();
  const [{ data: row, error }, account] = await Promise.all([
    supabase
      .from("presentation_reviews")
      .select("status, draft, draft_updated_at, submitted_fields, admin_note")
      .eq("presentation_id", id)
      .single(),
    getAccount(),
  ]);
  if (error) throw error;
  const presentation = row.draft
    ? presentationSchema.parse({ ...row.draft, author: result.presentation.author, updatedAt: Date.parse(row.draft_updated_at) })
    : result.presentation;
  // The form starts with what I sent last time, or my entry from an earlier review, or my account's name and email.
  // A new round's date is left empty here: the form fills in today in the reviewer's own time zone.
  const myEntry = result.reviewers.find((reviewer) => reviewer.email === account.email);
  const fields: ReviewerFields = (row.submitted_fields as ReviewerFields | null) ??
    (myEntry ? { ...myEntry, reviewedOn: "" } : { name: account.displayName, email: account.email, background: "", reviewedOn: "" });
  // Submitted: waiting for an admin, so it's view only (no editor at all).
  if (row.status === "submitted") {
    return (
      <PeopleArtGate needed={usesPeopleArt(presentation.slides)}>
        <ReviewSubmittedView presentation={presentation} fields={fields} />
      </PeopleArtGate>
    );
  }
  const review: EditorReview = { note: row.admin_note ?? "", fields };

  return <PresentationEditor presentation={presentation} review={review} />;
}
