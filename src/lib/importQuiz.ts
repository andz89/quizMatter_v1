// Turns a simple "recipe" JSON (e.g. written by Claude) into real slides. The recipe only says
// *what* goes on a slide ("3 apples, medium, in the question box"); this file works out *where*
// — every element's size and position — from the real box sizes.
import { z } from "zod";
import { createBlankSlide } from "./factories";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  DEFAULT_QUESTION_HEIGHT,
  DEFAULT_SHAPE_STRIP_HEIGHT,
  getContainerBounds,
  getMaxQuestionHeight,
  getMaxShapeStripHeight,
  hasShapeBox,
  MIN_QUESTION_HEIGHT,
  MIN_SHAPE_STRIP_HEIGHT,
  OPACITY_MIN,
  OPTION_FONT_SIZE,
  OPTION_LABELS,
  QUESTION_CONTAINER_WIDTH,
  QUESTION_FONT_SIZE,
  SIDE_CONTAINER_ID,
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
  getAssetViewBox,
  getElementAsset,
  getNumberLineValue,
  CUSTOM_SVG_ID,
} from "./svgLibrary";
import {
  DETAIL_MAX_LENGTH,
  FONT_SIZE_RANGE,
  GRADES,
  MAX_REFERENCE_LINKS,
  referenceSchema,
  type Slide,
  type SvgElement,
} from "./schema";

type Asset = NonNullable<ReturnType<typeof getElementAsset>>;

// ---------------------------------------------------------------------------------------------
// The recipe format. The same rules check an upload and (as JSON Schema) tell Claude what's allowed.
// ---------------------------------------------------------------------------------------------

// Claude doesn't place text boxes itself: a lesson's "title" and "text" become text boxes.
const ASSET_IDS = ELEMENT_LIBRARY.filter((asset) => !asset.isTextBox).map((asset) => asset.id) as [string, ...string[]];

const whole = (min: number, max: number) => z.number().int().min(min).max(max);
const assetId = z.enum(ASSET_IDS, { error: (issue) => `"${String(issue.input)}" isn't a picture in the app` });
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
// Claude's own drawings. They're shown as images (nothing inside can run), so this only checks
// that it's one <svg> and not huge — every drawing is stored inside the quiz.
const MAX_SVG_LENGTH = 20_000;
const svgMarkup = z
  .string()
  .max(MAX_SVG_LENGTH, `must be under ${MAX_SVG_LENGTH} characters`)
  .regex(/^\s*<svg[\s>][\s\S]*<\/svg>\s*$/i, "must be one <svg>…</svg>");

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
    .describe('Which box the picture goes in. Leave out for "side". Lesson slides ignore it.'),
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
    .describe("Lesson slides only: arrows with labels that point at parts of this picture."),
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
  position: rect
    .optional()
    .describe(
      "Place the picture yourself instead of letting the app place it, in px: on a lesson slide on the 1280×720 slide, on a question slide inside its box. Only with count 1.",
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
    opacity: whole(OPACITY_MIN, 100).optional().describe("How solid it is, in percent. Leave out for the default."),
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
    .describe('Fill and border colors of the picture box ("side"). Leave out for a plain box.'),
};

// Lesson slides are always white, with decorations and artwork.
const lessonDesign = {
  backgroundSvg: svgMarkup
    .optional()
    .describe('Your own full-slide artwork (viewBox="0 0 1280 720"), drawn over the white slide, behind everything. Always shown at 20% opacity.'),
  backgroundPattern: z
    .enum(BACKGROUND_PATTERN_IDS)
    .optional()
    .describe('A patterned background from the app, as a soft frame around the edges. Give this or "backgroundSvg", not both.'),
  design: z.array(decorationRecipe).max(6).default([]).describe("Decorations behind everything."),
};

