import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getContainerBounds,
  getOptionRoom,
  getOptionRowHeights,
  getOptionsGridStyle,
  getSlideNumbers,
  presentStartIndex,
  shownSlides,
  stepPresentation,
} from "./constants";
import type { Slide } from "./schema";

const slide = (id: string, extra: Partial<Slide> = {}) => ({ id, type: "choice", ...extra }) as Slide;

test("getSlideNumbers counts questions and blank slides separately", () => {
  const numbers = getSlideNumbers([slide("q1"), slide("b1", { type: "blank" }), slide("q2")]);
  assert.deepEqual([...numbers], [["q1", 1], ["b1", 1], ["q2", 2]]);
});

test("getSlideNumbers gives a hidden slide no number, and the next ones close the gap", () => {
  const numbers = getSlideNumbers([slide("q1"), slide("q2", { hidden: true }), slide("q3"), slide("b1", { type: "blank", hidden: true }), slide("b2", { type: "blank" })]);
  assert.deepEqual([...numbers], [["q1", 1], ["q3", 2], ["b2", 1]]);
});

test("stepPresentation skips hidden slides both ways", () => {
  const slides = [slide("a"), slide("b", { hidden: true }), slide("c")];
  assert.equal(stepPresentation(slides, 0, 1), 2);
  assert.equal(stepPresentation(slides, 2, -1), 0);
});

test("stepPresentation stays put when only hidden slides are left that way", () => {
  const slides = [slide("a"), slide("b", { hidden: true })];
  assert.equal(stepPresentation(slides, 0, 1), 0);
  assert.equal(stepPresentation(slides, 0, -1), 0);
});

test("stepPresentation skips nothing when every slide is hidden", () => {
  const slides = [slide("a", { hidden: true }), slide("b", { hidden: true })];
  assert.equal(stepPresentation(slides, 0, 1), 1);
});

test("presentStartIndex moves off a hidden slide: forward first, else back", () => {
  const slides = [slide("a"), slide("b", { hidden: true }), slide("c"), slide("d", { hidden: true })];
  assert.equal(presentStartIndex(slides, 0), 0);
  assert.equal(presentStartIndex(slides, 1), 2);
  assert.equal(presentStartIndex(slides, 3), 2);
});

test("presentStartIndex keeps the slide when every slide is hidden", () => {
  assert.equal(presentStartIndex([slide("a", { hidden: true }), slide("b", { hidden: true })], 1), 1);
});

test("shownSlides leaves out hidden slides, in order", () => {
  const slides = [slide("a"), slide("b", { hidden: true }), slide("c"), slide("d", { hidden: true })];
  assert.deepEqual(shownSlides(slides).map((s) => s.id), ["a", "c"]);
});

test("shownSlides keeps every slide when every slide is hidden (like presenting)", () => {
  const slides = [slide("a", { hidden: true }), slide("b", { hidden: true })];
  assert.deepEqual(shownSlides(slides).map((s) => s.id), ["a", "b"]);
});

// ─── Option row heights ────────────────────────────────────────────────────────────────────────────────────
const choice = (extra: Partial<Slide> = {}) =>
  ({
    id: "s",
    type: "choice",
    layout: "list",
    questionHeight: 160,
    options: ["o1", "o2", "o3", "o4"].map((id) => ({ id, text: id })),
    ...extra,
  }) as Slide;
const withRowSizes = (sizes: (number | undefined)[]) =>
  choice().options.map((o, i) => ({ ...o, rowSize: sizes[i] })) as Slide["options"];
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 0.001, `${a} ≈ ${b}`);

test("equal rows when no option has rowSize (older slides look as before)", () => {
  const before = getContainerBounds("o1", { type: "choice", layout: "list", questionHeight: 160 });
  const heights = getOptionRowHeights(choice());
  assert.equal(heights.length, 4);
  heights.forEach((h) => near(h, before.height));
  ["o1", "o2", "o3", "o4"].forEach((id) => near(getContainerBounds(id, choice()).height, before.height));
});

test("list rows follow rowSize and fill the room", () => {
  const slide = choice({ options: withRowSizes([1, 3, 1, 1]) });
  const heights = getOptionRowHeights(slide);
  near(sum(heights), getOptionRoom(slide));
  near(heights[1], heights[0] * 3);
  near(getContainerBounds("o2", slide).height, heights[1]);
});

test("true-false uses the first two options' rowSize", () => {
  const slide = choice({ type: "true-false", options: withRowSizes([1, 3, 50, 50]) });
  const heights = getOptionRowHeights(slide);
  assert.equal(heights.length, 2);
  near(heights[1], heights[0] * 3);
});

test("grid uses gridRowSizes, list uses rowSize", () => {
  const options = withRowSizes([5, 1, 1, 1]);
  const grid = choice({ layout: "grid", options, gridRowSizes: [1, 2] });
  const rows = getOptionRowHeights(grid);
  assert.equal(rows.length, 2);
  near(rows[1], rows[0] * 2);
  near(getContainerBounds("o2", grid).height, rows[0]);
  near(getContainerBounds("o3", grid).height, rows[1]);
  const list = choice({ options, gridRowSizes: [1, 2] });
  near(getOptionRowHeights(list)[0], getOptionRowHeights(list)[1] * 5);
});

test("getOptionsGridStyle shares the real room by the row heights, so rows never pass its bottom", () => {
  const slide = choice({ options: withRowSizes([1, 3, 1, 1]) });
  const heights = getOptionRowHeights(slide);
  assert.equal(getOptionsGridStyle(slide).gridTemplateRows, heights.map((h) => `minmax(0, ${h}fr)`).join(" "));
});
