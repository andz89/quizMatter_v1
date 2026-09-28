// Turns a simple "recipe" JSON (e.g. written by Claude) into real slides. The recipe only says
// *what* goes on a slide ("3 apples, medium, in the question box"); this file works out *where*
// — every element's size and position — from the real box sizes.
import { z } from "zod";
import { createBlankSlide, TITLE_SLIDE_DESCRIPTION, TITLE_SLIDE_TITLE } from "./factories";
import type { EmbedKind } from "./embed";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  CORNER_RADIUS_MAX,
  isFreeCanvas,
  DEFAULT_QUESTION_HEIGHT,
  DEFAULT_SHAPE_STRIP_HEIGHT,
  getContainerBounds,
  getMaxQuestionHeight,
  getMaxShapeStripHeight,
  getShownOptions,
  hasOptions,
  hasShapeBox,
  moveShortAnswerPicturesToSlide,
  MIN_QUESTION_HEIGHT,
  MIN_SHAPE_STRIP_HEIGHT,
  OPACITY_MIN,
  OPTION_FONT_SIZE,
  OPTION_LABELS,
  QUESTION_CONTAINER_ID,
  QUESTION_CONTAINER_WIDTH,
  QUESTION_NUMBER_INDENT,
  QUESTION_FONT_SIZE,
  SIDE_CONTAINER_ID,
  ANSWER_CONTAINER_ID,
  TEXT_BOX_FONT_SIZE,
} from "./constants";
import { markupToHtml, stripMarkup } from "./richText";
import { BACKGROUND_PATTERN_IDS, lighten, PATTERN_OPACITY_RANGE, withBackground } from "./slideBackground";
import { fitInBox, MIN_ELEMENT_SIZE, type Rect, type Size } from "./geometry";
import { createId } from "./id";
import { DEFAULT_ROTATION_3D } from "./solids";
import {
  BAR_COUNTS,
  BAR_GRAPH_MAX,
  BAR_LABEL_MAX,
  BASE_TEN_MAX,
  DEFAULT_ELEMENT_COLOR,
  ELEMENT_LIBRARY,
  FRACTION_NUMBER_MAX,
  FRACTION_PARTS,
  NUMBER_LINE_STEPS,
  TEN_FRAME_SIDE_MAX,
  THERMOMETER_MAX,
  THERMOMETER_MIN,
  canCrop,
  getAssetViewBox,
  getElementAsset,
  getNumberLineValue,
  CUSTOM_SVG_ID,
} from "./svgLibrary";
import {
  DETAIL_MAX_LENGTH,
  embedLinkSchema,
  FONT_SIZE_RANGE,
  GRADES,
  MAX_ANSWER_LENGTH,
  MAX_ITEM_COUNT,
  MAX_REFERENCE_LINKS,
  referenceSchema,
  type Slide,
  type SvgElement,
} from "./schema";

type Asset = NonNullable<ReturnType<typeof getElementAsset>>;

// ---------------------------------------------------------------------------------------------
// The recipe format. The same rules check an upload and (as JSON Schema) tell Claude what's allowed.
// ---------------------------------------------------------------------------------------------

// Claude doesn't place text boxes itself: a blank slide's "title" and "text" become text boxes.
const ASSET_IDS = ELEMENT_LIBRARY.filter((asset) => !asset.isTextBox).map((asset) => asset.id) as [string, ...string[]];

const whole = (min: number, max: number) => z.number().int().min(min).max(max);
const assetId = z.enum(ASSET_IDS, { error: (issue) => `"${String(issue.input)}" isn't a picture in the app` });
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
// Claude's own drawings. They're shown as images (nothing inside can run), so this only checks
// that it's one <svg> and not huge — every drawing is stored inside the presentation.
const MAX_SVG_LENGTH = 20_000;
const svgMarkup = z
  .string()
  .max(MAX_SVG_LENGTH, `must be under ${MAX_SVG_LENGTH} characters`)
  .regex(/^\s*<svg[\s>][\s\S]*<\/svg>\s*$/i, "must be one <svg>…</svg>");

// Opacity (percent) when Claude leaves it out: decorations are a little see-through, and its own
// background artwork stays calm behind the text.
const DECORATION_OPACITY = 60;
const BACKGROUND_SVG_OPACITY = 20;

// A spot on the 1280×720 slide, in px. Anything reaching past the edge is pulled back in.
const rect = z.object({
  x: whole(0, CANVAS_WIDTH),
  y: whole(0, CANVAS_HEIGHT),
  width: whole(20, CANVAS_WIDTH),
  height: whole(20, CANVAS_HEIGHT),
});

