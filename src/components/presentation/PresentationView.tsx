"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useEditorStore } from "@/lib/store";
import { animate } from "motion/mini";
import { CANVAS_WIDTH, CANVAS_HEIGHT, hasAnswerContent, getSlideNumbers, hasOptions, hasReveal, SLIDE_EFFECT_SECONDS, SLIDE_FADE_SECONDS } from "@/lib/constants";
import type { Presentation } from "@/lib/schema";
import { SlideStaticView } from "./SlideStaticView";
import { AnswerModal } from "@/components/editor/AnswerModal";
import { SlideThumbnailPreview } from "@/components/editor/SlideThumbnailPreview";
import { EyeIcon, LayoutGridIcon, XIcon } from "lucide-react";

// Clicks in the left 25% of the screen go to the previous slide.
const PREV_ZONE = 0.25;
// The top buttons hide after the mouse has been still this long.
const HIDE_BUTTONS_AFTER_MS = 3000;
// How many slides ahead are drawn hidden, so they're ready before the teacher moves to them.
const PRELOAD_SLIDES = 2;
// The longest a slide change waits for the new slide's photos before its effect starts anyway.
const MAX_WAIT_MS = 400;
// Starts fast and slows down at the end.
const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

/**
 * Plays the slide effect the teacher picked in the Effects panel, on the new slide (on top) and the old one (under
 * it). "Fade" goes through the dark screen: the old slide fades out in the first half, the new one fades in in the
 * second, so it looks the same however alike the two slides are. "Slide" comes in from the right going forward and
 * from the left going back. It plays even when the computer asks to reduce motion: the teacher picked it on
 * purpose ("None" turns it off), and many school laptops ask for reduced motion.
 */
