"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "@/components/icons/CloseIcon";
import { ANSWER_CONTAINER_ID } from "@/lib/constants";
import { FluidCanvas } from "@/components/presentation/FluidSlidePreview";
import { StaticElementView } from "./StaticElementView";
import type { Slide } from "@/lib/schema";

interface AnswerModalProps {
  slide: Slide;
  onClose: () => void;
}

/** Centered modal with a short-answer or blank slide's correct answer, shown when presenting: its text or its answer canvas. */
export function AnswerModal({ slide, onClose }: AnswerModalProps) {
  // Caught on the way down (capture) and stopped here, so the presentation's own shortcuts
  // (Escape leaves it, arrows change slides) don't fire behind the modal. Escape closes the modal.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  const isCanvas = slide.answerType === "canvas";
  const answer = slide.correctAnswer ?? "";
  // A blank slide's answer is content shown during the discussion, not a correct answer.
  const isReveal = slide.type === "lesson";

  // Portal into <body>, so no parent's `transform` shifts this `position: fixed` box.
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
      onClick={(e) => {
        // React sends portal clicks up to the presentation screen, which would change the slide.
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`flex max-h-[calc(100vh-32px)] max-w-[calc(100vw-32px)] flex-col gap-4 rounded-card bg-bg-surface px-6 py-5 ${
          // The canvas is as wide as fits while its 16:9 box (plus the header) still fits the screen height.
          isCanvas ? "w-[min(1100px,calc((100vh-120px)*16/9))]" : "w-[640px]"
        }`}
      >
        <div className="flex items-center justify-between">
          <span className={`text-xs font-semibold uppercase tracking-[0.05em] ${isReveal ? "text-accent-navy" : "text-accent-green"}`}>
            {isReveal ? "Reveal" : "Correct answer"}
          </span>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="flex h-8 w-8 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        {isCanvas ? (
          <div className="relative aspect-video w-full overflow-hidden rounded-button">
            <FluidCanvas>
              <div className="relative h-full w-full">
                <StaticElementView elements={slide.elements.filter((el) => el.containerId === ANSWER_CONTAINER_ID)} />
              </div>
            </FluidCanvas>
          </div>
        ) : answer ? (
          // pre-wrap keeps the line breaks the teacher typed.
          <p className="overflow-y-auto whitespace-pre-wrap break-words text-[32px] font-semibold leading-snug text-text-primary">
            {answer}
          </p>
        ) : (
          <p className="text-base text-text-secondary">{isReveal ? "Nothing was added to reveal." : "No answer was added for this slide."}</p>
        )}
      </div>
    </div>,
    document.body
  );
}
