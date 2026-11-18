import { test } from "node:test";
import assert from "node:assert/strict";
import { getContainerBounds, DEFAULT_QUESTION_HEIGHT, OPTION_FONT_SIZE } from "@/lib/constants";
import { LINE_HEIGHT_PER_PX, OPTION_TEXT_PADDING, QUESTION_PADDING, optionFontSizeFor, questionHeightFor, tooLong } from "./importText";

// A "list" slide with a picture strip: its option rows are the shortest the app makes (76 px).
const shortRow = getContainerBounds("o1", { type: "multiple-choice", layout: "list", hasShapeBox: true, questionHeight: DEFAULT_QUESTION_HEIGHT } as never);

test("one line taller than its box is too long (a list row under a picture strip)", () => {
  const room = { width: shortRow.width - OPTION_TEXT_PADDING, height: shortRow.height - OPTION_TEXT_PADDING };
  assert.equal(tooLong("Paris", room, OPTION_FONT_SIZE), true);
  assert.equal(tooLong("Paris", { width: 500, height: 200 }, OPTION_FONT_SIZE), false);
});

test("text that only fits if every line is filled to the last letter counts as too long", () => {
  // 20 letters fit a line at this width; 38 letters in words make 2 lines only on paper.
  const box = { width: 20 * 48 * 0.525, height: 2 * 48 * LINE_HEIGHT_PER_PX };
  assert.equal(tooLong("aaaa bbbb cccc dddd eeee ffff gggg hhh", box, 48), true);
  assert.equal(tooLong("aaaa bbbb cccc", box, 48), false);
});

test("options get a size that fits a short row, and the default where it fits", () => {
  const size = optionFontSizeFor(shortRow.height, OPTION_FONT_SIZE);
  assert.ok(size !== undefined && size < OPTION_FONT_SIZE);
  assert.ok(size * LINE_HEIGHT_PER_PX <= shortRow.height - OPTION_TEXT_PADDING);
  assert.equal(optionFontSizeFor(214, OPTION_FONT_SIZE), undefined);
  assert.equal(optionFontSizeFor(20, OPTION_FONT_SIZE), 12);
});

test("a question box has room for its text and half a line more, up to the default", () => {
  const short = questionHeightFor("What is 2 + 2?", 48);
  assert.ok(short >= 1.5 * 48 * LINE_HEIGHT_PER_PX + QUESTION_PADDING);
  assert.equal(questionHeightFor("word ".repeat(200), 48), DEFAULT_QUESTION_HEIGHT);
});
