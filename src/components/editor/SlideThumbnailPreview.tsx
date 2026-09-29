import { CANVAS_WIDTH, CANVAS_HEIGHT } from "@/lib/constants";
import { SlideStaticView } from "@/components/presentation/SlideStaticView";
import type { Slide } from "@/lib/schema";

const THUMB_WIDTH = 200;
const SCALE = THUMB_WIDTH / CANVAS_WIDTH;

/**
 * Static, non-editable miniature of a slide — used in the slide grid and the Background panel.
 * It's the presentation view scaled down, so the two always look the same.
 * The present screen turns revealAnswer off so students don't see the answers.
 */
export function SlideThumbnailPreview({
  slide,
  questionNumber,
  revealAnswer = true,
}: {
  slide: Slide;
  questionNumber?: number;
  revealAnswer?: boolean;
}) {
  return (
    <div
      // Reset text alignment and color, so a parent (e.g. a <button>, which centers text) can't change the slide.
      className="pointer-events-none overflow-hidden rounded-dropdown text-left text-text-primary"
      style={{ width: THUMB_WIDTH, aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}
    >
      <div style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, transform: `scale(${SCALE})`, transformOrigin: "top left" }}>
        <SlideStaticView slide={slide} questionNumber={questionNumber} revealAnswer={revealAnswer} />
      </div>
    </div>
  );
}
