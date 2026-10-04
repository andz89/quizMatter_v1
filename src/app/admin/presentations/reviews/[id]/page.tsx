import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeftIcon } from "lucide-react";
import { LinkPending } from "@/components/LinkPending";
import { PeopleArtGate } from "@/components/PeopleArtGate";
import { FluidSlidePreview } from "@/components/presentation/FluidSlidePreview";
import { CANVAS_HEIGHT, CANVAS_WIDTH, getSlideNumbers } from "@/lib/constants";
import { formatDay, joinParts, slideCountLabel } from "@/lib/format";
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
  const slideNumbers = getSlideNumbers(presentation.slides);
  const details = [
    { label: "Description", value: presentation.description },
    { label: "Curriculum", value: presentation.curriculum },
    { label: "Learning competency", value: presentation.learningCompetency },
    { label: "Tags", value: presentation.tags.join(", ") },
    { label: "References", value: presentation.referenceLinks.join("\n") },
  ].filter((detail) => detail.value);

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

      <dl className="mb-6 grid gap-4 rounded-card border border-border-default bg-bg-surface px-5 py-4 text-sm">
        <div>
          <dt className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">Reviewed by</dt>
          <dd className="mt-1 text-text-primary">
            <span className="font-semibold">{fields.name}</span>
            <span className="text-text-secondary">
              {" "}
              · {fields.email} · {formatDay(fields.reviewedOn)}
            </span>
            <span className="mt-0.5 block whitespace-pre-line text-text-secondary">{fields.background}</span>
          </dd>
        </div>
        {details.map((detail) => (
          <div key={detail.label}>
            <dt className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">{detail.label}</dt>
            <dd className="mt-1 whitespace-pre-line break-words text-text-primary">{detail.value}</dd>
          </div>
        ))}
      </dl>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {presentation.slides.map((slide, index) => (
          <div key={slide.id}>
            <div
              className="overflow-hidden rounded-dropdown border border-border-default bg-bg-surface"
              style={{ aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}
            >
              <FluidSlidePreview slide={slide} questionNumber={slideNumbers.get(slide.id)} />
            </div>
            <span className="mt-1.5 block text-[13px] text-text-secondary">{index + 1}</span>
          </div>
        ))}
      </div>
    </PeopleArtGate>
  );
}
