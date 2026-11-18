import { test } from "node:test";
import assert from "node:assert/strict";
import { isCutOff } from "./textRoom";

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
