import { test } from "node:test";
import assert from "node:assert/strict";
import { clamp, fitInBox, getOuterEdges } from "./geometry";

const box = { width: 1000, height: 500 };

test("clamp keeps a number between its limits", () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
});

test("fitInBox leaves a rect that already fits alone", () => {
  const rect = { x: 100, y: 50, width: 200, height: 100 };
  assert.deepEqual(fitInBox(rect, box), rect);
});

test("fitInBox never makes a rect bigger", () => {
  assert.deepEqual(fitInBox({ x: 0, y: 0, width: 10, height: 10 }, box), { x: 0, y: 0, width: 10, height: 10 });
});

test("fitInBox shrinks a too-big rect evenly, keeping its shape, and puts it inside", () => {
  // Twice as tall as the box: shrinks to half, keeping its 4:5 shape.
  const fitted = fitInBox({ x: 900, y: 0, width: 800, height: 1000 }, box);
  assert.equal(fitted.height, 500);
  assert.equal(fitted.width, 400);
  assert.ok(fitted.x >= 0 && fitted.x + fitted.width <= box.width);
  assert.ok(fitted.y >= 0 && fitted.y + fitted.height <= box.height);
});

test("fitInBox with keepCenter shrinks around the rect's center", () => {
  const fitted = fitInBox({ x: 100, y: -250, width: 500, height: 1000 }, box, true);
  assert.deepEqual(fitted, { x: 225, y: 0, width: 250, height: 500 });
});

test("fitInBox pulls a rect that sticks out back inside", () => {
  assert.deepEqual(fitInBox({ x: -30, y: 480, width: 100, height: 100 }, box), { x: 0, y: 400, width: 100, height: 100 });
});

test("getOuterEdges takes several rects together", () => {
  assert.deepEqual(
    getOuterEdges([
      { x: 10, y: 20, width: 100, height: 50 },
      { x: -5, y: 40, width: 20, height: 200 },
    ]),
    { minX: -5, minY: 20, maxX: 110, maxY: 240 },
  );
});
