"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useEditorStore } from "@/lib/store";
import { CANVAS_WIDTH, CANVAS_HEIGHT, hasAnswerContent, getSlideNumbers, hasOptions, hasReveal } from "@/lib/constants";
import { SlideStaticView } from "./SlideStaticView";
import { AnswerModal } from "@/components/editor/AnswerModal";
import { SlideThumbnailPreview } from "@/components/editor/SlideThumbnailPreview";
import { EyeIcon, LayoutGridIcon, XIcon } from "lucide-react";

// Clicks in the left 25% of the screen go to the previous slide.
const PREV_ZONE = 0.25;
// The top buttons hide after the mouse has been still this long.
const HIDE_BUTTONS_AFTER_MS = 3000;

export function PresentationView() {
  const presentation = useEditorStore((s) => s.presentation);
  const presentationIndex = useEditorStore((s) => s.presentationIndex);
  const exitPresentation = useEditorStore((s) => s.exitPresentation);
  const nextSlide = useEditorStore((s) => s.nextPresentationSlide);
  const prevSlide = useEditorStore((s) => s.prevPresentationSlide);
  const goToSlide = useEditorStore((s) => s.goToPresentationSlide);

  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  // The slide whose answer is showing. Moving to another slide hides it again.
  const [revealedSlideId, setRevealedSlideId] = useState<string | null>(null);
  const [showButtons, setShowButtons] = useState(true);
  const [showAllSlides, setShowAllSlides] = useState(false);
  const currentThumbRef = useRef<HTMLButtonElement>(null);

  const slide = presentation.slides[presentationIndex];
  const slideNumbers = getSlideNumbers(presentation.slides);
  const isAnswerShown = revealedSlideId === slide?.id;
  const isChoice = !!slide && hasOptions(slide);
  // Blank and title slides are often just for teaching, so they only get the button once a reveal is added.
  const canReveal =
    slide?.type === "short-answer" ||
    slide?.type === "custom" ||
    (!!slide && hasReveal(slide) && hasAnswerContent(slide)) ||
    (isChoice && !!slide?.correctOptionId);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const fit = () => {
      setScale(Math.min(el.clientWidth / CANVAS_WIDTH, el.clientHeight / CANVAS_HEIGHT));
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
      // While all slides are showing, the arrows do nothing and Esc closes only the grid — but only when
      // not in full screen. In full screen the browser takes Esc to leave full screen (the page never
      // gets it), which ends the presentation, so no hint promises that Esc closes the grid.
      if (showAllSlides) {
        if (e.key === "Escape") setShowAllSlides(false);
        return;
      }
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
  }, [nextSlide, prevSlide, exitPresentation, showAllSlides]);

  // Opening the grid scrolls to the slide being shown, so the teacher finds their place.
  useEffect(() => {
    if (showAllSlides) currentThumbRef.current?.scrollIntoView({ block: "center" });
  }, [showAllSlides]);

  // Show the top buttons while the mouse moves; hide them once it has been still for a while.
  useEffect(() => {
    let timer = setTimeout(() => setShowButtons(false), HIDE_BUTTONS_AFTER_MS);
    const handleMouseMove = () => {
      setShowButtons(true);
      clearTimeout(timer);
      timer = setTimeout(() => setShowButtons(false), HIDE_BUTTONS_AFTER_MS);
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, []);

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

  const roundButtonClass =
    // The shadow keeps the buttons easy to see when the slide behind them is white.
    "flex h-9 w-9 items-center justify-center rounded-full bg-black/30 text-white/80 shadow-[0_1px_6px_rgba(0,0,0,0.35)] hover:bg-black/50 hover:text-white";
  const buttonsClass = `transition-opacity duration-300 ${showButtons ? "opacity-100" : "pointer-events-none opacity-0"}`;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "var(--text-primary)" }}
      onClick={handleScreenClick}
    >
      {/* Bottom left. Left to right: Exit, All slides, Reveal. Reveal is last, so when it hides the other buttons don't move. */}
      <div className={`absolute bottom-5 left-5 z-10 flex gap-2 ${buttonsClass}`}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleExit();
          }}
          title="Exit presentation (Esc)"
          className={roundButtonClass}
        >
          <XIcon size={18} />
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setShowAllSlides((v) => !v);
          }}
          title={showAllSlides ? "Hide all slides" : "Show all slides"}
          className={roundButtonClass}
        >
          <LayoutGridIcon size={18} />
        </button>

        {canReveal && !showAllSlides && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              // Choice slides toggle the green highlight; the others open the answer popup.
              setRevealedSlideId(isChoice && isAnswerShown ? null : slide.id);
            }}
            title={hasReveal(slide) ? "Reveal" : isChoice && isAnswerShown ? "Hide answer" : "Show answer"}
            className={roundButtonClass}
          >
            <EyeIcon size={18} />
          </button>
        )}
      </div>

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
            questionNumber={slideNumbers.get(slide.id)}
            revealAnswer={isChoice && isAnswerShown}
            fullscreen
            liveEmbed
          />
        </div>
      </div>

      {isAnswerShown && !isChoice && <AnswerModal slide={slide} onClose={() => setRevealedSlideId(null)} />}

      {showAllSlides && (
        // Clicking the empty dark area closes the grid; clicks here never move to the next slide.
        <div
          className="absolute inset-0 z-[5] overflow-y-auto bg-black/85 px-10 pb-10 pt-24"
          onClick={(e) => {
            e.stopPropagation();
            setShowAllSlides(false);
          }}
        >
          <div className="mx-auto grid max-w-6xl grid-cols-[repeat(auto-fill,200px)] justify-center gap-6">
            {presentation.slides.map((s, i) => {
              const isCurrent = i === presentationIndex;
              return (
                <button
                  key={s.id}
                  ref={isCurrent ? currentThumbRef : undefined}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    goToSlide(i);
                    setShowAllSlides(false);
                  }}
                  className="flex flex-col items-center gap-2 text-sm text-white/70 hover:text-white"
                >
                  <div
                    className={`rounded-dropdown ring-offset-2 ring-offset-black transition-shadow ${
                      isCurrent ? "ring-2 ring-white" : "hover:ring-2 hover:ring-white/40"
                    }`}
                  >
                    <SlideThumbnailPreview slide={s} questionNumber={slideNumbers.get(s.id)} revealAnswer={false} />
                  </div>
                  {i + 1}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
