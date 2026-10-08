"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BookmarkIcon, ClipboardCheckIcon, EyeIcon } from "lucide-react";
import { CANVAS_WIDTH, CANVAS_HEIGHT, getSlideNumbers } from "@/lib/constants";
import { createId } from "@/lib/id";
import { formatDay, joinParts, publishedByLine, slideCountLabel } from "@/lib/format";
import { SaveRefusedError, saveErrorMessage, savePresentationToDb } from "@/lib/presentations";
import { startReview } from "@/lib/reviews";
import { loadReviewStatus, type Reviewer, type ReviewStatus } from "@/lib/reviewStatus";
import { createClient } from "@/lib/supabase/client";
import { DETAIL_MAX_LENGTH, gradesLabel, isWebLink, type Presentation } from "@/lib/schema";
import { useEditorStore } from "@/lib/store";
import { pauseFeature, useIsPaused } from "@/lib/clickLimits";
import { LinkPending } from "@/components/LinkPending";
import { Spinner } from "@/components/Spinner";
import { TopLoadingBar } from "@/components/TopLoadingBar";
import { FluidSlidePreview } from "@/components/presentation/FluidSlidePreview";
import { ReportButton } from "./ReportButton";
import { setPresentationSaved } from "./actions";
import { SAVE_ERRORS } from "../../SaveCardButton";

// Only downloaded when the teacher clicks Present.
const PresentationView = dynamic(() =>
  import("@/components/presentation/PresentationView").then((mod) => mod.PresentationView)
);

/**
 * A presentation's details and all its slides, view only. Present shows it fullscreen (the same view as the
 * editor's Present button); "Make a copy" saves a private copy for me and opens it in the editor. "Save" bookmarks
 * someone else's presentation to my home page's "Saved" row (like YouTube's), and "Report" sends it to the admins.
 * Editors can review a shared QuizMatter presentation ("Review"); while it's under review nobody can copy it, and
 * its owner can't edit it. Everyone who reviewed it is listed under "Reviewed by".
 */
