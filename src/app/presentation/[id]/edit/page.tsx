import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { LinkPending } from "@/components/LinkPending";
import { NavBar, navLinkClass } from "@/components/NavBar";
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
  // What I sent, or my account's name and email, which submit_review saves the same way (no display name = the
  // part of the email before "@"). The date is set on submit, in my own time zone.
  const fields: ReviewerFields = (row.submitted_fields as ReviewerFields | null) ?? {
    name: account.displayName.trim() || account.email.split("@")[0],
    email: account.email,
    reviewedOn: "",
  };
  // Submitted: waiting for an admin, so it's view only (no editor at all), with the top bar like other pages.
  if (row.status === "submitted") {
    return (
      <>
        <NavBar>
          <Link href="/" className={navLinkClass}>
            Home
            <LinkPending />
          </Link>
        </NavBar>
        <PeopleArtGate needed={usesPeopleArt(presentation.slides)}>
          <ReviewSubmittedView presentation={presentation} fields={fields} />
        </PeopleArtGate>
      </>
    );
  }
  const review: EditorReview = { note: row.admin_note ?? "", fields };

  return <PresentationEditor presentation={presentation} review={review} />;
}
