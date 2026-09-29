import Link from "next/link";
import { CANVAS_WIDTH, CANVAS_HEIGHT, getSlideNumbers } from "@/lib/constants";
import { Spinner } from "@/components/Spinner";
import { FluidSlidePreview } from "@/components/presentation/FluidSlidePreview";
import type { Slide } from "@/lib/schema";
import { PresentationCardMenu } from "./PresentationCardMenu";

export type PresentationCardData = {
  id: string;
  href: string;
  title: string;
  // Grade, subject, slide count, when it was changed ("" parts left out). Searched too.
  meta: string;
  // Drawn as the card's picture. null = no picture (Claude's drafts, or a slide that didn't pass the schema).
  firstSlide: Slide | null;
  // "checking" = a draft Claude is still checking (not openable yet); "unfinished" = Claude didn't send its final version.
  // "hidden" = an admin hid it (Admin → Reports), so other teachers can't see it.
  badge?: "draft" | "published" | "hidden" | "checking" | "unfinished";
  // "By <author> · Published by <name>" on other teachers' presentations (parts not filled in are left out).
  byline?: string;
  // Adds "Move to QuizMatter" to the card's menu (an admin's own saved presentations only).
  canMoveToQuizMatter?: boolean;
};

/**
 * A presentation as a card: a picture of its first slide, then the title and a gray line of details.
 * `showMenu` adds the "⋮" menu (Edit, Present, Delete) — only for my own presentations.
 */
export function PresentationCard({ card, showMenu = false }: { card: PresentationCardData; showMenu?: boolean }) {
  const isChecking = card.badge === "checking";
  // Like the design's card: picture, then a small status label, the title and a gray details line, all inside.
  const body = (
    <div
      className={`rounded-card border border-border-default bg-bg-surface p-3 transition-colors ${
        isChecking ? "" : "group-hover:border-accent"
      }`}
    >
      <div
        className="relative overflow-hidden rounded-dropdown border border-border-default"
        style={{ aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}
      >
        {card.firstSlide ? (
          // The presentation's first slide, so a question there is number 1 (unless taken out of the numbers).
          <FluidSlidePreview slide={card.firstSlide} questionNumber={getSlideNumbers([card.firstSlide]).get(card.firstSlide.id)} />
        ) : (
          <div className="flex h-full items-center justify-center gap-2 bg-bg-page text-[13px] text-text-secondary">
            {isChecking && <Spinner size={14} />}
            {isChecking
              ? "Claude is checking the layout…"
              : card.badge === "draft" || card.badge === "unfinished"
                ? "From Claude"
                : "No preview"}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1 px-1 pt-3 pb-1">
        {card.badge && <Kicker badge={card.badge} />}
        <p
          className={`truncate font-heading text-[15px] font-extrabold tracking-[-0.02em] ${
            isChecking ? "text-text-secondary" : "text-text-primary"
          }`}
        >
          {card.title}
        </p>
        {card.byline && <p className="truncate text-xs font-semibold text-text-secondary">{card.byline}</p>}
        <p className="truncate text-xs text-text-secondary">{card.meta}</p>
      </div>
    </div>
  );

  // The menu sits next to the link, not in it (a button can't go inside a link), placed over the picture.
  return (
    <div className="relative min-w-0">
      {/* A draft Claude is still checking can't be opened yet. */}
      {isChecking ? (
        <div className="block">{body}</div>
      ) : (
        // Opens in a new tab, so the list stays open in this one.
        <Link href={card.href} target="_blank" className="group block">
          {body}
        </Link>
      )}
      {showMenu && <PresentationCardMenu card={card} />}
    </div>
  );
}

// The status as the card's small uppercase label, colored by meaning (dark shades, so the small text reads well).
const KICKERS: Record<NonNullable<PresentationCardData["badge"]>, { label: string; className: string }> = {
  draft: { label: "Draft", className: "text-highlight-strong" },
  published: { label: "Published", className: "text-success-strong" },
  hidden: { label: "Hidden by QuizMatter", className: "text-danger-strong" },
  checking: { label: "Checking…", className: "text-text-secondary" },
  unfinished: { label: "Not finished", className: "text-text-secondary" },
};

function Kicker({ badge }: { badge: NonNullable<PresentationCardData["badge"]> }) {
  const { label, className } = KICKERS[badge];
  return <span className={`text-[11px] leading-none font-semibold tracking-[0.06em] uppercase ${className}`}>{label}</span>;
}
