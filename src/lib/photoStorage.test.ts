import { test } from "node:test";
import assert from "node:assert/strict";
import { PHOTO_STORAGE_LIMIT_BYTES, formatStorage, isStorageFull, stillUsedMessage } from "./photoStorage";

test("the limit is 50 MB, the same number as the database's photo_storage_limit()", () => {
  assert.equal(PHOTO_STORAGE_LIMIT_BYTES, 52428800);
});

test("formatStorage: one decimal under 10 MB, whole MB from 10 MB", () => {
  assert.equal(formatStorage(0), "0 MB");
  assert.equal(formatStorage(1887437), "1.8 MB");
  assert.equal(formatStorage(10380903), "9.9 MB");
  assert.equal(formatStorage(10485760), "10 MB");
  assert.equal(formatStorage(47185920), "45 MB");
  assert.equal(formatStorage(52428800), "50 MB");
});

test("isStorageFull: only with a limit, at or past it", () => {
  assert.equal(isStorageFull({ used: 52428800, limit: 52428800 }), true);
  assert.equal(isStorageFull({ used: 52428799, limit: 52428800 }), false);
  assert.equal(isStorageFull({ used: 5, limit: null }), false);
});

test("stillUsedMessage lists where the photo is, then why it still counts", () => {
  const message = stillUsedMessage(
    [
      { title: "Weather Quiz", is_shared_copy: false, slides: [1, 4] },
      { title: "Plants Quiz", is_shared_copy: true, slides: [3] },
    ],
    1887437,
    false
  );
  assert.equal(
    message,
    "It's used in:\n" +
      "• Weather Quiz (slides 1, 4)\n" +
      "• Plants Quiz, published version (slide 3): open it and click Update shared presentation to take it out there too\n\n" +
      "Removing it from My photos won't free storage. It still counts (1.8 MB) until it's gone from these slides too."
  );
});

test("stillUsedMessage: an untitled presentation, the open one not saved yet, and no known size", () => {
  assert.equal(
    stillUsedMessage([{ title: "", is_shared_copy: false, slides: [2] }], null, true),
    "It's used in:\n" +
      "• Untitled presentation (slide 2)\n" +
      "• This presentation (not saved yet)\n\n" +
      "Removing it from My photos won't free storage. It still counts until it's gone from these slides too."
  );
});
