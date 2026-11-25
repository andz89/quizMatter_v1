"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BookmarkIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, ClipboardCheckIcon, EyeIcon, Share2Icon } from "lucide-react";
import { CANVAS_WIDTH, CANVAS_HEIGHT, getSlideNumbers, shownSlides } from "@/lib/constants";
import { creditLines, detailsLabel, formatDay, joinParts, slideCountLabel } from "@/lib/format";
import { SaveRefusedError, saveErrorMessage } from "@/lib/presentations";
import { startReview } from "@/lib/reviews";
import { profileHref } from "@/lib/profiles";
import { gradesTitle, isWebLink, type Slide } from "@/lib/schema";
import { SUBMISSION_LABELS } from "@/lib/submissions";
import { pauseFeature, useIsPaused } from "@/lib/clickLimits";
import { useEditorStore } from "@/lib/store";
import { LinkPending } from "@/components/LinkPending";
import { LinkifiedText } from "@/components/LinkifiedText";
import { Spinner } from "@/components/Spinner";
import { TopLoadingBar } from "@/components/TopLoadingBar";
import { FluidSlidePreview } from "@/components/presentation/FluidSlidePreview";
import { PresentDraftButton } from "@/components/presentation/PresentDraftButton";
import { SAVE_ERRORS } from "../../SaveCardButton";
import {
  announcePresentationChange,
  useIsPresentationModalOpen,
  usePresentationChanges,
  usePresentationModal,
} from "../../openPresentation";
import { copyPageHref, useCopyResults } from "./copy/copyTicket";
import { LessonWeek } from "./LessonWeek";
import { LikeButton } from "./LikeButton";
import { MoreLikeThis } from "./MoreLikeThis";
import { ReportButton } from "./ReportButton";
import { setPresentationSaved } from "./actions";
import type { PresentationViewData } from "./loadView";

/**
 * A presentation to look at, laid out like Canva's template preview: the big slide and a strip of every slide on the
 * left; the title, details and buttons on the right; "More like this" below. Drawn on its page (`/presentation/<id>`)
 * and in the modal a card opens (`inModal`, src/app/PresentationModal.tsx).
 * "Make a copy" opens a new tab that saves a private copy for me and shows it in the editor (MakeCopyButton). Save bookmarks someone else's presentation to
 * my "Saved" row, the heart likes it (teachers and editors; everyone sees the count), Share copies its link, Report
 * sends it to the admins. Editors can review a shared QuizMatter presentation ("Review"; its own editor gets "Update
 * this lesson", see the author_updates migration); while it's under review nobody can copy it and its owner can't
 * edit it. While my presentation waits for QuizMatter (see the quizmatter_submissions migration), it has no Edit.
 * The slides skip hidden ones, like presenting, unless `showHidden` (the owner, and admins checking reports), who see
 * them faded with the eye-off mark. "Make a copy" still copies every slide. While the modal is open over the page,
 * the page's copy leaves the arrow keys and presenting to the modal.
 */
