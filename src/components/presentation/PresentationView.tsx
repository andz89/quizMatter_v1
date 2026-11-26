"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useEditorStore } from "@/lib/store";
import { animate } from "motion/mini";
import { CANVAS_WIDTH, CANVAS_HEIGHT, hasAnswerContent, getSlideNumbers, hasOptions, hasReveal, stepPresentation, SLIDE_EFFECT_SECONDS, SLIDE_FADE_SECONDS, ELEMENT_EFFECT_SECONDS } from "@/lib/constants";
import { effectSteps } from "@/lib/elementEffects";
import type { Presentation, Slide } from "@/lib/schema";
import { SlideStaticView } from "./SlideStaticView";
import { AnswerModal } from "@/components/editor/AnswerModal";
import { SlideThumbnailPreview } from "@/components/editor/SlideThumbnailPreview";
import { CheckIcon, LayoutGridIcon, XIcon } from "lucide-react";

// Clicks in the left 25% of the screen go to the previous slide.
const PREV_ZONE = 0.25;
// The top buttons hide after the mouse has been still this long.
const HIDE_BUTTONS_AFTER_MS = 3000;
// How many slides ahead are drawn hidden, so they're ready before the teacher moves to them.
const PRELOAD_SLIDES = 2;
// The longest a slide change waits for the new slide's photos before its effect starts anyway.
const MAX_WAIT_MS = 400;
// The tip about the check button shows this long after the presentation opens (unless closed sooner).
const TIP_MS = 6000;
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

/**
 * Plays one element effect (Effects panel → Element effects) on an element's inner box. Like the slide effect, it
 * plays even when the computer asks to reduce motion. Pop up grows a little past full size, then settles.
 */
function startElementEffect(node: HTMLElement, effect: NonNullable<Slide["elements"][number]["effect"]>) {
  const options = { duration: ELEMENT_EFFECT_SECONDS[effect.speed], reduceMotion: false };
  if (effect.type === "pop") {
    return animate(node, { opacity: [0, 1, 1], transform: ["scale(0.5)", "scale(1.08)", "scale(1)"] }, { ...options, times: [0, 0.7, 1], ease: "easeOut" });
  }
  return animate(node, { opacity: [0, 1] }, { ...options, ease: "easeOut" });
}

