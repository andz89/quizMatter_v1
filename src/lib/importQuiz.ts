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
  getMaxShapeStripHeight,
  OPACITY_MIN,
  OPTION_FONT_SIZE,
  OPTION_LABELS,
  QUESTION_CONTAINER_WIDTH,
  QUESTION_FONT_SIZE,
  SIDE_CONTAINER_ID,
  TEXT_BOX_FONT_SIZE,
} from "./constants";
import { textToHtml } from "./richText";
import { BACKGROUND_PATTERN_IDS, lighten, withBackground } from "./slideBackground";
import { fitInBox, MIN_ELEMENT_SIZE, type Rect, type Size } from "./geometry";
import { createId } from "./id";
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

// A text's font size (px). Text never shrinks to fit, so long text needs a smaller size.
const fontSize = whole(FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max);
const fontSizeNote = "Font size in px. Text does not shrink to fit: set a smaller size when the text is long.";

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
    question: z.string(),
    questionFontSize: fontSize.optional().describe(`The question. ${fontSizeNote}`),
    options: z.tuple([z.string(), z.string(), z.string(), z.string()]).describe("Options A, B, C, D in order."),
    optionFontSize: fontSize.optional().describe(`All 4 options. ${fontSizeNote}`),
    answer: z.enum(OPTION_LABELS).describe("Letter of the correct option."),
    elements,
  }),
  z.object({
    type: z.literal("short-answer"),
    ...common,
    ...questionBackground,
    question: z.string(),
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
    title: z.string().optional().describe("Short heading, shown in bold."),
    titleFontSize: fontSize.optional().describe(`The title. ${fontSizeNote}`),
    text: z.string().optional().describe("The lesson or instructions. Keep it short: 1–4 sentences. \\n starts a new paragraph."),
    textFontSize: fontSize.optional().describe(`The text. ${fontSizeNote}`),
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

Slide types:
- "choice": a question with 4 options (A–D). "answer" is the letter of the correct option.
- "short-answer": a question with no options. "answer" is the expected answer.
- Never number the questions: write "Which change forms no new substance?", not "1. Which change…" or "Q1: Which change…". The app adds the numbers itself.
- "lesson": a blank slide with a title, a short text and pictures. Use it to:
  - teach before the questions (explain the idea with a picture),
  - give instructions for a new kind of question,
  - start a class discussion: ask an open question with no right answer ("Which fruit do you like best? Why?", "Where do you see fractions at home?").

Text sizes: text does NOT shrink to fit its box. It shows at its font size, and text that doesn't fit is cut off. Defaults: question ${QUESTION_FONT_SIZE}px, options ${OPTION_FONT_SIZE}px, lesson title and text ${TEXT_BOX_FONT_SIZE}px.
- Keep text short: a question in 1–2 lines (about 100 characters), an option in 1 line (about 40 characters in a list row, 20 in a grid cell), a lesson text in 1–4 sentences.
- When text is longer, set a smaller size ("questionFontSize", "optionFontSize", "titleFontSize", "textFontSize", 12 to 96 px), e.g. 32 or 28.
- A "list" slide with pictures in "side" has short rows: set "optionFontSize": 32.
- Also set sizes when the user asks for bigger or smaller text, e.g. big text for young learners.
- If a text is still too long, send_lesson tells you which one: shorten it or make its font smaller.

Which layout for a choice slide (leave "layout" out and the app picks with these same rules):
- Read one tool (clock, thermometer, bar graph, protractor, base-ten blocks) → "list-side", the tool in "side".
- The answers are pictures ("Which shows 3/4?") or have pictures → "grid", one picture per option, option text "" or 1–3 words.
- Text-only answers, short or long → "list" (4 rows). Pictures for the question (e.g. the apples to count) go in "side".
- Calculate or type an answer, no choices → use a "short-answer" slide instead.

Where pictures go ("in", default "side"):
- "side": the picture box for the question. Put pictures that belong to the question here (never in the question text box).
  - Choice slides with layout "grid" or "list": a wide strip between the question and the options.
  - Choice slides with layout "list-side": a tall box beside the options. Best for one big picture like a clock or a thermometer.
  - Short-answer slides: the big area under the question.
- "A", "B", "C", "D": an option box (choice slides). If the option has text, its pictures sit on the right half, beside the text.
  - When an option has a picture, keep its text short (1–3 words).
  - An option can be just a picture: leave its text empty ("").
- Lesson slides: leave "in" out. Pictures fill the room the title and text leave.
  - Use layout "text-top" for lessons with a picture: the text runs across the full width and the picture gets the wide area below, so it's shown big. Don't use "text-left" when the picture has callouts — the half-width box makes the picture tiny.

Pictures:
- The app places, centers and sizes the pictures itself, so never give positions.
- "size" is compared to the box. Leave it out unless you need something different. On "grid" and "list" slides, small is shown as medium.
- "count" repeats a picture. More than 5 of the same picture wrap in rows of 5 (8 apples = 5 + 3), so they are easy to count.
- For a picture sum, list the pieces in order: 2 apples, "symbol-plus", 3 apples. Numbers and symbols take the size of the pictures next to them.
- Settings like "clockTime" or "fraction" only work on the pictures named in their description.
- Keep "elements" useful: they should help answer the question or explain the lesson. Decoration goes in "design".

Arrows that point at part of a picture ("callouts", lesson slides only):
- Use them in lessons and discussions to show where something is: the numerator and the denominator of a fraction, the hour hand of a clock, the tallest bar of a graph.
- "from" = where the arrow comes from: left, right, top or bottom. "at" = which part it points at: top, middle or bottom for arrows from the left or right; left, middle or right for arrows from the top or bottom.
- Up to 3 from the left and 3 from the right; at most 1 from the top and 1 from the bottom.
- Give the picture "size": "large" so the arrows and labels have room.
- On "text-top" lessons the room below the text is wide but not tall, so bring arrows from the left and right. An arrow from the top or bottom takes height and makes the picture smaller.

Question slides — keep them plain:
- No decorations, no pattern, no artwork: question slides don't have "design", "backgroundPattern" or "backgroundSvg".
- "background": you may give a soft, light color (e.g. #FEF3C7, #E0F2FE, #DCFCE7, #FCE7F3, #EDE9FE), or leave it out for white. Use one color family for the whole lesson. Dark colors are lightened automatically, because the text is dark.

Lesson slides — always white, made friendly with design:
- There is no background color to set on lesson slides.
- "design": decorations drawn behind everything, placed at a "spot". Pick ones that match the topic (leaves and trees for nature, sparkle and confetti for celebrations, planets for space, clouds for weather, shapes like circle, star or wave for anything) in 2–3 colors that go well together.
  - The 4 corners (big, about 180px; see-through where they sit under text) and "bottom-strip" (a row of small copies along the bottom). Use 2–4 decorations.

Background artwork (lesson slides only) — each lesson slide can have one of these (or none, just plain white):
- Option 1, "backgroundPattern": a ready-made pattern from the app: ${BACKGROUND_PATTERN_IDS.join(", ")}. It shows as a soft frame around the slide's edges, always at 25% opacity; the middle stays plain white. It replaces "design": a slide with a pattern gets no decorations.
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
      "text": "Which fruit do you like best? Why?",
      "elements": [{ "asset": "apple" }, { "asset": "banana" }, { "asset": "grapes" }]
    },
    {
      "type": "choice",
      "background": "#E0F2FE",
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
export function buildSlides(data: unknown, { drawPatterns = true } = {}): { slides: Slide[] } | { errors: string[] } {
  const parsed = quizRecipeSchema.safeParse(data);
  if (!parsed.success) return { errors: [z.prettifyError(parsed.error)] };

  const errors: string[] = [];
  const slides = parsed.data.slides.map((recipe, i) =>
    buildSlide(recipe, drawPatterns, (message) => errors.push(`Slide ${i + 1}: ${message}`)),
  );
  return errors.length ? { errors } : { slides };
}

function buildSlide(recipe: SlideRecipe, drawPatterns: boolean, reportError: (message: string) => void): Slide {
  const blank = createBlankSlide(recipe.type);
  let slide: Slide = { ...blank, name: recipe.name };
  if (recipe.type === "lesson") {
    if (recipe.backgroundPattern && recipe.backgroundSvg) reportError('give "backgroundPattern" or "backgroundSvg", not both.');
    slide.backgroundSvg = recipe.backgroundSvg && softened(withSvgNamespace(recipe.backgroundSvg));
    // The pattern sits on the plain white slide.
    if (recipe.backgroundPattern && drawPatterns) slide = withBackground(slide, { backgroundPattern: recipe.backgroundPattern });
  } else {
    // Dark colors are lightened, because the text is dark.
    slide.background = recipe.background && lighten(recipe.background);
  }

  if (recipe.type === "choice") {
    const options = blank.options.map((option, i) => ({
      ...option,
      text: recipe.options[i],
      fontSize: recipe.optionFontSize,
    })) as Slide["options"];
    const layout = recipe.layout ?? pickLayout(recipe.options, recipe.elements);
    slide = {
      ...slide,
      layout,
      question: recipe.question,
      questionHeight: questionHeightFor(recipe.question, recipe.questionFontSize),
      questionFontSize: recipe.questionFontSize,
      options,
      correctOptionId: options[OPTION_LABELS.indexOf(recipe.answer)].id,
      // Grid/list slides only show the side box (as a strip) once it's turned on.
      hasShapeBox: layout !== "list-side" && recipe.elements.some((el) => (el.in ?? "side") === "side"),
    };
    // Short options don't need much room, so a strip with pictures takes what the options can spare.
    if (slide.hasShapeBox) {
      slide.shapeStripHeight = Math.max(DEFAULT_SHAPE_STRIP_HEIGHT, Math.min(MAX_IMPORT_STRIP_HEIGHT, getMaxShapeStripHeight(slide)));
    }
  } else if (recipe.type === "short-answer") {
    slide = {
      ...slide,
      question: recipe.question,
      questionHeight: questionHeightFor(recipe.question, recipe.questionFontSize),
      questionFontSize: recipe.questionFontSize,
      correctAnswer: recipe.answer,
    };
  }

  // Lesson slides: the title and text become text boxes, and the pictures get the room that's left.
  const lesson = recipe.type === "lesson" ? lessonAreas(recipe) : null;
  if (recipe.type === "lesson" && recipe.layout === "title-only" && recipe.text) {
    reportError('a "title-only" lesson has no text. Use "text-top" or "text-left", or leave "text" out.');
  }
  const textBoxes: SvgElement[] = [];
  if (recipe.type === "lesson" && lesson?.title) {
    const align = recipe.layout === "title-only" ? "center" : "left";
    textBoxes.push(textBox(lesson.title, styledHtml(recipe.title!, { bold: true, align }), recipe.titleFontSize));
  }
  if (recipe.type === "lesson" && lesson?.text) {
    const size = recipe.textFontSize ?? TEXT_BOX_FONT_SIZE;
    if (textHeightFor(recipe.text!, lesson.text.width, size) > lesson.text.height) {
      reportError(`the lesson text is too long for its box at ${size}px. Shorten it or set a smaller "textFontSize".`);
    }
    textBoxes.push(textBox(lesson.text, textToHtml(recipe.text!), recipe.textFontSize));
  }

  // The area a box's pictures are placed in: the lesson's picture area, or the box itself.
  const areaOf = (containerId: string | null): Rect =>
    lesson && containerId === null ? lesson.pictures : { x: 0, y: 0, ...getContainerBounds(containerId, slide) };
  const boxOf = (el: ElementRecipe): BoxName => (recipe.type === "lesson" ? "canvas" : (el.in ?? "side"));

  // Numbers and symbols (e.g. the "+" in 🍎🍎 + 🍎🍎🍎) match the biggest picture in their box, so
  // the row reads as one line.
  const pictureSize = new Map<BoxName, SizeName>();
  for (const el of recipe.elements) {
    if (isGlyph(el.asset)) continue;
    const current = pictureSize.get(boxOf(el));
    if (!current || SIZE_NAMES.indexOf(sizeOf(el)) > SIZE_NAMES.indexOf(current)) pictureSize.set(boxOf(el), sizeOf(el));
  }

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

    const containerId = toContainerId(boxName, slide);
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
          color: el.color ?? asset.defaultColor ?? DEFAULT_ELEMENT_COLOR,
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
  const pictures: SvgElement[] = [];
  const calloutParts: SvgElement[] = [];
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
  const textRects = textBoxes.map((box) => ({ x: box.x, y: box.y, width: box.width, height: box.height }));
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

  const built = { ...slide, elements: [...decorations, ...textBoxes, ...pictures, ...calloutParts] };
  if (recipe.type !== "lesson") checkTextFits(built, reportError);
  return built;
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
    const height = textHeightFor(recipe.text!, width, recipe.textFontSize ?? TEXT_BOX_FONT_SIZE);
    text = { x: LESSON_MARGIN, y, width, height: Math.min(LESSON_MAX_TEXT_HEIGHT, height) };
    y += text.height + LESSON_GAP;
  }
  return { title, text, pictures: { x: LESSON_MARGIN, y, width, height: bottom - y } };
}

function textBox(rect: Rect, html: string, fontSize?: number): SvgElement {
  const asset = ELEMENT_LIBRARY.find((a) => a.isTextBox)!;
  return { id: createId(), assetId: asset.id, ...rect, color: asset.defaultColor!, containerId: null, text: { html, fontSize } };
}

/** Plain text as text-box HTML, optionally bold and/or aligned (titles, callout labels). */
function styledHtml(text: string, { bold = false, align = "left" }: { bold?: boolean; align?: "left" | "center" | "right" }) {
  const open = `<p${align === "left" ? "" : ` style="text-align: ${align}"`}>${bold ? "<strong>" : ""}`;
  const close = `${bold ? "</strong>" : ""}</p>`;
  return textToHtml(text).replaceAll("<p>", open).replaceAll("</p>", close);
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
    return [arrow, textBox(labelRect, styledHtml(label, { bold: true, align }), CALLOUT_LABEL_FONT_SIZE)];
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
// The room an option card's edges take (px), left + right and top + bottom: px-6 py-3 in list rows,
// p-6 in grid cells, plus the 1px border.
const OPTION_PADDING = { list: { x: 50, y: 26 }, grid: { x: 50, y: 50 } };

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

/**
 * Text never shrinks to fit, so text that's too long for its box would be cut off. This reports it
 * (while Claude can still fix it) for the question and each option.
 */
function checkTextFits(slide: Slide, reportError: (message: string) => void) {
  const questionSize = slide.questionFontSize ?? QUESTION_FONT_SIZE;
  const questionRoom = slide.questionHeight - QUESTION_PADDING;
  if (textHeightFor(slide.question, QUESTION_CONTAINER_WIDTH - QUESTION_PADDING, questionSize) > questionRoom) {
    reportError(`the question is too long for its box at ${questionSize}px. Shorten it or set a smaller "questionFontSize".`);
  }
  if (slide.type !== "choice") return;
  const padding = OPTION_PADDING[slide.layout === "grid" ? "grid" : "list"];
  slide.options.forEach((option, i) => {
    if (!option.text) return;
    const size = option.fontSize ?? OPTION_FONT_SIZE;
    const box = getContainerBounds(option.id, slide);
    // An option with pictures keeps only its left half for the text.
    const hasPictures = slide.elements.some((el) => el.containerId === option.id);
    const width = (box.width - padding.x) / (hasPictures ? 2 : 1);
    if (textHeightFor(option.text, width, size) > box.height - padding.y) {
      reportError(`option ${OPTION_LABELS[i]} doesn't fit in its box at ${size}px. Shorten it or set a smaller "optionFontSize".`);
    }
  });
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
