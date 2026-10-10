"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BookmarkIcon, ChevronLeftIcon, ChevronRightIcon, ClipboardCheckIcon, EyeIcon } from "lucide-react";
import { CANVAS_WIDTH, CANVAS_HEIGHT, getSlideNumbers } from "@/lib/constants";
import { createId } from "@/lib/id";
import { creditLines, formatDay, joinParts, slideCountLabel } from "@/lib/format";
import { SaveRefusedError, saveErrorMessage, savePresentationToDb } from "@/lib/presentations";
import { startReview } from "@/lib/reviews";
import { loadReviewStatus, type Reviewer, type ReviewStatus } from "@/lib/reviewStatus";
import { createClient } from "@/lib/supabase/client";
import { profileHref } from "@/lib/profiles";
import { DETAIL_MAX_LENGTH, gradesLabel, gradesTitle, isWebLink, type Presentation } from "@/lib/schema";
import { pauseFeature, pausedUntilFromError, useIsPaused } from "@/lib/clickLimits";
import { LinkPending } from "@/components/LinkPending";
import { Spinner } from "@/components/Spinner";
import { TopLoadingBar } from "@/components/TopLoadingBar";
import { FluidSlidePreview } from "@/components/presentation/FluidSlidePreview";
import { PresentDraftButton } from "@/components/presentation/PresentDraftButton";
import { ReportButton } from "./ReportButton";
import { setPresentationSaved } from "./actions";
import { SAVE_ERRORS } from "../../SaveCardButton";

/**
 * A presentation's slides (one at a time, with Prev/Next) and its details, view only. "Make a copy" saves a private
 * copy for me and opens it in the editor. "Save" bookmarks someone else's presentation to my home page's "Saved" row
 * (like YouTube's), and "Report" sends it to the admins.
 * Editors can review a shared QuizMatter presentation ("Review"); while it's under review nobody can copy it, and
 * its owner can't edit it. Everyone who reviewed it is listed under the "Published by" line.
 */
