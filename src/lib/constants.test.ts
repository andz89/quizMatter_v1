import { test } from "node:test";
import assert from "node:assert/strict";
import { getSlideNumbers, presentStartIndex, stepPresentation } from "./constants";
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
