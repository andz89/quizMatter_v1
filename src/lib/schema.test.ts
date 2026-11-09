import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DATA_VERSION,
  DETAIL_MAX_LENGTH,
  MAX_SLIDES,
  TOO_MANY_SLIDES_MESSAGE,
  isNewerThanApp,
  isSafeColor,
  parseSlide,
  presentationSchema,
  slideProblems,
  slideSchema,
  svgElementSchema,
  upgradePresentation,
  upgradeSlide,
} from "./schema";
import { DEFAULT_TEXT_COLOR } from "./constants";
import { createBlankPresentation, createBlankSlide } from "./factories";
import { BACKGROUND_COLORS, BACKGROUND_GRADIENTS, BACKGROUND_MESHES } from "./slideBackground";

test("upgradePresentation runs twice with the same result", () => {
  const presentation = { title: "Fractions", grades: ["4"], slides: [{ id: "s1", type: "blank" }] };
  const once = upgradePresentation(presentation);
  assert.deepEqual(upgradePresentation(once), once);
});

test('upgradeSlide turns an old "lesson" slide into "blank"', () => {
  assert.deepEqual(upgradeSlide({ id: "s1", type: "lesson" }), { id: "s1", type: "blank" });
});

test("isNewerThanApp is true only for a data_version above this app's", () => {
  assert.equal(isNewerThanApp(DATA_VERSION + 1), true);
  assert.equal(isNewerThanApp(DATA_VERSION), false);
  assert.equal(isNewerThanApp(DATA_VERSION - 1), false);
});

const option = (id: string) => ({ id, text: "" });
const blankSlide = {
  id: "s1",
  type: "blank",
  question: "",
  layout: "grid",
  options: [option("a"), option("b"), option("c"), option("d")],
  correctOptionId: null,
  elements: [],
  questionHeight: 100,
};

test("slideProblems gives no messages for a valid slide", () => {
  assert.deepEqual(slideProblems([blankSlide]), []);
});

test("slideProblems names the slide and the limit when a question is too long", () => {
  const problems = slideProblems([blankSlide, { ...blankSlide, question: "x".repeat(5_001) }]);
  assert.deepEqual(problems, ["Slide 2: the question is too long (at most 5000 characters)."]);
});

// A gradient that closes itself early and adds an outside picture after it.
const CRAFTED_COLOR = "gradient:#fff,#fff), url(https://x.example/a.png";

test("isSafeColor takes every color format the app writes", () => {
  const colors = [
    "#6B3DF5",
    "#6b3df5",
    "#fff",
    "#ffff",
    "#6B3DF580",
    "gradient:#fff,#000",
    "gradient:#F2A93B, #D6336C",
    "radial:#F0FFF7,#F0A3E9,#D3BFFF",
    "mesh:#A8C4E6,#FFD3DC,#F8F9FD,#8F9BD0",
    "rgba(0,0,0,0.35)",
    "rgb(10%, 20%, 30%)",
    "transparent",
    "none",
    DEFAULT_TEXT_COLOR,
    ...BACKGROUND_COLORS,
    ...BACKGROUND_GRADIENTS,
    ...BACKGROUND_MESHES,
  ];
  for (const color of colors) assert.equal(isSafeColor(color), true, color);
});

test("isSafeColor refuses anything else", () => {
  const colors = [CRAFTED_COLOR, "url(x)", "", "#ff", "#fffff", "red; background: url(x)", "gradient:", "rgb(0,0,0", "var(--x)", "image-set(x)"];
  for (const color of colors) assert.equal(isSafeColor(color), false, color);
});

test("an element's color must be safe", () => {
  const element = { id: "e1", assetId: "circle", x: 0, y: 0, width: 10, height: 10, color: "#FFFFFF", containerId: null };
  assert.equal(svgElementSchema.safeParse(element).success, true);
  assert.equal(svgElementSchema.safeParse({ ...element, color: CRAFTED_COLOR }).success, false);
});

test("upgradeSlide leaves out an unsafe slide background, shape box fill and border", () => {
  const slide = { id: "s1", background: CRAFTED_COLOR, shapeBoxFill: "url(x)", shapeBoxBorder: "url(x)" };
  assert.deepEqual(upgradeSlide(slide), { id: "s1" });
});

test("upgradeSlide gives an element with an unsafe color the default text color, and leaves out an unsafe border", () => {
  const slide = { id: "s1", elements: [{ id: "e1", color: CRAFTED_COLOR, borderColor: "url(x)" }] };
  assert.deepEqual(upgradeSlide(slide), { id: "s1", elements: [{ id: "e1", color: DEFAULT_TEXT_COLOR }] });
});

test("upgradeSlide keeps safe colors as they are", () => {
  const slide = {
    id: "s1",
    background: "mesh:#A8C4E6,#FFD3DC,#F8F9FD,#8F9BD0",
    shapeBoxFill: "gradient:#F2A93B,#D6336C",
    shapeBoxBorder: "#7DD3FC",
    elements: [{ id: "e1", color: "#EF4444", borderColor: "#16A34A" }],
  };
  assert.deepEqual(upgradeSlide(slide), slide);
});

