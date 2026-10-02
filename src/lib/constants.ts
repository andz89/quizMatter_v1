import type { Slide } from "./schema";
import { isEmbedSlide } from "./embed";

export const CANVAS_WIDTH = 1280;
export const CANVAS_HEIGHT = 720;

export const OPTION_LABELS = ["A", "B", "C", "D"] as const;

// Sentinel containerId for elements bound to the question box (option-bound elements use the option's own id).
export const QUESTION_CONTAINER_ID = "question";
// Sentinel containerId for elements bound to the shape box: beside the rows in the "list-side"
// layout, or a strip under the question in the other layouts.
export const SIDE_CONTAINER_ID = "side";
// Sentinel containerId for elements on a slide's answer canvas (short-answer and blank slides): a
// slide-sized area of its own, shown under the slide in the editor and in the answer popup when presenting.
export const ANSWER_CONTAINER_ID = "answer";

// dataTransfer type used to drag an element asset from the Elements panel onto a question/option box.
export const ELEMENT_DRAG_MIME = "application/x-quizbuilder-element";

// Cloudflare Turnstile (the "are you human?" check on the login page). Not secret: the browser needs it. Its secret
// key lives in Supabase (Authentication → Attack Protection). The widget allows quizmatter.com and localhost.
export const TURNSTILE_SITE_KEY = "0x4AAAAAAFMCLNaW53rxyTQZ";

// Where uploaded photos live: the R2 bucket "quizmatter-images", served from its own domain.
export const PHOTO_URL_PREFIX = "https://images.quizmatter.com/uploads/";

/**
 * A small copy (320 px wide) of one of our photos, for previews: Cloudflare makes it from the full file the first
 * time it's asked for (Images → Transformations, turned on for quizmatter.com) and keeps it in its cache. Slides
 * show the full photo. Other addresses are left as they are.
 */
export function thumbnailUrl(src: string) {
  return src.startsWith(PHOTO_URL_PREFIX) ? `https://quizmatter.com/cdn-cgi/image/width=320,quality=75,format=auto/${src}` : src;
}
// Photos are shrunk in the browser so their longest side is at most this (px) — sharp in fullscreen.
export const PHOTO_MAX_SIDE = 1920;
// Biggest photo file (bytes) a teacher can pick or add from a link, before it's shrunk.
export const MAX_PHOTO_FILE_BYTES = 20 * 1024 * 1024;
// Biggest shrunk photo (bytes) the server stores.
export const MAX_STORED_PHOTO_BYTES = 2 * 1024 * 1024;

// dataTransfer type used to drag a photo (as JSON) from the Photos panel's "My photos" list onto a box or the slide.
export const PHOTO_DRAG_MIME = "application/x-quizbuilder-photo";

// dataTransfer type used to drag a slide (as JSON) from the Presentations panel onto the workspace.
export const SLIDE_DRAG_MIME = "application/x-quizbuilder-slide";

// The font size (px) each kind of text shows at when the user hasn't chosen one. It's the largest
// the text gets: too-long text shrinks to fit its box. Text boxes match the question box.
export const QUESTION_FONT_SIZE = 48;
export const OPTION_FONT_SIZE = 56;
export const TEXT_BOX_FONT_SIZE = 48;
// How small text shrinks before going below it only as a last resort (see useAutoFitText).
const AUTO_FIT_MIN_FONT_SIZE = 22;

/**
 * The auto-fit limits for a text of this size: it's the largest the text gets, and the smallest
 * drops along with a small size, so picking 16 shrinks from 16 instead of jumping to 22.
 */
export function autoFitRange(fontSize: number) {
  return { minFontSize: Math.min(AUTO_FIT_MIN_FONT_SIZE, fontSize), maxFontSize: fontSize };
}

// Lowest opacity (percent) an element can be set to, so it never fully disappears.
export const OPACITY_MIN = 5;
// Most rounding for a square/rectangle's corners, in percent of its shorter side (50 = fully round ends).
export const CORNER_RADIUS_MAX = 50;

// The question box and each option card are fixed-size within the fixed CANVAS_WIDTH/HEIGHT layout
// (p-10 canvas padding, gap-6 between the question, the optional shape strip and the options — or,
// in grid/list without a strip, the "add shape box" row in place of that gap — gap-x-24 / gap-y-5
// within the 2x2 options grid (the wider column gap fits the right-hand options' grip + ✓/A column) or gap-3 between the 4 rows of the list; list-side puts the rows and
// the side box in two gap-5 columns) — these mirror that layout so container-bound elements can be
// positioned relative to their own box.
const CARD_PADDING = 40;
const SECTION_GAP = 24;
const GRID_COLUMN_GAP = 96;
const GRID_ROW_GAP = 20;
const LIST_GAP = 12;
const CONTENT_HEIGHT = CANVAS_HEIGHT - CARD_PADDING * 2;

export type SlideLayout = Slide["layout"];
// The parts of a slide that decide how big each box is.
export type BoxLayout = Pick<Slide, "questionHeight" | "layout" | "hasShapeBox" | "type" | "shapeStripHeight" | "questionBox">;