export function PresentationPreview({
  presentation,
  isMine,
  ownerId,
  profileSlugs,
  publisherName,
  isSaved: savedAtStart,
  review,
  reviewers,
}: {
  presentation: Presentation;
  isMine: boolean;
  ownerId: string;
  profileSlugs: Record<string, string>;
  publisherName: string;
  isSaved: boolean;
  review: ReviewStatus;
  reviewers: Reviewer[];
}) {
  const router = useRouter();
  const [isCopying, setIsCopying] = useState(false);
  const [isSaved, setIsSaved] = useState(savedAtStart);
  const [isSaving, setIsSaving] = useState(false);
  const [isStartingReview, setIsStartingReview] = useState(false);
  const [slideIndex, setSlideIndex] = useState(0);
  const slideCount = presentation.slides.length;
  // Saving is paused for clicking too fast (the notice at the bottom says until when).
  const isSavePaused = useIsPaused("saved");
  // A copy is a new presentation: too many in a day pauses it until midnight (the "create" click limit).
  const isCopyPaused = useIsPaused("create");

  // ← / → change the slide, unless the teacher is typing.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.key === "ArrowLeft") setSlideIndex((index) => Math.max(index - 1, 0));
      if (event.key === "ArrowRight") setSlideIndex((index) => Math.min(index + 1, slideCount - 1));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [slideCount]);

  const makeCopy = async () => {
    setIsCopying(true);
    // It may have gone private (or hidden), or under review, since the page opened.
    try {
      const supabase = createClient();
      // The database hides someone else's private presentation, so finding nothing means it's private now.
      const { data: stillVisible, error } = await supabase.from("presentations").select("id").eq("id", presentation.id).maybeSingle();
      if (!error && !stillVisible) {
        toast.error("This presentation is private now, so it can't be copied.");
        setIsCopying(false);
        router.refresh();
        return;
      }
      if ((await loadReviewStatus(supabase, presentation.id)).isLocked) {
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
      // Paused: the button greys out and the notice at the bottom says until when.
      const pausedUntil = pausedUntilFromError(error as { code?: string; details?: string });
      if (pausedUntil) pauseFeature("create", pausedUntil);
      else toast.error(saveErrorMessage(error, "make a copy"));
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
  const slide = presentation.slides[slideIndex];

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:py-14">
      <section className="mx-auto w-[80%]">
        {slide && (
          <div
            className="overflow-hidden rounded-card border border-border-default bg-bg-surface"
            style={{ aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}
          >
            <FluidSlidePreview slide={slide} questionNumber={slideNumbers.get(slide.id)} />
          </div>
        )}
        {/* One row: the buttons on the left, Prev/Next on the right. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {slide && (
              <PresentDraftButton
                presentation={presentation}
                className="rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
              />
            )}
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
                disabled={isCopying || review.isLocked || isCopyPaused}
                title={
                  review.isLocked
                    ? "Under review: it can be copied once QuizMatter publishes the review."
                    : isCopyPaused
                      ? "You've made the most new presentations for today. It works again at midnight."
                      : undefined
                }
                className={`inline-flex items-center gap-2 ${secondaryButtonClass}`}
              >
                {isCopying && <Spinner size={14} />}
                {isCopying ? "Copying…" : "Make a copy"}
              </button>
            )}
          </div>
          {slide && (
            <div className="ml-auto flex items-center gap-3">
              <button
                type="button"
                onClick={() => setSlideIndex(slideIndex - 1)}
                disabled={slideIndex === 0}
                title="Previous slide"
                className={`inline-flex items-center gap-1 ${secondaryButtonClass}`}
              >
                <ChevronLeftIcon size={16} />
                Prev
              </button>
              <span className="min-w-14 text-center text-sm text-text-secondary">
                {slideIndex + 1} / {slideCount}
              </span>
              <button
                type="button"
                onClick={() => setSlideIndex(slideIndex + 1)}
                disabled={slideIndex === slideCount - 1}
                title="Next slide"
                className={`inline-flex items-center gap-1 ${secondaryButtonClass}`}
              >
                Next
                <ChevronRightIcon size={16} />
              </button>
            </div>
          )}
        </div>

        <header className="mt-6 mb-6">
          <h1 className="text-base font-extrabold text-text-primary">{presentation.title || "Untitled presentation"}</h1>
          <p title={gradesTitle(presentation.grades)} className="mt-0.5 text-sm text-text-secondary">
            {joinParts([gradesLabel(presentation.grades), presentation.subject, slideCountLabel(slideCount)])}
          </p>
          {/* Author and Publisher rows; each reviewer gets their own row below, with their email and date. The
              publisher's and reviewers' names open their profile pages ("QuizMatter" and the typed Author don't). */}
          <div className="mt-2 flex flex-col gap-0.5 text-sm text-text-secondary">
            {creditLines({ author: presentation.author, fromAdmin: presentation.fromAdmin, publisherName: undefined }).map(
              (line) => (
                <p key={line}>{line}</p>
              ),
            )}
            {!presentation.fromAdmin && publisherName && (
              <p>Publisher: <ProfileName id={ownerId} name={publisherName} slugs={profileSlugs} /></p>
            )}
            {reviewers.map((reviewer) => (
              <p key={`${reviewer.email}-${reviewer.reviewedOn}`}>
                Reviewer: <ProfileName id={reviewer.reviewerId} name={reviewer.name} slugs={profileSlugs} /> ·{" "}
                {reviewer.email} · {formatDay(reviewer.reviewedOn)}
              </p>
            ))}
          </div>
        </header>

        {(details.length > 0 || presentation.tags.length > 0 || presentation.referenceLinks.length > 0) && (
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
          </dl>
        )}
      </section>

      {(isCopying || isStartingReview) && <TopLoadingBar />}
    </main>
  );
}

const secondaryButtonClass =
  "rounded-button border border-border-default bg-bg-surface px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:border-text-secondary disabled:opacity-60";

/** A publisher's or reviewer's name: a link to their profile, or plain text when it has none (a hidden admin's). */
function ProfileName({ id, name, slugs }: { id: string; name: string; slugs: Record<string, string> }) {
  const slug = slugs[id];
  if (!slug) return <span className="font-semibold text-text-primary">{name}</span>;
  return (
    <Link href={profileHref(slug)} className="font-semibold text-accent hover:underline">
      {name}
      <LinkPending />
    </Link>
  );
}