test("a slide with an unsafe color still opens, without it", () => {
  const element = { id: "e1", assetId: "circle", x: 0, y: 0, width: 10, height: 10, color: CRAFTED_COLOR, containerId: null };
  const slide = parseSlide({ ...blankSlide, background: CRAFTED_COLOR, elements: [element] });
  assert.ok(slide);
  assert.equal(slide.background, undefined);
  assert.equal(slide.elements[0].color, DEFAULT_TEXT_COLOR);
});

test(`a presentation can have ${MAX_SLIDES} slides, not one more`, () => {
  const withSlides = (count: number) =>
    presentationSchema.safeParse({ ...createBlankPresentation(), slides: Array.from({ length: count }, () => createBlankSlide()) });
  assert.ok(withSlides(MAX_SLIDES).success);
  const tooMany = withSlides(MAX_SLIDES + 1);
  assert.equal(tooMany.success, false);
  assert.equal(tooMany.error?.issues[0].message, TOO_MANY_SLIDES_MESSAGE);
});

test("a title or question longer than its limit is refused", () => {
  const title = (length: number) => presentationSchema.safeParse({ ...createBlankPresentation(), title: "a".repeat(length) }).success;
  assert.ok(title(DETAIL_MAX_LENGTH.title));
  assert.equal(title(DETAIL_MAX_LENGTH.title + 1), false);
  const question = (length: number) => slideSchema.safeParse({ ...createBlankSlide(), question: "a".repeat(length) }).success;
  assert.ok(question(5_000));
  assert.equal(question(5_001), false);
});

test("an embed slide only keeps a link its kind can show", () => {
  const embed = (type: "video" | "image", embedUrl: string) => slideSchema.safeParse({ ...createBlankSlide(type), embedUrl }).success;
  assert.ok(embed("video", "https://www.youtube.com/embed/dQw4w9WgXcQ"));
  assert.equal(embed("video", "https://example.com/video.mp4"), false);
  assert.ok(embed("image", "https://example.com/cat.png"));
  assert.equal(embed("image", "http://example.com/cat.png"), false);
  assert.equal(embed("image", "javascript:alert(1)"), false);
});

test("an element keeps a real calendar date and refuses one that doesn't exist", () => {
  const calendar = { id: "e1", assetId: "calendar-page", x: 0, y: 0, width: 100, height: 100, color: "#191A2C", containerId: null };
  const kept = svgElementSchema.parse({ ...calendar, calendarDate: { year: 2026, month: 11, day: 4 } });
  assert.deepEqual(kept.calendarDate, { year: 2026, month: 11, day: 4 });
  assert.equal(svgElementSchema.safeParse({ ...calendar, calendarDate: { year: 2026, month: 2, day: 30 } }).success, false);
});

test("an element keeps a table and refuses one with the wrong shape", () => {
  const element = { id: "e1", assetId: "table", x: 0, y: 0, width: 100, height: 100, color: "#191A2C", containerId: null };
  const cells = (count: number) => Array.from({ length: count }, () => ({ html: "" }));
  const rows = (count: number, columns: number) => Array.from({ length: count }, () => cells(columns));
  const fits = (table: unknown) => svgElementSchema.safeParse({ ...element, table }).success;

  const kept = svgElementSchema.parse({ ...element, table: { rows: [[{ html: "<p>Hi</p>" }]], fontSize: 24 } });
  assert.deepEqual(kept.table, { rows: [[{ html: "<p>Hi</p>" }]], fontSize: 24 });
  assert.ok(fits({ rows: rows(15, 15) }));
  assert.equal(fits({ rows: [cells(2), cells(3)] }), false, "rows of different lengths");
  assert.equal(fits({ rows: rows(16, 2) }), false, "16 rows");
  assert.equal(fits({ rows: rows(2, 16) }), false, "16 columns");
  assert.equal(fits({ rows: [] }), false, "no rows");
  assert.equal(fits({ rows: [[]] }), false, "no columns");
});

test("a table keeps its column and row sizes and refuses ones that don't match", () => {
  const element = { id: "e1", assetId: "table", x: 0, y: 0, width: 100, height: 100, color: "#191A2C", containerId: null };
  const rows = [[{ html: "" }, { html: "" }]];
  const fits = (sizes: object) => svgElementSchema.safeParse({ ...element, table: { rows, ...sizes } }).success;

  const kept = svgElementSchema.parse({ ...element, table: { rows, columnSizes: [30, 70], rowSizes: [50] } });
  assert.deepEqual(kept.table?.columnSizes, [30, 70]);
  assert.deepEqual(kept.table?.rowSizes, [50]);
  assert.equal(fits({ columnSizes: [30] }), false, "too few column sizes");
  assert.equal(fits({ rowSizes: [50, 50] }), false, "too many row sizes");
  assert.equal(fits({ columnSizes: [30, 0] }), false, "a zero size");
  assert.equal(fits({ columnSizes: [30, -5] }), false, "a negative size");
});

test("slideSchema keeps a slide's hidden mark", () => {
  assert.equal(slideSchema.parse({ ...blankSlide, hidden: true }).hidden, true);
  assert.equal(slideSchema.parse(blankSlide).hidden, undefined);
});
