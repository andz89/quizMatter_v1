import type { Slide } from "./schema";

export const CANVAS_WIDTH = 1280;
export const CANVAS_HEIGHT = 720;

export const OPTION_LABELS = ["A", "B", "C", "D"] as const;

// Sentinel containerId for elements bound to the question box (option-bound elements use the option's own id).
export const QUESTION_CONTAINER_ID = "question";
// Sentinel containerId for elements bound to the shape box: beside the rows in the "list-side"
// layout, or a strip under the question in the other layouts.
export const SIDE_CONTAINER_ID = "side";

// dataTransfer type used to drag an element asset from the Elements panel onto a question/option box.
export const ELEMENT_DRAG_MIME = "application/x-quizbuilder-element";

// dataTransfer type used to drag a slide (as JSON) from the Lessons panel onto the workspace.
export const SLIDE_DRAG_MIME = "application/x-quizbuilder-slide";

// Each kind of text shrinks between these font sizes (px) to fit its box. `max` is the size it shows
// at when the user hasn't chosen one; text boxes match the question box.
export const QUESTION_FONT_SIZE = { min: 22, max: 40 };
export const OPTION_FONT_SIZE = { min: 22, max: 44 };
export const TEXT_BOX_FONT_SIZE = { min: 22, max: 40 };

/**
 * The auto-fit limits for a text: the size the user chose (if any) is the largest it gets, and the
 * smallest drops along with a small choice, so picking 16 shrinks from 16 instead of jumping to 22.
 */
export function autoFitRange(defaults: { min: number; max: number }, chosen?: number) {
  const maxFontSize = chosen ?? defaults.max;
  return { minFontSize: Math.min(defaults.min, maxFontSize), maxFontSize };
}

// Lowest opacity (percent) an element can be set to, so it never fully disappears.
export const OPACITY_MIN = 5;

// The question box and each option card are fixed-size within the fixed CANVAS_WIDTH/HEIGHT layout
// (p-10 canvas padding, gap-6 between the question, the optional shape strip and the options — or,
// in grid/list without a strip, the "add shape box" row in place of that gap — gap-x-15 / gap-y-5
// within the 2x2 options grid (the wider column gap fits the right-hand options' ✓/A + tools column) or gap-3 between the 4 rows of the list; list-side puts the rows and
// the side box in two gap-5 columns) — these mirror that layout so container-bound elements can be
// positioned relative to their own box.
const CARD_PADDING = 40;
const SECTION_GAP = 24;
const GRID_COLUMN_GAP = 60;
const GRID_ROW_GAP = 20;
const LIST_GAP = 12;
const CONTENT_HEIGHT = CANVAS_HEIGHT - CARD_PADDING * 2;

export type SlideLayout = Slide["layout"];
// The parts of a slide that decide how big each box is.
export type BoxLayout = Pick<Slide, "questionHeight" | "layout" | "hasShapeBox" | "type" | "shapeStripHeight">;

// Tailwind classes for the options area in each layout (the canvas, thumbnails and presentation
// all use these, so they can't drift apart). list-side puts this area and the side box in a row.
export const OPTIONS_GRID_CLASSES: Record<SlideLayout, string> = {
  grid: "grid-cols-2 grid-rows-2 gap-x-15 gap-y-5",
  list: "grid-rows-4 gap-3",
  "list-side": "grid-rows-4 gap-3",
};

export const QUESTION_CONTAINER_WIDTH = CANVAS_WIDTH - CARD_PADDING * 2;

export const DEFAULT_QUESTION_HEIGHT = 160;
export const MIN_QUESTION_HEIGHT = 56;

// The options area is indented from the left (Tailwind pl-5 on OPTIONS_AREA_CLASSES) so each
// option's ✓/A column, which sits outside the card, doesn't touch the slide's edge.
const OPTIONS_INDENT = 20;
// Gap between the rows and the side box in the list-side layout (Tailwind gap-5).
const SIDE_BOX_GAP = 20;
const OPTIONS_WIDTH = QUESTION_CONTAINER_WIDTH - OPTIONS_INDENT;
// One grid column, and one half of the list-side layout (rows | side box).
const GRID_OPTION_WIDTH = (OPTIONS_WIDTH - GRID_COLUMN_GAP) / 2;
const LIST_SIDE_HALF_WIDTH = (OPTIONS_WIDTH - SIDE_BOX_GAP) / 2;

// The row holding the options (and the list-side box). Used by the canvas, thumbnails and presentation.
export const OPTIONS_AREA_CLASSES = "flex min-h-0 flex-1 gap-5 pl-5";
// Height of the shape box when it sits as a strip between the question and the options. The teacher
// can drag it taller or shorter, like the question box; slides without their own height use the default.
export const DEFAULT_SHAPE_STRIP_HEIGHT = 120;
export const MIN_SHAPE_STRIP_HEIGHT = 80;
// 10px gap above and below the strip.
const SHAPE_STRIP_GAPS = 20;
// With a strip, the question box and the strip share the room above the options. Neither may grow
// so far that the options area gets smaller than this, so every option box stays at least ~70px tall.
const MIN_OPTIONS_HEIGHT_WITH_STRIP: Record<SlideLayout, number> = { grid: 160, list: 316, "list-side": 0 };
// Inner padding of the list-side shape box (Tailwind inset-4), so its elements never touch its border.
const SIDE_PADDING = 16;

