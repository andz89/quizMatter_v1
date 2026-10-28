import { test } from "node:test";
import assert from "node:assert/strict";
import { clampView, cropSource } from "./photoCrop";

const wide = { width: 800, height: 600 };
const tall = { width: 600, height: 1200 };

test("at zoom 1 in the middle, the short side fills the box", () => {
  assert.deepEqual(cropSource(wide, 300, { zoom: 1, x: 0, y: 0 }), { x: 100, y: 0, size: 600 });
});

test("zoomed in and moved, the cut follows the photo", () => {
  assert.deepEqual(cropSource(wide, 300, { zoom: 2, x: 100, y: -50 }), { x: 150, y: 200, size: 300 });
});

test("a wide photo can't be moved past its edges", () => {
  assert.deepEqual(clampView(wide, 300, { zoom: 1, x: 80, y: 20 }), { zoom: 1, x: 50, y: 0 });
});

test("a tall photo can't be moved past its edges", () => {
  assert.deepEqual(clampView(tall, 300, { zoom: 1, x: 40, y: -500 }), { zoom: 1, x: 0, y: -150 });
});

test("zoom stays between 1 and 3", () => {
  assert.equal(clampView(wide, 300, { zoom: 5, x: 0, y: 0 }).zoom, 3);
  assert.equal(clampView(wide, 300, { zoom: 0.2, x: 0, y: 0 }).zoom, 1);
});
