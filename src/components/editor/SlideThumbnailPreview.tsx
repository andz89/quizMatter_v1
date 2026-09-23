import { CANVAS_WIDTH, CANVAS_HEIGHT, OPTION_LABELS, QUESTION_CONTAINER_ID } from "@/lib/constants";
import type { Slide } from "@/lib/schema";
import { StaticElementView } from "./StaticElementView";

const THUMB_WIDTH = 200;
const SCALE = THUMB_WIDTH / CANVAS_WIDTH;

/** Static, non-editable miniature of a slide — used in the slide list. */
export function SlideThumbnailPreview({ slide }: { slide: Slide }) {
  return (
    <div
      className="overflow-hidden rounded-dropdown bg-bg-surface"
      style={{ width: THUMB_WIDTH, aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}
    >
      <div
        className="pointer-events-none relative flex select-none flex-col gap-6 p-10"
        style={{
          width: CANVAS_WIDTH,
          height: CANVAS_HEIGHT,
          transform: `scale(${SCALE})`,
          transformOrigin: "top left",
        }}
      >
        <div
          className="relative shrink-0 rounded-button border border-border-default p-4"
          style={{ height: slide.questionHeight }}
        >
          <p className="line-clamp-2 text-3xl font-semibold text-text-primary">
            {slide.question || "Type your question…"}
          </p>
          <StaticElementView elements={slide.elements.filter((el) => el.containerId === QUESTION_CONTAINER_ID)} />
        </div>
        <div className="grid flex-1 grid-cols-2 grid-rows-2 gap-5">
          {slide.options.map((option, index) => (
            <div
              key={option.id}
              className="relative rounded-button border p-4 pl-14"
              style={{
                borderColor: option.id === slide.correctOptionId ? "var(--accent-green)" : "var(--border-default)",
                background: option.id === slide.correctOptionId ? "rgba(30, 142, 79, 0.06)" : "var(--bg-page)",
              }}
            >
              <span className="absolute left-3 top-3 text-2xl font-semibold text-text-secondary">
                {OPTION_LABELS[index]}
              </span>
              <span className="line-clamp-1 text-2xl text-text-primary">{option.text}</span>
              <StaticElementView elements={slide.elements.filter((el) => el.containerId === option.id)} />
            </div>
          ))}
        </div>
        <StaticElementView elements={slide.elements.filter((el) => el.containerId === null)} />
      </div>
    </div>
  );
}