// Tailwind classes for the options area in each layout (the canvas, thumbnails and presentation
// all use these, so they can't drift apart). list-side puts this area and the side box in a row.
const OPTIONS_GRID_CLASSES: Record<SlideLayout, string> = {
  grid: "grid-cols-2 grid-rows-2 gap-x-24 gap-y-5",
  list: "grid-rows-4 gap-3",
  "list-side": "grid-rows-4 gap-3",
};
// True-or-false slides have 2 cards: side by side in the grid, 2 rows in the lists.
const TRUE_FALSE_GRID_CLASSES: Record<SlideLayout, string> = {
  grid: "grid-cols-2 grid-rows-1 gap-x-24",
  list: "grid-rows-2 gap-3",
  "list-side": "grid-rows-2 gap-3",
};

export function getOptionsGridClasses(box: Pick<Slide, "type" | "layout">): string {
  return (box.type === "true-false" ? TRUE_FALSE_GRID_CLASSES : OPTIONS_GRID_CLASSES)[box.layout];
}

export const QUESTION_CONTAINER_WIDTH = CANVAS_WIDTH - CARD_PADDING * 2;

export const DEFAULT_QUESTION_HEIGHT = 160;
export const MIN_QUESTION_HEIGHT = 56;

// The options area is indented from the left (Tailwind pl-13 on OPTIONS_AREA_CLASSES) so each
// option's grip + ✓/A label, which sit outside the card, fit inside the slide.
const OPTIONS_INDENT = 52;
// The question box starts this much further right, so its number sits beside it (lined up
// with the option letters below), not in it.
export const QUESTION_NUMBER_INDENT = OPTIONS_INDENT;
// The question box's width, with its number beside it.
export const QUESTION_WIDTH = QUESTION_CONTAINER_WIDTH - QUESTION_NUMBER_INDENT;
// Short-answer slides: the teacher can move and resize the question box. Until then it sits in its
// usual spot, inside the slide padding and beside the question number (which always stays there).
export const DEFAULT_QUESTION_BOX = { x: CARD_PADDING + QUESTION_NUMBER_INDENT, y: CARD_PADDING, width: QUESTION_WIDTH };
export const MIN_QUESTION_WIDTH = 200;

/** A short-answer slide's question box spot and width, in slide px (its height is `questionHeight`). */
export function getQuestionBox(box: Pick<Slide, "questionBox">) {
  return box.questionBox ?? DEFAULT_QUESTION_BOX;
}
// Gap between the rows and the side box in the list-side layout (Tailwind gap-5).
const SIDE_BOX_GAP = 20;
const OPTIONS_WIDTH = QUESTION_CONTAINER_WIDTH - OPTIONS_INDENT;
// One grid column, and one half of the list-side layout (rows | side box).
const GRID_OPTION_WIDTH = (OPTIONS_WIDTH - GRID_COLUMN_GAP) / 2;
const LIST_SIDE_HALF_WIDTH = (OPTIONS_WIDTH - SIDE_BOX_GAP) / 2;

// The row holding the options (and the list-side box). Used by the canvas, thumbnails and presentation.
export const OPTIONS_AREA_CLASSES = "flex min-h-0 flex-1 gap-5 pl-13";
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
 * Slide numbers for the whole presentation, by slide id. Question slides and blank slides are counted
 * separately: Slide 1, Q1, Q2, Slide 2, Q3. A custom slide gets its first number and uses up one per
 * item, so after Q10 a 5-item custom slide is 11 (shown as 11–15) and the next question is 16.
 */
export function getSlideNumbers(slides: Slide[]): Map<string, number> {
  const numbers = new Map<string, number>();
  let questions = 0;
  let blanks = 0;
  slides.forEach((slide) => {
    if (isDiscussionSlide(slide)) {
      numbers.set(slide.id, ++blanks);
    } else {
      numbers.set(slide.id, questions + 1);
      questions += getItemCount(slide);
    }
  });
  return numbers;
}

/** How many question numbers the slide takes: its item count on custom slides, 1 on the others. */
export function getItemCount(slide: Pick<Slide, "type" | "itemCount">): number {
  return slide.type === "custom" ? (slide.itemCount ?? 1) : 1;
}

/** Blank, title and custom slides: a free canvas with no question or option boxes, where elements go anywhere. */
export function isFreeCanvas(slide: Pick<Slide, "type">): boolean {
  return slide.type === "blank" || slide.type === "title" || slide.type === "custom";
}

/** Blank and title slides hold a "Reveal" (hint, activity, example); question slides hold an "Answer". */
export function hasReveal(slide: Pick<Slide, "type">): boolean {
  return slide.type === "blank" || slide.type === "title";
}

/** Multiple choice and true-or-false slides: the teacher marks one of the option cards as right. */
export function hasOptions(slide: Pick<Slide, "type">): boolean {
  const type = slide.type ?? "choice";
  return type === "choice" || type === "true-false";
}

