import { test } from "node:test";
import assert from "node:assert/strict";
import { KEEP_NEW_FILES_MS, isPastKeepTime } from "./cleanupPhotos";

const NOW = Date.UTC(2026, 10, 4, 12);

test("isPastKeepTime: a file uploaded over 7 days ago can be deleted", () => {
  assert.equal(isPastKeepTime(new Date(NOW - KEEP_NEW_FILES_MS - 1), NOW), true);
});

test("isPastKeepTime: a newer file is kept (it may be on a slide not saved yet)", () => {
  assert.equal(isPastKeepTime(new Date(NOW - KEEP_NEW_FILES_MS + 1), NOW), false);
  assert.equal(isPastKeepTime(new Date(NOW - 60_000), NOW), false);
});