function startSlideEffect(
  { transition, transitionSpeed }: Pick<Presentation, "transition" | "transitionSpeed">,
  newLayer: HTMLElement,
  oldLayer: HTMLElement,
  goingBack: boolean,
) {
  // reduceMotion: false, or motion would skip Slide and Zoom on computers that ask for reduced motion.
  const options = { duration: SLIDE_EFFECT_SECONDS[transitionSpeed], ease: EASE_OUT, reduceMotion: false };
  if (transition === "fade") {
    const halves = { ...options, duration: SLIDE_FADE_SECONDS[transitionSpeed], times: [0, 0.5, 1], ease: "easeInOut" as const };
    return [animate(oldLayer, { opacity: [1, 0, 0] }, halves), animate(newLayer, { opacity: [0, 0, 1] }, halves)];
  }
  if (transition === "zoom") {
    return [animate(newLayer, { transform: ["scale(0.5)", "scale(1)"] }, options)];
  }
  const start = goingBack ? "translateX(-100%)" : "translateX(100%)";
  return [animate(newLayer, { transform: [start, "translateX(0%)"] }, options)];
}

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
  // Remember the last slide shown: it stays under the new slide while the slide effect plays (cleared when the
  // effect ends), and tells "Slide" which way to come from.
  const [shownIndex, setShownIndex] = useState(presentationIndex);
  const [fromIndex, setFromIndex] = useState<number | null>(null);
  const [goingBack, setGoingBack] = useState(false);
  // True from a slide change until the new slide is drawn and its photos are ready. Only then does its effect
  // start: started earlier, the browser was still busy drawing, so part of the effect was lost and the speed changed.
  const [isWaiting, setIsWaiting] = useState(false);
  const currentLayerRef = useRef<HTMLDivElement>(null);
  const fromLayerRef = useRef<HTMLDivElement>(null);
  if (presentationIndex !== shownIndex) {
    // The slide really on screen: while waiting, the new slide wasn't shown yet, so it's still the old one.
    const onScreenIndex = isWaiting && fromIndex !== null ? fromIndex : shownIndex;
    const playEffect = presentation.transition !== "none" && presentationIndex !== onScreenIndex;
    setGoingBack(presentationIndex < onScreenIndex);
    // A click during an effect ends it at once: the slide on screen becomes the old one for the next effect.
    setFromIndex(playEffect ? onScreenIndex : null);
    setIsWaiting(playEffect);
    setShownIndex(presentationIndex);
  }

  useEffect(() => {
    if (!isWaiting) return;
    let cancelled = false;
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const photos = [...(currentLayerRef.current?.querySelectorAll("img") ?? [])];
    const photosReady = Promise.all(photos.map((img) => img.decode().catch(() => {})));
    // A slow photo doesn't hold the slide back for long.
    const tooLong = new Promise((resolve) => (timer = setTimeout(resolve, MAX_WAIT_MS)));
    Promise.race([photosReady, tooLong]).then(() => {
      if (cancelled) return;
      // Two frames: the first lets the browser draw the slide, the effect starts on the second.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => setIsWaiting(false));
      });
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [isWaiting, presentationIndex]);

  // Once the new slide is ready, motion plays the effect. Started before the screen is drawn, so the first frame
  // already shows the effect's start. When it ends, the old slide is let go; a click before then (the clean-up)
  // ends it at once.
  const { transition, transitionSpeed } = presentation;
  useLayoutEffect(() => {
    const newLayer = currentLayerRef.current;
    const oldLayer = fromLayerRef.current;
    if (isWaiting || fromIndex === null || !newLayer || !oldLayer) return;
    let cancelled = false;
    const effects = startSlideEffect({ transition, transitionSpeed }, newLayer, oldLayer, goingBack);
    Promise.all(effects.map((effect) => effect.finished))
      .then(() => {
        if (!cancelled) setFromIndex(null);
      })
      .catch(() => {}); // Ended early by a click: nothing to do.
    return () => {
      cancelled = true;
      effects.forEach((effect) => effect.cancel());
      // Leave no effect styles behind: the slides' own classes decide how they look again.
      for (const layer of [newLayer, oldLayer]) {
        layer.style.opacity = "";
        layer.style.transform = "";
      }
    };
  }, [isWaiting, fromIndex, presentationIndex, goingBack, transition, transitionSpeed]);

  const slide = presentation.slides[presentationIndex];
  // The slides drawn: the one shown, the one we came from, the one before and the next ones (see below). While an
  // effect plays, only slides that were already drawn stay: drawing a new one then would make the effect skip.
  const nearSlides = (index: number) => [index - 1, index, ...Array.from({ length: PRELOAD_SLIDES }, (_, k) => index + 1 + k)];
  const drawnBefore = fromIndex === null ? null : nearSlides(fromIndex);
  const layerIndices = [
    ...new Set([fromIndex, ...nearSlides(presentationIndex).filter((i) => !drawnBefore || i === presentationIndex || drawnBefore.includes(i))]),
  ]
    .filter((i): i is number => i !== null && i >= 0 && i < presentation.slides.length)
    .sort((a, b) => a - b);
  const scaledSlideStyle = { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, transform: `scale(${scale})`, transformOrigin: "top left" };
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
  const buttonsClass =`transition-opacity duration-300 ${showButtons ? "opacity-100" : "pointer-events-none opacity-0"}`;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden"
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

      <div className="relative overflow-hidden" style={{ width: CANVAS_WIDTH * scale, height: CANVAS_HEIGHT * scale }}>
        {/* Each slide keeps one drawing while it's near: the slide shown, the one we came from (under it until its
            effect ends), and the ones around it, too faint to see, so their photos and
            pictures are ready. A slide is never drawn fresh during an effect: that made photos flash their small
            copy and pictures jump size mid-effect. Kept in slide order, so no drawing moves (that would reload an
            embed). The effect plays when a slide gets its class, on becoming the one shown. */}
        {layerIndices.map((i) => {
          const layer = presentation.slides[i];
          const isCurrent = i === presentationIndex;
          return (
            <div
              key={layer.id}
              ref={isCurrent ? currentLayerRef : i === fromIndex ? fromLayerRef : undefined}
              aria-hidden={!isCurrent}
              // Every slide keeps its own layer (will-change), so the browser keeps its painted pixels between roles.
              className={`absolute inset-0 will-change-transform ${
                isCurrent && !isWaiting
                  ? "z-[2]"
                  : i === fromIndex
                    ? "z-[1]"
                    : // Waiting slides (and the new slide until it's ready): too faint to see, but not hidden, so
                      // the browser paints them now. A hidden slide is only painted when it shows, which took up
                      // to a second on busy slides (a dark screen mid-effect). On top, so nothing covers them and
                      // the browser can't skip them.
                      "pointer-events-none z-[3] opacity-[0.001]"
              }`}
            >
              <div style={scaledSlideStyle}>
                <SlideStaticView
                  slide={layer}
                  questionNumber={slideNumbers.get(layer.id)}
                  revealAnswer={isCurrent && isChoice && isAnswerShown}
                  fullscreen
                  // The live embed starts after the effect: loading it mid-effect made the effect stutter.
                  liveEmbed={isCurrent && fromIndex === null}
                />
              </div>
            </div>
          );
        })}
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
