"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useEditorStore } from "@/lib/store";
import { CANVAS_WIDTH, CANVAS_HEIGHT, getSlideNumbers } from "@/lib/constants";
import { SlideStaticView } from "./SlideStaticView";
import { AnswerModal } from "@/components/editor/AnswerModal";

// Clicks in the left 25% of the screen go to the previous slide.
const PREV_ZONE = 0.25;
// Empty space kept above and below the slide, so the top buttons and the page counter sit fully on the dark background.
const EDGE_SPACE = 64;

export function PresentationView() {
  const quiz = useEditorStore((s) => s.quiz);
  const presentationIndex = useEditorStore((s) => s.presentationIndex);
  const exitPresentation = useEditorStore((s) => s.exitPresentation);
  const nextSlide = useEditorStore((s) => s.nextPresentationSlide);
  const prevSlide = useEditorStore((s) => s.prevPresentationSlide);

  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  // The slide whose answer is showing. Moving to another slide hides it again.
  const [revealedSlideId, setRevealedSlideId] = useState<string | null>(null);

  const slide = quiz.slides[presentationIndex];
  const isAnswerShown = revealedSlideId === slide?.id;
  const isChoice = (slide?.type ?? "choice") === "choice";
  const canReveal = slide?.type === "short-answer" || (isChoice && !!slide?.correctOptionId);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const fit = () => {
      const availableWidth = el.clientWidth;
      const availableHeight = el.clientHeight - EDGE_SPACE * 2;
      setScale(Math.min(availableWidth / CANVAS_WIDTH, availableHeight / CANVAS_HEIGHT));
    };

    // Watch the container itself: entering fullscreen can finish after this view mounts,
    // and a window "resize" event isn't always fired for it.
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " ") {
        e.preventDefault();
        nextSlide();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        prevSlide();
      } else if (e.key === "Escape") {
        exitPresentation();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [nextSlide, prevSlide, exitPresentation]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) exitPresentation();
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [exitPresentation]);

  const handleExit = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    exitPresentation();
  };

  // Like Canva: click the left part of the screen to go back, anywhere else to go forward.
  const handleScreenClick = (e: React.MouseEvent) => {
    if (e.clientX < window.innerWidth * PREV_ZONE) prevSlide();
    else nextSlide();
  };

  if (!slide) return null;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "var(--text-primary)" }}
      onClick={handleScreenClick}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleExit();
        }}
        title="Exit presentation (Esc)"
        className="absolute right-5 top-5 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/30 text-white/80 hover:bg-black/50 hover:text-white"
      >
        <CloseIcon />
      </button>

      {canReveal && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            // Choice slides toggle the green highlight; short-answer slides open the answer popup.
            setRevealedSlideId(isChoice && isAnswerShown ? null : slide.id);
          }}
          title={isChoice && isAnswerShown ? "Hide answer" : "Show answer"}
          className="absolute right-16 top-5 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/30 text-white/80 hover:bg-black/50 hover:text-white"
        >
          <EyeIcon />
        </button>
      )}

      <div style={{ width: CANVAS_WIDTH * scale, height: CANVAS_HEIGHT * scale }}>
        <div
          style={{
            width: CANVAS_WIDTH,
            height: CANVAS_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          <SlideStaticView
            slide={slide}
            number={getSlideNumbers(quiz.slides).get(slide.id)}
            revealAnswer={isChoice && isAnswerShown}
            hideBorders
          />
        </div>
      </div>


      {isAnswerShown && slide.type === "short-answer" && <AnswerModal answer={slide.correctAnswer ?? ""} onClose={() => setRevealedSlideId(null)} />}

      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-dropdown bg-black/30 px-3 py-1 text-xs font-medium text-white/80">
        {presentationIndex + 1} / {quiz.slides.length}
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 4L14 14M14 4L4 14" strokeLinecap="round" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M1.5 9C3.2 5.8 5.9 4 9 4s5.8 1.8 7.5 5c-1.7 3.2-4.4 5-7.5 5S3.2 12.2 1.5 9Z" strokeLinejoin="round" />
      <circle cx="9" cy="9" r="2.25" />
    </svg>
  );
}
