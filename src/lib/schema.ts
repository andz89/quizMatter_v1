import { z } from "zod";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  MIN_QUESTION_HEIGHT,
  MIN_QUESTION_WIDTH,
  PHOTO_MAX_SIDE,
  PHOTO_URL_PREFIX,
  moveShortAnswerPicturesToSlide,
} from "./constants";
import { EMBED_SLIDE_TYPES, MAX_EMBED_URL_LENGTH, isEmbedSlide, readEmbedLink, type EmbedKind } from "./embed";

// The font sizes (px) a user can choose for a text. The chosen size is the largest the text gets;
// it still shrinks to fit its box when it's too long.
export const FONT_SIZE_RANGE = { min: 12, max: 96 };
const fontSizeSchema = z.number().int().min(FONT_SIZE_RANGE.min).max(FONT_SIZE_RANGE.max);

export const optionSchema = z.object({
  id: z.string(),
  text: z.string(),
  // Styled version of `text` (bold, color…), as HTML from the text editor. Missing on older presentations.
  html: z.string().optional(),
  // Chosen font size. Missing = OPTION_FONT_SIZE.
  fontSize: fontSizeSchema.optional(),
});

// A photo in our own storage (only there — see PHOTO_URL_PREFIX), with its real size in px to keep its shape.
// Used by photo elements and by the teacher's "My photos" list (the photos table).
export const photoSchema = z.object({
  src: z.string().max(300).startsWith(PHOTO_URL_PREFIX),
  width: z.number().int().positive().max(PHOTO_MAX_SIDE),
  height: z.number().int().positive().max(PHOTO_MAX_SIDE),
});

export const svgElementSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  color: z.string(),
  // null = freely placed on the canvas; "question" or an option's id = bound to that
  // container, positioned relative to it, and moves with it (e.g. on option reorder).
  containerId: z.string().nullable(),
  // Elements sharing a groupId are one group: a click selects them all. Members are always in the
  // same container. Missing = not grouped.
  groupId: z.string().optional(),
  // Only used by solid (3D) shapes: tilt (x) and turn (y) in degrees. Missing = the default angle.
  rotation3d: z.object({ x: z.number(), y: z.number() }).optional(),
  // Flat (2D) spin in degrees around the element's center. Missing = 0. Not used by solids.
  rotation: z.number().optional(),
  // How see-through the element is, in percent (OPACITY_MIN–100). Missing = 100 (solid).
  opacity: z.number().optional(),
  // Only used by the square and rectangle: how round their corners are, in percent of the shorter
  // side (0–50; 50 = fully round ends). Missing = 0 (sharp corners).
  cornerRadius: z.number().min(0).max(50).optional(),
  // Only used by the clocks: the time they show (hours 1–12, minutes 0–59). Missing = 10:10.
  // `pm` is only shown by the digital clock; missing = AM.
  clockTime: z.object({ hours: z.number(), minutes: z.number(), pm: z.boolean().optional() }).optional(),
  // Only used by number lines: first number, how much each tick counts up by, and which tick
  // positions show an empty box instead of a number. Centered (integer) lines ignore `start`.
  // Missing = start 0, step 1, nothing hidden.
  numberLine: z.object({ start: z.number(), step: z.number(), hidden: z.array(z.number()) }).optional(),
  // Only used by fraction bars/circles: equal parts and how many are shaded. Missing = 4 parts, 1 shaded.
  fraction: z.object({ parts: z.number(), shaded: z.number() }).optional(),
  // Only used by the counting frame: how many dots, and the grid size (missing rows/columns = 2×5).
  // Missing = 5 dots on a 2×5 grid.
  tenFrame: z.object({ count: z.number(), rows: z.number().optional(), columns: z.number().optional() }).optional(),
  // Only used by base-ten blocks: how many flats (100), rods (10) and cubes (1), 0–9 each.
  baseTen: z.object({ hundreds: z.number(), tens: z.number(), ones: z.number() }).optional(),
  // Only used by the thermometer: the temperature shown, in °C (-20 to 50).
  thermometer: z.object({ value: z.number() }).optional(),
  // Only used by the bar graph: one entry per bar, left to right; values are 0–10.
  barGraph: z.object({ bars: z.array(z.object({ label: z.string(), value: z.number() })) }).optional(),
  // Only used by the protractor: the angle between its two lines, 0–180°.
  protractor: z.object({ angle: z.number() }).optional(),
  // Only used by the text box: its styled text, as HTML from the text editor (empty string = no
  // text), and its chosen font size (missing = TEXT_BOX_FONT_SIZE).
  text: z.object({ html: z.string(), fontSize: fontSizeSchema.optional() }).optional(),
  // Only used by custom drawings (assetId CUSTOM_SVG_ID, e.g. drawn by Claude): the SVG markup. Shown
  // as an image, so nothing inside it can run.
  svg: z.string().optional(),
  // Only used by photos (assetId PHOTO_ID) a teacher uploaded or added from a link: the copy in our own
  // storage, and the photo's real size (to keep its shape). Only our own storage is allowed.
  image: photoSchema.optional(),
  // Mirrored left to right (flipX) or top to bottom (flipY). Only the picture is mirrored, not the box.
  // Missing = not flipped. Text boxes are never flipped.
  flipX: z.boolean().optional(),
  flipY: z.boolean().optional(),
  // Which part of the picture shows, as parts (0–1) of the whole picture: x/y = where the shown part
  // starts, width/height = how much of it shows. The rest is only hidden, so it can be shown again.
  // The element's box (x, y, width, height above) is the shown part. Missing = the whole picture.
  crop: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      width: z.number().positive().max(1),
      height: z.number().positive().max(1),
    })
    .optional(),
});

