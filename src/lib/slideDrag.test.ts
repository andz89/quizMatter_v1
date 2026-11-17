import { test } from "node:test";
import assert from "node:assert/strict";
import { readSlideDrag, slideDragData } from "./slideDrag";
import { DATA_VERSION, type Slide } from "./schema";

const slide = {
  id: "s1",
  type: "choice",
  question: "Two plus two?",
  layout: "grid",
  options: ["a", "b", "c", "d"].map((o) => ({ id: `s1-${o}`, text: o })),
  correctOptionId: "s1-b",
  elements: [],
  questionHeight: 100,
} as unknown as Slide;

test("a slide dragged from this app version reads back", () => {
  const result = readSlideDrag(slideDragData(slide));
  assert.ok("slide" in result);
  assert.equal(result.slide.question, "Two plus two?");
  assert.equal(result.slide.correctOptionId, "s1-b");
});

test("a slide dragged from a newer app version is refused, not stripped", () => {
  const data = JSON.stringify({ dataVersion: DATA_VERSION + 1, slide: { ...slide, newField: 1 } });
  assert.deepEqual(readSlideDrag(data), { problem: "newer" });
});

test("broken drag data is refused", () => {
  assert.deepEqual(readSlideDrag("not json"), { problem: "broken" });
  assert.deepEqual(readSlideDrag(JSON.stringify({ dataVersion: DATA_VERSION, slide: { id: "x" } })), { problem: "broken" });
  // The old shape (the slide alone, with no version) can't be told apart from a newer one's.
  assert.deepEqual(readSlideDrag(JSON.stringify(slide)), { problem: "broken" });
});
