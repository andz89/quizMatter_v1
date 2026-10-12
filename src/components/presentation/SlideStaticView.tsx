import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  OPTION_LABELS,
  OPTIONS_AREA_CLASSES,
  getOptionsGridClasses,
  getShownOptions,
  hasOptions,
  QUESTION_CONTAINER_ID,
  SIDE_CONTAINER_ID,
  getShapeStripHeight,
  hasShapeStrip,
  hasShapeBox,
  ADD_SHAPE_BOX_ROW_HEIGHT,
  OPTION_FONT_SIZE,
  QUESTION_FONT_SIZE,
  QUESTION_NUMBER_INDENT,
  DEFAULT_QUESTION_BOX,
  getQuestionBox,
  getItemCount,
  isFreeCanvas,
  GRADIENT_PREFIX,
  MESH_PREFIX,
} from "@/lib/constants";
import type { Slide } from "@/lib/schema";
import { SlideText } from "@/components/editor/SlideText";
import { StaticElementView } from "@/components/editor/StaticElementView";
import { toCssBackground } from "@/components/editor/ElementSvg";
import { EmbedSlideView } from "@/components/editor/EmbedSlide";
import { isEmbedSlide } from "@/lib/embed";

/** The shape box's fill and border outside the editor. Unset parts go transparent, so nothing shifts. */
export function getShapeBoxFrameStyle(slide: Pick<Slide, "shapeBoxFill" | "shapeBoxBorder">) {
  return {
    borderColor: slide.shapeBoxBorder ?? "transparent",
    background: slide.shapeBoxFill ? toCssBackground(slide.shapeBoxFill) : "transparent",
  };
}

// Where each corner color of a soft blend sits, in the stored order.
const MESH_CORNERS = ["0% 0%", "100% 0%", "0% 100%", "100% 100%"];

/**
 * A slide's background color as CSS: the color itself, its gradient from the top of the slide to the bottom,
 * or its soft blend (a round glow of color in each corner, fading out, over a corner-to-corner gradient).
 */
export function slideBackgroundCss(background: string) {
  if (background.startsWith(GRADIENT_PREFIX)) return `linear-gradient(180deg, ${background.slice(GRADIENT_PREFIX.length)})`;
  if (background.startsWith(MESH_PREFIX)) {
    const corners = background.slice(MESH_PREFIX.length).split(",");
    const glows = corners.map((color, i) => `radial-gradient(at ${MESH_CORNERS[i]}, ${color} 0%, transparent 70%)`);
    return [...glows, `linear-gradient(135deg, ${corners[0]}, ${corners[3]})`].join(", ");
  }
  return background;
}

/** The slide's background color, gradient or soft blend. */
export function getSlideBackgroundStyle(slide: Pick<Slide, "background">) {
  if (slide.background?.startsWith(GRADIENT_PREFIX) || slide.background?.startsWith(MESH_PREFIX)) {
    return { backgroundImage: slideBackgroundCss(slide.background) };
  }
  return { backgroundColor: slide.background };
}

// The number circle's size and its gap to the question box (Tailwind h-12 w-12 and mr-2 / top-4).
const BADGE_SIZE = 48;
const BADGE_GAP = 8;
const BADGE_TOP = 16;

/**
 * The question's number, in a circle just left of the question box, lined up with the option letters
 * below (the box starts QUESTION_NUMBER_INDENT further right to make room). Full screen gives it the
 * option letters' soft tint instead of a ring. A custom slide with several items shows its range
 * (11–15), and the circle stretches into a pill to fit it.
 */
export function QuestionNumberBadge({
  number,
  count = 1,
  fullscreen = false,
  atDefaultSpot = false,
}: {
  number: number;
  /** How many items the slide holds (see getItemCount). */
  count?: number;
  fullscreen?: boolean;
  /**
   * Short-answer and custom slides: there's no box it can sit beside (it moves, or there is none),
   * so the number sits at the box's usual spot instead.
   */
  atDefaultSpot?: boolean;
}) {
  const className =
    "pointer-events-none flex h-12 min-w-12 items-center justify-center whitespace-nowrap rounded-full border-2 bg-white px-2 text-2xl font-bold";
  const style = {
    borderColor: fullscreen ? "transparent" : "var(--border-default)",
    background: fullscreen ? "var(--accent-soft)" : undefined,
    color: fullscreen ? "var(--accent)" : "#000000",
  };
  const label = count > 1 ? `${number}–${number + count - 1}` : number;

  if (!atDefaultSpot) {
    return (
      <span className={`absolute right-full top-4 mr-2 ${className}`} style={style}>
        {label}
      </span>
    );
  }
  // Where the circle sits beside an unmoved box (+1 for the box's border). Placed by its left edge,
  // so a wider range pill grows to the right, into the slide, instead of off its left edge.
  return (
    <span
      className={`absolute ${className}`}
      style={{
        ...style,
        left: DEFAULT_QUESTION_BOX.x - BADGE_GAP - BADGE_SIZE,
        top: DEFAULT_QUESTION_BOX.y + 1 + BADGE_TOP,
      }}
    >
      {label}
    </span>
  );
}

interface SlideStaticViewProps {
  slide: Slide;
  /** The question's number (from getSlideNumbers). Missing = no number. Ignored on blank slides. */
  questionNumber?: number;
  /** When true, the correct option is colored green. */
  revealAnswer?: boolean;
  /** Full-screen presentation: hides the slide border and gives the option labels a soft tint. */
  fullscreen?: boolean;
  /** Embed slides: true = the live video or slide deck (present mode); false = a light preview. */
  liveEmbed?: boolean;
}

