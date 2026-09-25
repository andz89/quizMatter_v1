import Link from "next/link";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "@/lib/constants";
import { joinParts } from "@/lib/format";
import { LinkPending } from "@/components/LinkPending";
import { FluidSlidePreview } from "@/components/presentation/FluidSlidePreview";
import type { Slide } from "@/lib/schema";

export type LessonCardData = {
  id: string;
  href: string;
  title: string;
  // Grade, subject, slide count, when it was changed ("" parts left out). Searched too.
  meta: string;
  // Drawn as the card's picture. null = no picture (Claude's drafts, or a slide that didn't pass the schema).
  firstSlide: Slide | null;
  badge?: "draft" | "published";
  // "By <author>" on other teachers' lessons, when the author is filled in.
  byline?: string;
};

/** A lesson as a card: a picture of its first slide, then the title and a gray line of details. */
export function LessonCard({ card }: { card: LessonCardData }) {
  return (
    <Link href={card.href} className="group block min-w-0">
      <div className="relative rounded-card border border-border-default bg-bg-surface p-3 transition-colors group-hover:border-text-secondary">
        <div
          className="overflow-hidden rounded-dropdown border border-border-default"
          style={{ aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}
        >
          {card.firstSlide ? (
            <FluidSlidePreview slide={card.firstSlide} />
          ) : (
            <div className="flex h-full items-center justify-center bg-bg-page text-[13px] text-text-secondary">
              {card.badge === "draft" ? "From Claude" : "No preview"}
            </div>
          )}
        </div>
        {card.badge && <Badge badge={card.badge} />}
        {/* In the middle of the picture, on a white circle so it shows on any slide. */}
        <LinkPending spinnerClassName="absolute top-1/2 left-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-bg-surface" />
      </div>
      <p className="mt-2 truncate text-sm font-semibold text-text-primary">{card.title}</p>
      <p className="mt-0.5 truncate text-[13px] text-text-secondary">{joinParts([card.byline, card.meta])}</p>
    </Link>
  );
}

function Badge({ badge }: { badge: NonNullable<LessonCardData["badge"]> }) {
  return (
    <span
      className={`absolute top-5 left-5 rounded-dropdown px-2 py-1 text-xs leading-none font-semibold text-white ${
        badge === "draft" ? "bg-accent-orange" : "bg-accent-green"
      }`}
    >
      {badge === "draft" ? "Draft" : "Published"}
    </span>
  );
}