export function PresentationDetails({ view, inModal = false }: { view: PresentationViewData; inModal?: boolean }) {
  const { presentation, isMine, review, reviewers, waitingSince } = view;
  const router = useRouter();
  const [isSaved, setIsSaved] = useState(view.isSaved);
  const [isSaving, setIsSaving] = useState(false);
  const [isStartingReview, setIsStartingReview] = useState(false);
  const [slideIndex, setSlideIndex] = useState(0);
  const isPresenting = useEditorStore((s) => s.isPresenting);
  const modal = usePresentationModal();
  // Saved or removed elsewhere (the same presentation in the modal over this page, a card).
  usePresentationChanges((change) => {
    if (change.id === presentation.id && change.isSaved !== undefined) setIsSaved(change.isSaved);
  });
  // The page under an open modal: the modal is the one in use.
  const isModalOpen = useIsPresentationModalOpen();
  const isBehindModal = !inModal && isModalOpen;
  // The slides the strip and Prev/Next go through (the details line still counts them all).
  const slides = view.showHidden ? presentation.slides : shownSlides(presentation.slides);
  const slideCount = slides.length;
  const slideNumbers = getSlideNumbers(presentation.slides);
  const slide = slides[slideIndex];
  // Saving is paused for clicking too fast (the notice at the bottom says until when).
  const isSavePaused = useIsPaused("saved");
  // A copy is a new presentation: too many in a day pauses it until midnight (the "create" click limit).
  const isCopyPaused = useIsPaused("create");

  // ← / → change the slide, unless the teacher is typing or presenting, or the modal is open over this page.
  useEffect(() => {
    if (isPresenting || isBehindModal) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.key === "ArrowLeft") setSlideIndex((index) => Math.max(index - 1, 0));
      if (event.key === "ArrowRight") setSlideIndex((index) => Math.min(index + 1, slideCount - 1));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [slideCount, isPresenting, isBehindModal]);

  // Another page: from the modal, through it (so one Back returns to the list behind).
  const goTo = (href: string) => (inModal && modal ? modal.leave(href) : router.push(href));
  // It changed since it opened (private, under review): show it as it is now.
  const reload = () => (inModal && modal ? modal.open(presentation.id, { fresh: true }) : router.refresh());

  // Make a copy's tab couldn't copy it: grey out the button here too (the daily pause), or show it as it is now.
  useCopyResults(presentation.id, (result) => {
    if (result.kind === "paused" && result.pausedUntil) pauseFeature("create", result.pausedUntil);
    else if (result.kind !== "paused") reload();
  });

  const beginReview = async () => {
    setIsStartingReview(true);
    try {
      await startReview(presentation.id);
      toast.success(
        review.isAuthor
          ? "You're updating this lesson now. Teachers keep seeing it as it is until QuizMatter publishes your update."
          : "You're reviewing this presentation now. Teachers keep seeing it as it is.",
      );
      // isStartingReview stays true, so the spinner and top line keep showing until the editor opens.
      goTo(`/presentation/${presentation.id}/edit`);
    } catch (error) {
      const startedByOther = error instanceof SaveRefusedError;
      toast.error(startedByOther ? "Someone else just started reviewing this." : saveErrorMessage(error, "start the review"));
      setIsStartingReview(false);
      // Only when it really changed (under review now); a lost connection would just fail again.
      if (startedByOther) reload();
    }
  };

  const toggleSaved = async () => {
    setIsSaving(true);
    let result;
    try {
      result = await setPresentationSaved(presentation.id, !isSaved);
    } catch {
      toast.error("Couldn't change it. Please try again.");
      return;
    } finally {
      setIsSaving(false);
    }
    const { status, pausedUntil } = result;
    if (status === "done") {
      setIsSaved(!isSaved);
      announcePresentationChange({ id: presentation.id, isSaved: !isSaved });
      toast.success(isSaved ? "Removed from Saved." : "Saved. Find it in “Saved” on your home page.");
    } else if (status === "paused") {
      pauseFeature("saved", pausedUntil!);
    } else {
      toast.error(SAVE_ERRORS[status]);
      // Just banned (e.g. automatically, for clicking too fast): load the page again once, so it says so.
      if (status === "banned") router.refresh();
    }
  };

  // Phones (a touch screen) get their own share menu; computers copy the link.
  const share = async () => {
    const url = `${window.location.origin}/presentation/${presentation.id}`;
    if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
      // Closing the share menu without picking counts as an error: nothing to say then.
      await navigator.share({ title: presentation.title || "Untitled presentation", url }).catch(() => {});
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied.");
    } catch {
      toast.error("Couldn't copy the link. Please try again.");
    }
  };

  const details = [
    { label: "Description", value: presentation.description },
    { label: "Curriculum", value: presentation.curriculum },
    { label: "Learning competency", value: presentation.learningCompetency },
  ].filter((detail) => detail.value);
  const Title = inModal ? "h2" : "h1";

  return (
    <div className="flex flex-col gap-10">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-8">
        {/* Left: the big slide, its controls, and every slide in a sideways strip. */}
        <section className="min-w-0">
          {slide ? (
            <div
              className="overflow-hidden rounded-card border border-border-default bg-bg-surface"
              style={{ aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}
            >
              <FluidSlidePreview slide={slide} questionNumber={slideNumbers.get(slide.id)} />
            </div>
          ) : (
            <p className="rounded-card border border-border-default bg-bg-page px-5 py-16 text-center text-sm text-text-secondary">
              This presentation has no slides yet.
            </p>
          )}
          {slide && (
            <>
              <div className="mt-3 flex items-center gap-3">
                <PresentDraftButton
                  presentation={presentation}
                  // Under the modal, the modal's own Present shows the slides (one view, so a key moves one slide).
                  showView={!isBehindModal}
                  className="rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
                />
                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSlideIndex(slideIndex - 1)}
                    disabled={slideIndex === 0}
                    title="Previous slide"
                    aria-label="Previous slide"
                    className={iconButtonClass}
                  >
                    <ChevronLeftIcon size={16} />
                  </button>
                  <span className="min-w-14 text-center text-sm text-text-secondary">
                    {slideIndex + 1} / {slideCount}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSlideIndex(slideIndex + 1)}
                    disabled={slideIndex === slideCount - 1}
                    title="Next slide"
                    aria-label="Next slide"
                    className={iconButtonClass}
                  >
                    <ChevronRightIcon size={16} />
                  </button>
                </div>
              </div>
              {slideCount > 1 && (
                <SlideStrip slides={slides} current={slideIndex} slideNumbers={slideNumbers} onPick={setSlideIndex} />
              )}
            </>
          )}
        </section>

        {/* Right: what it is, who made it, and what I can do with it. */}
        <section className="flex min-w-0 flex-col gap-4">
          <Labels view={view} />
          <div>
            <Title className="font-heading text-2xl leading-tight font-extrabold tracking-[-0.02em] text-text-primary">
              {presentation.title || "Untitled presentation"}
            </Title>
            <p title={gradesTitle(presentation.grades)} className="mt-1 text-sm text-text-secondary">
              {joinParts([detailsLabel(presentation), slideCountLabel(presentation.slides.length)])}
            </p>
          </div>
          {presentation.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {presentation.tags.map((tag) => (
                <span key={tag} className="rounded-dropdown border border-border-default px-2.5 py-1 text-[13px] text-text-primary">
                  {tag}
                </span>
              ))}
            </div>
          )}
          {view.maker && (
            <Link href={profileHref(view.maker.slug)} className="group flex items-center gap-3 self-start text-sm text-text-secondary">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-white">
                {view.maker.name.trim().charAt(0).toUpperCase()}
              </span>
              <span>
                View more by <span className="font-semibold text-text-primary group-hover:text-accent">{view.maker.name}</span>
              </span>
              <LinkPending />
            </Link>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {isMine ? (
              // Under review or waiting for QuizMatter, only its reviewer can change it.
              !review.isLocked &&
              waitingSince === null && (
                <Link href={`/presentation/${presentation.id}/edit`} className={`flex-1 ${mainButtonClass}`}>
                  Edit
                  <LinkPending />
                </Link>
              )
            ) : (
              <MakeCopyButton presentationId={presentation.id} isLocked={review.isLocked} isPaused={isCopyPaused} />
            )}
            {!isMine && (
              <button
                type="button"
                onClick={toggleSaved}
                disabled={isSaving || isSavePaused}
                aria-pressed={isSaved}
                aria-label={isSaved ? "Remove from Saved" : "Save to your home page"}
                title={isSaved ? "Remove from Saved" : "Save to your home page"}
                className={iconButtonClass}
              >
                {isSaving ? <Spinner size={14} /> : <BookmarkIcon size={16} className={isSaved ? "fill-accent text-accent" : ""} />}
              </button>
            )}
            {presentation.isPublished && (
              <LikeButton
                presentationId={presentation.id}
                likeCount={view.likeCount}
                isLiked={view.isLiked}
                canLike={view.canLike}
                className={smallButtonClass}
              />
            )}
            {/* Only a published one: nobody else can open a private one's link. */}
            {presentation.isPublished && (
              <button type="button" onClick={share} title="Share" aria-label="Share" className={iconButtonClass}>
                <Share2Icon size={16} />
              </button>
            )}
            {!isMine && <ReportButton presentationId={presentation.id} iconOnly className={iconButtonClass} />}
          </div>

          {review.canStart && (
            <button type="button" onClick={beginReview} disabled={isStartingReview} className={secondaryButtonClass}>
              {isStartingReview ? <Spinner size={14} /> : <ClipboardCheckIcon size={16} />}
              {review.isAuthor ? "Update this lesson" : "Review"}
            </button>
          )}
          {/* Submitted: the link opens the view-only page, so it says so. */}
          {review.isMine && (
            <Link href={`/presentation/${presentation.id}/edit`} className={secondaryButtonClass}>
              {review.status === "submitted" ? <EyeIcon size={16} /> : <ClipboardCheckIcon size={16} />}
              {review.status === "submitted" ? "See submitted version" : review.isAuthorUpdate ? "Continue update" : "Continue review"}
              <LinkPending />
            </Link>
          )}
          {waitingSince !== null && (
            <p className="text-sm text-text-secondary">
              You sent this to QuizMatter {waitingSince.toLowerCase()}. You can change it again once an admin decides.
            </p>
          )}

          {/* Author and Publisher rows; each reviewer gets their own row, with their email and date. The publisher's
              and reviewers' names open their profile pages ("QuizMatter" and the typed Author don't). */}
          <div className="flex flex-col gap-0.5 text-sm text-text-secondary">
            {creditLines({ author: presentation.author, fromAdmin: presentation.fromAdmin, publisherName: undefined }).map((line) => (
              <p key={line}>{line}</p>
            ))}
            {!presentation.fromAdmin && view.publisherName && (
              <p>
                Publisher: <ProfileName id={view.ownerId} name={view.publisherName} slugs={view.profileSlugs} />
              </p>
            )}
            {reviewers.map((reviewer) => (
              <p key={`${reviewer.email}-${reviewer.reviewedOn}`}>
                Reviewer: <ProfileName id={reviewer.reviewerId} name={reviewer.name} slugs={view.profileSlugs} /> ·{" "}
                {reviewer.email} · {formatDay(reviewer.reviewedOn)}
              </p>
            ))}
          </div>

          {(details.length > 0 || presentation.referenceLinks.length > 0) && (
            <dl className="grid gap-4 border-t border-border-default pt-4 text-sm">
              {details.map((detail) => (
                <div key={detail.label}>
                  <dt className={labelClass}>{detail.label}</dt>
                  <dd className="mt-1 whitespace-pre-line text-text-primary">
                    <LinkifiedText text={detail.value} />
                  </dd>
                </div>
              ))}
              {presentation.referenceLinks.length > 0 && (
                <div>
                  <dt className={labelClass}>References</dt>
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

          {view.lessonWeek && <LessonWeek week={view.lessonWeek} currentId={presentation.id} />}
        </section>
      </div>

      {view.hasMoreLikeThis && <MoreLikeThis presentationId={presentation.id} />}

      {isStartingReview && <TopLoadingBar />}
    </div>
  );
}

/**
 * "Make a copy": opens a new tab (`/presentation/<id>/copy`, MakeCopy) that makes my private copy and then shows it
 * in the editor, so this page or modal stays as it is. The click leaves a one-time ticket for the copy's new id
 * (copyTicket.ts) and greys the button out for a few seconds, so a double-click opens one tab, not two copies.
 * Greyed out while it's under review or new presentations are paused for today (the "create" click limit).
 */
function MakeCopyButton({ presentationId, isLocked, isPaused }: { presentationId: string; isLocked: boolean; isPaused: boolean }) {
  const [isOpening, setIsOpening] = useState(false);
  const open = () => {
    setIsOpening(true);
    setTimeout(() => setIsOpening(false), COPY_WAIT_MS);
    // At once, inside the click: a tab opened later (after a wait) is blocked by the browser.
    window.open(copyPageHref(presentationId), "_blank", "noopener");
  };
  return (
    <button
      type="button"
      onClick={open}
      disabled={isLocked || isPaused || isOpening}
      title={
        isLocked
          ? "Under review: it can be copied once QuizMatter publishes the review."
          : isPaused
            ? "You've made the most new presentations for today. It works again at midnight."
            : "Opens your copy in a new tab"
      }
      className={`flex-1 ${mainButtonClass}`}
    >
      Make a copy
    </button>
  );
}

// After a click, Make a copy waits this long before it can open another tab.
const COPY_WAIT_MS = 4000;

/** QuizMatter, Reviewed, Under review, Sent to QuizMatter: small pills above the title. */
function Labels({ view }: { view: PresentationViewData }) {
  const pills = [
    view.presentation.fromAdmin && { text: "QuizMatter", className: "bg-accent-soft text-accent" },
    view.reviewers.length > 0 && { text: "Reviewed", className: "bg-success-soft text-success-strong", icon: true },
    view.review.isLocked && { text: "Under review", className: "bg-highlight-soft text-highlight-strong" },
    view.waitingSince !== null && { text: SUBMISSION_LABELS.submitted.label, className: SUBMISSION_LABELS.submitted.className },
  ].filter((pill) => pill !== false);
  if (pills.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {pills.map((pill) => (
        <span
          key={pill.text}
          className={`inline-flex items-center gap-1 rounded-dropdown px-2.5 py-1 text-[13px] leading-none font-semibold ${pill.className}`}
        >
          {"icon" in pill && <CheckIcon size={12} />}
          {pill.text}
        </span>
      ))}
    </div>
  );
}

/**
 * Every slide as a small picture in a sideways row; the shown one has a violet border. A presentation can have 100
 * slides, so each picture is drawn only once it scrolls near the row's view.
 */
function SlideStrip({
  slides,
  current,
  slideNumbers,
  onPick,
}: {
  slides: Slide[];
  current: number;
  slideNumbers: Map<string, number>;
  onPick: (index: number) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);

  // Prev/Next (or the arrow keys) keep the shown slide in view.
  useEffect(() => {
    const row = rowRef.current;
    const item = row?.children[current] as HTMLElement | undefined;
    if (!row || !item) return;
    // The row is `relative`, so offsetLeft already counts from the row's own left edge.
    const left = item.offsetLeft;
    if (left < row.scrollLeft || left + item.offsetWidth > row.scrollLeft + row.clientWidth) {
      row.scrollTo({ left: left - (row.clientWidth - item.offsetWidth) / 2, behavior: "smooth" });
    }
  }, [current]);

  return (
    <div ref={rowRef} className="relative mt-3 flex gap-2 overflow-x-auto pb-2 [scrollbar-width:thin]">
      {slides.map((slide, index) => (
        <button
          key={slide.id}
          type="button"
          onClick={() => onPick(index)}
          aria-label={`Slide ${index + 1}`}
          aria-current={index === current}
          className={`w-28 shrink-0 overflow-hidden rounded-dropdown border-2 bg-bg-page transition-colors sm:w-32 ${
            index === current ? "border-accent" : "border-border-default hover:border-text-secondary"
          }`}
          style={{ aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}
        >
          <LazySlide slide={slide} questionNumber={slideNumbers.get(slide.id)} />
        </button>
      ))}
    </div>
  );
}

/** A slide picture drawn only once it comes near the screen (then kept). */
function LazySlide({ slide, questionNumber }: { slide: Slide; questionNumber?: number }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [isNear, setIsNear] = useState(false);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || isNear) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setIsNear(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(box);
    return () => observer.disconnect();
  }, [isNear]);

  return (
    // Clicks go to the button around it, never into the slide.
    <div ref={boxRef} className="pointer-events-none h-full w-full">
      {isNear && <FluidSlidePreview slide={slide} questionNumber={questionNumber} />}
    </div>
  );
}

const labelClass = "text-[11px] font-bold tracking-[0.05em] text-text-header uppercase";

const mainButtonClass =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60";

const smallButtonClass =
  "inline-flex h-10 items-center justify-center rounded-button border border-border-default bg-bg-surface px-3 text-sm font-semibold text-text-primary transition-colors hover:border-text-secondary disabled:opacity-60";

const iconButtonClass = `${smallButtonClass} w-10 px-0`;

const secondaryButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-button border border-border-default bg-bg-surface px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:border-text-secondary disabled:opacity-60";

/** A publisher's or reviewer's name: a link to their profile, or plain text when it has none (a hidden admin's, or
 * a deleted account's: no id). */
function ProfileName({ id, name, slugs }: { id: string | null; name: string; slugs: Record<string, string> }) {
  const slug = id ? slugs[id] : undefined;
  if (!slug) return <span className="font-semibold text-text-primary">{name}</span>;
  return (
    <Link href={profileHref(slug)} className="font-semibold text-accent hover:underline">
      {name}
      <LinkPending />
    </Link>
  );
}