/** Read-only, full-size rendering of a slide — used in presentation mode. */
export function SlideStaticView({ slide, questionNumber, revealAnswer = false, fullscreen = false, liveEmbed = false }: SlideStaticViewProps) {
  // Borders turn see-through instead of going away, so nothing on the slide shifts.
  const lineColor = fullscreen ? "transparent" : "var(--border-default)";
  const sideElements = slide.elements.filter((el) => el.containerId === SIDE_CONTAINER_ID);
  // Short-answer slides: the question box sits wherever the teacher moved it, in slide px (so it
  // doesn't shift with full screen's smaller padding, just like the pictures around it).
  const isMovableQuestion = slide.type === "short-answer";
  const questionBox = getQuestionBox(slide);
  return (
    <div
      // The editor's padding in full screen too, so every box is the same size as in the editor and the
      // pictures in it sit where the teacher (or Claude) put them.
      className="relative flex select-none flex-col gap-6 overflow-hidden rounded-card border bg-bg-surface p-10"
      style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, borderColor: lineColor, ...getSlideBackgroundStyle(slide) }}
    >
      {(isMovableQuestion || slide.type === "custom") && questionNumber !== undefined && (
        <QuestionNumberBadge number={questionNumber} count={getItemCount(slide)} fullscreen={fullscreen} atDefaultSpot />
      )}
      {isEmbedSlide(slide) && <EmbedSlideView slide={slide} kind={slide.type} live={liveEmbed} />}
      {!isFreeCanvas(slide) && !isEmbedSlide(slide) && (
        <div
          className={`flex gap-4 rounded-button border border-transparent p-4 ${isMovableQuestion ? "absolute" : "relative shrink-0"}`}
          style={
            isMovableQuestion
              ? { left: questionBox.x, top: questionBox.y, width: questionBox.width, height: slide.questionHeight }
              : { height: slide.questionHeight, marginLeft: QUESTION_NUMBER_INDENT }
          }
        >
          {!isMovableQuestion && questionNumber !== undefined && (
            <QuestionNumberBadge number={questionNumber} fullscreen={fullscreen} />
          )}
          <div className="h-full min-w-0 flex-1">
            <SlideText
              text={slide.question || "Untitled question"}
              html={slide.questionHtml}
              fontSize={slide.questionFontSize ?? QUESTION_FONT_SIZE}
              className="font-normal text-text-primary"
            />
          </div>
          <StaticElementView elements={slide.elements.filter((el) => el.containerId === QUESTION_CONTAINER_ID)} />
        </div>
      )}

      {hasOptions(slide) && (
        <>
          {hasShapeStrip(slide) && (
            <div
              className="relative -my-[14px] shrink-0 rounded-button border"
              style={{ height: getShapeStripHeight(slide), ...getShapeBoxFrameStyle(slide) }}
            >
              <div className="absolute inset-0">
                <StaticElementView elements={sideElements} />
              </div>
            </div>
          )}

          {/* Keeps the editor's "add shape box" row space empty here, so the options line up. */}
          {!hasShapeBox(slide) && <div className="-my-6 shrink-0" style={{ height: ADD_SHAPE_BOX_ROW_HEIGHT }} />}
          <div className={OPTIONS_AREA_CLASSES}>
            <div className={`grid min-h-0 flex-1 ${getOptionsGridClasses(slide)}`}>
              {getShownOptions(slide).map((option, index) => {
                const isCorrect = revealAnswer && option.id === slide.correctOptionId;
                const optionElements = slide.elements.filter((el) => el.containerId === option.id);
                const textColor = isCorrect ? "var(--success-strong)" : fullscreen ? "var(--accent)" : "#000000";
                return (
                <div
                  key={option.id}
                  className="relative rounded-button border border-transparent p-[5px]"
                >
                  <span
                    // Just outside the card on its left, 10px below its top.
                    // Solid fill so the letter stays readable on any slide background. Full screen uses a soft
                    // tint (pale violet, or pale mint once revealed) with no ring, so the label stands out gently.
                    className="absolute right-full top-4 z-20 mr-2 flex h-12 w-12 items-center justify-center rounded-full border-2 bg-white text-2xl font-bold"
                    style={{
                      borderColor: fullscreen ? "transparent" : isCorrect ? "var(--success)" : lineColor,
                      background: fullscreen ? (isCorrect ? "var(--success-soft)" : "var(--accent-soft)") : undefined,
                      color: textColor,
                    }}
                  >
                    {isCorrect ? "✓" : OPTION_LABELS[index]}
                  </span>
                  {/* With pictures, the text keeps to the left half, like the editor (OptionCard). */}
                  <div className={`h-full ${optionElements.length ? "w-1/2" : "w-full"}`}>
                    <SlideText
                      text={option.text}
                      html={option.html}
                      fontSize={option.fontSize ?? OPTION_FONT_SIZE}
                      className="text-text-primary"
                    />
                  </div>
                  <StaticElementView elements={optionElements} />
                </div>
                );
              })}
            </div>
            {slide.layout === "list-side" && (
              <div
                className="relative flex-1 rounded-button border"
                style={getShapeBoxFrameStyle(slide)}
              >
                <div className="absolute inset-4">
                  <StaticElementView elements={sideElements} />
                </div>
              </div>
            )}
          </div>
        </>
      )}
      <StaticElementView elements={slide.elements.filter((el) => el.containerId === null)} />
    </div>
  );
}
