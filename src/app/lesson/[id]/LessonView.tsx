"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "@/lib/constants";
import { createId } from "@/lib/id";
import { joinParts, slideCountLabel } from "@/lib/format";
import { saveQuizToDb } from "@/lib/quizzes";
import { DETAIL_MAX_LENGTH, isWebLink, type Quiz } from "@/lib/schema";
import { useEditorStore } from "@/lib/store";
import { LinkPending } from "@/components/LinkPending";
import { Spinner } from "@/components/Spinner";
import { TopLoadingBar } from "@/components/TopLoadingBar";
import { FluidSlidePreview } from "@/components/presentation/FluidSlidePreview";

// Only downloaded when the teacher clicks Present.
const PresentationView = dynamic(() =>
  import("@/components/presentation/PresentationView").then((mod) => mod.PresentationView)
);

/**
 * A lesson's details and all its slides, view only. Present shows it fullscreen (the same view as the
 * editor's Present button); "Make a copy" saves a private copy for me and opens it in the editor.
 */
export function LessonView({ quiz, isMine }: { quiz: Quiz; isMine: boolean }) {
  const router = useRouter();
  const isPresenting = useEditorStore((s) => s.isPresenting);
  const [isCopying, setIsCopying] = useState(false);

  // The presentation view reads the editor's store, so the lesson goes in there first.
  const present = async (slideId = quiz.slides[0]?.id) => {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      // Fullscreen isn't available (unsupported/blocked) — presentation still opens.
    }
    const store = useEditorStore.getState();
    store.loadQuiz(quiz);
    useEditorStore.setState({ selectedSlideId: slideId });
    store.startPresentation();
  };

  const makeCopy = async () => {
    setIsCopying(true);
    const now = Date.now();
    // Slide ids can stay: a slide's id only has to be unique inside its own lesson.
    // "Copy of …" so it's easy to tell apart from the original. `author` stays: it credits who wrote the content.
    const title = `Copy of ${quiz.title || "Untitled lesson"}`.slice(0, DETAIL_MAX_LENGTH.title);
    const copy = { ...quiz, id: createId(), title, isPublished: false, createdAt: now, updatedAt: now };
    try {
      await saveQuizToDb(copy);
      // isCopying stays true, so the spinner and top line keep showing until the editor opens.
      router.push(`/quiz/${copy.id}`);
    } catch {
      alert("Couldn't make a copy. Please try again.");
      setIsCopying(false);
    }
  };

  const details = [
    { label: "Description", value: quiz.description },
    { label: "Curriculum", value: quiz.curriculum },
    { label: "Learning competency", value: quiz.learningCompetency },
  ].filter((detail) => detail.value);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:py-14">
      <Link href="/" className="text-sm text-text-secondary transition-colors hover:text-text-primary">
        ← Home
      </Link>

      <header className="mt-3 mb-6 flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-text-primary">{quiz.title || "Untitled lesson"}</h1>
          <p className="mt-0.5 text-sm text-text-secondary">
            {joinParts([quiz.author && `By ${quiz.author}`, quiz.grade, quiz.subject, slideCountLabel(quiz.slides.length)])}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {isMine ? (
            <Link href={`/quiz/${quiz.id}`} className={secondaryButtonClass}>
              Edit
              <LinkPending />
            </Link>
          ) : (
            <button
              type="button"
              onClick={makeCopy}
              disabled={isCopying}
              className={`inline-flex items-center gap-2 ${secondaryButtonClass}`}
            >
              {isCopying && <Spinner size={14} />}
              {isCopying ? "Copying…" : "Make a copy"}
            </button>
          )}
          {quiz.slides.length > 0 && (
            <button
              type="button"
              onClick={() => present()}
              className="rounded-button bg-accent-navy px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              Present
            </button>
          )}
        </div>
      </header>

      {(details.length > 0 || quiz.referenceLinks.length > 0) && (
        <dl className="mb-8 grid gap-4 rounded-card border border-border-default bg-bg-surface px-5 py-4 text-sm">
          {details.map((detail) => (
            <div key={detail.label}>
              <dt className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">{detail.label}</dt>
              <dd className="mt-1 whitespace-pre-line text-text-primary">{detail.value}</dd>
            </div>
          ))}
          {quiz.referenceLinks.length > 0 && (
            <div>
              <dt className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">References</dt>
              {quiz.referenceLinks.map((reference) => (
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

      {/* Clicking a slide presents from that slide. */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {quiz.slides.map((slide, index) => (
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
              <FluidSlidePreview slide={slide} />
            </div>
            <span className="mt-1.5 block text-[13px] text-text-secondary">{index + 1}</span>
          </button>
        ))}
      </div>

      {isCopying && <TopLoadingBar />}
      {isPresenting && <PresentationView />}
    </main>
  );
}

const secondaryButtonClass =
  "rounded-button border border-border-default bg-bg-surface px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:border-text-secondary disabled:opacity-60";
