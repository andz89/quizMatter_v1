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
} from "@/lib/constants";
import type { Slide } from "@/lib/schema";
import { svgDataUrl } from "@/lib/svgLibrary";
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

/** The slide's background color and artwork. The artwork is a CSS image, so nothing inside it can run. */
export function getSlideBackgroundStyle(slide: Pick<Slide, "background" | "backgroundSvg">) {
  return {
    backgroundColor: slide.background,
    ...(slide.backgroundSvg && {
      backgroundImage: `url("${svgDataUrl(slide.backgroundSvg)}")`,
      backgroundSize: "100% 100%",
    }),
  };
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
    background: fullscreen ? "#ECEDF3" : undefined,
    color: fullscreen ? "var(--accent-navy)" : "#000000",
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
      // Full-screen trims the top and bottom padding so the content uses more of the screen.
      className={`relative flex select-none flex-col gap-6 overflow-hidden rounded-card border bg-bg-surface ${fullscreen ? "px-10 py-4" : "p-10"}`}
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
                const textColor = isCorrect ? "var(--accent-green)" : fullscreen ? "var(--accent-navy)" : "#000000";
                return (
                <div
                  key={option.id}
                  className="relative rounded-button border border-transparent p-[5px]"
                >
                  <span
                    // Just outside the card on its left, 10px below its top.
                    // Solid fill so the letter stays readable on any slide background. Full screen uses a soft
                    // tint (pale navy, or pale green once revealed) with no ring, so the label stands out gently.
                    className="absolute right-full top-4 z-20 mr-2 flex h-12 w-12 items-center justify-center rounded-full border-2 bg-white text-2xl font-bold"
                    style={{
                      borderColor: fullscreen ? "transparent" : isCorrect ? "var(--accent-green)" : lineColor,
                      background: fullscreen ? (isCorrect ? "#E3F2EA" : "#ECEDF3") : undefined,
                      color: textColor,
                    }}
                  >
                    {isCorrect ? "✓" : OPTION_LABELS[index]}
                  </span>
                  <div className="h-full w-full">
                    <SlideText
                      text={option.text}
                      html={option.html}
                      fontSize={option.fontSize ?? OPTION_FONT_SIZE}
                      className="text-text-primary"
                    />
                  </div>
                  <StaticElementView elements={slide.elements.filter((el) => el.containerId === option.id)} />
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