export function PresentationPreview({
  presentation,
  isMine,
  publisherName,
  isSaved: savedAtStart,
  review,
  reviewers,
}: {
  presentation: Presentation;
  isMine: boolean;
  publisherName: string;
  isSaved: boolean;
  review: ReviewStatus;
  reviewers: Reviewer[];
}) {
  const router = useRouter();
  const isPresenting = useEditorStore((s) => s.isPresenting);
  const [isCopying, setIsCopying] = useState(false);
  const [isSaved, setIsSaved] = useState(savedAtStart);
  const [isSaving, setIsSaving] = useState(false);
  const [isStartingReview, setIsStartingReview] = useState(false);
  // Saving is paused for clicking too fast (the notice at the bottom says until when).
  const isSavePaused = useIsPaused("saved");

  // The presentation view reads the editor's store, so the presentation goes in there first.
  const present = async (slideId = presentation.slides[0]?.id) => {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      // Fullscreen isn't available (unsupported/blocked) — presentation still opens.
    }
    const store = useEditorStore.getState();
    store.loadPresentation(presentation);
    useEditorStore.setState({ selectedSlideId: slideId });
    store.startPresentation();
  };

  const makeCopy = async () => {
    setIsCopying(true);
    // It may have gone under review since the page opened.
    try {
      if ((await loadReviewStatus(createClient(), presentation.id)).isLocked) {
        toast.error("This presentation is under review, so it can't be copied right now.");
        setIsCopying(false);
        router.refresh();
        return;
      }
    } catch {
      // The check failed (connection): the copy below fails too and says so.
    }
    const now = Date.now();
    // Slide ids can stay: a slide's id only has to be unique inside its own presentation.
    // "Copy of …" so it's easy to tell apart from the original. `author` stays: it credits who wrote the content.
    const title = `Copy of ${presentation.title || "Untitled presentation"}`.slice(0, DETAIL_MAX_LENGTH.title);
    const copy = { ...presentation, id: createId(), title, isPublished: false, fromAdmin: false, createdAt: now, updatedAt: now };
    try {
      await savePresentationToDb(copy);
      // isCopying stays true, so the spinner and top line keep showing until the editor opens.
      router.push(`/presentation/${copy.id}/edit`);
    } catch (error) {
      toast.error(saveErrorMessage(error, "make a copy"));
      setIsCopying(false);
    }
  };

  const beginReview = async () => {
    setIsStartingReview(true);
    try {
      await startReview(presentation.id);
      toast.success("You're reviewing this presentation now. Teachers keep seeing it as it is.");
      // isStartingReview stays true, so the spinner and top line keep showing until the editor opens.
      router.push(`/presentation/${presentation.id}/edit`);
    } catch (error) {
      toast.error(error instanceof SaveRefusedError ? "Someone else just started reviewing this." : saveErrorMessage(error, "start the review"));
      setIsStartingReview(false);
      router.refresh();
    }
  };

  const toggleSaved = async () => {
    setIsSaving(true);
    const { status, pausedUntil } = await setPresentationSaved(presentation.id, !isSaved);
    setIsSaving(false);
    if (status === "done") {
      setIsSaved(!isSaved);
      toast.success(isSaved ? "Removed from Saved." : "Saved. Find it in “Saved” on your home page.");
    } else if (status === "paused") {
      pauseFeature("saved", pausedUntil!);
    } else {
      toast.error(SAVE_ERRORS[status]);
      // Just banned (e.g. automatically, for clicking too fast): load the page again once, so it says so.
      if (status === "banned") router.refresh();
    }
  };

  const details = [
    { label: "Description", value: presentation.description },
    { label: "Curriculum", value: presentation.curriculum },
    { label: "Learning competency", value: presentation.learningCompetency },
  ].filter((detail) => detail.value);
  const slideNumbers = getSlideNumbers(presentation.slides);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:py-14">
      <Link href="/" className="text-sm text-text-secondary transition-colors hover:text-text-primary">
        ← Home
      </Link>

      <header className="mt-3 mb-6 flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <h1 className="text-base font-extrabold text-text-primary">{presentation.title || "Untitled presentation"}</h1>
          <p className="mt-0.5 text-sm text-text-secondary">
            {joinParts([publishedByLine(presentation.author, publisherName), gradesLabel(presentation.grades), presentation.subject, slideCountLabel(presentation.slides.length)])}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {review.isLocked && (
            <span className="rounded-dropdown bg-highlight-soft px-2.5 py-1 text-[13px] leading-none font-semibold text-highlight-strong">
              Under review
            </span>
          )}
          {review.canStart && (
            <button
              type="button"
              onClick={beginReview}
              disabled={isStartingReview}
              className={`inline-flex items-center gap-2 ${secondaryButtonClass}`}
            >
              {isStartingReview ? <Spinner size={14} /> : <ClipboardCheckIcon size={16} />}
              Review
            </button>
          )}
          {/* Submitted: the link opens the view-only page, so it says so. */}
          {review.isMine && (
            <Link href={`/presentation/${presentation.id}/edit`} className={`inline-flex items-center gap-2 ${secondaryButtonClass}`}>
              {review.status === "submitted" ? <EyeIcon size={16} /> : <ClipboardCheckIcon size={16} />}
              {review.status === "submitted" ? "See submitted version" : "Continue review"}
              <LinkPending />
            </Link>
          )}
          {!isMine && <ReportButton presentationId={presentation.id} className={secondaryButtonClass} />}
          {!isMine && (
            <button
              type="button"
              onClick={toggleSaved}
              disabled={isSaving || isSavePaused}
              aria-pressed={isSaved}
              title={isSaved ? "Remove from Saved" : "Save to your home page"}
              className={`inline-flex items-center gap-2 ${secondaryButtonClass}`}
            >
              {isSaving ? (
                <Spinner size={14} />
              ) : (
                <BookmarkIcon size={16} className={isSaved ? "fill-accent text-accent" : ""} />
              )}
              {isSaved ? "Saved" : "Save"}
            </button>
          )}
          {isMine ? (
            // Under review, only its reviewer can change it.
            !review.isLocked && (
              <Link href={`/presentation/${presentation.id}/edit`} className={secondaryButtonClass}>
                Edit
                <LinkPending />
              </Link>
            )
          ) : (
            <button
              type="button"
              onClick={makeCopy}
              disabled={isCopying || review.isLocked}
              title={review.isLocked ? "Under review: it can be copied once QuizMatter publishes the review." : undefined}
              className={`inline-flex items-center gap-2 ${secondaryButtonClass}`}
            >
              {isCopying && <Spinner size={14} />}
              {isCopying ? "Copying…" : "Make a copy"}
            </button>
          )}
          {presentation.slides.length > 0 && (
            <button
              type="button"
              onClick={() => present()}
              className="rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
            >
              Present
            </button>
          )}
        </div>
      </header>

      {(details.length > 0 || presentation.tags.length > 0 || presentation.referenceLinks.length > 0 || reviewers.length > 0) && (
        <dl className="mb-8 grid gap-4 rounded-card border border-border-default bg-bg-surface px-5 py-4 text-sm">
          {details.map((detail) => (
            <div key={detail.label}>
              <dt className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">{detail.label}</dt>
              <dd className="mt-1 whitespace-pre-line text-text-primary">{detail.value}</dd>
            </div>
          ))}
          {presentation.tags.length > 0 && (
            <div>
              <dt className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">Tags</dt>
              <dd className="mt-1.5 flex flex-wrap gap-1.5">
                {presentation.tags.map((tag) => (
                  <span key={tag} className="rounded-dropdown bg-accent-soft px-2 py-0.5 text-[13px] font-semibold text-accent">
                    {tag}
                  </span>
                ))}
              </dd>
            </div>
          )}
          {presentation.referenceLinks.length > 0 && (
            <div>
              <dt className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">References</dt>
              {presentation.referenceLinks.map((reference) => (
                <dd key={reference} className="mt-1 break-words text-text-primary">
                  {isWebLink(reference) ? (
                    <a href={reference} target="_blank" rel="noopener noreferrer" className="underline">
                      {reference}
                    </a>
                  ) : (
                    reference
                  )}
                </dd>
              ))}
            </div>
          )}
          {reviewers.length > 0 && (
            <div>
              <dt className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">Reviewed by</dt>
              {reviewers.map((reviewer) => (
                <dd key={`${reviewer.email}-${reviewer.reviewedOn}`} className="mt-2 text-text-primary">
                  <span className="font-semibold">{reviewer.name}</span>
                  <span className="text-text-secondary">
                    {" "}
                    · {reviewer.email} · {formatDay(reviewer.reviewedOn)}
                  </span>
                  <span className="mt-0.5 block whitespace-pre-line text-text-secondary">{reviewer.background}</span>
                </dd>
              ))}
            </div>
          )}
        </dl>
      )}

      {/* Clicking a slide presents from that slide. */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {presentation.slides.map((slide, index) => (
          <button
            key={slide.id}
            type="button"
            onClick={() => present(slide.id)}
            title={`Present from slide ${index + 1}`}
            className="group text-left"
          >
            <div
              className="overflow-hidden rounded-dropdown border border-border-default bg-bg-surface transition-colors group-hover:border-text-secondary"
              style={{ aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}
            >
              <FluidSlidePreview slide={slide} questionNumber={slideNumbers.get(slide.id)} />
            </div>
            <span className="mt-1.5 block text-[13px] text-text-secondary">{index + 1}</span>
          </button>
        ))}
      </div>

      {(isCopying || isStartingReview) && <TopLoadingBar />}
      {isPresenting && <PresentationView />}
    </main>
  );
}

const secondaryButtonClass =
  "rounded-button border border-border-default bg-bg-surface px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:border-text-secondary disabled:opacity-60";
