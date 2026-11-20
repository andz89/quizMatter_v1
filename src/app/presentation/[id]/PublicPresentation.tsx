import Link from "next/link";
import { LinkPending } from "@/components/LinkPending";
import { PeopleArtGate } from "@/components/PeopleArtGate";
import { FluidSlidePreview } from "@/components/presentation/FluidSlidePreview";
import { CANVAS_HEIGHT, CANVAS_WIDTH, getSlideNumbers } from "@/lib/constants";
import { joinParts, slideCountLabel } from "@/lib/format";
import { usesPeopleArt } from "@/lib/peopleArt";
import type { PublicPresentation as PublicData } from "@/lib/publicPresentation";
import { gradesLabel, gradesTitle } from "@/lib/schema";

/**
 * A published presentation's public preview, for logged-out visitors and robots (Google, Facebook's link reader):
 * its first shown slide, title, Author, details and description, and buttons to log in or sign up to see the rest.
 * Logged-in teachers get the full view page instead (see page.tsx).
 */
export function PublicPresentation({ presentation }: { presentation: PublicData }) {
  const { id, title, description, subject, grades, authorName, slideCount, firstSlide } = presentation;
  const loginHref = `/login?next=${encodeURIComponent(`/presentation/${id}`)}`;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-14">
      <article className="overflow-hidden rounded-card border border-border-default bg-bg-surface">
        <div className="border-b border-border-default" style={{ aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}>
          {firstSlide ? (
            <PeopleArtGate needed={usesPeopleArt([firstSlide])}>
              <FluidSlidePreview
                slide={firstSlide}
                questionNumber={getSlideNumbers([firstSlide]).get(firstSlide.id)}
                // A logged-out visitor's browser never asks YouTube for a video's cover picture.
                showVideoCover={false}
              />
            </PeopleArtGate>
          ) : (
            <div className="flex h-full items-center justify-center bg-bg-page text-sm text-text-secondary">No slides yet</div>
          )}
        </div>
        <div className="px-5 py-5 sm:px-6">
          <h1 className="text-2xl font-extrabold text-text-primary">{title || "Untitled presentation"}</h1>
          {authorName && <p className="mt-1 text-sm font-semibold text-text-primary">By {authorName}</p>}
          <p title={gradesTitle(grades)} className="mt-1 text-sm text-text-secondary">
            {joinParts([subject, gradesLabel(grades), slideCountLabel(slideCount)])}
          </p>
          {description && <p className="mt-4 text-sm whitespace-pre-line text-text-primary">{description}</p>}
          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <Link
              href={loginHref}
              className="flex items-center justify-center rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
            >
              {slideCount === 1 ? "Log in to see the slide" : `Log in to see all ${slideCount} slides`}
              <LinkPending />
            </Link>
            <Link
              href="/signup"
              className="flex items-center justify-center rounded-button border border-border-default bg-bg-surface px-4 py-2 text-sm font-semibold text-text-primary hover:bg-accent-soft"
            >
              Sign up free
              <LinkPending />
            </Link>
          </div>
        </div>
      </article>
    </main>
  );
}
