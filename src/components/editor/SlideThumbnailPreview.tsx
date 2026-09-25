import { CANVAS_WIDTH, CANVAS_HEIGHT } from "@/lib/constants";
import { SlideStaticView } from "@/components/presentation/SlideStaticView";
import type { Slide } from "@/lib/schema";

const THUMB_WIDTH = 200;
const SCALE = THUMB_WIDTH / CANVAS_WIDTH;

/**
 * Static, non-editable miniature of a slide — used in the slide grid and the Background panel.
 * It's the presentation view scaled down, so the two always look the same.
 */
export function SlideThumbnailPreview({ slide }: { slide: Slide }) {
  return (
    <div
      className="pointer-events-none overflow-hidden rounded-dropdown"
      style={{ width: THUMB_WIDTH, aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}
    >
      <div style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, transform: `scale(${SCALE})`, transformOrigin: "top left" }}>
        <SlideStaticView slide={slide} revealAnswer />
      </div>
    </div>
  );
}
