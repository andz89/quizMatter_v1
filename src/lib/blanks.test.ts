import { test } from "node:test";
import assert from "node:assert/strict";
import { blankRuns } from "./blanks";

test("finds each run of two or more underscores", () => {
  assert.deepEqual(blankRuns("we ___ the script"), [[3, 6]]);
  assert.deepEqual(blankRuns("__ and ____"), [[0, 2], [7, 11]]);
});

test("a single underscore is left alone", () => {
  assert.deepEqual(blankRuns("file_name and _"), []);
});

test("no underscores, no runs", () => {
  assert.deepEqual(blankRuns(""), []);
  assert.deepEqual(blankRuns("Which set completes the report?"), []);
});
