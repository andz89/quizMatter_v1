import { test } from "node:test";
import assert from "node:assert/strict";
import { countResets, startOfManilaDay } from "./resets";

test("countResets counts the rows of each key and keeps its newest time", () => {
  const counts = countResets([
    { key: "ana", at: "2026-11-07T01:00:00+00:00" },
    { key: "ben", at: "2026-11-07T02:00:00+00:00" },
    { key: "ana", at: "2026-11-07T03:00:00+00:00" },
    { key: "ana", at: "2026-11-07T02:30:00+00:00" },
  ]);
  assert.deepEqual(counts, [
    { key: "ana", count: 3, lastAt: "2026-11-07T03:00:00+00:00" },
    { key: "ben", count: 1, lastAt: "2026-11-07T02:00:00+00:00" },
  ]);
});

test("countResets puts the most first, then the newest", () => {
  const counts = countResets([
    { key: "old", at: "2026-11-07T01:00:00+00:00" },
    { key: "new", at: "2026-11-07T05:00:00+00:00" },
    { key: "many", at: "2026-11-07T00:10:00+00:00" },
    { key: "many", at: "2026-11-07T00:20:00+00:00" },
  ]);
  assert.deepEqual(
    counts.map((count) => count.key),
    ["many", "new", "old"],
  );
});

test("countResets of no rows is empty", () => {
  assert.deepEqual(countResets([]), []);
});

test("startOfManilaDay is midnight in the Philippines (UTC+8), as UTC", () => {
  // 11:59 PM on Nov 7 in Manila: the day started at 4 PM UTC on Nov 6.
  assert.equal(startOfManilaDay(Date.parse("2026-11-07T15:59:00Z")), "2026-11-06T16:00:00.000Z");
  // Midnight on Nov 8 in Manila: a new day.
  assert.equal(startOfManilaDay(Date.parse("2026-11-07T16:00:00Z")), "2026-11-07T16:00:00.000Z");
});