// A look for a whole text. Single words can also be **bold** or *italic* inside the text itself.
const textStyle = z
  .object({
    color: hexColor.optional().describe("Text color. Leave out for near-black. Keep it dark enough to read."),
    align: z.enum(["left", "center", "right"]).optional(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
  })
  .meta({ id: "textStyle" });

const calloutRecipe = z.object({
  from: z.enum(["left", "right", "top", "bottom"]).default("left").describe("Where the arrow comes from."),
  at: z
    .enum(["top", "middle", "bottom", "left", "right"])
    .default("middle")
    .describe("Which part it points at: top/middle/bottom for arrows from the left or right; left/middle/right from the top or bottom."),
  label: z.string().max(30).describe('Short label at the arrow\'s tail, e.g. "Numerator".'),
  color: hexColor.optional().describe("Arrow color. Leave out for dark navy."),
});

const elementRecipe = z.object({
  asset: assetId.describe("Which picture."),
  in: z
    .enum(["A", "B", "C", "D", "side"])
    .optional()
    .describe('Which box the picture goes in. Leave out for "side". Blank, title and custom slides ignore it.'),
  count: whole(1, 20).default(1).describe("How many copies, e.g. 3 apples for a counting question."),
  size: z
    .enum(["small", "medium", "large"])
    .optional()
    .describe("Size compared to the box it sits in. Leave out for medium (large for reading tools like clocks)."),
  color: hexColor.optional().describe("Hex color like #EF4444. Leave out to use the picture's own color."),
  callouts: z
    .array(calloutRecipe)
    .max(8)
    .optional()
    .describe("Blank, title and custom slides only: arrows with labels that point at parts of this picture."),
  clockTime: z
    .object({ hours: whole(1, 12), minutes: whole(0, 59), pm: z.boolean().optional() })
    .optional()
    .describe("Only for clock and digital-clock. Only digital-clock shows AM/PM."),
  numberLine: z
    .object({
      start: z.number().default(0).describe("First number. Ignored by integer-number-line (0 is always in the middle)."),
      step: z.literal(NUMBER_LINE_STEPS).default(1).describe("How much each tick counts up by."),
      hidden: z.array(z.number()).default([]).describe("Numbers on the line to show as an empty box instead."),
    })
    .optional()
    .describe("Only for number-line (11 ticks) and integer-number-line (17 ticks, 0 in the middle)."),
  fraction: z
    .object({ parts: whole(1, FRACTION_NUMBER_MAX), shaded: whole(0, FRACTION_NUMBER_MAX) })
    .optional()
    .describe(
      `Only for fraction-bar, fraction-circle (parts ${FRACTION_PARTS.min}–${FRACTION_PARTS.max}, shaded 0–parts) ` +
        `and fraction-number (shaded = top number, parts = bottom number, up to ${FRACTION_NUMBER_MAX}).`,
    ),
  tenFrame: z
    .object({
      count: whole(0, TEN_FRAME_SIDE_MAX * TEN_FRAME_SIDE_MAX).describe("Dots, at most rows × columns."),
      rows: whole(1, TEN_FRAME_SIDE_MAX).default(2),
      columns: whole(1, TEN_FRAME_SIDE_MAX).default(5),
    })
    .optional()
    .describe("Only for ten-frame."),
  baseTen: z
    .object({
      hundreds: whole(0, BASE_TEN_MAX).default(0),
      tens: whole(0, BASE_TEN_MAX).default(0),
      ones: whole(0, BASE_TEN_MAX).default(0),
    })
    .optional()
    .describe("Only for base-ten-blocks."),
  thermometer: z
    .object({ value: whole(THERMOMETER_MIN, THERMOMETER_MAX).describe("Temperature in °C.") })
    .optional()
    .describe("Only for thermometer."),
  barGraph: z
    .object({
      bars: z
        .array(z.object({ label: z.string().max(BAR_LABEL_MAX), value: whole(0, BAR_GRAPH_MAX) }))
        .min(BAR_COUNTS[0])
        .max(BAR_COUNTS[BAR_COUNTS.length - 1]),
    })
    .optional()
    .describe("Only for bar-graph. Bars from left to right."),
  protractor: z.object({ angle: whole(0, 180) }).optional().describe("Only for protractor."),
  rotation: whole(0, 359).optional().describe("Turn a flat picture, in degrees clockwise. Not for 3D solids (use tilt/turn)."),
  tilt: whole(-90, 90).optional().describe(`Only for 3D solids: tilt toward you, in degrees. Leave out for ${DEFAULT_ROTATION_3D.x}.`),
  turn: whole(-180, 180).optional().describe(`Only for 3D solids: turn left/right, in degrees. Leave out for ${DEFAULT_ROTATION_3D.y}.`),
  opacity: whole(OPACITY_MIN, 100).optional().describe("How solid it is, in percent. Leave out for 100."),
  cornerRadius: whole(0, CORNER_RADIUS_MAX)
    .optional()
    .describe(`Only for square and rectangle: how round the corners are, in percent of the shorter side (${CORNER_RADIUS_MAX} = fully round ends). Leave out for sharp corners.`),
  flipX: z.boolean().optional().describe("Mirror the picture left to right, e.g. to make a kid face the other way."),
  flipY: z.boolean().optional().describe("Mirror the picture top to bottom."),
  crop: z
    .object({ x: whole(0, 99), y: whole(0, 99), width: whole(1, 100), height: whole(1, 100) })
    .optional()
    .describe(
      "Show only part of the picture, in percent of the whole picture: x, y = where the shown part starts (from the top-left), width, height = how much shows. E.g. { x: 0, y: 0, width: 100, height: 50 } shows the top half. Flat pictures only (not text, lines, 3D solids, clocks or math tools).",
    ),
  position: rect
    .optional()
    .describe(
      "Place the picture yourself instead of letting the app place it, in px: on a blank, title or custom slide on the 1280×720 slide, on a question slide inside its box. Only with count 1.",
    ),
  // The id makes the JSON Schema write these rules once (as "element") instead of once per slide type.
}).meta({ id: "element" });

const elements = z.array(elementRecipe).default([]);

const decorationRecipe = z
  .object({
    asset: assetId.optional().describe('A picture from the app. Give "asset" or "svg", not both.'),
    svg: svgMarkup.optional().describe("Your own drawing instead of an asset (square viewBox, e.g. 0 0 100 100)."),
    spot: z
      .enum(["top-left", "top-right", "bottom-left", "bottom-right", "bottom-strip"])
      .describe("Where it goes: a corner, or bottom-strip (a row of small copies along the bottom)."),
    color: hexColor.optional().describe("Leave out to use the picture's own color. Not used by svg."),
    opacity: whole(OPACITY_MIN, 100).optional().describe(`How solid it is, in percent. Leave out for ${DECORATION_OPACITY}.`),
    flipX: z.boolean().optional().describe("Mirror it left to right."),
    flipY: z.boolean().optional().describe("Mirror it top to bottom."),
  })
  .meta({ id: "decoration" });

// Every slide type shares these.
const common = {
  name: z.string().optional().describe('Optional slide name, e.g. "Fractions".'),
};

// Question slides are kept plain: only a soft background color, no decorations or artwork.
const questionBackground = {
  background: hexColor.optional().describe("Soft, light background color for the slide, e.g. #FEF3C7. Leave out for white."),
};

// The question box and the picture box ("side"), which both question slide types have.
const questionBoxes = {
  question: z.string().describe("The question. **word** makes a word bold, *word* italic."),
  questionStyle: textStyle.optional().describe("Look of the whole question."),
  questionHeight: whole(MIN_QUESTION_HEIGHT, 400)
    .optional()
    .describe("Height of the question box in px. Leave out and the app fits it to the question. The most allowed depends on the layout (see the notes)."),
  pictureBox: z
    .object({ fill: hexColor.optional(), border: hexColor.optional() })
    .optional()
    .describe('Choice slides only: fill and border colors of the picture box ("side"). Leave out for a plain box.'),
};

// Blank slides are always white, with decorations and artwork.
const blankDesign = {
  backgroundSvg: svgMarkup
    .optional()
    .describe('Your own full-slide artwork (viewBox="0 0 1280 720"), drawn over the white slide, behind everything. "backgroundSvgOpacity" sets how solid it is.'),
  backgroundPattern: z
    .enum(BACKGROUND_PATTERN_IDS)
    .optional()
    .describe('A patterned background from the app, as a soft frame around the edges. Give this or "backgroundSvg", not both.'),
  design: z.array(decorationRecipe).max(6).default([]).describe("Decorations behind everything."),
};

// A text's font size (px). The text still shrinks to fit its box, so this is the largest it gets.
const fontSize = whole(FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max);
const fontSizeNote = "Largest font size in px; long text still shrinks to fit. Leave out unless the user asks for bigger or smaller text.";

// What's on a free canvas slide (besides its design). Title slides use these as they are; blank and
// custom slides and the answer canvas add a layout (blankContent).
const canvasContent = {
  title: z.string().optional().describe("Short heading, shown in bold. **word** / *word* work here too."),
  titleFontSize: fontSize.optional().describe(`The title. ${fontSizeNote}`),
  titleStyle: textStyle.optional().describe("Look of the title (it's always bold)."),
  text: z
    .string()
    .optional()
    .describe("The main text: the explanation or instructions. \\n starts a new paragraph. **word** makes a word bold, *word* italic."),
  textFontSize: fontSize.optional().describe(`The text. ${fontSizeNote}`),
  textStyle: textStyle.optional().describe("Look of the text."),
  textBoxes: z
    .array(
      z.object({
        text: z.string().describe("**word** makes a word bold, *word* italic. \\n starts a new paragraph."),
        position: rect.describe("Where the box goes, in px on the 1280×720 slide."),
        fontSize: fontSize.optional().describe(fontSizeNote),
        style: textStyle.optional(),
      }),
    )
    .max(6)
    .default([])
    .describe("Extra text boxes you place yourself: labels, a speech bubble's words, a second paragraph."),
  elements,
};

// What's on a blank slide (besides its design). The answer canvas uses the same fields.
const blankContent = {
  layout: z
    .enum(["text-top", "text-left", "title-only"])
    .default("text-top")
    .describe(
      "text-top (default) = title and text across the full width at the top, pictures below; " +
        "text-left = title and text on the left half, pictures in the right half; " +
        "title-only = a big centered title with pictures below (no text).",
    ),
  ...canvasContent,
};

// Blank and title slides: how solid their pattern or artwork is, and their optional "Reveal" as a short text.
const blankExtras = {
  patternOpacity: whole(PATTERN_OPACITY_RANGE.min, PATTERN_OPACITY_RANGE.max)
    .optional()
    .describe('How solid "backgroundPattern" is, in percent. Leave out for 25.'),
  backgroundSvgOpacity: whole(OPACITY_MIN, 100)
    .optional()
    .describe(`How solid "backgroundSvg" is, in percent. Leave out for ${BACKGROUND_SVG_OPACITY}.`),
  answer: z
    .string()
    .max(MAX_ANSWER_LENGTH)
    .optional()
    .describe(
      'The "Reveal" as a short text: what the teacher shows during the discussion (an activity, a hint, or the answer to a practice problem).',
    ),
};

// A video, slide deck or picture from another site, filling the slide. The link is checked the same
// way as a link the teacher pastes in the editor.
function embedRecipe<K extends EmbedKind>(kind: K, link: string) {
  return z.object({ type: z.literal(kind), ...common, link: embedLinkSchema(kind).describe(link) });
}

// The answer shown as a picture instead of a typed text: a white 1280×720 canvas, built exactly like
// a blank slide (no design). The teacher reveals it when presenting. On blank slides it's the "Reveal":
// content shown during the discussion (an activity, an example, a hint), not only an answer.
const answerCanvas = z
  .object(blankContent)
  .optional()
  .describe(
    'The answer as a picture: a 1280×720 canvas with a title, text, text boxes and pictures, laid out like a blank slide. ' +
      'Use it when the answer is best shown (the worked solution, the shape with its parts labeled…). The teacher sees this instead of "answer". ' +
      'On a blank slide it is the "Reveal": what the teacher shows during the discussion (an activity, an example, a hint, or the answer).',
  )
  .meta({ id: "answerCanvas" });

const slideRecipe = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("choice"),
    ...common,
    ...questionBackground,
    layout: z
      .enum(["grid", "list", "list-side"])
      .optional()
      .describe(
        "grid = 2×2 options; list = 4 rows; list-side = 4 rows with a tall picture box beside them. Leave out to let the app pick.",
      ),
    ...questionBoxes,
    questionFontSize: fontSize.optional().describe(`The question. ${fontSizeNote}`),
    stripHeight: whole(MIN_SHAPE_STRIP_HEIGHT, 600)
      .optional()
      .describe('grid/list only: height of the picture strip in px, when pictures go in "side". Leave out and the app picks.'),
    options: z
      .tuple([z.string(), z.string(), z.string(), z.string()])
      .describe("Options A, B, C, D in order. **word** makes a word bold, *word* italic."),
    optionFontSize: fontSize.optional().describe(`All 4 options. ${fontSizeNote}`),
    optionStyle: textStyle.optional().describe("Look of all 4 options."),
    answer: z.enum(OPTION_LABELS).describe("Letter of the correct option."),
    elements,
  }),
  z.object({
    type: z.literal("true-false"),
    ...common,
    ...questionBackground,
    layout: z
      .enum(["grid", "list", "list-side"])
      .optional()
      .describe("grid = 2 options side by side; list = 2 rows; list-side = 2 rows with a tall picture box beside them. Leave out for grid."),
    ...questionBoxes,
    questionFontSize: fontSize.optional().describe(`The statement. ${fontSizeNote}`),
    stripHeight: whole(MIN_SHAPE_STRIP_HEIGHT, 600)
      .optional()
      .describe('grid/list only: height of the picture strip in px, when pictures go in "side". Leave out and the app picks.'),
    options: z
      .tuple([z.string(), z.string()])
      .optional()
      .describe('Options A and B. Leave out for "True" and "False"; give them for other pairs, e.g. ["Yes", "No"] or another language.'),
    optionFontSize: fontSize.optional().describe(`Both options. ${fontSizeNote}`),
    optionStyle: textStyle.optional().describe("Look of both options."),
    answer: z.boolean().describe("true when option A (True) is right, false when option B (False) is right."),
    elements,
  }),
  z.object({
    type: z.literal("short-answer"),
    ...common,
    ...questionBackground,
    ...questionBoxes,
    questionFontSize: fontSize.optional().describe(`The question. ${fontSizeNote}`),
    answer: z.string().max(MAX_ANSWER_LENGTH).describe("The answer the student should give."),
    answerCanvas,
    elements,
  }),
  z.object({
    type: z.literal("blank"),
    ...common,
    ...blankDesign,
    ...blankContent,
    ...blankExtras,
    answerCanvas,
  }),
  z.object({
    type: z.literal("title"),
    ...common,
    ...blankDesign,
    ...canvasContent,
    title: z.string().describe("The big centered title. **word** / *word* work here too."),
    text: z
      .string()
      .optional()
      .describe("A short line under the title, centered: a subtitle, the grade, the teacher's name…"),
    ...blankExtras,
    answerCanvas,
  }),
  embedRecipe("video", "A YouTube, Vimeo or Canva video link."),
  embedRecipe("embed-slides", 'A Google Slides link (shared with "Anyone with the link") or a Canva Share → Embed link.'),
  embedRecipe("image", "A picture link that starts with https:// (a Google Drive link works too)."),
  z.object({
    type: z.literal("custom"),
    ...common,
    ...questionBackground,
    itemCount: whole(1, MAX_ITEM_COUNT)
      .default(1)
      .describe("How many question items the slide holds, e.g. 5 for five blanks to fill. The slide takes that many numbers (after Q10: 11–15)."),
    ...blankContent,
    answer: z
      .string()
      .max(MAX_ANSWER_LENGTH)
      .optional()
      .describe('The answers as a short text, one per item, e.g. "11. cat  12. dog  13. hen".'),
    answerCanvas,
  }),
]);

export const presentationRecipeSchema = z.object({ slides: z.array(slideRecipe).min(1) });

/**
 * Details about the presentation as a whole, which Claude fills in when it sends a presentation (see /api/mcp).
 * All optional. Who published it isn't here: that's the logged-in user who saves the presentation.
 */
export const claudeDetailsSchema = z.object({
  title: z.string().trim().max(DETAIL_MAX_LENGTH.title).optional().describe('The presentation title, e.g. "Adding Fractions".'),
  description: z.string().trim().max(DETAIL_MAX_LENGTH.description).optional().describe("What the presentation covers, in 1–3 sentences."),
  grade: z.enum(GRADES).optional(),
  subject: z.string().trim().max(DETAIL_MAX_LENGTH.subject).optional().describe('e.g. "Mathematics", "Science", "English".'),
  curriculum: z.string().trim().max(DETAIL_MAX_LENGTH.curriculum).optional().describe('e.g. "MATATAG", "K to 12".'),
  learningCompetency: z
    .string()
    .trim()
    .max(DETAIL_MAX_LENGTH.learningCompetency)
    .optional()
    .describe("The learning competency the presentation targets, with its code if known."),
  author: z
    .string()
    .trim()
    .max(DETAIL_MAX_LENGTH.author)
    .optional()
    .describe("Who wrote the content (a teacher, a book…). Only if the user says so."),
  referenceLinks: z
    .array(referenceSchema)
    .max(MAX_REFERENCE_LINKS)
    .optional()
    .describe(
      'What the presentation is based on, one per item: a full https:// link, or a book / module name (e.g. "DepEd SLM Mathematics 5, Quarter 1 – Module 8"). Only links you are sure are real.',
    ),
});

export type ClaudeDetails = z.infer<typeof claudeDetailsSchema>;

type SlideRecipe = z.infer<typeof slideRecipe>;
type ElementRecipe = z.infer<typeof elementRecipe>;

type BoxName = NonNullable<ElementRecipe["in"]> | "canvas";

// Which boxes each question slide type has. The question box isn't one: its text grows to fill the
// box, so pictures there would sit on top of it. The question's pictures go in "side": the shape box on
// choice slides, the open room under the question on short-answer slides.
// Blank slides have no boxes: their pictures go in the room the title and text leave on the canvas.
const BOXES: Record<"choice" | "true-false" | "short-answer", BoxName[]> = {
  choice: ["A", "B", "C", "D", "side"],
  "true-false": ["A", "B", "side"],
  "short-answer": ["side"],
};

