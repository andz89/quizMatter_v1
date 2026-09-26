import Link from "next/link";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "@/lib/constants";
import { joinParts } from "@/lib/format";
import { LinkPending } from "@/components/LinkPending";
import { Spinner } from "@/components/Spinner";
import { FluidSlidePreview } from "@/components/presentation/FluidSlidePreview";
import type { Slide } from "@/lib/schema";
import { LessonCardMenu } from "./LessonCardMenu";

export type LessonCardData = {
  id: string;
  href: string;
  title: string;
  // Grade, subject, slide count, when it was changed ("" parts left out). Searched too.
  meta: string;
  // Drawn as the card's picture. null = no picture (Claude's drafts, or a slide that didn't pass the schema).
  firstSlide: Slide | null;
  // "checking" = a draft Claude is still checking (not openable yet); "unfinished" = Claude didn't send its final version.
  badge?: "draft" | "published" | "checking" | "unfinished";
  // "By <author>" on other teachers' lessons, when the author is filled in.
  byline?: string;
};

/**
 * A lesson as a card: a picture of its first slide, then the title and a gray line of details.
 * `showMenu` adds the "⋮" menu (Edit, Present, Delete) — only for my own lessons.
 */
export function LessonCard({ card, showMenu = false }: { card: LessonCardData; showMenu?: boolean }) {
  const isChecking = card.badge === "checking";
  const body = (
    <>
      <div
        className={`relative rounded-card border border-border-default bg-bg-surface p-3 transition-colors ${
          isChecking ? "" : "group-hover:border-text-secondary"
        }`}
      >
        <div
          className="overflow-hidden rounded-dropdown border border-border-default"
          style={{ aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}
        >
          {card.firstSlide ? (
            <FluidSlidePreview slide={card.firstSlide} />
          ) : (
            <div className="flex h-full items-center justify-center gap-2 bg-bg-page text-[13px] text-text-secondary">
              {isChecking && <Spinner size={14} />}
              {isChecking ? "Claude is checking the layout…" : card.badge ? "From Claude" : "No preview"}
            </div>
          )}
        </div>
        {card.badge && <Badge badge={card.badge} />}
        {/* In the middle of the picture, on a white circle so it shows on any slide. */}
        {!isChecking && (
          <LinkPending spinnerClassName="absolute top-1/2 left-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-bg-surface" />
        )}
      </div>
      <p className={`mt-2 truncate text-sm font-semibold ${isChecking ? "text-text-secondary" : "text-text-primary"}`}>{card.title}</p>
      <p className="mt-0.5 truncate text-[13px] text-text-secondary">{joinParts([card.byline, card.meta])}</p>
    </>
  );

  // The menu sits next to the link, not in it (a button can't go inside a link), placed over the picture.
  return (
    <div className="relative min-w-0">
      {/* A draft Claude is still checking can't be opened yet. */}
      {isChecking ? (
        <div className="block">{body}</div>
      ) : (
        <Link href={card.href} className="group block">
          {body}
        </Link>
      )}
      {showMenu && <LessonCardMenu card={card} />}
    </div>
  );
}

const BADGES: Record<NonNullable<LessonCardData["badge"]>, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-accent-orange text-white" },
  published: { label: "Published", className: "bg-accent-green text-white" },
  checking: { label: "Checking…", className: "border border-border-default bg-bg-surface text-text-secondary" },
  unfinished: { label: "Not finished", className: "bg-accent-gray text-white" },
};

function Badge({ badge }: { badge: NonNullable<LessonCardData["badge"]> }) {
  const { label, className } = BADGES[badge];
  return (
    <span className={`absolute top-5 left-5 rounded-dropdown px-2 py-1 text-xs leading-none font-semibold ${className}`}>{label}</span>
  );
}