// Longest typed answer (short-answer, blank and custom slides), in the editor and from Claude.
export const MAX_ANSWER_LENGTH = 300;

// Most items one custom question slide can hold (e.g. 5 items = Q11–15).
export const MAX_ITEM_COUNT = 50;

/** What the teacher pasted into an embed slide's box, turned into the link the slide keeps (or a message why it can't be used). */
export function embedLinkSchema(kind: EmbedKind) {
  return z
    .string()
    .max(MAX_EMBED_URL_LENGTH, "This link is too long.")
    .transform((pasted, ctx) => {
      const result = readEmbedLink(kind, pasted);
      if ("error" in result) {
        ctx.addIssue({ code: "custom", message: result.error });
        return z.NEVER;
      }
      return result.src;
    });
}

export const slideSchema = z.object({
  id: z.string(),
  // choice = 4 options to pick from; true-false = 2 options ("True" and "False", editable), kept in the
  // first 2 option slots (the other 2 stay empty and hidden); short-answer = no options, the teacher types the correct answer;
  // blank = a blank slide for teaching (free-placed elements only, no question, no number).
  // custom = a question slide the teacher builds on a free canvas, numbered like questions (see itemCount).
  // title = a blank slide that starts with a title and a description text box (still a free canvas).
  // video / embed-slides / image = a video, a slide deck (Google Slides, Canva) or a picture from
  // another site, filling the slide (no elements, no answer).
  // Missing = "choice" (older presentations). "lesson" is blank's old name: a browser tab opened before
  // the rename can still send it.
  type: z.preprocess(
    (type) => (type === "lesson" ? "blank" : type),
    z.enum(["choice", "true-false", "short-answer", "custom", "blank", "title", ...EMBED_SLIDE_TYPES]).optional()
  ),
  // Embed slides only: the link they show (already turned into the viewer or picture address, and
  // checked against the slide's kind below). Missing = nothing added yet.
  embedUrl: z.string().max(MAX_EMBED_URL_LENGTH).optional(),
  // Custom slides only: how many question items the slide holds, so it takes that many numbers
  // (5 items after Q10 = Q11–15). Missing = 1.
  itemCount: z.number().int().min(1).max(MAX_ITEM_COUNT).optional(),
  // Name the teacher gave the slide. Question slides show it after their number ("Q1 · Fractions");
  // blank slides show it instead of "Slide 1". Missing = no name.
  name: z.string().optional(),
  question: z.string(),
  // Styled version of `question`, as HTML from the text editor. Missing on older presentations.
  questionHtml: z.string().optional(),
  // Chosen font size for the question. Missing = QUESTION_FONT_SIZE.
  questionFontSize: fontSizeSchema.optional(),
  // grid = 2x2 options; list = 4 stacked rows; list-side = 4 rows on the left and a box for
  // elements on the right.
  layout: z.enum(["grid", "list", "list-side"]),
  // Grid/list only: show the shape box as a strip between the question and the options. Turned on
  // when leaving list-side with shapes in its box. Missing = no strip.
  hasShapeBox: z.boolean().optional(),
  // Height of that strip, set by dragging its bottom edge. Missing = DEFAULT_SHAPE_STRIP_HEIGHT.
  shapeStripHeight: z.number().optional(),
  // Shape box fill and border color. Missing = none (a plain box in fullscreen).
  shapeBoxFill: z.string().optional(),
  shapeBoxBorder: z.string().optional(),
  // The slide's background color, behind everything. Missing = the plain white surface.
  background: z.string().optional(),
  // Full-slide artwork (SVG markup) drawn over the background color, behind everything else. Shown
  // as an image, so nothing inside it can run. Missing = none.
  backgroundSvg: z.string().optional(),
  // Which library pattern `backgroundSvg` was drawn from (e.g. "background-dots"), so it can be
  // redrawn when the color changes. Missing = no pattern (the artwork, if any, is Claude's own).
  backgroundPattern: z.string().optional(),
  // How solid that pattern is, in percent. Missing = DEFAULT_PATTERN_OPACITY.
  backgroundOpacity: z.number().optional(),
  options: z.tuple([optionSchema, optionSchema, optionSchema, optionSchema]),
  correctOptionId: z.string().nullable(),
  // Short-answer, custom and blank slides only: the answer the teacher expects. (Their options stay empty and aren't shown.)
  correctAnswer: z.string().optional(),
  // Short-answer, custom and blank slides only: which answer is shown — the typed `correctAnswer`, or a canvas
  // of elements (those with containerId ANSWER_CONTAINER_ID). Both are kept, so switching loses nothing.
  // Missing = "text".
  answerType: z.enum(["text", "canvas"]).optional(),
  elements: z.array(svgElementSchema),
  questionHeight: z.number(),
  // Short-answer slides only: where the teacher moved the question box, and how wide they made it,
  // in slide px (its height is `questionHeight`). It always stays inside the slide. Missing =
  // DEFAULT_QUESTION_BOX.
  questionBox: z
    .object({
      x: z.number().min(0).max(CANVAS_WIDTH - MIN_QUESTION_WIDTH),
      y: z.number().min(0).max(CANVAS_HEIGHT - MIN_QUESTION_HEIGHT),
      width: z.number().min(MIN_QUESTION_WIDTH).max(CANVAS_WIDTH),
    })
    .optional(),
})
  .refine(
    (slide) => !slide.embedUrl || (isEmbedSlide(slide) && !("error" in readEmbedLink(slide.type, slide.embedUrl))),
    { message: "This slide's link can't be shown.", path: ["embedUrl"] }
  )
  .refine(
    (slide) =>
      slide.type !== "true-false" || !slide.correctOptionId || slide.options.slice(0, 2).some((o) => o.id === slide.correctOptionId),
    { message: "A true-or-false answer must be True or False.", path: ["correctOptionId"] }
  )
  // Older short-answer slides kept their pictures in a shape box; they now sit on the slide itself.
  .transform((slide) => ({ ...slide, elements: moveShortAnswerPicturesToSlide(slide) }));

