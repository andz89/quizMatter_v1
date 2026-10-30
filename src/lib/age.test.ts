import { test } from "node:test";
import assert from "node:assert/strict";
import { ageOn, birthDateRange, isAllowedBirthDate } from "./age";

test("ageOn counts whole years", () => {
  assert.equal(ageOn("1990-06-15", "2026-06-14"), 35);
  assert.equal(ageOn("1990-06-15", "2026-06-15"), 36);
  assert.equal(ageOn("1990-06-15", "2026-06-16"), 36);
});

test("ageOn with a 29 February birthday", () => {
  assert.equal(ageOn("2008-02-29", "2026-02-28"), 17);
  assert.equal(ageOn("2008-02-29", "2026-03-01"), 18);
  assert.equal(ageOn("2008-02-29", "2028-02-29"), 20);
});

test("isAllowedBirthDate edges", () => {
  const today = "2026-10-30";
  assert.equal(isAllowedBirthDate("2008-10-30", today), true);
  assert.equal(isAllowedBirthDate("2008-10-31", today), false);
  assert.equal(isAllowedBirthDate("1926-10-31", today), true);
  assert.equal(isAllowedBirthDate("1925-10-30", today), false);
  assert.equal(isAllowedBirthDate("2026-11-01", today), false);
});

test("isAllowedBirthDate refuses impossible dates", () => {
  for (const date of ["2001-02-30", "2001-13-01", "2001-1-1", "", "abc"]) {
    assert.equal(isAllowedBirthDate(date, "2026-10-30"), false, date);
  }
});

test("birthDateRange", () => {
  assert.deepEqual(birthDateRange("2026-10-30"), { min: "1925-10-31", max: "2008-10-30" });
});

test("birthDateRange on 29 February", () => {
  assert.deepEqual(birthDateRange("2028-02-29"), { min: "1927-03-01", max: "2010-02-28" });
});
