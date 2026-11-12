import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DATA_VERSION,
  DETAIL_MAX_LENGTH,
  MAX_ELEMENTS,
  MAX_SLIDES,
  TOO_MANY_SLIDES_MESSAGE,
  isNewerThanApp,
  isSafeColor,
  parseSavedPresentation,
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

const clockElement = (id: string, clockTime: unknown) => ({
  id,
  assetId: "digital-clock",
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  color: "#000000",
  containerId: null,
  clockTime,
});

test("a clock's time can be any time a clock shows", () => {
  for (const time of [{ hours: 1, minutes: 0 }, { hours: 12, minutes: 59, pm: true }]) {
    assert.equal(svgElementSchema.safeParse(clockElement("c1", time)).success, true, JSON.stringify(time));
  }
});

test("a clock's time is refused outside hours 1–12 and minutes 0–59, or when not whole", () => {
  for (const [hours, minutes] of [[99999, 5], [0, 5], [13, 5], [1.5, 5], [3, 60], [3, -1], [3, 1.5]]) {
    assert.equal(svgElementSchema.safeParse(clockElement("c1", { hours, minutes })).success, false, `${hours}:${minutes}`);
  }
});

test("a slide already holding an impossible clock time still opens, without that time", () => {
  const good = { hours: 3, minutes: 30, pm: true };
  const slide = slideSchema.parse({
    ...blankSlide,
    elements: [clockElement("bad", { hours: 99999, minutes: 5 }), clockElement("good", good)],
  });
  assert.equal(slide.elements[0].clockTime, undefined);
  assert.deepEqual(slide.elements[1].clockTime, good);
});

const diagramElement = (id: string, assetId: string, settings: object) => ({
  id,
  assetId,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  color: "#000000",
  containerId: null,
  ...settings,
});
const steps = (count: number) => Array.from({ length: count }, (_, i) => ({ text: `S${i}` }));
/** A factor tree `levels` deep (only the second number of each pair splits). */
function deepFactorNode(levels: number) {
  let node: { text: string; children?: unknown[] } = { text: "end" };
  for (let i = 1; i < levels; i++) node = { text: "n", children: [{ text: "x" }, node] };
  return node;
}

const brokenDiagrams: [string, string, object][] = [
  ["a flowchart with too many steps", "flowchart", { flowchart: { steps: steps(9) } }],
  ["a box with only part of its place", "flowchart", { flowchart: { steps: [{ text: "A", x: 5 }, { text: "B" }] } }],
  ["a cycle with too few steps", "cycle", { cycle: { steps: steps(2) } }],
  ["a mind map with too many ideas", "mind-map", { mindMap: { center: { text: "T" }, ideas: steps(9) } }],
  ["a tree with too many branches", "tree-diagram", { tree: { root: { text: "R" }, branches: Array.from({ length: 5 }, () => ({ label: { text: "L" }, leaves: [] })) } }],
  ["a factor tree with too many levels", "factor-tree", { factorTree: { root: deepFactorNode(9) } }],
  ["a factor tree nested very deep", "factor-tree", { factorTree: { root: deepFactorNode(20_000) } }],
  ["diagram settings of the wrong kind", "flowchart", { flowchart: "not a diagram" }],
];
for (const [name, assetId, settings] of brokenDiagrams) {
  test(`a slide holding ${name} still opens, with that diagram back to its starting boxes`, () => {
    const key = Object.keys(settings)[0] as "flowchart";
    const slide = slideSchema.parse({ ...blankSlide, elements: [diagramElement("bad", assetId, settings)] });
    assert.equal(slide.elements[0].id, "bad");
    assert.equal(slide.elements[0][key], undefined);
  });
}

test("a good diagram keeps everything, also next to a broken one", () => {
  const flowchart = { steps: [{ text: "A", x: 5, y: 6, width: 70, height: 40 }, { text: "B", fontSize: 14 }], vertical: true };
  const slide = slideSchema.parse({
    ...blankSlide,
    elements: [diagramElement("bad", "flowchart", { flowchart: { steps: steps(9) } }), diagramElement("good", "flowchart", { flowchart })],
  });
  assert.deepEqual(slide.elements[1].flowchart, flowchart);
});

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

test("a saved date no calendar can show is left out, so the slide still opens", () => {
  const calendar = { id: "bad", assetId: "calendar-page", x: 0, y: 0, width: 100, height: 100, color: "#191A2C", containerId: null };
  const good = { year: 2024, month: 2, day: 29 };
  for (const calendarDate of [{ year: 2026, month: 2, day: 30 }, { year: 2026, month: 13, day: 1 }, { year: 1800, month: 1, day: 1 }, { year: "2026", month: 1, day: 1 }, null, "2026-01-01"]) {
    const slide = slideSchema.parse({ ...blankSlide, elements: [{ ...calendar, calendarDate }, { ...calendar, id: "good", calendarDate: good }] });
    assert.equal(slide.elements[0].calendarDate, undefined, JSON.stringify(calendarDate));
    assert.deepEqual(slide.elements[1].calendarDate, good);
  }
});

