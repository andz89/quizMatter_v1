import { FluidSlidePreview } from "@/components/presentation/FluidSlidePreview";
import { CANVAS_HEIGHT, CANVAS_WIDTH, getSlideNumbers } from "@/lib/constants";
import { formatDay } from "@/lib/format";
import type { Presentation, ReviewerFields } from "@/lib/schema";

/**
 * A review's draft, view only: the "Reviewed by" details, the presentation's details, and every slide as a
 * picture. Used by the admin's review page and by the reviewer's page once they've submitted.
 */
export function ReviewDraftView({ presentation, fields }: { presentation: Presentation; fields: ReviewerFields }) {
  const slideNumbers = getSlideNumbers(presentation.slides);
  const details = [
    { label: "Description", value: presentation.description },
    { label: "Curriculum", value: presentation.curriculum },
    { label: "Learning competency", value: presentation.learningCompetency },
    { label: "Tags", value: presentation.tags.join(", ") },
    { label: "References", value: presentation.referenceLinks.join("\n") },
  ].filter((detail) => detail.value);

  return (
    <>
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
    </>
  );
}