// Tools you read a value from. They get the tall side box (list-side) and start large.
const READING_TOOLS = new Set(["clock", "digital-clock", "thermometer", "bar-graph", "protractor", "base-ten-blocks", "fraction-circle"]);

const CLAUDE_NOTES = `Write a presentation for my app (quizMatter) as JSON. Send it with send_presentation: "slides" is the slides array below, and it must match the JSON Schema at the end.

quizMatter is an open canvas tool for making presentations, like Canva or PowerPoint. It is not only for quizzes. A presentation is a set of slides of these kinds:
- Blank slides ("blank" type): a free canvas for any kind of presentation — teaching a topic, a class discussion, a story, a report, instructions, a review. A presentation can be all blank slides, with no questions at all.
- Title slides ("title" type): a big centered title with a short line under it, to open a presentation or start a new part.
- Question slides ("choice", "true-false", "short-answer" and "custom"): for checking what learners know — an evaluation, a paper quiz, an assessment, or a short quiz after the discussion.
- Embed slides ("video", "embed-slides", "image"): a video, a slide deck or a picture from another site, filling the whole slide. Only with a link the user gives you.
Mix them as the user's request needs: e.g. a title slide, blank slides to teach, then question slides to check.

When the user gives you a reference (a module or SLM, a lesson from a book, a worksheet, a lesson plan, a file, a link…): it often has many short quizzes and activities inside it, plus a final assessment at the end. Before you write any slides, ask the user which ones become question slides:
- all the short quizzes and activities (and the final assessment), or
- only the final assessment at the end.
Wait for the answer, then build the presentation that way.

Also fill in "details" when you send it: the presentation's title, a short description, grade, subject, curriculum and learning competency (and author or reference links only when you know them).

Leave a setting out and the app decides it. The layout report you get back (see "Checking before the final version") shows where everything landed.

Never number the questions: write "Which change forms no new substance?", not "1. Which change…" or "Q1: Which change…". The app numbers the question slides itself (beside the question box), and keeps the numbers right when the teacher moves slides around. A "custom" slide takes one number per item ("itemCount"), shown as a range: after Q10, a 5-item custom slide is 11–15. Blank, title and embed slides are not numbered as questions: the app names them "Slide 1", "Slide 2"…

=== The slides and what is on each one ===

The slide is 1280 × 720 px.

1. "choice" — a question with 4 options (A–D). "answer" is the letter of the correct option.
   - Question box (top, full width): "question", "questionStyle", "questionFontSize", "questionHeight".
   - Picture box "side": for pictures that belong to the question. Where it sits depends on "layout":
     - "list" (4 rows) and "grid" (2×2): a wide strip between the question and the options. It only shows when you put pictures in "side". "stripHeight" sets its height.
     - "list-side": a tall box beside the 4 rows.
   - 4 option boxes "A", "B", "C", "D": "options" (the texts), "optionStyle", "optionFontSize". Each can also hold pictures.
   - "pictureBox": fill and border colors of the picture box.
   - "background": the slide's color.
2. "true-false" — a statement the learner marks true or false. It works like "choice", with 2 options "A" (True) and "B" (False) instead of 4. "answer" is true or false.
   - Write "question" as a statement, not a question: "The sun is a star.", not "Is the sun a star?".
   - "options": leave out for "True" and "False". Give 2 texts for another pair (e.g. "Yes" and "No", or another language).
   - Same question box, "side" picture box, "pictureBox", "background" and layouts as "choice": "grid" (2 side by side, the default), "list" (2 rows), "list-side" (2 rows with a tall picture box beside them).
3. "short-answer" — a question with no options. "answer" is the expected answer.
   - Question box (top, full width): "question", "questionStyle", "questionFontSize", "questionHeight".
   - "side": the big open area under the question. There is no box around it: the pictures sit on the slide itself. Put the pictures for the question here (the apples to count, the shape to measure…). No "pictureBox".
   - "background": the slide's color.
   - "answerCanvas": optional, the answer shown as a picture (see Answers below).
4. "blank" — a blank white slide, a free canvas. Use it for any presentation slide, e.g. to:
   - teach a topic (explain the idea with a picture),
   - build a whole presentation with no questions (a report, a story, a topic overview),
   - give instructions for a new kind of question,
   - start a class discussion: ask an open question with no right answer ("Which fruit do you like best? Why?", "Where do you see fractions at home?").
   - It has no boxes. "title" and "text" become text boxes ("titleStyle", "textStyle", "titleFontSize", "textFontSize"), and the pictures fill the room they leave, as "layout" says.
   - "textBoxes": extra text boxes you place yourself anywhere (labels, a speech bubble's words, a second paragraph).
   - Pictures can be placed by the app (default) or by you ("position").
   - "design", "backgroundPattern" or "backgroundSvg" make it friendly (see Design below).
   - "answer" / "answerCanvas": optional "Reveal" — hidden content the teacher shows during the discussion, like an activity (see Answers and Reveal below).
5. "title" — a title slide: a big centered title, and "text" as a short line under it (a subtitle, the grade, the teacher's name). Use it to open the presentation, or to start a new part ("Part 2: Let's practice!").
   - "title" is needed. "titleStyle", "textStyle", "titleFontSize" (72px if left out) and "textFontSize" (36px) work like on blank slides. There is no "layout".
   - Pictures go in the room under the text, or where you put them ("position"), e.g. a waving student beside the title. "textBoxes" work too.
   - Design like a blank slide: "design", "backgroundPattern" or "backgroundSvg" (see Design below).
   - "answer" / "answerCanvas": optional "Reveal", like on blank slides. Most title slides don't need one.
6. "custom" — a question slide built on a free canvas, like a blank slide, for questions the other types can't hold: matching, labeling a picture, fill in the blanks, a set of small items on one slide.
   - "itemCount": how many items the slide holds (1–${MAX_ITEM_COUNT}). The app shows the range in the top-left corner (e.g. 11–15), so keep that corner free: the app starts the title, text and pictures to the right of it. Label the items inside the slide by letters or words, not by their numbers.
   - The same content as a blank slide: "layout", "title", "text", "textBoxes", "elements" (with "position" and "callouts").
   - Plain like the other question slides: only "background", no "design", pattern or artwork.
   - "answer" / "answerCanvas": the correct answers (see Answers below).
7. "video", "embed-slides" and "image" — embed slides: something from another site fills the whole slide. They have only "link" (and "name").
   - "video": a YouTube, Vimeo or Canva video link. "embed-slides": a Google Slides link (shared with "Anyone with the link") or a Canva Share → Embed link. "image": a picture link that starts with https:// (Google Drive links work too).
   - Only use a link the user gave you, or one you are sure is real. Never make one up. If you have no link, leave the slide out, or use a blank slide instead.
   - A bad link comes back as an error that says what kind of link works. The layout report shows the link the slide will show.
   - E.g. { "type": "video", "name": "Watch: The Water Cycle", "link": "<the link the user gave>" }.

The question box never holds pictures. Pictures always go in a picture box or an option.

=== Text ===

- Styled words: inside any text, **word** makes it bold and *word* makes it italic. Write × for times, not *.
- Style for a whole text ("questionStyle", "optionStyle", "titleStyle", "textStyle", a text box's "style"): "color", "align" (left, center, right), "bold", "italic", "underline". Keep colors dark enough to read.
- "\\n" starts a new line (a new paragraph).
- Font sizes: every text shrinks to fit its box, so the font size is the largest a text gets. Defaults: question ${QUESTION_FONT_SIZE}px, options ${OPTION_FONT_SIZE}px, blank slide title and text ${TEXT_BOX_FONT_SIZE}px. You can set ${FONT_SIZE_RANGE.min}–${FONT_SIZE_RANGE.max}px, e.g. bigger text for young learners.

=== Box sizes (question slides) ===

The question box, the strip and the options share the slide's height, so giving one more room takes it from the others.
- "questionHeight" (px, at least ${MIN_QUESTION_HEIGHT}): leave it out and the box fits the question. Give it when a long question needs more room, or a short one should leave more room below. The most it can be:
  - "grid": ${getMaxQuestionHeight({ layout: "grid" })}, or ${getMaxQuestionHeight({ layout: "grid", hasShapeBox: true })} with a strip.
  - "list": ${getMaxQuestionHeight({ layout: "list" })}, or ${getMaxQuestionHeight({ layout: "list", hasShapeBox: true })} with a strip.
  - "list-side": ${getMaxQuestionHeight({ layout: "list-side" })}.
  - "short-answer": ${getMaxQuestionHeight({ type: "short-answer", layout: "list" })}.
- "stripHeight" (px, at least ${MIN_SHAPE_STRIP_HEIGHT}; "grid" and "list" with pictures in "side"): leave it out and the app gives it the room the options can spare. A taller strip means shorter options. If a height is too big, the error says the most allowed.

=== Layouts ===

Choice slides: "list" (4 rows), "grid" (2×2) or "list-side" (4 rows with a tall picture box beside them). Left out, the app picks, in this order: "grid" when the options are only pictures (empty texts); "list-side" when "side" has a clock, thermometer, bar graph, protractor, base-ten blocks or fraction circle; "grid" when the options have pictures; otherwise "list".
- To calculate or type an answer, with no choices, use a "short-answer" slide instead.
- For a statement that is either right or wrong, use a "true-false" slide instead.

Blank slides:
- "text-top" (default): title and text across the full width, pictures below.
- "text-left": title and text on the left half, pictures in the right half.
- "title-only": a big centered title, pictures below, no text.

=== Pictures ("elements") ===

Where they go ("in", default "side"; blank slides leave "in" out):
- "side": the question's picture box, or the open area under the question on short-answer slides (see above).
- "A", "B", "C", "D": an option box ("A" and "B" only on true-false slides). If the option has text, its pictures sit on the right half, beside the text. An option can be just a picture: leave its text empty ("").

How they look:
- "size" (small, medium, large) is compared to the box. On "grid" and "list" slides, small is shown as medium.
- "count" repeats a picture. More than 5 of the same picture wrap in rows of 5 (8 apples = 5 + 3), so they are easy to count.
- For a picture sum, list the pieces in order: 2 apples, "symbol-plus", 3 apples. Numbers and symbols take the size of the pictures next to them.
- "color" recolors a picture. "opacity" (${OPACITY_MIN}–100%) makes it see-through.
- "rotation" (0–359°) turns a flat picture. 3D solids (cube, cone…) use "tilt" (−90 to 90°) and "turn" (−180 to 180°) instead, to show them from another side.
- "cornerRadius" (0–${CORNER_RADIUS_MAX}%) rounds the corners of a square or rectangle.
- "flipX" mirrors a picture left to right (e.g. two kids facing each other), "flipY" top to bottom. Decorations in "design" can be flipped too.
- "crop" shows only part of a flat picture, in percent of the whole picture: { x, y, width, height }. E.g. { x: 0, y: 0, width: 100, height: 50 } = the top half; a kid's head and shoulders is about the top 45%. The picture's box takes the shape of the part that shows.
- The picture list has people: students in school uniform — Filipino boys ("ph-student-…", one waving, one with a fist up), a waving boy with a book ("school-boy"), and students with a pencil, reading, with an apple, a book, a globe, a backpack or a paper, pointing up, or jumping for joy ("student-…"). Their "color" is their clothes. Use them to make presentations friendly: a student reading on a lesson slide, a student cheering on a summary slide.
- Fruits include apple, banana, grapes, mango, papaya, coconut, rambutan, dragon-fruit, kiwi, avocado, peach, pomegranate, blueberries and more.
- Shapes include every kind of triangle (equilateral, isosceles, scalene, right, acute, obtuse) and four-sided shape (square, rectangle, trapezoid, right trapezoid, rhombus, kite, parallelogram…). 3D solids include prisms and pyramids with 3–6 sided bases, frustum, hemisphere, octahedron and icosahedron.
- Settings like "clockTime", "fraction", "numberLine", "tenFrame", "baseTen", "thermometer", "barGraph" and "protractor" only work on the pictures named in their description.
- Keep "elements" useful: they should help answer the question or explain the topic. Decoration goes in "design".

Placing them yourself:
- The app places, centers and sizes pictures itself. To choose the spot yourself, give "position": { x, y, width, height } in px (x, y = top-left corner). Only with count 1.
  - Blank, title and custom slides: on the 1280 × 720 slide.
  - Question slides: inside the picture's box ("side" or an option), from the box's top-left corner. The box sizes are in the layout report.
- Anything past its box's edge is pulled back in.
- "square" and "rectangle" take exactly the width and height you give, so they can be a box of any shape: e.g. a soft colored panel behind a group of pictures, or a bar. Add "cornerRadius" for rounded corners.
- Pictures you place yourself are drawn in list order (a later one sits on top of an earlier one), and behind the pictures the app places. So list a background panel before what goes on it.
- "textBoxes" (blank, title and custom slides) are placed the same way, and sit on top of pictures — good for labels on a picture.

Arrows that point at part of a picture ("callouts", blank, title and custom slides only):
- Use them to show where something is: the numerator and the denominator of a fraction, the hour hand of a clock, the tallest bar of a graph.
- "from" = where the arrow comes from: left, right, top or bottom. "at" = which part it points at: top, middle or bottom for arrows from the left or right; left, middle or right for arrows from the top or bottom.
- Up to 3 from the left and 3 from the right; at most 1 from the top and 1 from the bottom.

=== Checking before the final version (the layout report) ===

- send_presentation replies with a layout report: every box's size, and where each text and picture landed, in the same px as "position". Lines starting with "!" point out things to check: pictures that wrapped to more rows or shrank a lot, pictures on top of text, text that will probably shrink.
- Send the presentation first with "final": false. The user sees it as "Checking…" and can't open it yet. Check the report against what you meant, and fix anything that's off (e.g. give "position" with the numbers you want). You can check again the same way.
- Then send it with "final": true and the "draftId" you got. That turns the checking version into the finished presentation and gives you the link for the user.

=== Answers and Reveal (short-answer, custom, blank and title slides) ===

When presenting, the teacher clicks a button to show hidden content in a popup. On short-answer and custom slides it's the correct answer. On blank and title slides the app calls it "Reveal" (see below). There are two kinds:
- "answer": a short typed text (at most ${MAX_ANSWER_LENGTH} characters), e.g. "12 apples". Short-answer slides always need one.
- "answerCanvas": the answer as a picture — a white 1280 × 720 canvas, built exactly like a blank slide: "layout", "title", "text", "textBoxes", "elements" (with "position" and "callouts"), and the same style and font size settings. No design, pattern or background. When you give it, the teacher sees the canvas instead of the text.
- Use "answerCanvas" when the answer is best shown, not just said: a worked solution step by step, the counted pictures with the total, a shape with its parts labeled, the clock showing the right time. Keep it clear: a title like "Answer: 12", a short explanation, and the pictures that prove it.
- A short-answer slide with "answerCanvas" still needs "answer" (a short text version).
- Custom slides: give "answer", "answerCanvas" or both, with every item's answer.
- Blank slides ("Reveal"): not a correct answer, but content kept hidden until the teacher shows it during the discussion. Use it for:
  - an activity for the class after the talk ("Draw your favorite fruit and tell a partner why."),
  - a worked example or the next step after the slide's idea,
  - a hint, or the answer to a practice problem or riddle the slide asks ("What comes next?").
  Most often give "answerCanvas" with a title like "Activity" or "Let's try!", short instructions and a picture. Leave both out on plain teaching slides that have nothing to reveal.
- Choice and true-false slides never have these: their answer is in "answer". Embed slides have no answer.
- The layout report shows the answer canvas (a blank slide's Reveal too) under its slide, as "Answer canvas".

=== Design ===

Question slides — keep them plain:
- No decorations, no pattern, no artwork: question slides don't have "design", "backgroundPattern" or "backgroundSvg".
- "background": you may give a soft, light color (e.g. #FEF3C7, #E0F2FE, #DCFCE7, #FCE7F3, #EDE9FE), or leave it out for white. Use one color family for the whole presentation. Dark colors are lightened automatically, because the text is dark.
- "pictureBox" (choice slides): a soft fill and/or border for the picture box, in the same color family, so the pictures stand out.

Blank and title slides — always white, made friendly with design:
- There is no background color to set on blank or title slides.
- Custom slides are question slides: keep them plain, like the others.
- "design": decorations drawn behind everything, placed at a "spot". Pick ones that match the topic (leaves and trees for nature, sparkle and confetti for celebrations, planets for space, clouds for weather, shapes like circle, star or wave for anything) in 2–3 colors that go well together.
  - The 4 corners (big, about 180px) and "bottom-strip" (a row of small copies along the bottom). Use 2–4 decorations. "opacity" sets how solid each one is (${DECORATION_OPACITY}% if left out).

Background artwork (blank and title slides only) — each blank or title slide can have one of these (or none, just plain white):
- Option 1, "backgroundPattern": a ready-made pattern from the app: ${BACKGROUND_PATTERN_IDS.join(", ")}. It shows as a soft frame around the slide's edges, at 25% opacity unless you set "patternOpacity"; the middle stays plain white. It replaces "design": a slide with a pattern gets no decorations.
- Option 2, "backgroundSvg": your own full-slide artwork, drawn over the white slide, behind everything. Use viewBox="0 0 1280 720". Good ideas: soft waves along the bottom, blobs in the corners, a sunburst, a frame. Keep the middle mostly empty so the text stays easy to read.
  - "backgroundSvgOpacity" sets how solid it is (${BACKGROUND_SVG_OPACITY}% if left out). Draw it in full colors and use this to soften it.
- Mix them across the presentation: patterns on some slides, your own artwork or decorations on others.

Opacity: you choose how solid decorations, patterns, background artwork and pictures are. Keep anything behind text light enough that the text stays easy to read.

Your own drawings (SVG) — for blank and title slide design only:
- In "design", give "svg" instead of "asset" to draw your own decoration for a spot (square viewBox, e.g. "0 0 100 100").
- Rules: one <svg>…</svg>, under 20,000 characters. Use shapes, paths and gradients (path, circle, ellipse, rect, polygon, line, g, defs, linearGradient, radialGradient, stop). No images, scripts or links — they won't show.
- Teaching pictures (the ones in "elements") always come from "asset", never your own drawings.

Example:
{
  "slides": [
    {
      "type": "title",
      "backgroundPattern": "${BACKGROUND_PATTERN_IDS[0]}",
      "title": "Fractions",
      "text": "Mathematics · Grade 3",
      "elements": [{ "asset": "student-pointing", "position": { "x": 1040, "y": 500, "width": 180, "height": 200 } }]
    },
    {
      "type": "blank",
      "layout": "text-top",
      "design": [
        { "asset": "circle", "spot": "top-right", "color": "#FDBA74", "opacity": 40 },
        { "asset": "sparkle", "spot": "bottom-left", "color": "#F59E0B" }
      ],
      "title": "Parts of a Fraction",
      "text": "The top number is the numerator.\\nThe bottom number is the denominator.",
      "elements": [
        {
          "asset": "fraction-number",
          "fraction": { "parts": 4, "shaded": 1 },
          "size": "large",
          "callouts": [
            { "from": "right", "at": "top", "label": "Numerator" },
            { "from": "right", "at": "bottom", "label": "Denominator" }
          ]
        }
      ]
    },
    {
      "type": "blank",
      "design": [{ "asset": "leaf-maple", "spot": "bottom-strip", "color": "#16A34A" }],
      "title": "Let's talk!",
      "text": "Which fruit do you like **best**? Why?",
      "elements": [{ "asset": "apple" }, { "asset": "banana" }, { "asset": "grapes" }],
      "answerCanvas": {
        "title": "Activity",
        "text": "Draw your favorite fruit.\\nTell a partner **why** you like it.",
        "elements": [{ "asset": "apple" }, { "asset": "banana" }]
      }
    },
    {
      "type": "choice",
      "background": "#E0F2FE",
      "pictureBox": { "fill": "#F0F9FF", "border": "#7DD3FC" },
      "question": "What time does the clock show?",
      "options": ["3:00", "4:30", "6:15", "9:45"],
      "answer": "C",
      "elements": [{ "asset": "clock", "clockTime": { "hours": 6, "minutes": 15 } }]
    },
    {
      "type": "short-answer",
      "question": "How many apples are there in all?",
      "answer": "5 apples",
      "elements": [
        { "asset": "apple", "count": 3 },
        { "asset": "symbol-plus" },
        { "asset": "apple", "count": 2 }
      ],
      "answerCanvas": {
        "title": "Answer: 5 apples",
        "text": "3 apples and 2 more apples make **5** apples.",
        "elements": [{ "asset": "apple", "count": 5 }]
      }
    },
    {
      "type": "true-false",
      "question": "A square has **4** equal sides.",
      "answer": true,
      "elements": [{ "asset": "square" }]
    },
    {
      "type": "choice",
      "question": "What is 2 + 3?",
      "options": ["4", "5", "6", "7"],
      "answer": "B",
      "elements": [
        { "asset": "apple", "count": 2 },
        { "asset": "symbol-plus" },
        { "asset": "apple", "count": 3 }
      ]
    }
  ]
}

JSON Schema:
`;