test("math tool settings no panel can make are left out, so the slide still opens", () => {
  const cases: [string, string, unknown[], unknown][] = [
    ["number-line", "numberLine", ["x", null, { start: 0, step: 1 }], { start: -7, step: 5, hidden: [0, 3] }],
    ["fraction-bar", "fraction", [null, { parts: "4", shaded: 1 }, { parts: 4 }, { parts: 13, shaded: 1 }, { parts: 1, shaded: 1 }, { parts: 20000, shaded: 1 }, { parts: 1.5, shaded: 1 }], { parts: 12, shaded: 12 }],
    ["fraction-circle", "fraction", [{ parts: -3, shaded: 1 }, { parts: 13, shaded: 1 }], { parts: 2, shaded: 0 }],
    ["fraction-number", "fraction", [{ parts: 0, shaded: 1 }, { parts: 1000, shaded: 1 }, { parts: 2, shaded: 1000 }], { parts: 999, shaded: 999 }],
    ["ten-frame", "tenFrame", [null, { count: "5" }, { count: 1, rows: 0, columns: 5 }, { count: 1, rows: 150, columns: 150 }, { count: -1 }, { count: 101 }], { count: 100, rows: 10, columns: 10 }],
    ["base-ten-blocks", "baseTen", [{ hundreds: 1, tens: 1 }, { hundreds: 3000, tens: 0, ones: 0 }, { hundreds: -1, tens: 0, ones: 0 }], { hundreds: 9, tens: 0, ones: 9 }],
    ["thermometer", "thermometer", [{ value: "hot" }, { value: 500 }, { value: -21 }], { value: -20 }],
    ["bar-graph", "barGraph", [{}, { bars: [{ label: 5, value: 5 }] }, { bars: [{ label: "x", value: -5 }] }, { bars: [{ label: "x", value: 11 }] }, { bars: [{ label: "x".repeat(101), value: 1 }] }], { bars: [{ label: "", value: 10 }] }],
    ["protractor", "protractor", [{ angle: "x" }, { angle: 999 }, { angle: -1 }], { angle: 180 }],
  ];
  const tool = (assetId: string, id: string, fields: object) => ({ id, assetId, x: 0, y: 0, width: 100, height: 100, color: "#191A2C", containerId: null, ...fields });
  for (const [assetId, field, bad, good] of cases) {
    for (const value of bad) {
      const slide = slideSchema.parse({ ...blankSlide, elements: [tool(assetId, "bad", { [field]: value }), tool(assetId, "good", { [field]: good })] });
      const [cleaned, kept] = slide.elements as unknown as Record<string, unknown>[];
      assert.equal(cleaned[field], undefined, `${assetId} ${JSON.stringify(value)}`);
      assert.deepEqual(kept[field], good, assetId);
    }
  }
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

const savedElement = (id: string, extra: object = {}) => ({ id, assetId: "star", x: 10, y: 10, width: 100, height: 100, color: "#3B82F6", containerId: null, ...extra });
const savedPresentation = (elements: unknown[]) => {
  const presentation = createBlankPresentation();
  return { ...presentation, slides: [{ ...presentation.slides[0], elements }] };
};

test("parseSavedPresentation opens a slide without its broken element and keeps the good ones", () => {
  const opened = parseSavedPresentation(savedPresentation([savedElement("good"), savedElement("bad", { x: "400" }), null, savedElement("good2")]));
  assert.deepEqual(opened.slides[0].elements.map((e) => e.id), ["good", "good2"]);
});

test("parseSavedPresentation keeps at most a slide's limit of elements", () => {
  const many = Array.from({ length: MAX_ELEMENTS + 1 }, (_, i) => savedElement(`e${i}`));
  const opened = parseSavedPresentation(savedPresentation(many));
  assert.equal(opened.slides[0].elements.length, MAX_ELEMENTS);
  assert.equal(opened.slides[0].elements[0].id, "e0");
});

test("parseSavedPresentation still refuses what isn't about one element", () => {
  const presentation = savedPresentation([savedElement("good")]);
  assert.throws(() => parseSavedPresentation({ ...presentation, slides: [{ ...presentation.slides[0], questionHeight: "tall" }] }));
});

test("parseSavedPresentation still upgrades an old element before checking it", () => {
  const opened = parseSavedPresentation(savedPresentation([savedElement("old", { color: "url(x)" }), savedElement("bad", { y: "1" })]));
  assert.deepEqual(opened.slides[0].elements.map((e) => [e.id, e.color]), [["old", DEFAULT_TEXT_COLOR]]);
});

test("a save stays strict: presentationSchema refuses a broken element instead of dropping it", () => {
  assert.equal(presentationSchema.safeParse(savedPresentation([savedElement("good"), savedElement("bad", { x: "400" })])).success, false);
});
