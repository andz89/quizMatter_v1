import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeftIcon } from "lucide-react";
import { LinkPending } from "@/components/LinkPending";
import { PeopleArtGate } from "@/components/PeopleArtGate";
import { ReviewDraftView } from "@/components/presentation/ReviewDraftView";
import { joinParts, slideCountLabel } from "@/lib/format";
import { usesPeopleArt } from "@/lib/peopleArt";
import { presentationSchema, type ReviewerFields } from "@/lib/schema";
import { createClient } from "@/lib/supabase/server";
import { ReviewDecision } from "./ReviewDecision";

/** A submitted review: the reviewer's version and details, with Publish and Send back. (The layout checks admins.) */
export default async function AdminReviewPage({ params }: PageProps<"/admin/presentations/reviews/[id]">) {
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("presentation_reviews")
    .select("status, draft, submitted_fields")
    .eq("presentation_id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.status !== "submitted") notFound();

  const presentation = presentationSchema.parse(data.draft);
  const fields = data.submitted_fields as ReviewerFields;

  return (
    <PeopleArtGate needed={usesPeopleArt(presentation.slides)}>
      <Link
        href="/admin/presentations/reviews"
        className="mb-4 inline-flex items-center gap-1 text-sm text-text-secondary transition-colors hover:text-text-primary"
      >
        <ChevronLeftIcon size={16} />
        Under review
        <LinkPending />
      </Link>

      <header className="mb-4 flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-extrabold text-text-primary">{presentation.title || "Untitled presentation"}</h2>
          <p className="mt-0.5 text-sm text-text-secondary">
            {joinParts([presentation.grade, presentation.subject, slideCountLabel(presentation.slides.length)])}
          </p>
        </div>
        <div className="ml-auto">
          <ReviewDecision presentationId={id} />
        </div>
      </header>

      <ReviewDraftView presentation={presentation} fields={fields} />
    </PeopleArtGate>
  );
}
