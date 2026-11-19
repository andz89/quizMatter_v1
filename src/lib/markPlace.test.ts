import { test } from "node:test";
import assert from "node:assert/strict";
import { MARK_ROOM, markPlaceClasses, markSide } from "./markPlace";

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

test("preferBefore puts it above when there's room, else below", () => {
  assert.equal(markSide(200, 60, 720, true), "before");
  assert.equal(markSide(20, 60, 720, true), "after");
  assert.equal(markSide(10, 700, 720, true), "inside");
});

test("above or under the box, the mark lines up with the box's right edge", () => {
  assert.equal(markPlaceClasses({ x: "after", y: "before" }), "right-0 bottom-full pb-3");
  assert.equal(markPlaceClasses({ x: "before", y: "after" }), "right-0 top-full pt-3");
});

test("with no room above or under, it goes beside, tops lined up, or inside", () => {
  assert.equal(markPlaceClasses({ x: "after", y: "inside" }), "left-full pl-3 top-0");
  assert.equal(markPlaceClasses({ x: "before", y: "inside" }), "right-full pr-3 top-0");
  assert.equal(markPlaceClasses({ x: "inside", y: "inside" }), "right-4 bottom-4");
});
