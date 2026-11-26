import { test } from "node:test";
import assert from "node:assert/strict";
import { KEEP_NEW_FILES_MS, isPastKeepTime, sizesToFix } from "./cleanupPhotos";

const NOW = Date.UTC(2026, 10, 4, 12);

test("isPastKeepTime: a file uploaded over 7 days ago can be deleted", () => {
  assert.equal(isPastKeepTime(new Date(NOW - KEEP_NEW_FILES_MS - 1), NOW), true);
});

test("isPastKeepTime: a newer file is kept (it may be on a slide not saved yet)", () => {
  assert.equal(isPastKeepTime(new Date(NOW - KEEP_NEW_FILES_MS + 1), NOW), false);
  assert.equal(isPastKeepTime(new Date(NOW - 60_000), NOW), false);
});

test("sizesToFix gives each estimated photo its real size, or 1 byte when it is gone from R2", () => {
  const sizes = new Map([
    ["https://images.quizmatter.com/uploads/a.webp", 10],
    ["https://images.quizmatter.com/uploads/c.webp", 5],
  ]);
  assert.deepEqual(
    sizesToFix(["https://images.quizmatter.com/uploads/a.webp", "https://images.quizmatter.com/uploads/b.webp"], sizes),
    { "https://images.quizmatter.com/uploads/a.webp": 10, "https://images.quizmatter.com/uploads/b.webp": 1 }
  );
  assert.deepEqual(sizesToFix([], sizes), {});
});

test("sizesToFix keeps a size between 1 byte and 2 MB (photo_uploads' own limits)", () => {
  const sizes = new Map([
    ["https://images.quizmatter.com/uploads/big.webp", 3 * 1024 * 1024],
    ["https://images.quizmatter.com/uploads/empty.webp", 0],
  ]);
  assert.deepEqual(
    sizesToFix(["https://images.quizmatter.com/uploads/big.webp", "https://images.quizmatter.com/uploads/empty.webp"], sizes),
    { "https://images.quizmatter.com/uploads/big.webp": 2 * 1024 * 1024, "https://images.quizmatter.com/uploads/empty.webp": 1 }
  );
});
