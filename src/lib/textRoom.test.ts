import { test } from "node:test";
import assert from "node:assert/strict";
import { isCutOff, largestFittingSize } from "./textRoom";

test("cutting only the empty space under a last line with no hanging letters doesn't count as hidden", () => {
  // 40 px text: the line is 50 px tall, its bottom 10 px are room for g, y, p…
  assert.equal(isCutOff(8, 40, "uniform."), false);
});

test("cutting a last line with hanging letters counts at once", () => {
  assert.equal(isCutOff(8, 40, "making"), true);
  assert.equal(isCutOff(3, 40, "fragile, yes"), true);
});

test("cutting into the letters themselves always counts", () => {
  assert.equal(isCutOff(12, 40, "uniform."), true);
});

test("a pixel of rounding never counts", () => {
  assert.equal(isCutOff(1, 40, "making"), false);
});

test("largestFittingSize picks the biggest size that fits, from the current one down", () => {
  assert.equal(largestFittingSize(56, 12, (size) => size <= 30), 30);
  assert.equal(largestFittingSize(56, 12, () => true), 56);
});

test("largestFittingSize stops at the smallest size when nothing fits", () => {
  assert.equal(largestFittingSize(56, 12, () => false), 12);
});

test("largestFittingSize asks few sizes (it halves the range, not one step at a time)", () => {
  let asked = 0;
  assert.equal(largestFittingSize(96, 12, (size) => (asked++, size <= 25)), 25);
  assert.ok(asked <= 8, String(asked));
});
