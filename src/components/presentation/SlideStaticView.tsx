import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  OPTION_LABELS,
  OPTIONS_AREA_CLASSES,
  OPTIONS_GRID_CLASSES,
  QUESTION_CONTAINER_ID,
  SIDE_CONTAINER_ID,
  getShapeStripHeight,
  hasShapeStrip,
  hasShapeBox,
  ADD_SHAPE_BOX_ROW_HEIGHT,
  OPTION_FONT_SIZE,
  QUESTION_FONT_SIZE,
} from "@/lib/constants";
import type { Slide } from "@/lib/schema";
import { svgDataUrl } from "@/lib/svgLibrary";
import { SlideText } from "@/components/editor/SlideText";
import { StaticElementView } from "@/components/editor/StaticElementView";
import { toCssBackground } from "@/components/editor/ElementSvg";

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

interface SlideStaticViewProps {
  slide: Slide;
  /** When true, the correct option is colored green. */
  revealAnswer?: boolean;
  /** Full-screen presentation: hides the slide border and gives the option labels a soft tint. */
  fullscreen?: boolean;
}

/** Read-only, full-size rendering of a slide — used in presentation mode. */
export function SlideStaticView({ slide, revealAnswer = false, fullscreen = false }: SlideStaticViewProps) {
  // Borders turn see-through instead of going away, so nothing on the slide shifts.
  const lineColor = fullscreen ? "transparent" : "var(--border-default)";
  const sideElements = slide.elements.filter((el) => el.containerId === SIDE_CONTAINER_ID);
  return (
    <div
      // Full-screen trims the top and bottom padding so the content uses more of the screen.
      className={`relative flex select-none flex-col gap-6 overflow-hidden rounded-card border bg-bg-surface ${fullscreen ? "px-10 py-4" : "p-10"}`}
      style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, borderColor: lineColor, ...getSlideBackgroundStyle(slide) }}
    >
      {slide.type !== "lesson" && (
        <div
          className="relative flex shrink-0 gap-4 rounded-button border border-transparent p-4"
          style={{ height: slide.questionHeight }}
        >
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

      {/* An empty shape box is hidden here — there's nothing to show in it. */}
      {slide.type === "short-answer" && sideElements.length > 0 && (
        <div
          className="relative min-h-0 flex-1 rounded-button border"
          style={getShapeBoxFrameStyle(slide)}
        >
          <div className="absolute inset-4">
            <StaticElementView elements={sideElements} />
          </div>
        </div>
      )}
      {(slide.type ?? "choice") === "choice" && (
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
            <div className={`grid min-h-0 flex-1 ${OPTIONS_GRID_CLASSES[slide.layout]}`}>
              {slide.options.map((option, index) => {
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
