import { test } from "node:test";
import assert from "node:assert/strict";
import { createBlankPresentation, createBlankSlide, duplicateSlide } from "./factories";
import { presentationSchema, slideSchema, type SlideType } from "./schema";

const SLIDE_TYPES: SlideType[] = ["choice", "true-false", "short-answer", "custom", "blank", "title", "video", "embed-slides", "image"];

test("a new slide of every type passes the slide schema, so it can be saved", () => {
  for (const type of SLIDE_TYPES) {
    const result = slideSchema.safeParse(createBlankSlide(type));
    assert.ok(result.success, `${type}: ${result.error?.issues[0]?.message}`);
  }
});

test("a new presentation passes the presentation schema", () => {
  const result = presentationSchema.safeParse(createBlankPresentation({ title: "Fractions" }));
  assert.ok(result.success, result.error?.issues[0]?.message);
});

test("duplicateSlide gives the copy new ids and keeps its content", () => {
  const slide = createBlankSlide("choice");
  slide.question = "Which is bigger?";
  slide.correctOptionId = slide.options[1].id;
  const [onSlide] = createBlankSlide("title").elements;
  slide.elements = [onSlide, { ...onSlide, id: "in-option", containerId: slide.options[1].id }];

  const copy = duplicateSlide(slide);

  assert.notEqual(copy.id, slide.id);
  assert.equal(copy.question, slide.question);
  const oldIds = new Set([...slide.options.map((o) => o.id), ...slide.elements.map((e) => e.id)]);
  for (const id of [...copy.options.map((o) => o.id), ...copy.elements.map((e) => e.id)]) assert.ok(!oldIds.has(id));
  assert.deepEqual(copy.options.map((o) => o.text), slide.options.map((o) => o.text));
  // The answer and the element inside an option follow that option's new id.
  assert.equal(copy.correctOptionId, copy.options[1].id);
  assert.equal(copy.elements[0].containerId, null);
  assert.equal(copy.elements[1].containerId, copy.options[1].id);
  assert.deepEqual(copy.elements[1].text, slide.elements[1].text);
});

test("duplicateSlide keeps no answer when the slide has none", () => {
  assert.equal(duplicateSlide(createBlankSlide("choice")).correctOptionId, null);
});