// A text's font size (px). The text still shrinks to fit its box, so this is the largest it gets.
const fontSize = whole(FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max);
const fontSizeNote = "Largest font size in px; long text still shrinks to fit. Leave out unless the user asks for bigger or smaller text.";

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
    type: z.literal("short-answer"),
    ...common,
    ...questionBackground,
    ...questionBoxes,
    questionFontSize: fontSize.optional().describe(`The question. ${fontSizeNote}`),
    answer: z.string().describe("The answer the student should give."),
    elements,
  }),
  z.object({
    type: z.literal("lesson"),
    ...common,
    ...lessonDesign,
    layout: z
      .enum(["text-top", "text-left", "title-only"])
      .default("text-top")
      .describe(
        "text-top (the default and best choice) = title and text across the full width at the top, pictures big below; " +
          "text-left = title and text on the left half, pictures squeezed into the right half — only for a small, simple picture with no callouts; " +
          "title-only = a big centered title with pictures below (no text).",
      ),
    patternOpacity: whole(PATTERN_OPACITY_RANGE.min, PATTERN_OPACITY_RANGE.max)
      .optional()
      .describe('How solid "backgroundPattern" is, in percent. Leave out for 25.'),
    title: z.string().optional().describe("Short heading, shown in bold. **word** / *word* work here too."),
    titleFontSize: fontSize.optional().describe(`The title. ${fontSizeNote}`),
    titleStyle: textStyle.optional().describe("Look of the title (it's always bold)."),
    text: z
      .string()
      .optional()
      .describe("The lesson or instructions. Keep it short: 1–4 sentences. \\n starts a new paragraph. **word** makes a word bold, *word* italic."),
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
  }),
]);

export const quizRecipeSchema = z.object({ slides: z.array(slideRecipe).min(1) });

/**
 * Details about the lesson as a whole, which Claude fills in when it sends a lesson (see /api/mcp).
 * All optional. Who published it isn't here: that's the logged-in user who saves the lesson.
 */
export const quizDetailsSchema = z.object({
  title: z.string().trim().max(DETAIL_MAX_LENGTH.title).optional().describe('The lesson title, e.g. "Adding Fractions".'),
  description: z.string().trim().max(DETAIL_MAX_LENGTH.description).optional().describe("What the lesson covers, in 1–3 sentences."),
  grade: z.enum(GRADES).optional(),
  subject: z.string().trim().max(DETAIL_MAX_LENGTH.subject).optional().describe('e.g. "Mathematics", "Science", "English".'),
  curriculum: z.string().trim().max(DETAIL_MAX_LENGTH.curriculum).optional().describe('e.g. "MATATAG", "K to 12".'),
  learningCompetency: z
    .string()
    .trim()
    .max(DETAIL_MAX_LENGTH.learningCompetency)
    .optional()
    .describe("The learning competency the lesson targets, with its code if known."),
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
      'What the lesson is based on, one per item: a full https:// link, or a book / module name (e.g. "DepEd SLM Mathematics 5, Quarter 1 – Module 8"). Only links you are sure are real.',
    ),
});

export type QuizDetails = z.infer<typeof quizDetailsSchema>;

type SlideRecipe = z.infer<typeof slideRecipe>;
type ElementRecipe = z.infer<typeof elementRecipe>;

type BoxName = NonNullable<ElementRecipe["in"]> | "canvas";

// Which boxes each question slide type has. The question box isn't one: its text grows to fill the
// box, so pictures there would sit on top of it. The question's pictures go in the shape box ("side").
// Lesson slides have no boxes: their pictures go in the room the title and text leave on the canvas.
const BOXES: Record<"choice" | "short-answer", BoxName[]> = {
  choice: ["A", "B", "C", "D", "side"],
  "short-answer": ["side"],
};

// Tools you read a value from. They get the tall side box (list-side) and start large.
const READING_TOOLS = new Set(["clock", "digital-clock", "thermometer", "bar-graph", "protractor", "base-ten-blocks", "fraction-circle"]);