/** Everything Claude needs to write a recipe: short notes, an example, and the JSON Schema with every allowed value. */
export function getClaudeFormat(): string {
  return CLAUDE_NOTES + JSON.stringify(z.toJSONSchema(presentationRecipeSchema, { io: "input" }), null, 2);
}

// ---------------------------------------------------------------------------------------------
// Recipe → slides
// ---------------------------------------------------------------------------------------------

/**
 * "lesson" is the blank slide's old type name. Older Claude chats still write it, and drafts sent before the
 * rename still have it, so it's read as "blank".
 */
function renameLessonSlides(data: unknown): unknown {
  if (typeof data !== "object" || data === null || !("slides" in data) || !Array.isArray(data.slides)) return data;
  const slides = data.slides.map((slide) =>
    typeof slide === "object" && slide !== null && slide.type === "lesson" ? { ...slide, type: "blank" } : slide,
  );
  return { ...data, slides };
}

/**
 * `drawPatterns: false` skips drawing background patterns (they need react-dom/server, which
 * Cloudflare Workers don't have) — for the MCP server, which only wants the errors.
 */
export function buildSlides(
  data: unknown,
  { drawPatterns = true } = {},
): { slides: Slide[]; report: string } | { errors: string[] } {
  const parsed = presentationRecipeSchema.safeParse(renameLessonSlides(data));
  if (!parsed.success) return { errors: [z.prettifyError(parsed.error)] };

  const errors: string[] = [];
  const built = parsed.data.slides.map((recipe, i) =>
    buildSlide(recipe, drawPatterns, (message) => errors.push(`Slide ${i + 1}: ${message}`)),
  );
  if (errors.length) return { errors };
  const report = built
    .map(({ slide, report }, i) => {
      const recipe = parsed.data.slides[i];
      // Short-answer slides have no layout to pick.
      const layout = recipe.type === "blank" || recipe.type === "custom" ? `, ${recipe.layout}` : hasOptions(slide) ? `, ${slide.layout}` : "";
      return [`Slide ${i + 1} (${slide.type}${layout})`, ...report].join("\n  ");
    })
    .join("\n\n");
  return { slides: built.map(({ slide }) => slide), report };
}

