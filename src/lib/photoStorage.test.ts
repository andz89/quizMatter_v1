import { test } from "node:test";
import assert from "node:assert/strict";
import { PHOTO_STORAGE_LIMIT_BYTES, formatStorage, isStorageFull } from "./photoStorage";

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
