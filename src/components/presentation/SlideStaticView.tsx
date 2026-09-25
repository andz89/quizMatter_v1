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
  autoFitRange,
  OPTION_FONT_SIZE,
  QUESTION_FONT_SIZE,
} from "@/lib/constants";
import type { Slide } from "@/lib/schema";
import { svgDataUrl } from "@/lib/svgLibrary";
import { FitText } from "@/components/editor/FitText";
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
  /** Slide's place in the quiz (1, 2, 3…). Shown as a "Q1" badge when given. */
  number?: number;
  /** When true, the correct option is colored green. */
  revealAnswer?: boolean;
  /** When true, the slide, question and option borders are hidden (full-screen presentation). */
  hideBorders?: boolean;
}

/** Read-only, full-size rendering of a slide — used in presentation mode. */
export function SlideStaticView({ slide, number, revealAnswer = false, hideBorders = false }: SlideStaticViewProps) {
  // Borders turn see-through instead of going away, so nothing on the slide shifts.
  const lineColor = hideBorders ? "transparent" : "var(--border-default)";
  const isList = slide.layout !== "grid";
  const sideElements = slide.elements.filter((el) => el.containerId === SIDE_CONTAINER_ID);
  return (
    <div
      className="relative flex select-none flex-col gap-6 overflow-hidden rounded-card border bg-bg-surface p-10"
      style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, borderColor: lineColor, ...getSlideBackgroundStyle(slide) }}
    >
      {slide.type !== "lesson" && (
        <div
          className="relative shrink-0 rounded-button border p-4"
          style={{ height: slide.questionHeight, borderColor: lineColor }}
        >
          {number !== undefined && (
            // Sits on the box's top border, like a small tab.
            <span className="absolute -top-4 left-4 rounded-dropdown bg-accent-navy px-3 py-1.5 text-[20px] font-semibold leading-none text-white">
              Q{number}
            </span>
          )}
          <FitText
            text={slide.question || "Untitled question"}
            html={slide.questionHtml}
            {...autoFitRange(QUESTION_FONT_SIZE, slide.questionFontSize)}
            className="font-normal text-text-primary"
          />
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
                return (
                <div
                  key={option.id}
                  className={`relative rounded-button border ${isList ? "px-6 py-3" : "p-6"}`}
                  style={{
                    borderColor: isCorrect ? "var(--accent-green)" : lineColor,
                    background: isCorrect ? "rgba(30, 142, 79, 0.12)" : "var(--bg-page)",
                  }}
                >
                  <span
                    // Just outside the card on the left, centered up and down.
                    // White fill so the letter stays readable on any slide background.
                    className="absolute right-full top-1/2 z-20 mr-2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border-2 bg-white text-2xl font-bold"
                    style={{
                      borderColor: isCorrect ? "var(--accent-green)" : lineColor,
                      color: isCorrect ? "var(--accent-green)" : "#000000",
                    }}
                  >
                    {isCorrect ? "✓" : OPTION_LABELS[index]}
                  </span>
                  <div className="h-full w-full">
                    <FitText
                      text={option.text}
                      html={option.html}
                      {...autoFitRange(OPTION_FONT_SIZE, option.fontSize)}
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