const CANVAS: Size = { width: CANVAS_WIDTH, height: CANVAS_HEIGHT };

type QuestionRecipe = Extract<SlideRecipe, { type: "choice" | "true-false" | "short-answer" }>;

/** The question box's text, styled text, font size and height (Claude's, or just tall enough for the text). */
function questionFields(recipe: QuestionRecipe) {
  const question = stripMarkup(recipe.question);
  return {
    question,
    questionHtml: markupToHtml(recipe.question, recipe.questionStyle),
    questionFontSize: recipe.questionFontSize,
    questionHeight: recipe.questionHeight ?? questionHeightFor(question, recipe.questionFontSize),
  };
}

function buildSlide(
  recipe: SlideRecipe,
  drawPatterns: boolean,
  reportError: (message: string) => void,
): { slide: Slide; report: string[] } {
  const blank = createBlankSlide(recipe.type);
  let slide: Slide = { ...blank, name: recipe.name };
  // Video, slide deck and picture slides only show their (already checked) link.
  if ("link" in recipe) return { slide: { ...slide, embedUrl: recipe.link }, report: [`Shows: ${recipe.link}`] };

  // Blank, title and custom slides have no boxes: the title and text become text boxes, and the pictures go anywhere.
  const isCanvas = recipe.type === "blank" || recipe.type === "title" || recipe.type === "custom";
  const isTitle = recipe.type === "title";
  // Blank and title slides are white, with decorations or artwork; the others get a background color.
  const hasDesign = recipe.type === "blank" || recipe.type === "title";
  if (hasDesign) {
    if (recipe.backgroundPattern && recipe.backgroundSvg) reportError('give "backgroundPattern" or "backgroundSvg", not both.');
    slide.backgroundSvg =
      recipe.backgroundSvg && softened(withSvgNamespace(recipe.backgroundSvg), recipe.backgroundSvgOpacity ?? BACKGROUND_SVG_OPACITY);
    if (recipe.backgroundSvgOpacity !== undefined && !recipe.backgroundSvg) reportError('"backgroundSvgOpacity" needs a "backgroundSvg".');
    // The pattern sits on the plain white slide.
    if (recipe.patternOpacity !== undefined && !recipe.backgroundPattern) reportError('"patternOpacity" needs a "backgroundPattern".');
    if (recipe.backgroundPattern && drawPatterns) {
      slide = withBackground(slide, { backgroundPattern: recipe.backgroundPattern, backgroundOpacity: recipe.patternOpacity });
    }
  } else {
    // Dark colors are lightened, because the text is dark.
    slide.background = recipe.background && lighten(recipe.background);
    if (recipe.type !== "custom") {
      slide.shapeBoxFill = recipe.pictureBox?.fill;
      slide.shapeBoxBorder = recipe.pictureBox?.border;
    }
  }

  if (recipe.type === "choice" || recipe.type === "true-false") {
    const isChoice = recipe.type === "choice";
    // True-or-false slides fill only the first 2 option slots; the other 2 stay empty and hidden.
    const texts = isChoice ? recipe.options : [...(recipe.options ?? ["True", "False"]), "", ""];
    const options = blank.options.map((option, i) => ({
      ...option,
      text: stripMarkup(texts[i]),
      html: texts[i] ? markupToHtml(texts[i], recipe.optionStyle) : undefined,
      fontSize: recipe.optionFontSize,
    })) as Slide["options"];
    const layout = recipe.layout ?? (isChoice ? pickLayout(recipe.options, recipe.elements) : "grid");
    const answerIndex = isChoice ? OPTION_LABELS.indexOf(recipe.answer) : recipe.answer ? 0 : 1;
    slide = {
      ...slide,
      layout,
      ...questionFields(recipe),
      options,
      correctOptionId: options[answerIndex].id,
      // Grid/list slides only show the side box (as a strip) once it's turned on.
      hasShapeBox: layout !== "list-side" && recipe.elements.some((el) => (el.in ?? "side") === "side"),
    };
    if (recipe.stripHeight !== undefined && !slide.hasShapeBox) {
      reportError('"stripHeight" only works on "grid" or "list" slides with pictures in "side".');
    }
  } else if (recipe.type === "short-answer") {
    slide = { ...slide, ...questionFields(recipe), correctAnswer: recipe.answer };
  } else if (recipe.type === "custom") {
    slide.itemCount = recipe.itemCount;
  }

  if (!isCanvas) {
    if (recipe.pictureBox && recipe.type === "short-answer") reportError('short-answer slides have no picture box, so leave "pictureBox" out.');
    else if (recipe.pictureBox && !hasShapeBox(slide)) reportError('"pictureBox" needs a picture box: put pictures in "side".');
    // The question box and the strip share the room above the options, so each one's limit depends on the other.
    const stripHeight = recipe.type === "choice" || recipe.type === "true-false" ? recipe.stripHeight : undefined;
    const maxQuestion = getMaxQuestionHeight({ ...slide, shapeStripHeight: stripHeight ?? DEFAULT_SHAPE_STRIP_HEIGHT });
    if (recipe.questionHeight && recipe.questionHeight > maxQuestion) {
      reportError(`"questionHeight" can be at most ${maxQuestion} on this slide.`);
    }
    if (slide.hasShapeBox) {
      const maxStrip = getMaxShapeStripHeight(slide);
      if (stripHeight && stripHeight > maxStrip) reportError(`"stripHeight" can be at most ${maxStrip} on this slide.`);
      // Short options don't need much room, so a strip with pictures takes what the options can spare.
      slide.shapeStripHeight = stripHeight ?? Math.max(DEFAULT_SHAPE_STRIP_HEIGHT, Math.min(MAX_IMPORT_STRIP_HEIGHT, maxStrip));
    }
  }

  // Blank, title and custom slides: the title and text become text boxes, and the pictures get the room that's left.
  const areas = isCanvas ? blankAreas(recipe) : null;
  if (isCanvas && recipe.type !== "title" && recipe.layout === "title-only" && recipe.text) {
    reportError(`a "title-only" ${recipe.type} slide has no text. Use "text-top" or "text-left", or leave "text" out.`);
  }
  // Every blank slide text box, with a name and its words, for the report.
  const texts: BlankText[] = [];
  const textBoxes: SvgElement[] = [];
  if (isCanvas && areas?.title) {
    // Title slides get the editor's big centered title.
    const centered = recipe.type === "title" || recipe.layout === "title-only";
    const fontSize = recipe.titleFontSize ?? (isTitle ? TITLE_SLIDE_TITLE.fontSize : undefined);
    const html = markupToHtml(recipe.title!, { align: centered ? "center" : "left", ...recipe.titleStyle, bold: true });
    textBoxes.push(textBox(areas.title, html, fontSize));
    texts.push({ label: "title", box: textBoxes.at(-1)!, words: stripMarkup(recipe.title!) });
  }
  if (isCanvas && areas?.text) {
    const fontSize = recipe.textFontSize ?? (isTitle ? TITLE_SLIDE_DESCRIPTION.fontSize : undefined);
    const style = isTitle ? { align: "center" as const, ...recipe.textStyle } : recipe.textStyle;
    textBoxes.push(textBox(areas.text, markupToHtml(recipe.text!, style), fontSize));
    texts.push({ label: "text", box: textBoxes.at(-1)!, words: stripMarkup(recipe.text!) });
  }
  // Text boxes Claude placed itself. They sit on top of the pictures, so a label can go on one.
  const placedText =
    isCanvas
      ? recipe.textBoxes.map((box, i) => {
          const element = textBox(fitInBox(box.position, CANVAS), markupToHtml(box.text, box.style), box.fontSize);
          texts.push({ label: `text box ${i + 1}`, box: element, words: stripMarkup(box.text) });
          return element;
        })
      : [];

  // The area a box's pictures are placed in: the blank slide's picture area, or the box itself.
  const areaOf = (containerId: string | null): Rect =>
    areas && containerId === null ? areas.pictures : { x: 0, y: 0, ...getContainerBounds(containerId, slide) };
  const boxOf = (el: ElementRecipe): BoxName => (isCanvas ? "canvas" : (el.in ?? "side"));

  // Numbers and symbols (e.g. the "+" in 🍎🍎 + 🍎🍎🍎) match the biggest picture in their box, so
  // the row reads as one line.
  const pictureSize = new Map<BoxName, SizeName>();
  for (const el of recipe.elements) {
    if (isGlyph(el.asset) || el.position) continue;
    const current = pictureSize.get(boxOf(el));
    if (!current || SIZE_NAMES.indexOf(sizeOf(el)) > SIZE_NAMES.indexOf(current)) pictureSize.set(boxOf(el), sizeOf(el));
  }

  const pictures: SvgElement[] = [];
  const calloutParts: SvgElement[] = [];
  // Things Claude may want to fix, for the report.
  const notes: string[] = [];

  // Build every element's settings first, grouped by the box it goes in (keeping the recipe's order).
  const byBox = new Map<string | null, { base: Omit<SvgElement, keyof Rect>; size: Size; callouts: Callout[]; pad: Pad }[]>();
  recipe.elements.forEach((el, i) => {
    const where = `element ${i + 1} (${el.asset})`;
    const boxName = boxOf(el);
    if (!isCanvas && !BOXES[recipe.type].includes(boxName)) {
      reportError(`${where}: a ${recipe.type} slide has no "${boxName}" box. Use one of: ${BOXES[recipe.type].join(", ")}.`);
      return;
    }
    const asset = getElementAsset(el.asset)!;
    const settings = buildSettings(el, asset);
    const calloutError = el.callouts && checkCallouts(el.callouts, isCanvas);
    if (typeof settings === "string" || calloutError) {
      reportError(`${where}: ${calloutError || settings}`);
      return;
    }

    const color = el.color ?? asset.defaultColor ?? DEFAULT_ELEMENT_COLOR;
    const containerId = toContainerId(boxName, slide);
    // A picture Claude placed itself skips the app's placing. Its position is inside its box (on a
    // blank slide, the whole slide).
    if (el.position) {
      if (el.count > 1) return reportError(`${where}: "position" places one picture, so leave "count" out.`);
      const picture = fitInBox(el.position, boundsOf(containerId, slide));
      if (formatRect(picture) !== formatRect(el.position)) {
        notes.push(`${where} didn't fit in "${boxLabel(containerId, slide)}" where you put it, so it was moved or shrunk to ${formatRect(picture)}.`);
      }
      pictures.push({ id: createId(), assetId: el.asset, color, containerId, ...settings, ...picture });
      calloutParts.push(...calloutElements(picture, el.callouts ?? []));
      return;
    }

    let size = isGlyph(el.asset) ? (pictureSize.get(boxName) ?? sizeOf(el)) : sizeOf(el);
    // Grid/list boxes are short (the strip, the option rows), so small pictures there look too tiny.
    if (hasOptions(slide) && slide.layout !== "list-side" && size === "small") size = "medium";
    const list = byBox.get(containerId) ?? [];
    const callouts = el.callouts ?? [];
    for (let copy = 0; copy < el.count; copy++) {
      const pictureSize = fitAroundCallouts(startSize(asset, settings, size, areaOf(containerId)), callouts, areaOf(containerId));
      list.push({
        base: {
          id: createId(),
          assetId: el.asset,
          color,
          containerId,
          ...settings,
        },
        size: pictureSize,
        callouts,
        pad: calloutPad(callouts, pictureSize),
      });
    }
    byBox.set(containerId, list);
  });

  // Each picture is placed together with the room its callouts need around it (its "slot"); the
  // picture then sits inside its slot and the arrows + labels fill the rest.
  for (const [containerId, items] of byBox) {
    // An option with text keeps its left side for the text, so its pictures go on the right.
    const hasText = slide.options.some((option) => option.id === containerId && option.text.trim() !== "");
    const area = areaOf(containerId);
    const slots = placeInBox(
      items.map(({ size, pad, base }) => ({
        assetId: base.assetId,
        width: size.width + pad.left + pad.right,
        height: size.height + pad.top + pad.bottom,
      })),
      area,
      hasText ? "right" : "center",
    );
    const label = boxLabel(containerId, slide);
    // Pictures in one row are centered on the same line, so each distinct middle is one row.
    const rows = new Set(slots.map((slot) => Math.round(slot.y + slot.height / 2))).size;
    if (rows > 1) notes.push(`the ${items.length} pictures in "${label}" didn't fit in one row, so they wrapped to ${rows} rows.`);
    const scale = Math.min(...items.map(({ size, pad }, i) => slots[i].width / (size.width + pad.left + pad.right)));
    if (scale < 0.7) notes.push(`the pictures in "${label}" shrank to ${Math.round(scale * 100)}% of their size to fit.`);
    items.forEach(({ base, size, pad, callouts }, i) => {
      // Shrinking to fit scales the slot evenly, so the picture and its padding shrink by the same amount.
      const scale = slots[i].width / (size.width + pad.left + pad.right);
      const picture = {
        x: area.x + slots[i].x + pad.left * scale,
        y: area.y + slots[i].y + pad.top * scale,
        width: size.width * scale,
        height: size.height * scale,
      };
      pictures.push({ ...base, ...picture });
      calloutParts.push(...calloutElements(picture, callouts));
    });
  }

  // Drawn first, so they sit behind everything. Only blank and title slides have decorations. A pattern background is already the slide's decoration,
  // so other decorations would only crowd it.
  const design = !hasDesign || recipe.backgroundPattern ? [] : recipe.design;
  const decorations = design.flatMap((item, i) => {
    if (!item.asset === !item.svg) {
      reportError(`decoration ${i + 1}${item.asset ? ` (${item.asset})` : ""}: give "asset" or "svg" (one of them).`);
      return [];
    }
    return decorationElements(item);
  });

  slide = { ...slide, elements: [...decorations, ...textBoxes, ...pictures, ...placedText, ...calloutParts] };
  const report = describeSlide(slide, texts, pictures, notes);
  // Short-answer pictures were placed in the room under the question ("side"); they sit on the slide itself.
  slide.elements = moveShortAnswerPicturesToSlide(slide);

  // The answer (short-answer, custom and blank slides): a typed text, and/or a canvas built like a blank
  // slide with no design, whose elements then move into the answer box.
  if (isCanvas && recipe.answer !== undefined) slide.correctAnswer = recipe.answer;
  if ((recipe.type === "short-answer" || isCanvas) && recipe.answerCanvas) {
    const canvas = buildSlide({ type: "blank", design: [], ...recipe.answerCanvas }, drawPatterns, (message) =>
      reportError(`answer canvas: ${message}`),
    );
    slide.answerType = "canvas";
    slide.elements.push(...canvas.slide.elements.map((el) => ({ ...el, containerId: ANSWER_CONTAINER_ID })));
    // Its pictures sit on the canvas, which its own report calls "slide".
    const lines = canvas.report.map((line) => `  ${line.replaceAll('"slide"', '"answer canvas"')}`);
    report.push(`Answer canvas (${recipe.answerCanvas.layout}):`, ...lines);
  }
  return { slide, report };
}

