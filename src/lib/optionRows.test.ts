import { test } from "node:test";
import assert from "node:assert/strict";
import { gridRowNeeds, heightsFromShares, moveRowLine, oneLineHeight, shareOut } from "./optionRows";

test("shareOut gives the spare out equally", () => {
  assert.deepEqual(shareOut([50, 100, 50, 100], 400), [75, 125, 75, 125]);
});

test("shareOut with too little room shares by want and still fills the room", () => {
  assert.deepEqual(shareOut([100, 300], 200), [50, 150]);
});

test("heightsFromShares: a missing share means equal rows", () => {
  assert.deepEqual(heightsFromShares([2, undefined, 1, 1], 400), [100, 100, 100, 100]);
});

test("heightsFromShares: rows follow their shares", () => {
  assert.deepEqual(heightsFromShares([1, 3], 400), [100, 300]);
});

test("gridRowNeeds takes the taller option of each row", () => {
  assert.deepEqual(gridRowNeeds([80, 40, 30, 120]), [80, 120]);
});

test("gridRowNeeds leaves out hidden options (true / false has one row)", () => {
  assert.deepEqual(gridRowNeeds([80, 40]), [80]);
});

test("moveRowLine grows one row, shrinks the next, and stops at the smallest size", () => {
  assert.deepEqual(moveRowLine([100, 100, 100], 0, 30, [40, 40, 40]), [130, 70, 100]);
  assert.deepEqual(moveRowLine([100, 100, 100], 0, 90, [40, 40, 40]), [160, 40, 100]);
  assert.deepEqual(moveRowLine([100, 100, 100], 1, -90, [40, 40, 40]), [100, 40, 160]);
});

test("moveRowLine never makes a row already under its smallest size smaller", () => {
  assert.deepEqual(moveRowLine([30, 100], 0, -20, [40, 40]), [30, 100]);
});

test("oneLineHeight is one line of text plus the card's edges", () => {
  assert.equal(oneLineHeight(40), 63);
});
