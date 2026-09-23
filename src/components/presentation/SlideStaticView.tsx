import { CANVAS_WIDTH, CANVAS_HEIGHT, OPTION_LABELS, QUESTION_CONTAINER_ID } from "@/lib/constants";
import type { Slide } from "@/lib/schema";
import { FitText } from "@/components/editor/FitText";
import { StaticElementView } from "@/components/editor/StaticElementView";

interface SlideStaticViewProps {
  slide: Slide;
}

/** Read-only, full-size rendering of a slide — used in presentation mode. */
export function SlideStaticView({ slide }: SlideStaticViewProps) {
  return (
    <div
      className="relative flex select-none flex-col gap-6 overflow-hidden rounded-card border border-border-default bg-bg-surface p-10"
      style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
    >
      <div
        className="relative shrink-0 rounded-button border border-border-default p-4"
        style={{ height: slide.questionHeight }}
      >
        <FitText
          text={slide.question || "Untitled question"}
          html={slide.questionHtml}
          minFontSize={22}
          maxFontSize={40}
          className="font-semibold text-text-primary"
        />
        <StaticElementView elements={slide.elements.filter((el) => el.containerId === QUESTION_CONTAINER_ID)} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-5">
        {slide.options.map((option, index) => (
          <div
            key={option.id}
            className="relative rounded-button border p-6 pl-16"
            style={{ borderColor: "var(--border-default)", background: "var(--bg-page)" }}
          >
            <span
              className="absolute left-3 top-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold"
              style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
            >
              {OPTION_LABELS[index]}
            </span>
            <div className="h-full w-full">
              <FitText text={option.text} html={option.html} minFontSize={22} maxFontSize={44} className="text-text-primary" />
            </div>
            <StaticElementView elements={slide.elements.filter((el) => el.containerId === option.id)} />
          </div>
        ))}
      </div>
      <StaticElementView elements={slide.elements.filter((el) => el.containerId === null)} />
    </div>
  );
}