// ---------------------------------------------------------------------------------------------
// The layout report: where everything landed, sent back to Claude so it can check and fix it.
// ---------------------------------------------------------------------------------------------

interface BlankText {
  label: string;
  box: SvgElement;
  words: string;
}

// Room an option's text keeps from its box's edges (px, both sides together), about.
const OPTION_TEXT_PADDING = 16;

function boundsOf(containerId: string | null, slide: Slide): Size {
  return containerId === null ? CANVAS : getContainerBounds(containerId, slide);
}

function boxLabel(containerId: string | null, slide: Slide): string {
  if (containerId === null) return "slide";
  if (containerId === SIDE_CONTAINER_ID) return "side";
  return OPTION_LABELS[slide.options.findIndex((option) => option.id === containerId)];
}

const formatSize = ({ width, height }: Size) => `${Math.round(width)}×${Math.round(height)}`;
const formatRect = (rect: Rect) => `${Math.round(rect.x)},${Math.round(rect.y)} ${formatSize(rect)}`;

/** Whether text probably needs more room than the box has at this font size (then it shrinks). A guess: the browser does the real fitting. */
function tooLong(words: string, box: Size, fontSize: number): boolean {
  if (words.trim() === "") return false;
  // One line always counts as fitting: a short option in a short list row is fine.
  const lineHeight = fontSize * LINE_HEIGHT_PER_PX;
  const lines = textHeightFor(words, Math.max(1, box.width), fontSize) / lineHeight;
  return lines > Math.max(1, Math.floor(box.height / lineHeight));
}

/** The slide's boxes, text and pictures (x,y = top-left corner, inside its box), and anything to check. */
function describeSlide(slide: Slide, texts: BlankText[], pictures: SvgElement[], notes: string[]): string[] {
  const lines: string[] = [];
  const warnings = [...notes];

  if (isFreeCanvas(slide)) {
    if (texts.length) lines.push(`Text: ${texts.map(({ label, box }) => `${label} ${formatRect(box)}`).join(" · ")}`);
    for (const { label, box, words } of texts) {
      const fontSize = box.text?.fontSize ?? TEXT_BOX_FONT_SIZE;
      if (tooLong(words, box, fontSize)) warnings.push(`the ${label} is probably too long for its box at ${fontSize}px, so it will shrink.`);
      for (const picture of pictures) {
        if (overlaps(picture, box)) warnings.push(`${picture.assetId} (${formatRect(picture)}) overlaps the ${label}.`);
      }
    }
  } else {
    const questionFont = slide.questionFontSize ?? QUESTION_FONT_SIZE;
    const questionRoom = { width: QUESTION_TEXT_WIDTH, height: slide.questionHeight - QUESTION_PADDING };
    const boxes = [`question ${formatSize(getContainerBounds(QUESTION_CONTAINER_ID, slide))}`];
    // Short-answer slides have no box there, but their "side" pictures are placed in the room under the question.
    if (hasShapeBox(slide) || slide.type === "short-answer") boxes.push(`side ${formatSize(getContainerBounds(SIDE_CONTAINER_ID, slide))}`);
    if (hasOptions(slide)) {
      const letters = slide.type === "true-false" ? "A–B" : "A–D";
      boxes.push(`${letters} ${formatSize(getContainerBounds(slide.options[0].id, slide))} each`);
    }
    lines.push(`Boxes: ${boxes.join(" · ")}`);
    if (tooLong(slide.question, questionRoom, questionFont)) {
      warnings.push(`the question is probably too long for its box at ${questionFont}px, so it will shrink.`);
    }
    if (hasOptions(slide)) {
      getShownOptions(slide).forEach((option, i) => {
        const box = getContainerBounds(option.id, slide);
        // Pictures in an option sit on its right half, so its text should fit in the left half.
        const hasPictures = pictures.some((picture) => picture.containerId === option.id);
        const room = { width: box.width / (hasPictures ? 2 : 1) - OPTION_TEXT_PADDING, height: box.height - OPTION_TEXT_PADDING };
        const fontSize = option.fontSize ?? OPTION_FONT_SIZE;
        if (tooLong(option.text, room, fontSize)) {
          const where = hasPictures ? "the left half of its box" : "its box";
          warnings.push(`option ${OPTION_LABELS[i]} is probably too long for ${where} at ${fontSize}px, so it will shrink.`);
        }
      });
    }
  }

  const byBox = new Map<string, SvgElement[]>();
  for (const picture of pictures) {
    const label = boxLabel(picture.containerId, slide);
    byBox.set(label, [...(byBox.get(label) ?? []), picture]);
  }
  for (const [label, list] of byBox) {
    lines.push(`Pictures in "${label}": ${list.map((picture) => `${picture.assetId} ${formatRect(picture)}`).join(" · ")}`);
  }
  return [...lines, ...warnings.map((warning) => `! ${warning}`)];
}

type SizeName = NonNullable<ElementRecipe["size"]>;
const SIZE_NAMES: SizeName[] = ["small", "medium", "large"];

/** The size Claude asked for, or the default: large for reading tools (a small clock is hard to read), else medium. */
function sizeOf(el: ElementRecipe): SizeName {
  return el.size ?? (READING_TOOLS.has(el.asset) ? "large" : "medium");
}

function isGlyph(assetId: string): boolean {
  const category = getElementAsset(assetId)?.category;
  return category === "number" || category === "letter" || category === "symbol";
}

/** Picks a choice slide's layout when Claude leaves it out — the same rules Claude's notes give. */
function pickLayout(options: string[], elements: ElementRecipe[]): Slide["layout"] {
  const optionsArePictures =
    options.every((text) => text.trim() === "") && elements.some((el) => el.in !== undefined && el.in !== "side");
  if (optionsArePictures) return "grid";
  if (elements.some((el) => (el.in ?? "side") === "side" && READING_TOOLS.has(el.asset))) return "list-side";
  // Pictures inside the options need the taller grid cells; text-only options read best as rows.
  const optionsHavePictures = elements.some((el) => el.in !== undefined && el.in !== "side");
  return optionsHavePictures ? "grid" : "list";
}

// ---------------------------------------------------------------------------------------------
// Blank slides
// ---------------------------------------------------------------------------------------------

// Space around the slide's edge and between the text and the pictures (px).
// The margin is wider than a pattern background's 40px frame, so text never sits on the pattern.
const BLANK_MARGIN = 56;
const BLANK_GAP = 24;
const BLANK_TITLE_HEIGHT = 72;
const BLANK_BIG_TITLE_HEIGHT = 140;
// Longest text box across the top of a text-top blank slide, so the pictures keep room below.
const BLANK_MAX_TEXT_HEIGHT = 240;

// Custom slides keep their left side free for the question number range (e.g. "11–15") in the
// top-left corner, so the content starts right of it.
const CUSTOM_LEFT_MARGIN = 150;

type BlankRecipe = Extract<SlideRecipe, { type: "blank" | "title" | "custom" }>;