// Height of the "add shape box" row (line + plus button) that sits between the question and the
// options of a grid/list slide with no strip. It replaces the gap there instead of adding to it.
export const ADD_SHAPE_BOX_ROW_HEIGHT = 32;

/**
 * Slide numbers for the whole quiz, by slide id. Question slides and blank slides are counted
 * separately: Slide 1, Q1, Q2, Slide 2, Q3.
 */
export function getSlideNumbers(slides: Slide[]): Map<string, number> {
  const numbers = new Map<string, number>();
  let questions = 0;
  let blanks = 0;
  slides.forEach((slide) => numbers.set(slide.id, slide.type === "lesson" ? ++blanks : ++questions));
  return numbers;
}

/** Grid and list show the shape box as a strip under the question, once the slide has one. */
export function hasShapeStrip(box: Omit<BoxLayout, "questionHeight">): boolean {
  return box.type !== "short-answer" && box.layout !== "list-side" && !!box.hasShapeBox;
}

/** Whether the slide shows the shape box at all (beside the rows, as a strip, or on a short-answer slide). */
export function hasShapeBox(box: Omit<BoxLayout, "questionHeight">): boolean {
  return box.type === "short-answer" || box.layout === "list-side" || !!box.hasShapeBox;
}

export function getShapeStripHeight(box: Pick<BoxLayout, "shapeStripHeight">): number {
  return box.shapeStripHeight ?? DEFAULT_SHAPE_STRIP_HEIGHT;
}

// The list layouts and the shape strip take room from the options, so the question box can't grow
// as tall — these keep every option box at least ~70px tall.
export function getMaxQuestionHeight(box: Omit<BoxLayout, "questionHeight">): number {
  if (box.type === "short-answer") return 280;
  if (hasShapeStrip(box)) {
    // A taller strip leaves less room for the question box.
    const room = CONTENT_HEIGHT - getShapeStripHeight(box) - SHAPE_STRIP_GAPS - MIN_OPTIONS_HEIGHT_WITH_STRIP[box.layout];
    return Math.min(box.layout === "grid" ? 280 : 160, room);
  }
  return box.layout === "grid" ? 400 : 280;
}

/** The strip can grow into whatever room the question box and the options don't need. */
export function getMaxShapeStripHeight(box: BoxLayout): number {
  return CONTENT_HEIGHT - box.questionHeight - SHAPE_STRIP_GAPS - MIN_OPTIONS_HEIGHT_WITH_STRIP[box.layout];
}

/** The options (and the side box) take whatever vertical space the question box and strip don't use. */
// Short-answer slides hide their options but keep them, so this ignores the slide type.
function getOptionsAreaHeight(box: BoxLayout): number {
  const available = CONTENT_HEIGHT - box.questionHeight;
  if (box.layout === "list-side") return available - SECTION_GAP;
  if (box.hasShapeBox) return available - getShapeStripHeight(box) - SHAPE_STRIP_GAPS;
  return available - ADD_SHAPE_BOX_ROW_HEIGHT;
}

/** The coordinate space an element's x/y/width/height are relative to. */
export function getContainerBounds(containerId: string | null, box: BoxLayout): { width: number; height: number } {
  if (containerId === null) return { width: CANVAS_WIDTH, height: CANVAS_HEIGHT };
  if (containerId === QUESTION_CONTAINER_ID) return { width: QUESTION_CONTAINER_WIDTH, height: box.questionHeight };
  if (containerId === SIDE_CONTAINER_ID) {
    if (box.type === "short-answer") {
      // Everything under the question (after the gap-6), minus the inset-4 padding.
      const height = CONTENT_HEIGHT - box.questionHeight - SECTION_GAP;
      return { width: QUESTION_CONTAINER_WIDTH - SIDE_PADDING * 2, height: height - SIDE_PADDING * 2 };
    }
    return box.layout === "list-side"
      ? { width: LIST_SIDE_HALF_WIDTH - SIDE_PADDING * 2, height: getOptionsAreaHeight(box) - SIDE_PADDING * 2 }
      : { width: QUESTION_CONTAINER_WIDTH, height: getShapeStripHeight(box) }; // the strip has no inner padding
  }
  const optionsHeight = getOptionsAreaHeight(box);
  return {
    width: box.layout === "list" ? OPTIONS_WIDTH : box.layout === "grid" ? GRID_OPTION_WIDTH : LIST_SIDE_HALF_WIDTH,
    height: box.layout === "grid" ? (optionsHeight - GRID_ROW_GAP) / 2 : (optionsHeight - LIST_GAP * 3) / 4,
  };
}
