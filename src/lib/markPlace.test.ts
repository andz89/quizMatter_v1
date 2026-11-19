import { test } from "node:test";
import assert from "node:assert/strict";
import { MARK_ROOM, markSide } from "./markPlace";

test("a mark goes after the box when the slide has room there", () => {
  assert.equal(markSide(100, 60, 1280), "after");
  assert.equal(markSide(1280 - 60 - MARK_ROOM, 60, 1280), "after");
});

test("near the slide's far edge it goes before the box", () => {
  assert.equal(markSide(1200, 60, 1280), "before");
  assert.equal(markSide(0, 720, 720 + MARK_ROOM - 1), "inside");
});

test("a box nearly as big as the slide gets it inside", () => {
  assert.equal(markSide(10, 1250, 1280), "inside");
});