/** Where a blank, title or custom slide's title, text and pictures go on the canvas (a missing title or text gets no area). */
function blankAreas(recipe: BlankRecipe): { title: Rect | null; text: Rect | null; pictures: Rect } {
  const left = recipe.type === "custom" ? CUSTOM_LEFT_MARGIN : BLANK_MARGIN;
  const width = CANVAS_WIDTH - left - BLANK_MARGIN;
  const bottom = CANVAS_HEIGHT - BLANK_MARGIN;

  // Title slides: the title and the line under it sit where the editor puts them, pictures in the room below.
  if (recipe.type === "title") {
    const text = recipe.text ? TITLE_SLIDE_DESCRIPTION.rect : null;
    const above = text ?? TITLE_SLIDE_TITLE.rect;
    const y = above.y + above.height + BLANK_GAP;
    return { title: TITLE_SLIDE_TITLE.rect, text, pictures: { x: left, y, width, height: bottom - y } };
  }
  const hasText = !!recipe.text && recipe.layout !== "title-only";

  if (recipe.layout === "text-left" && (recipe.title || hasText)) {
    const column = (width - BLANK_GAP) / 2;
    const title = recipe.title ? { x: left, y: BLANK_MARGIN, width: column, height: BLANK_TITLE_HEIGHT } : null;
    const textTop = title ? BLANK_MARGIN + BLANK_TITLE_HEIGHT + BLANK_GAP : BLANK_MARGIN;
    return {
      title,
      text: hasText ? { x: left, y: textTop, width: column, height: bottom - textTop } : null,
      pictures: { x: left + column + BLANK_GAP, y: BLANK_MARGIN, width: column, height: bottom - BLANK_MARGIN },
    };
  }

  // text-top and title-only: title, then text, then pictures, top to bottom.
  let y = BLANK_MARGIN;
  let title: Rect | null = null;
  let text: Rect | null = null;
  if (recipe.title) {
    const height = recipe.layout === "title-only" ? BLANK_BIG_TITLE_HEIGHT : BLANK_TITLE_HEIGHT;
    title = { x: left, y, width, height };
    y += height + BLANK_GAP;
  }
  if (hasText) {
    const height = textHeightFor(stripMarkup(recipe.text!), width, recipe.textFontSize ?? TEXT_BOX_FONT_SIZE);
    text = { x: left, y, width, height: Math.min(BLANK_MAX_TEXT_HEIGHT, height) };
    y += text.height + BLANK_GAP;
  }
  return { title, text, pictures: { x: left, y, width, height: bottom - y } };
}

function textBox(rect: Rect, html: string, fontSize?: number): SvgElement {
  const asset = ELEMENT_LIBRARY.find((a) => a.isTextBox)!;
  return { id: createId(), assetId: asset.id, ...rect, color: asset.defaultColor!, containerId: null, text: { html, fontSize } };
}

// ---------------------------------------------------------------------------------------------
// Callouts: arrows with labels pointing at part of a picture
// ---------------------------------------------------------------------------------------------

type Callout = z.infer<typeof calloutRecipe>;
interface Pad {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

// Callout sizes in px. They stay the same whatever the picture's size, so a big picture doesn't get
// giant labels, and labels don't take room the picture could use.
const CALLOUT_GAP = 6; // between the arrow's tip and the picture
const CALLOUT_ARROW = 56; // arrow length
const CALLOUT_THICKNESS = 14; // the arrow element's height (its line and head scale with it)
const CALLOUT_LABEL_HEIGHT = 40; // fits one line of bold text at CALLOUT_LABEL_FONT_SIZE
const CALLOUT_LABEL_FONT_SIZE = 24;
// A label is as wide as its text: about this much per letter, plus a little room, within these limits.
const CALLOUT_LETTER_WIDTH = 14;
const CALLOUT_LABEL_PADDING = 16;
const CALLOUT_LABEL_WIDTH = { min: 60, max: 300 };
// How far along the picture each "at" points: a quarter, half or three quarters of the way.
const CALLOUT_AT = { top: 0.25, left: 0.25, middle: 0.5, bottom: 0.75, right: 0.75 };
// Most callouts from each side. Labels above or below would sit on top of each other, so just one there.
const CALLOUT_MAX = { left: 3, right: 3, top: 1, bottom: 1 };

/** An error message, or null when the callouts are fine. */
function checkCallouts(callouts: Callout[], isCanvas: boolean): string | null {
  if (callouts.length && !isCanvas) return "callouts only work on blank, title and custom slides.";
  for (const { from, at } of callouts) {
    const sideways = from === "left" || from === "right";
    const allowed = sideways ? ["top", "middle", "bottom"] : ["left", "middle", "right"];
    if (!allowed.includes(at)) return `a callout from the ${from} points at ${allowed.join(", ")} — not "${at}".`;
  }
  for (const side of ["left", "right", "top", "bottom"] as const) {
    if (callouts.filter((c) => c.from === side).length > CALLOUT_MAX[side])
      return `at most ${CALLOUT_MAX[side]} callout${CALLOUT_MAX[side] > 1 ? "s" : ""} from the ${side}.`;
  }
  return null;
}

function labelWidth(label: string): number {
  const width = label.length * CALLOUT_LETTER_WIDTH + CALLOUT_LABEL_PADDING;
  return Math.min(CALLOUT_LABEL_WIDTH.max, Math.max(CALLOUT_LABEL_WIDTH.min, width));
}

/** The room a picture's callouts need on each side of it. */
function calloutPad(callouts: Callout[], picture: Size): Pad {
  const on = (side: Callout["from"]) => callouts.filter((c) => c.from === side);
  const widest = (side: Callout["from"]) => Math.max(0, ...on(side).map((c) => labelWidth(c.label)));
  const sideways = (side: Callout["from"]) => (on(side).length ? CALLOUT_GAP + CALLOUT_ARROW + widest(side) : 0);
  const upDown = (side: Callout["from"]) => (on(side).length ? CALLOUT_GAP + CALLOUT_ARROW + CALLOUT_LABEL_HEIGHT : 0);
  // A label above or below can be wider than a narrow picture, so it also needs a little room at the sides.
  const overhang = Math.max(0, (Math.max(widest("top"), widest("bottom")) - picture.width) / 2);
  return {
    left: Math.max(sideways("left"), overhang),
    right: Math.max(sideways("right"), overhang),
    top: upDown("top"),
    bottom: upDown("bottom"),
  };
}

/** The picture shrunk (keeping its shape) just enough that it and its callouts fit in the area. */
function fitAroundCallouts(picture: Size, callouts: Callout[], area: Size): Size {
  if (!callouts.length) return picture;
  const pad = calloutPad(callouts, picture);
  const scale = Math.min(
    1,
    (area.width - pad.left - pad.right) / picture.width,
    (area.height - pad.top - pad.bottom) / picture.height,
  );
  return { width: picture.width * scale, height: picture.height * scale };
}

/** Each callout's arrow (a turned "line-arrow") and its label, around the placed picture. */
function calloutElements(picture: Rect, callouts: Callout[]): SvgElement[] {
  const arrowAsset = getElementAsset("line-arrow")!;
  const gap = CALLOUT_GAP;
  const length = CALLOUT_ARROW;
  const thickness = Math.max(MIN_ELEMENT_SIZE, CALLOUT_THICKNESS);
  const labelHeight = CALLOUT_LABEL_HEIGHT;

  return callouts.flatMap(({ from, at, label, color }) => {
    const width = labelWidth(label);
    let tip: { x: number; y: number };
    let labelRect: Rect;
    let align: "left" | "center" | "right" = "center";
    // The arrow is drawn pointing right; turning it makes it point at the picture.
    const rotation = { left: 0, right: 180, top: 90, bottom: 270 }[from];
    if (from === "left" || from === "right") {
      const y = picture.y + CALLOUT_AT[at] * picture.height;
      tip = { x: from === "left" ? picture.x - gap : picture.x + picture.width + gap, y };
      const tailX = from === "left" ? tip.x - length : tip.x + length;
      labelRect = { x: from === "left" ? tailX - width : tailX, y: y - labelHeight / 2, width, height: labelHeight };
      align = from === "left" ? "right" : "left";
    } else {
      const x = picture.x + CALLOUT_AT[at] * picture.width;
      tip = { x, y: from === "top" ? picture.y - gap : picture.y + picture.height + gap };
      const tailY = from === "top" ? tip.y - length : tip.y + length;
      labelRect = { x: x - width / 2, y: from === "top" ? tailY - labelHeight : tailY, width, height: labelHeight };
    }
    // The arrow's middle is half its length back from the tip, toward where it comes from.
    const back = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] }[from];
    const middle = { x: tip.x + (back[0] * length) / 2, y: tip.y + (back[1] * length) / 2 };
    const arrow: SvgElement = {
      id: createId(),
      assetId: arrowAsset.id,
      x: middle.x - length / 2,
      y: middle.y - thickness / 2,
      width: length,
      height: thickness,
      color: color ?? arrowAsset.defaultColor ?? DEFAULT_ELEMENT_COLOR,
      containerId: null,
      ...(rotation && { rotation }),
    };
    return [arrow, textBox(labelRect, markupToHtml(label, { bold: true, align }), CALLOUT_LABEL_FONT_SIZE)];
  });
}

// ---------------------------------------------------------------------------------------------
// Design: background color and decorations
// ---------------------------------------------------------------------------------------------

type Decoration = z.infer<typeof decorationRecipe>;

// Decorations (blank slides only): big in the corners, small along the bottom strip.
const CORNER_SIZE = 180;
const STRIP_ITEM_SIZE = 40;
function decorationElements(item: Decoration): SvgElement[] {
  // A library picture, or Claude's own drawing.
  const look = item.svg
    ? { assetId: CUSTOM_SVG_ID, color: DEFAULT_ELEMENT_COLOR, svg: withSvgNamespace(item.svg) }
    : { assetId: item.asset!, color: item.color ?? getElementAsset(item.asset!)?.defaultColor ?? DEFAULT_ELEMENT_COLOR };
  return decorationRects(item.spot).map((rect) => {
    const opacity = item.opacity ?? DECORATION_OPACITY;
    const flip = { ...(item.flipX && { flipX: true }), ...(item.flipY && { flipY: true }) };
    return { id: createId(), ...look, ...rect, containerId: null, ...flip, ...(opacity < 100 && { opacity }) };
  });
}

/** Claude's artwork wrapped in a see-through layer; the inner <svg> keeps its own viewBox and fills the slide. */
function softened(markup: string, opacity: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" preserveAspectRatio="none"><g opacity="${opacity / 100}">${markup}</g></svg>`;
}

/** An SVG only shows as an image when it names the SVG namespace, so add it if Claude left it out. */
function withSvgNamespace(markup: string): string {
  const trimmed = markup.trim();
  return /<svg[^>]*\sxmlns=/i.test(trimmed) ? trimmed : trimmed.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
}