/** The ids of the steps from `from` on: elements that haven't come in yet. */
function hiddenFrom(steps: string[][], from: number): ReadonlySet<string> {
  return new Set(steps.slice(from).flat());
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
  // The tip fades in ("entering" → "shown"), fades out ("leaving") and is then removed ("gone").
  const [tip, setTip] = useState<"entering" | "shown" | "leaving" | "gone">("entering");
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
  // Element effects: how many of the shown slide's steps have come in, and how many the slide we came from had (it
  // stays as it was while the slide effect plays). The step being played now, so its effect plays once.
  const [stepsShown, setStepsShown] = useState(0);
  const [fromStepsShown, setFromStepsShown] = useState(0);
  const [playing, setPlaying] = useState<{ slideId: string; step: number } | null>(null);
  // Set by the "Show all slides" grid: a slide picked there starts with none of its steps, even going back.
  const [isGridJump, setIsGridJump] = useState(false);
  if (presentationIndex !== shownIndex) {
    // The slide really on screen: while waiting, the new slide wasn't shown yet, so it's still the old one.
    const onScreenIndex = isWaiting && fromIndex !== null ? fromIndex : shownIndex;
    const playEffect = presentation.transition !== "none" && presentationIndex !== onScreenIndex;
    setGoingBack(presentationIndex < onScreenIndex);
    // A click during an effect ends it at once: the slide on screen becomes the old one for the next effect.
    setFromIndex(playEffect ? onScreenIndex : null);
    setIsWaiting(playEffect);
    setShownIndex(presentationIndex);
    // `stepsShown` belongs to `shownIndex`, which may still be loading; the slide on screen has its own count.
    const onScreenSteps = onScreenIndex === shownIndex ? stepsShown : fromStepsShown;
    // Going back shows a slide with all its steps in (like PowerPoint); going forward, or from the grid, with none.
    // Back to the slide still on screen (the new one hadn't loaded yet) keeps the steps it showed.
    const arriving = presentation.slides[presentationIndex];
    setFromStepsShown(onScreenSteps);
    setStepsShown(
      presentationIndex === onScreenIndex
        ? onScreenSteps
        : presentationIndex < onScreenIndex && !isGridJump && arriving
          ? effectSteps(arriving).length
          : 0
    );
    setPlaying(null);
    setIsGridJump(false);
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
  const steps = slide ? effectSteps(slide) : [];
  // While the slide effect waits or plays, a press that would change a step only ends the slide effect, so a step
  // never plays (or goes) on a slide the teacher can't see yet. Changing slides still works as before.
  const isChangingSlide = fromIndex !== null;
  const endSlideEffect = () => {
    setFromIndex(null);
    setIsWaiting(false);
  };
  // Next: the next step of the slide comes in first; once every one has, the next slide.
  const goNext = () => {
    if (slide && stepsShown < steps.length && isChangingSlide) endSlideEffect();
    else if (slide && stepsShown < steps.length) {
      setPlaying({ slideId: slide.id, step: stepsShown });
      setStepsShown(stepsShown + 1);
    } else nextSlide();
  };
  // Back: the last step that came in goes again (no effect); with none in, the previous slide.
  const goBack = () => {
    if (stepsShown > 0 && isChangingSlide) endSlideEffect();
    else if (stepsShown > 0) {
      setPlaying(null);
      setStepsShown(stepsShown - 1);
    } else prevSlide();
  };
  // What each drawn slide hides: the one shown, its steps not in yet; the one we came from, as it was; the ones
  // ahead, all their steps (they start with none); the ones behind, nothing (going back shows them whole).
  const hiddenOf = (i: number, layer: Slide) => {
    if (i === presentationIndex) return hiddenFrom(steps, stepsShown);
    if (i === fromIndex) return hiddenFrom(effectSteps(layer), fromStepsShown);
    return i > presentationIndex ? hiddenFrom(effectSteps(layer), 0) : undefined;
  };

  // A step that just came in plays its effect. Started before the screen is drawn, so the first frame already
  // shows its start. The next press ends it at once (the clean-up), and the element's own class decides again.
  useLayoutEffect(() => {
    const layer = currentLayerRef.current;
    if (!playing || !layer || playing.slideId !== slide?.id) return;
    const nodes: HTMLElement[] = [];
    const effects = (steps[playing.step] ?? []).flatMap((id) => {
      const effect = slide.elements.find((e) => e.id === id)?.effect;
      const node = layer.querySelector<HTMLElement>(`[data-element-id="${CSS.escape(id)}"]`);
      if (!effect || !node) return [];
      nodes.push(node);
      return [startElementEffect(node, effect)];
    });
    return () => {
      effects.forEach((effect) => effect.cancel());
      for (const node of nodes) {
        node.style.opacity = "";
        node.style.transform = "";
      }
    };
    // Only a new step plays: the slide and its steps are read for that step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // The slides drawn: the one shown, the one we came from, the one before and the next ones (see below). While an
  // effect plays, only slides that were already drawn stay: drawing a new one then would make the effect skip.
  // The slides the arrows go to from `index` (hidden ones are skipped), so those are the ones drawn ahead.
  const nearSlides = (index: number) => {
    const near = [stepPresentation(presentation.slides, index, -1), index];
    for (let k = 0, i = index; k < PRELOAD_SLIDES; k++) near.push((i = stepPresentation(presentation.slides, i, 1)));
    return near;
  };
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
      // Space brings in the next element step first. Then it shows or hides the answer key, like the check button.
      // A slide without one: Space goes on, as before.
      if (e.key === " " && stepsShown < steps.length) {
        e.preventDefault();
        goNext();
      } else if (e.key === " " && canReveal && slide) {
        e.preventDefault();
        setRevealedSlideId(isAnswerShown ? null : slide.id);
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " ") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        goBack();
      } else if (e.key === "Escape") {
        exitPresentation();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

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

  // The tip fades in on the next frame (so the fade plays) and starts fading out after TIP_MS.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setTip("shown"));
    const timer = setTimeout(() => setTip((t) => (t === "gone" ? t : "leaving")), TIP_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, []);

  // The page under the presentation can't scroll while it shows: a long page (like the home page with many cards)
  // kept its scrollbar on top of the fullscreen slides, making them narrower.
  useEffect(() => {
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = before;
    };
  }, []);

  // Tells AnnouncementsWatch (root layout) a presentation is showing, also when the browser refused fullscreen.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.presenting = "true";
    return () => {
      delete root.dataset.presenting;
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
    if (e.clientX < window.innerWidth * PREV_ZONE) goBack();
    else goNext();
  };

  if (!slide) return null;

  const roundButtonClass =
    // A darker fill keeps the buttons easy to see when the slide behind them is white.
    "flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white/80 hover:bg-black/50 hover:text-white";
  // A live video or deck is another site's frame: a mouse moving over it never reaches this page, so hidden buttons
  // couldn't come back. They stay while one is showing.
  const hasLivePlayer = !!slide.embedUrl && (slide.type === "video" || slide.type === "embed-slides");
  const buttonsClass = `transition-opacity duration-300 ${showButtons || hasLivePlayer ? "opacity-100" : "pointer-events-none opacity-0"}`;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden"
      style={{ background: "var(--text-primary)" }}
      onClick={handleScreenClick}
    >
      {/* Bottom left. Left to right: Exit, All slides, Reveal. Reveal is last, so when it hides the other buttons don't
          move. */}
      <div className="absolute bottom-5 left-5 z-10 flex max-w-[calc(100%-40px)] items-center gap-2">
        <div className={`flex shrink-0 gap-2 ${buttonsClass}`}>
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
              title={`${hasReveal(slide) ? "Reveal" : isAnswerShown ? "Hide answer" : "Show answer"} (Space)`}
              className={roundButtonClass}
            >
              <CheckIcon size={18} />
            </button>
          )}
        </div>
      </div>

      {/* A tip at the bottom center when the presentation opens. It stays even when the buttons hide. */}
      {tip !== "gone" && (
        <div
          role="status"
          onClick={(e) => e.stopPropagation()}
          onTransitionEnd={() => {
            if (tip === "leaving") setTip("gone");
          }}
          className={`absolute bottom-5 left-1/2 z-10 flex w-max max-w-[calc(100%-40px)] -translate-x-1/2 items-center gap-3 rounded-card border border-border-default bg-bg-surface py-2 pl-4 pr-2 text-sm text-text-primary transition-opacity duration-500 ${
            tip === "shown" ? "opacity-100" : "opacity-0"
          }`}
        >
          <span>
            If this slide has a saved answer key, click the check icon at the bottom left or press Space to reveal it.
          </span>
          <button
            type="button"
            onClick={() => setTip("leaving")}
            title="Close tip"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-dropdown text-text-secondary hover:bg-accent-soft hover:text-text-primary"
          >
            <XIcon size={16} />
          </button>
        </div>
      )}

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
                  hiddenElementIds={hiddenOf(i, layer)}
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
                    // Picking the slide already shown changes nothing, so the flag would stay for a later change.
                    if (!isCurrent) setIsGridJump(true);
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