const CLAUDE_NOTES = `Write a lesson for my app (quizMatter) as JSON. A lesson is a set of slides: lesson slides that teach, and question slides. Reply with only the JSON. It must match the JSON Schema at the end.

The app makes every slide look good on its own: it sizes the boxes, places and sizes the pictures and picks the layout. Leave a setting out and the app decides. Every setting below is there for when you want something different — use them freely when they make a slide clearer or nicer, but you don't have to.

Never number the questions: write "Which change forms no new substance?", not "1. Which change…" or "Q1: Which change…". The app adds the numbers itself.

=== The slides and what is on each one ===

The slide is 1280 × 720 px.

1. "choice" — a question with 4 options (A–D). "answer" is the letter of the correct option.
   - Question box (top, full width): "question", "questionStyle", "questionFontSize", "questionHeight".
   - Picture box "side": for pictures that belong to the question. Where it sits depends on "layout":
     - "list" (4 rows) and "grid" (2×2): a wide strip between the question and the options. It only shows when you put pictures in "side". "stripHeight" sets its height.
     - "list-side": a tall box beside the 4 rows. Best for one big picture like a clock or a thermometer.
   - 4 option boxes "A", "B", "C", "D": "options" (the texts), "optionStyle", "optionFontSize". Each can also hold pictures.
   - "pictureBox": fill and border colors of the picture box.
   - "background": the slide's color.
2. "short-answer" — a question with no options. "answer" is the expected answer.
   - Question box (top, full width): "question", "questionStyle", "questionFontSize", "questionHeight".
   - Picture box "side": the big area under the question. Put the pictures for the question here (the apples to count, the shape to measure…). "pictureBox" colors it.
   - "background": the slide's color.
3. "lesson" — a white slide for teaching. Use it to:
   - teach before the questions (explain the idea with a picture),
   - give instructions for a new kind of question,
   - start a class discussion: ask an open question with no right answer ("Which fruit do you like best? Why?", "Where do you see fractions at home?").
   - It has no boxes. "title" and "text" become text boxes ("titleStyle", "textStyle", "titleFontSize", "textFontSize"), and the pictures fill the room they leave, as "layout" says.
   - "textBoxes": extra text boxes you place yourself anywhere (labels, a speech bubble's words, a second paragraph).
   - Pictures can be placed by the app (default) or by you ("position").
   - "design", "backgroundPattern" or "backgroundSvg" make it friendly (see Design below).

The question box never holds pictures. Pictures always go in a picture box or an option.

=== Text ===

- Styled words: inside any text, **word** makes it bold and *word* makes it italic. Write × for times, not *.
- Style for a whole text ("questionStyle", "optionStyle", "titleStyle", "textStyle", a text box's "style"): "color", "align" (left, center, right), "bold", "italic", "underline". Keep colors dark enough to read.
- "\\n" starts a new line (a new paragraph).
- Font sizes: every text shrinks to fit its box, so the font size is the largest a text gets. Defaults: question ${QUESTION_FONT_SIZE}px, options ${OPTION_FONT_SIZE}px, lesson title and text ${TEXT_BOX_FONT_SIZE}px. You can set ${FONT_SIZE_RANGE.min}–${FONT_SIZE_RANGE.max}px, e.g. bigger text for young learners.
- Keep text short so it stays big and easy to read: a question in 1–2 lines (about 100 characters), an option in 1 line (about 40 characters in a list row, 20 in a grid cell), a lesson text in 1–4 sentences.

=== Box sizes (question slides) ===

The question box, the strip and the options share the slide's height, so giving one more room takes it from the others.
- "questionHeight" (px, at least ${MIN_QUESTION_HEIGHT}): leave it out and the box fits the question. Give it when a long question needs more room, or a short one should leave more room below. The most it can be:
  - "grid": ${getMaxQuestionHeight({ layout: "grid" })}, or ${getMaxQuestionHeight({ layout: "grid", hasShapeBox: true })} with a strip.
  - "list": ${getMaxQuestionHeight({ layout: "list" })}, or ${getMaxQuestionHeight({ layout: "list", hasShapeBox: true })} with a strip.
  - "list-side": ${getMaxQuestionHeight({ layout: "list-side" })}.
  - "short-answer": ${getMaxQuestionHeight({ type: "short-answer", layout: "list" })}.
- "stripHeight" (px, at least ${MIN_SHAPE_STRIP_HEIGHT}; "grid" and "list" with pictures in "side"): leave it out and the app gives it the room the options can spare. A taller strip means shorter options. If a height is too big, the error says the most allowed.

=== Which layout for a choice slide ===

Leave "layout" out and the app picks with these same rules:
- Read one tool (clock, thermometer, bar graph, protractor, base-ten blocks) → "list-side", the tool in "side".
- The answers are pictures ("Which shows 3/4?") or have pictures → "grid", one picture per option, option text "" or 1–3 words.
- Text-only answers, short or long → "list" (4 rows). Pictures for the question (e.g. the apples to count) go in "side".
- Calculate or type an answer, no choices → use a "short-answer" slide instead.

Lesson layouts:
- "text-top" (default, best): title and text across the full width, pictures big below. Use it for lessons with a picture, always when the picture has callouts.
- "text-left": title and text on the left half, pictures in the right half — only for a small, simple picture.
- "title-only": a big centered title, pictures below, no text.

=== Pictures ("elements") ===

Where they go ("in", default "side"; lesson slides leave "in" out):
- "side": the question's picture box (see above).
- "A", "B", "C", "D": an option box. If the option has text, its pictures sit on the right half, beside the text. Keep that text short (1–3 words). An option can be just a picture: leave its text empty ("").

How they look:
- "size" (small, medium, large) is compared to the box. On "grid" and "list" slides, small is shown as medium.
- "count" repeats a picture. More than 5 of the same picture wrap in rows of 5 (8 apples = 5 + 3), so they are easy to count.
- For a picture sum, list the pieces in order: 2 apples, "symbol-plus", 3 apples. Numbers and symbols take the size of the pictures next to them.
- "color" recolors a picture. "opacity" (${OPACITY_MIN}–100%) makes it see-through.
- "rotation" (0–359°) turns a flat picture. 3D solids (cube, cone…) use "tilt" (−90 to 90°) and "turn" (−180 to 180°) instead, to show them from another side.
- Settings like "clockTime", "fraction", "numberLine", "tenFrame", "baseTen", "thermometer", "barGraph" and "protractor" only work on the pictures named in their description.
- Keep "elements" useful: they should help answer the question or explain the lesson. Decoration goes in "design".

Placing them yourself:
- The app places, centers and sizes pictures itself. To choose the spot yourself, give "position": { x, y, width, height } in px (x, y = top-left corner). Only with count 1.
  - Lesson slides: on the 1280 × 720 slide. Keep placed pictures off the title and text.
  - Question slides: inside the picture's box ("side" or an option), from the box's top-left corner. The box sizes are in the layout report.
- Anything past its box's edge is pulled back in.
- "textBoxes" (lesson slides) are placed the same way, and sit on top of pictures — good for labels on a picture.

After you send (the layout report):
- send_lesson replies with a layout report: every box's size, and where each text and picture landed, in the same px as "position". Lines starting with "!" point out things to check: pictures that wrapped to more rows or shrank a lot, pictures on top of text, text that will probably shrink.
- Check it against what you meant. To fix something, change the lesson (e.g. give "position" with the numbers you want) and call send_lesson again with the "draftId" it gave you. That replaces the draft and keeps the same link.

Arrows that point at part of a picture ("callouts", lesson slides only):
- Use them to show where something is: the numerator and the denominator of a fraction, the hour hand of a clock, the tallest bar of a graph.
- "from" = where the arrow comes from: left, right, top or bottom. "at" = which part it points at: top, middle or bottom for arrows from the left or right; left, middle or right for arrows from the top or bottom.
- Up to 3 from the left and 3 from the right; at most 1 from the top and 1 from the bottom.
- Give the picture "size": "large" so the arrows and labels have room.
- On "text-top" lessons the room below the text is wide but not tall, so bring arrows from the left and right. An arrow from the top or bottom takes height and makes the picture smaller.
- On a picture with "position", leave room around it for the arrows and labels (about 60px for the arrow plus the label's width).

=== Design ===

Question slides — keep them plain:
- No decorations, no pattern, no artwork: question slides don't have "design", "backgroundPattern" or "backgroundSvg".
- "background": you may give a soft, light color (e.g. #FEF3C7, #E0F2FE, #DCFCE7, #FCE7F3, #EDE9FE), or leave it out for white. Use one color family for the whole lesson. Dark colors are lightened automatically, because the text is dark.
- "pictureBox": a soft fill and/or border for the picture box, in the same color family, so the pictures stand out.

Lesson slides — always white, made friendly with design:
- There is no background color to set on lesson slides.
- "design": decorations drawn behind everything, placed at a "spot". Pick ones that match the topic (leaves and trees for nature, sparkle and confetti for celebrations, planets for space, clouds for weather, shapes like circle, star or wave for anything) in 2–3 colors that go well together.
  - The 4 corners (big, about 180px; see-through where they sit under text) and "bottom-strip" (a row of small copies along the bottom). Use 2–4 decorations. "opacity" sets how solid each one is.

Background artwork (lesson slides only) — each lesson slide can have one of these (or none, just plain white):
- Option 1, "backgroundPattern": a ready-made pattern from the app: ${BACKGROUND_PATTERN_IDS.join(", ")}. It shows as a soft frame around the slide's edges, at 25% opacity unless you set "patternOpacity"; the middle stays plain white. It replaces "design": a slide with a pattern gets no decorations.
- Option 2, "backgroundSvg": your own full-slide artwork, drawn over the white slide, behind everything. Use viewBox="0 0 1280 720". Good ideas: soft waves along the bottom, blobs in the corners, a sunburst, a frame. Keep the middle mostly empty so the text stays easy to read.
  - Always 20% opacity: the app shows your artwork at 20%, so draw it in full, bright colors and let the app soften it.
- Mix them across the lesson: patterns on some slides, your own artwork or decorations on others.

Your own drawings (SVG) — for lesson design only:
- In "design", give "svg" instead of "asset" to draw your own decoration for a spot (square viewBox, e.g. "0 0 100 100").
- Rules: one <svg>…</svg>, under 20,000 characters. Use shapes, paths and gradients (path, circle, ellipse, rect, polygon, line, g, defs, linearGradient, radialGradient, stop). No images, scripts or links — they won't show.
- Teaching pictures (the ones in "elements") always come from "asset", never your own drawings.

Example:
{
  "slides": [
    {
      "type": "lesson",
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
      "type": "lesson",
      "design": [{ "asset": "leaf-maple", "spot": "bottom-strip", "color": "#16A34A" }],
      "title": "Let's talk!",
      "text": "Which fruit do you like **best**? Why?",
      "elements": [{ "asset": "apple" }, { "asset": "banana" }, { "asset": "grapes" }]
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
  return CLAUDE_NOTES + JSON.stringify(z.toJSONSchema(quizRecipeSchema, { io: "input" }), null, 2);
}

// ---------------------------------------------------------------------------------------------
// Recipe → slides
// ---------------------------------------------------------------------------------------------

/**
 * `drawPatterns: false` skips drawing background patterns (they need react-dom/server, which
 * Cloudflare Workers don't have) — for the MCP server, which only wants the errors.
 */
export function buildSlides(
  data: unknown,
  { drawPatterns = true } = {},
): { slides: Slide[]; report: string } | { errors: string[] } {
  const parsed = quizRecipeSchema.safeParse(data);
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
      const layout = recipe.type === "lesson" ? `, ${recipe.layout}` : recipe.type === "choice" ? `, ${slide.layout}` : "";
      return [`Slide ${i + 1} (${slide.type}${layout})`, ...report].join("\n  ");
    })
    .join("\n\n");
  return { slides: built.map(({ slide }) => slide), report };
}

const CANVAS: Size = { width: CANVAS_WIDTH, height: CANVAS_HEIGHT };

type QuestionRecipe = Extract<SlideRecipe, { type: "choice" | "short-answer" }>;

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
  if (recipe.type === "lesson") {
    if (recipe.backgroundPattern && recipe.backgroundSvg) reportError('give "backgroundPattern" or "backgroundSvg", not both.');
    slide.backgroundSvg = recipe.backgroundSvg && softened(withSvgNamespace(recipe.backgroundSvg));
    // The pattern sits on the plain white slide.
    if (recipe.patternOpacity !== undefined && !recipe.backgroundPattern) reportError('"patternOpacity" needs a "backgroundPattern".');
    if (recipe.backgroundPattern && drawPatterns) {
      slide = withBackground(slide, { backgroundPattern: recipe.backgroundPattern, backgroundOpacity: recipe.patternOpacity });
    }
  } else {
    // Dark colors are lightened, because the text is dark.
    slide.background = recipe.background && lighten(recipe.background);
    slide.shapeBoxFill = recipe.pictureBox?.fill;
    slide.shapeBoxBorder = recipe.pictureBox?.border;
  }

  if (recipe.type === "choice") {
    const options = blank.options.map((option, i) => ({
      ...option,
      text: stripMarkup(recipe.options[i]),
      html: recipe.options[i] ? markupToHtml(recipe.options[i], recipe.optionStyle) : undefined,
      fontSize: recipe.optionFontSize,
    })) as Slide["options"];
    const layout = recipe.layout ?? pickLayout(recipe.options, recipe.elements);
    slide = {
      ...slide,
      layout,
      ...questionFields(recipe),
      options,
      correctOptionId: options[OPTION_LABELS.indexOf(recipe.answer)].id,
      // Grid/list slides only show the side box (as a strip) once it's turned on.
      hasShapeBox: layout !== "list-side" && recipe.elements.some((el) => (el.in ?? "side") === "side"),
    };
    if (recipe.stripHeight !== undefined && !slide.hasShapeBox) {
      reportError('"stripHeight" only works on "grid" or "list" slides with pictures in "side".');
    }
  } else if (recipe.type === "short-answer") {
    slide = { ...slide, ...questionFields(recipe), correctAnswer: recipe.answer };
  }

  if (recipe.type !== "lesson") {
    if (recipe.pictureBox && !hasShapeBox(slide)) reportError('"pictureBox" needs a picture box: put pictures in "side".');
    // The question box and the strip share the room above the options, so each one's limit depends on the other.
    const stripHeight = recipe.type === "choice" ? recipe.stripHeight : undefined;
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

  // Lesson slides: the title and text become text boxes, and the pictures get the room that's left.
  const lesson = recipe.type === "lesson" ? lessonAreas(recipe) : null;
  if (recipe.type === "lesson" && recipe.layout === "title-only" && recipe.text) {
    reportError('a "title-only" lesson has no text. Use "text-top" or "text-left", or leave "text" out.');
  }
  // Every lesson text box, with a name and its words, for the report.
  const texts: LessonText[] = [];
  const textBoxes: SvgElement[] = [];
  if (recipe.type === "lesson" && lesson?.title) {
    const align = recipe.layout === "title-only" ? "center" : "left";
    textBoxes.push(textBox(lesson.title, markupToHtml(recipe.title!, { align, ...recipe.titleStyle, bold: true }), recipe.titleFontSize));
    texts.push({ label: "title", box: textBoxes.at(-1)!, words: stripMarkup(recipe.title!) });
  }
  if (recipe.type === "lesson" && lesson?.text) {
    textBoxes.push(textBox(lesson.text, markupToHtml(recipe.text!, recipe.textStyle), recipe.textFontSize));
    texts.push({ label: "text", box: textBoxes.at(-1)!, words: stripMarkup(recipe.text!) });
  }
  // Text boxes Claude placed itself. They sit on top of the pictures, so a label can go on one.
  const placedText =
    recipe.type === "lesson"
      ? recipe.textBoxes.map((box, i) => {
          const element = textBox(fitInBox(box.position, CANVAS), markupToHtml(box.text, box.style), box.fontSize);
          texts.push({ label: `text box ${i + 1}`, box: element, words: stripMarkup(box.text) });
          return element;
        })
      : [];

  // The area a box's pictures are placed in: the lesson's picture area, or the box itself.
  const areaOf = (containerId: string | null): Rect =>
    lesson && containerId === null ? lesson.pictures : { x: 0, y: 0, ...getContainerBounds(containerId, slide) };
  const boxOf = (el: ElementRecipe): BoxName => (recipe.type === "lesson" ? "canvas" : (el.in ?? "side"));

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
    if (recipe.type !== "lesson" && !BOXES[recipe.type].includes(boxName)) {
      reportError(`${where}: a ${recipe.type} slide has no "${boxName}" box. Use one of: ${BOXES[recipe.type].join(", ")}.`);
      return;
    }
    const asset = getElementAsset(el.asset)!;
    const settings = buildSettings(el, asset);
    const calloutError = el.callouts && checkCallouts(el.callouts, recipe.type);
    if (typeof settings === "string" || calloutError) {
      reportError(`${where}: ${calloutError || settings}`);
      return;
    }

    const color = el.color ?? asset.defaultColor ?? DEFAULT_ELEMENT_COLOR;
    const containerId = toContainerId(boxName, slide);
    // A picture Claude placed itself skips the app's placing. Its position is inside its box (on a
    // lesson slide, the whole slide).
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
    if (recipe.type === "choice" && slide.layout !== "list-side" && size === "small") size = "medium";
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

  // Drawn first, so they sit behind everything. Where one would sit under text, it's made see-through.
  const textRects = [...textBoxes, ...placedText].map((box) => ({ x: box.x, y: box.y, width: box.width, height: box.height }));
  // Only lesson slides have decorations. A pattern background is already the slide's decoration,
  // so other decorations would only crowd it.
  const design = recipe.type !== "lesson" || recipe.backgroundPattern ? [] : recipe.design;
  const decorations = design.flatMap((item, i) => {
    if (!item.asset === !item.svg) {
      reportError(`decoration ${i + 1}${item.asset ? ` (${item.asset})` : ""}: give "asset" or "svg" (one of them).`);
      return [];
    }
    return decorationElements(item, textRects);
  });

  slide = { ...slide, elements: [...decorations, ...textBoxes, ...pictures, ...placedText, ...calloutParts] };
  return { slide, report: describeSlide(slide, texts, pictures, notes) };
}

// ---------------------------------------------------------------------------------------------
// The layout report: where everything landed, sent back to Claude so it can check and fix it.
// ---------------------------------------------------------------------------------------------

interface LessonText {
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
function describeSlide(slide: Slide, texts: LessonText[], pictures: SvgElement[], notes: string[]): string[] {
  const lines: string[] = [];
  const warnings = [...notes];

  if (slide.type === "lesson") {
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
    const questionRoom = { width: QUESTION_CONTAINER_WIDTH - QUESTION_PADDING, height: slide.questionHeight - QUESTION_PADDING };
    const boxes = [`question ${QUESTION_CONTAINER_WIDTH}×${Math.round(slide.questionHeight)}`];
    if (hasShapeBox(slide)) boxes.push(`side ${formatSize(getContainerBounds(SIDE_CONTAINER_ID, slide))}`);
    if (slide.type === "choice") boxes.push(`A–D ${formatSize(getContainerBounds(slide.options[0].id, slide))} each`);
    lines.push(`Boxes: ${boxes.join(" · ")}`);
    if (tooLong(slide.question, questionRoom, questionFont)) {
      warnings.push(`the question is probably too long for its box at ${questionFont}px, so it will shrink.`);
    }
    if (slide.type === "choice") {
      slide.options.forEach((option, i) => {
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
// Lesson slides
// ---------------------------------------------------------------------------------------------

// Space around the slide's edge and between the text and the pictures (px).
// The margin is wider than a pattern background's 40px frame, so text never sits on the pattern.
const LESSON_MARGIN = 56;
const LESSON_GAP = 24;
const LESSON_TITLE_HEIGHT = 72;
const LESSON_BIG_TITLE_HEIGHT = 140;
// Longest text box across the top of a text-top lesson, so the pictures keep room below.
const LESSON_MAX_TEXT_HEIGHT = 240;

type LessonRecipe = Extract<SlideRecipe, { type: "lesson" }>;

/** Where a lesson's title, text and pictures go on the canvas (a missing title or text gets no area). */
function lessonAreas(recipe: LessonRecipe): { title: Rect | null; text: Rect | null; pictures: Rect } {
  const width = CANVAS_WIDTH - LESSON_MARGIN * 2;
  const bottom = CANVAS_HEIGHT - LESSON_MARGIN;
  const hasText = !!recipe.text && recipe.layout !== "title-only";

  if (recipe.layout === "text-left" && (recipe.title || hasText)) {
    const column = (width - LESSON_GAP) / 2;
    const title = recipe.title ? { x: LESSON_MARGIN, y: LESSON_MARGIN, width: column, height: LESSON_TITLE_HEIGHT } : null;
    const textTop = title ? LESSON_MARGIN + LESSON_TITLE_HEIGHT + LESSON_GAP : LESSON_MARGIN;
    return {
      title,
      text: hasText ? { x: LESSON_MARGIN, y: textTop, width: column, height: bottom - textTop } : null,
      pictures: { x: LESSON_MARGIN + column + LESSON_GAP, y: LESSON_MARGIN, width: column, height: bottom - LESSON_MARGIN },
    };
  }

  // text-top and title-only: title, then text, then pictures, top to bottom.
  let y = LESSON_MARGIN;
  let title: Rect | null = null;
  let text: Rect | null = null;
  if (recipe.title) {
    const height = recipe.layout === "title-only" ? LESSON_BIG_TITLE_HEIGHT : LESSON_TITLE_HEIGHT;
    title = { x: LESSON_MARGIN, y, width, height };
    y += height + LESSON_GAP;
  }
  if (hasText) {
    const height = textHeightFor(stripMarkup(recipe.text!), width, recipe.textFontSize ?? TEXT_BOX_FONT_SIZE);
    text = { x: LESSON_MARGIN, y, width, height: Math.min(LESSON_MAX_TEXT_HEIGHT, height) };
    y += text.height + LESSON_GAP;
  }
  return { title, text, pictures: { x: LESSON_MARGIN, y, width, height: bottom - y } };
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
function checkCallouts(callouts: Callout[], slideType: SlideRecipe["type"]): string | null {
  if (callouts.length && slideType !== "lesson") return "callouts only work on lesson slides.";
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

// Decorations (lesson slides only): big in the corners, small along the bottom strip.
const CORNER_SIZE = 180;
const STRIP_ITEM_SIZE = 40;
// Decorations are a little see-through by default, and at most this solid under text.
const DECORATION_OPACITY = 60;
const UNDER_TEXT_OPACITY = 25;

function decorationElements(item: Decoration, textRects: Rect[]): SvgElement[] {
  // A library picture, or Claude's own drawing.
  const look = item.svg
    ? { assetId: CUSTOM_SVG_ID, color: DEFAULT_ELEMENT_COLOR, svg: withSvgNamespace(item.svg) }
    : { assetId: item.asset!, color: item.color ?? getElementAsset(item.asset!)?.defaultColor ?? DEFAULT_ELEMENT_COLOR };
  return decorationRects(item.spot).map((rect) => {
    let opacity = item.opacity ?? DECORATION_OPACITY;
    if (textRects.some((text) => overlaps(text, rect))) opacity = Math.min(opacity, UNDER_TEXT_OPACITY);
    return { id: createId(), ...look, ...rect, containerId: null, ...(opacity < 100 && { opacity }) };
  });
}

// Claude's own background artwork is always shown this solid (0–1), so it stays calm behind the text.
const BACKGROUND_SVG_OPACITY = 0.2;

/** Claude's artwork wrapped in a see-through layer; the inner <svg> keeps its own viewBox and fills the slide. */
function softened(markup: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" preserveAspectRatio="none"><g opacity="${BACKGROUND_SVG_OPACITY}">${markup}</g></svg>`;
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

/** Roughly how tall `text` is at `fontSize` in a box `width` wide. Each \n starts a new line. */
function textHeightFor(text: string, width: number, fontSize: number): number {
  const charsPerLine = Math.max(1, Math.floor(width / (fontSize * CHAR_WIDTH_PER_PX)));
  const lines = text.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
  return lines * fontSize * LINE_HEIGHT_PER_PX;
}

/** A question box just tall enough for its text — short questions get a shorter box. Never taller than the default. */
function questionHeightFor(question: string, fontSize = QUESTION_FONT_SIZE): number {
  const height = textHeightFor(question, QUESTION_CONTAINER_WIDTH - QUESTION_PADDING, fontSize) + QUESTION_PADDING;
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
  const shape =
    typeof asset.viewBox === "function" ? { width: viewWidth, height: viewHeight } : (asset.defaultSize ?? { width: 1, height: 1 });
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