function decorationRects(spot: Decoration["spot"]): Rect[] {
  if (spot === "bottom-strip") {
    // Small copies in a centered row along the bottom edge.
    const count = Math.floor((CANVAS_WIDTH + GAP) / (STRIP_ITEM_SIZE + GAP));
    const startX = (CANVAS_WIDTH - (count * (STRIP_ITEM_SIZE + GAP) - GAP)) / 2;
    const y = CANVAS_HEIGHT - STRIP_ITEM_SIZE - 8;
    return Array.from({ length: count }, (_, i) => ({
      x: startX + i * (STRIP_ITEM_SIZE + GAP),
      y,
      width: STRIP_ITEM_SIZE,
      height: STRIP_ITEM_SIZE,
    }));
  }
  return [
    {
      x: spot.endsWith("left") ? 0 : CANVAS_WIDTH - CORNER_SIZE,
      y: spot.startsWith("top") ? 0 : CANVAS_HEIGHT - CORNER_SIZE,
      width: CORNER_SIZE,
      height: CORNER_SIZE,
    },
  ];
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

// Tallest strip an import makes (px), so the options never shrink more than they need to.
const MAX_IMPORT_STRIP_HEIGHT = 240;

// For each px of font size, a character is about this wide and a line this tall (px).
const CHAR_WIDTH_PER_PX = 0.525;
const LINE_HEIGHT_PER_PX = 1.25;
// The room the question box's edges take (px), top + bottom (and left + right): p-4 plus its 1px border.
const QUESTION_PADDING = 34;
// Room the question text has across: slides from Claude are numbered, so their question box is narrower.
const QUESTION_TEXT_WIDTH = QUESTION_CONTAINER_WIDTH - QUESTION_PADDING - QUESTION_NUMBER_INDENT;

/** Roughly how tall `text` is at `fontSize` in a box `width` wide. Each \n starts a new line. */
function textHeightFor(text: string, width: number, fontSize: number): number {
  const charsPerLine = Math.max(1, Math.floor(width / (fontSize * CHAR_WIDTH_PER_PX)));
  const lines = text.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
  return lines * fontSize * LINE_HEIGHT_PER_PX;
}

/** A question box just tall enough for its text — short questions get a shorter box. Never taller than the default. */
function questionHeightFor(question: string, fontSize = QUESTION_FONT_SIZE): number {
  const height = textHeightFor(question, QUESTION_TEXT_WIDTH, fontSize) + QUESTION_PADDING;
  return Math.min(DEFAULT_QUESTION_HEIGHT, height);
}

function toContainerId(box: BoxName, slide: Slide): string | null {
  if (box === "canvas") return null;
  if (box === "side") return SIDE_CONTAINER_ID;
  return slide.options[OPTION_LABELS.indexOf(box)].id;
}

// The math tools' setting names, and which asset's `mathTool` each belongs to.
const MATH_SETTINGS = ["fraction", "tenFrame", "baseTen", "thermometer", "barGraph", "protractor"] as const;

/** The element's settings in the app's own format, or an error message. */
function buildSettings(el: ElementRecipe, asset: Asset): Partial<SvgElement> | string {
  const settings: Partial<SvgElement> = {};

  if (el.clockTime) {
    if (!asset.isClock) return "clockTime only works on clock and digital-clock.";
    settings.clockTime = el.clockTime;
  }

  if (el.numberLine) {
    if (!asset.numberLine) return "numberLine only works on number-line and integer-number-line.";
    const { ticks, centered } = asset.numberLine;
    const { start, step, hidden } = el.numberLine;
    // The recipe hides numbers by value; the app stores tick positions.
    const values = Array.from({ length: ticks }, (_, i) => getNumberLineValue(i, ticks, centered, { start, step, hidden: [] }));
    const missing = hidden.filter((value) => !values.includes(value));
    if (missing.length) return `hidden has ${missing.join(", ")}, but the line only shows ${values.join(", ")}.`;
    settings.numberLine = { start, step, hidden: values.flatMap((value, i) => (hidden.includes(value) ? [i] : [])) };
  }

  // Fraction bars/circles and the written fraction share the `fraction` setting.
  const tool = asset.mathTool === "fractionNumber" ? "fraction" : asset.mathTool;
  for (const key of MATH_SETTINGS) {
    if (el[key] && tool !== key) return `${key} doesn't work on ${el.asset}.`;
  }

  if (el.fraction) {
    const { parts, shaded } = el.fraction;
    if (asset.mathTool === "fraction") {
      if (parts < FRACTION_PARTS.min || parts > FRACTION_PARTS.max)
        return `fraction.parts must be ${FRACTION_PARTS.min}–${FRACTION_PARTS.max}.`;
      if (shaded > parts) return "fraction.shaded can't be more than fraction.parts.";
    }
    settings.fraction = el.fraction;
  }
  if (el.tenFrame) {
    if (el.tenFrame.count > el.tenFrame.rows * el.tenFrame.columns) return "tenFrame.count can't be more than rows × columns.";
    settings.tenFrame = el.tenFrame;
  }
  if (el.baseTen) settings.baseTen = el.baseTen;
  if (el.thermometer) settings.thermometer = el.thermometer;
  if (el.barGraph) settings.barGraph = el.barGraph;
  if (el.protractor) settings.protractor = el.protractor;

  if (el.rotation !== undefined) {
    if (asset.is3d) return `"rotation" doesn't work on 3D solids. Use "tilt" and "turn".`;
    settings.rotation = el.rotation;
  }
  if (el.tilt !== undefined || el.turn !== undefined) {
    if (!asset.is3d) return '"tilt" and "turn" only work on 3D solids.';
    settings.rotation3d = { x: el.tilt ?? DEFAULT_ROTATION_3D.x, y: el.turn ?? DEFAULT_ROTATION_3D.y };
  }
  if (el.opacity !== undefined && el.opacity < 100) settings.opacity = el.opacity;
  if (el.cornerRadius) {
    if (!asset.roundCorners) return '"cornerRadius" only works on square and rectangle.';
    settings.cornerRadius = el.cornerRadius;
  }
  if (el.flipX) settings.flipX = true;
  if (el.flipY) settings.flipY = true;

  if (el.crop) {
    const { x, y, width, height } = el.crop;
    if (!canCrop({ assetId: el.asset })) return `"crop" doesn't work on ${el.asset}.`;
    if (x + width > 100 || y + height > 100) return "crop: x + width and y + height can't be more than 100.";
    // The app keeps crops as parts (0–1) of the whole picture; the whole picture is left as no crop.
    if (width < 100 || height < 100) settings.crop = { x: x / 100, y: y / 100, width: width / 100, height: height / 100 };
  }

  return settings;
}

// ---------------------------------------------------------------------------------------------
// Placing: size each element from its box, then lay them out like words in a sentence.
// ---------------------------------------------------------------------------------------------

// How tall each size is, as a share of the box's height.
const SIZE_SHARE = { small: 0.3, medium: 0.55, large: 0.85 };
// Sizes are worked out from at least this box height (px), so pictures in short boxes (the 120px
// strip, list options ~70–100px) aren't tiny — many drawings (e.g. the car) only fill part of their
// square. placeInBox still shrinks them to fit the real box.
const MIN_SIZE_BASE = 180;
// Space between elements, and from the box's right edge when placed on the right (px).
const GAP = 16;

/** The size an element starts at before placing: a share of the box height, in the asset's own shape. */
function startSize(asset: Asset, settings: Partial<SvgElement>, size: SizeName, box: Size): Size {
  // Assets whose shape depends on their settings (counting frame, base-ten blocks) take it from the
  // drawing area; the rest from their default size (e.g. wide number lines), or a square.
  const [, , viewWidth, viewHeight] = getAssetViewBox(asset, settings).split(" ").map(Number);
  const full =
    typeof asset.viewBox === "function" ? { width: viewWidth, height: viewHeight } : (asset.defaultSize ?? { width: 1, height: 1 });
  // A cropped picture's box is only the shown part, so it takes that part's shape.
  const crop = settings.crop ?? { width: 1, height: 1 };
  const shape = { width: full.width * crop.width, height: full.height * crop.height };
  // 3D solids are drawn smaller inside their box, so they start 30% bigger (like in the editor).
  const height = Math.max(box.height, MIN_SIZE_BASE) * SIZE_SHARE[size] * (asset.is3d ? 1.3 : 1);
  return { width: (height * shape.width) / shape.height, height };
}

// An element waiting to be placed: its size, and which picture it is (for the rows-of-5 rule).
interface Item extends Size {
  assetId: string;
}

interface Row {
  items: Item[];
  width: number;
  height: number;
}

// Most copies of the same picture in one row, so counting is easy (8 apples = 5 + 3), like a ten frame.
const MAX_SAME_IN_ROW = 5;

// Math signs. Pictures with one of these are an equation (e.g. [1/2 bar] = [2/4 bar]), which reads
// wrong when it wraps, so it's kept on one row by shrinking — down to 30% of the starting size.
// That's lower than it sounds: wide pictures start very big (a "large" fraction bar is ~1200px wide),
// so two bars and an "=" in one row are still ~500px wide each.
const MATH_SIGN_IDS = new Set(["symbol-plus", "symbol-minus", "symbol-multiply", "symbol-divide", "symbol-equals"]);
const MIN_EQUATION_SCALE = 0.3;

/**
 * Places the elements left to right, starting a new row when one is full. The rows as a whole are
 * centered top to bottom; each row is centered, or with "right" kept to the box's right half (the
 * left half is for the box's text). If they don't fit, everything shrinks a little and is tried again.
 * An equation first tries to stay on one row; only if it would get too small does it wrap like the rest.
 */
function placeInBox(items: Item[], box: Size, align: "center" | "right"): Rect[] {
  if (items.some((item) => MATH_SIGN_IDS.has(item.assetId))) {
    const oneRow = placeInRows(items, box, align, { wrap: false, minScale: MIN_EQUATION_SCALE });
    if (oneRow) return oneRow;
  }
  return placeInRows(items, box, align, { wrap: true, minScale: 0.05 })!;
}

/**
 * One placing attempt: shrinks until everything fits, down to `minScale`. Without `wrap` everything
 * stays on one row, and it gives up (null) if that doesn't fit; with `wrap` it places them anyway.
 */
function placeInRows(
  items: Item[],
  box: Size,
  align: "center" | "right",
  { wrap, minScale }: { wrap: boolean; minScale: number },
): Rect[] | null {
  const areaWidth = align === "right" ? box.width / 2 - GAP : box.width;
  for (let scale = 1; ; scale *= 0.9) {
    const rows = wrapIntoRows(
      items.map((item) => ({ ...item, width: item.width * scale, height: item.height * scale })),
      wrap ? areaWidth : Infinity,
    );
    const totalHeight = rows.reduce((sum, row) => sum + row.height, 0) + GAP * (rows.length - 1);
    const fits = totalHeight <= box.height && rows.every((row) => row.width <= areaWidth);
    if (!fits && scale > minScale) continue;
    if (!fits && !wrap) return null;

    const rects: Rect[] = [];
    let y = (box.height - totalHeight) / 2;
    for (const row of rows) {
      let x = align === "right" ? box.width - GAP - row.width : (box.width - row.width) / 2;
      for (const item of row.items) {
        // fitInBox is only a safety net: the loop above already made everything fit.
        rects.push(fitInBox({ width: item.width, height: item.height, x, y: y + (row.height - item.height) / 2 }, box));
        x += item.width + GAP;
      }
      y += row.height + GAP;
    }
    return rects;
  }
}

function wrapIntoRows(items: Item[], maxWidth: number): Row[] {
  const rows: Row[] = [];
  for (const item of items) {
    const row = rows[rows.length - 1];
    const lastFew = row?.items.slice(-MAX_SAME_IN_ROW) ?? [];
    const sameRowFull = lastFew.length === MAX_SAME_IN_ROW && lastFew.every((other) => other.assetId === item.assetId);
    if (row && !sameRowFull && row.width + GAP + item.width <= maxWidth) {
      row.items.push(item);
      row.width += GAP + item.width;
      row.height = Math.max(row.height, item.height);
    } else {
      rows.push({ items: [item], width: item.width, height: item.height });
    }
  }
  return rows;
}
