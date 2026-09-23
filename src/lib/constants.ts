export const CANVAS_WIDTH = 1280;
export const CANVAS_HEIGHT = 720;

export const OPTION_LABELS = ["A", "B", "C", "D"] as const;

// Sentinel containerId for elements bound to the question box (option-bound elements use the option's own id).
export const QUESTION_CONTAINER_ID = "question";

// dataTransfer type used to drag an element asset from the Elements panel onto a question/option box.
export const ELEMENT_DRAG_MIME = "application/x-quizbuilder-element";

// The question box and each option card are fixed-size within the fixed CANVAS_WIDTH/HEIGHT layout
// (p-10 canvas padding, gap-6 between question and options, gap-5 within the 2x2 options grid) —
// these mirror that layout so container-bound elements can be positioned relative to their own box.
const CARD_PADDING = 40;
const SECTION_GAP = 24;
const GRID_GAP = 20;
const CONTENT_HEIGHT = CANVAS_HEIGHT - CARD_PADDING * 2;

export const QUESTION_CONTAINER_WIDTH = CANVAS_WIDTH - CARD_PADDING * 2;
export const OPTION_CONTAINER_WIDTH = (QUESTION_CONTAINER_WIDTH - GRID_GAP) / 2;

export const DEFAULT_QUESTION_HEIGHT = 160;
export const MIN_QUESTION_HEIGHT = 56;
export const MAX_QUESTION_HEIGHT = 400;

/** The options grid takes whatever vertical space the question box doesn't use. */
export function getOptionContainerHeight(questionHeight: number): number {
  const optionsGridHeight = CONTENT_HEIGHT - questionHeight - SECTION_GAP;
  return (optionsGridHeight - GRID_GAP) / 2;
}

/** The coordinate space an element's x/y/width/height are relative to. */
export function getContainerBounds(
  containerId: string | null,
  questionHeight: number
): { width: number; height: number } {
  if (containerId === null) return { width: CANVAS_WIDTH, height: CANVAS_HEIGHT };
  if (containerId === QUESTION_CONTAINER_ID) return { width: QUESTION_CONTAINER_WIDTH, height: questionHeight };
  return { width: OPTION_CONTAINER_WIDTH, height: getOptionContainerHeight(questionHeight) };
}
