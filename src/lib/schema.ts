import { z } from "zod";

// The font sizes (px) a user can choose for a text. The text always shows at the chosen
// size; too-long text is cut off at its box's edge.
export const FONT_SIZE_RANGE = { min: 12, max: 96 };
const fontSizeSchema = z.number().int().min(FONT_SIZE_RANGE.min).max(FONT_SIZE_RANGE.max);

export const optionSchema = z.object({
  id: z.string(),
  text: z.string(),
  // Styled version of `text` (bold, color…), as HTML from the text editor. Missing on older quizzes.
  html: z.string().optional(),
  // Chosen font size. Missing = OPTION_FONT_SIZE.
  fontSize: fontSizeSchema.optional(),
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
});

export const slideSchema = z.object({
  id: z.string(),
  // choice = 4 options to pick from; short-answer = no options, the teacher types the correct answer;
  // lesson = a blank slide for teaching (free-placed elements only, no question, no number).
  // Missing = "choice" (older quizzes).
  type: z.enum(["choice", "short-answer", "lesson"]).optional(),
  // Name the teacher gave the slide. Question slides show it after their number ("Q1 · Fractions");
  // blank slides show it instead of "Slide 1". Missing = no name.
  name: z.string().optional(),
  question: z.string(),
  // Styled version of `question`, as HTML from the text editor. Missing on older quizzes.
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
  // Short-answer slides only: the answer the teacher expects. (Their options stay empty and aren't shown.)
  correctAnswer: z.string().optional(),
  elements: z.array(svgElementSchema),
  questionHeight: z.number(),
});

// The grade a lesson is for ("" = not chosen).
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

// Longest text each lesson detail may have. The zod schema below checks them before saving; the
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

export const quizSchema = z.object({
  id: z.string(),
  title: z.string().max(DETAIL_MAX_LENGTH.title),
  // Lesson details, all optional ("" when not filled in).
  description: z.string().max(DETAIL_MAX_LENGTH.description),
  grade: z.union([z.enum(GRADES), z.literal("")]),
  subject: z.string().max(DETAIL_MAX_LENGTH.subject),
  curriculum: z.string().max(DETAIL_MAX_LENGTH.curriculum),
  learningCompetency: z.string().max(DETAIL_MAX_LENGTH.learningCompetency),
  // Who wrote the content: the teacher, a book, another teacher… Not who published it — that's the
  // lesson's owner (the logged-in user who saved it).
  author: z.string().max(DETAIL_MAX_LENGTH.author),
  // What the lesson is based on (links, or book / module names), as many as the user adds.
  referenceLinks: z.array(referenceSchema).max(MAX_REFERENCE_LINKS),
  // Private (only the owner sees it) or published (other teachers see it on their home page and can copy it).
  isPublished: z.boolean(),
  slides: z.array(slideSchema),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type Option = z.infer<typeof optionSchema>;
export type SvgElement = z.infer<typeof svgElementSchema>;
export type Slide = z.infer<typeof slideSchema>;
export type SlideType = NonNullable<Slide["type"]>;

/** The slide, checked against the schema, or null if it's in an old or broken shape. */
export function parseSlide(data: unknown): Slide | null {
  const result = slideSchema.safeParse(data);
  return result.success ? result.data : null;
}
export type Quiz = z.infer<typeof quizSchema>;
export type LessonDetails = Pick<
  Quiz,
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