/** The option cards the slide shows: true-or-false slides use only the first 2 of the 4 (the rest stay empty). */
export function getShownOptions<O>(slide: { type?: Slide["type"]; options: readonly O[] }): readonly O[] {
  return slide.type === "true-false" ? slide.options.slice(0, 2) : slide.options;
}

/** Blank, title and embed slides: named "Slide 1", "Slide 2"… instead of numbered like questions. */
export function isDiscussionSlide(slide: Pick<Slide, "type">): boolean {
  return hasReveal(slide) || isEmbedSlide(slide);
}

/** Short-answer and free-canvas slides can have an answer (text, or a canvas of elements); choice slides mark an option instead. */
export function canHaveAnswer(slide: Pick<Slide, "type">): boolean {
  return slide.type === "short-answer" || isFreeCanvas(slide);
}

/** Whether the slide's chosen kind of answer has anything in it. */
export function hasAnswerContent(slide: Pick<Slide, "answerType" | "correctAnswer" | "elements">): boolean {
  return slide.answerType === "canvas"
    ? slide.elements.some((el) => el.containerId === ANSWER_CONTAINER_ID)
    : !!slide.correctAnswer?.trim();
}

/** Grid and list show the shape box as a strip under the question, once the slide has one. */
export function hasShapeStrip(box: Omit<BoxLayout, "questionHeight">): boolean {
  return box.type !== "short-answer" && box.layout !== "list-side" && !!box.hasShapeBox;
}

/** Whether the slide shows the shape box at all (beside the rows, or as a strip). Short-answer slides have none. */
export function hasShapeBox(box: Omit<BoxLayout, "questionHeight">): boolean {
  return box.type !== "short-answer" && (box.layout === "list-side" || !!box.hasShapeBox);
}

/**
 * Short-answer slides used to keep their pictures in a shape box under the question. Returns the
 * slide's elements with those pictures moved onto the slide itself, in the same spot: past the slide
 * padding, the question, the gap and the box padding. (Typed by its fields, not Slide, because the
 * slide schema uses it.)
 */
export function moveShortAnswerPicturesToSlide<E extends { containerId: string | null; x: number; y: number }>(slide: {
  type?: string;
  questionHeight: number;
  elements: E[];
}): E[] {
  if (slide.type !== "short-answer") return slide.elements;
  const dx = CARD_PADDING + SIDE_PADDING;
  const dy = CARD_PADDING + slide.questionHeight + SECTION_GAP + SIDE_PADDING;
  return slide.elements.map((el) =>
    el.containerId === SIDE_CONTAINER_ID ? { ...el, containerId: null, x: el.x + dx, y: el.y + dy } : el
  );
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
  if (containerId === null || containerId === ANSWER_CONTAINER_ID) return { width: CANVAS_WIDTH, height: CANVAS_HEIGHT };
  if (containerId === QUESTION_CONTAINER_ID) {
    const width = box.type === "short-answer" ? getQuestionBox(box).width : QUESTION_WIDTH;
    return { width, height: box.questionHeight };
  }
  if (containerId === SIDE_CONTAINER_ID) {
    if (box.type === "short-answer") {
      // Short-answer slides have no shape box. This is the room under the question where the old box
      // was (after the gap-6, minus its inset-4 padding) — Claude's "side" pictures are placed in it.
      const height = CONTENT_HEIGHT - box.questionHeight - SECTION_GAP;
      return { width: QUESTION_CONTAINER_WIDTH - SIDE_PADDING * 2, height: height - SIDE_PADDING * 2 };
    }
    return box.layout === "list-side"
      ? { width: LIST_SIDE_HALF_WIDTH - SIDE_PADDING * 2, height: getOptionsAreaHeight(box) - SIDE_PADDING * 2 }
      : { width: QUESTION_CONTAINER_WIDTH, height: getShapeStripHeight(box) }; // the strip has no inner padding
  }
  const optionsHeight = getOptionsAreaHeight(box);
  // True-or-false slides have 1 grid row or 2 list rows instead of 2 and 4.
  const gridRows = box.type === "true-false" ? 1 : 2;
  const listRows = gridRows * 2;
  return {
    width: box.layout === "list" ? OPTIONS_WIDTH : box.layout === "grid" ? GRID_OPTION_WIDTH : LIST_SIDE_HALF_WIDTH,
    height:
      box.layout === "grid"
        ? (optionsHeight - GRID_ROW_GAP * (gridRows - 1)) / gridRows
        : (optionsHeight - LIST_GAP * (listRows - 1)) / listRows,
  };
}

/**
 * How long a fullscreen slide effect (Fade, Slide, Zoom) takes, in seconds, for each speed the teacher can pick in
 * the Effects panel: 1 (slowest) to 5 (fastest). 3 is the default.
 */
export const SLIDE_EFFECT_SECONDS: Record<number, number> = { 1: 1.6, 2: 1.3, 3: 1, 4: 0.7, 5: 0.45 };
// "Fade" has its own, faster times: it goes through the dark screen (out, then in), so the same time felt slow.
export const SLIDE_FADE_SECONDS: Record<number, number> = { 1: 1, 2: 0.8, 3: 0.6, 4: 0.45, 5: 0.3 };