// The grade a presentation is for ("" = not chosen).
export const GRADES = [
  "Kindergarten",
  "Grade 1",
  "Grade 2",
  "Grade 3",
  "Grade 4",
  "Grade 5",
  "Grade 6",
  "Grade 7",
  "Grade 8",
  "Grade 9",
  "Grade 10",
  "Grade 11",
  "Grade 12",
  "N/A",
] as const;

// Longest text each presentation detail may have. The zod schema below checks them before saving; the
// Details panel's inputs use them too, so users can't type past them.
export const DETAIL_MAX_LENGTH = {
  title: 120,
  description: 1000,
  subject: 80,
  curriculum: 80,
  learningCompetency: 1000,
  author: 120,
};

const webLinkSchema = z.url({ protocol: /^https?$/ });

/** Whether a reference is a web link (shown as a clickable link), not a book or module name. */
export function isWebLink(reference: string): boolean {
  return webLinkSchema.safeParse(reference).success;
}

// A reference: the name of a book or module, or a link. Anything with "://" must be a full http(s)
// link, so broken links and other kinds (ftp://…) are refused. Plain text is only ever shown as text.
export const referenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((reference) => !reference.includes("://") || isWebLink(reference), "A link must start with http:// or https://");
export const MAX_REFERENCE_LINKS = 20;

export const presentationSchema = z.object({
  id: z.string(),
  title: z.string().max(DETAIL_MAX_LENGTH.title),
  // Presentation details, all optional ("" when not filled in).
  description: z.string().max(DETAIL_MAX_LENGTH.description),
  grade: z.union([z.enum(GRADES), z.literal("")]),
  subject: z.string().max(DETAIL_MAX_LENGTH.subject),
  curriculum: z.string().max(DETAIL_MAX_LENGTH.curriculum),
  learningCompetency: z.string().max(DETAIL_MAX_LENGTH.learningCompetency),
  // Who wrote the content: the teacher, a book, another teacher… Not who published it — that's the
  // presentation's owner (the logged-in user who saved it).
  author: z.string().max(DETAIL_MAX_LENGTH.author),
  // What the presentation is based on (links, or book / module names), as many as the user adds.
  referenceLinks: z.array(referenceSchema).max(MAX_REFERENCE_LINKS),
  // Private (only the owner sees it) or published (other teachers see it on their home page and can copy it).
  isPublished: z.boolean(),
  slides: z.array(slideSchema),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type Option = z.infer<typeof optionSchema>;
export type SvgElement = z.infer<typeof svgElementSchema>;
export type Photo = z.infer<typeof photoSchema>;
export type Slide = z.infer<typeof slideSchema>;
export type SlideType = NonNullable<Slide["type"]>;

/** The slide, checked against the schema, or null if it's in an old or broken shape. */
export function parseSlide(data: unknown): Slide | null {
  const result = slideSchema.safeParse(data);
  return result.success ? result.data : null;
}
export type Presentation = z.infer<typeof presentationSchema>;
export type PresentationDetails = Pick<
  Presentation,
  | "title"
  | "description"
  | "grade"
  | "subject"
  | "curriculum"
  | "learningCompetency"
  | "author"
  | "referenceLinks"
  | "isPublished"
>;
