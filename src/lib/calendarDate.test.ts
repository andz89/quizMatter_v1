import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatCalendarDate,
  fromDateInput,
  isRealCalendarDate,
  monthGrid,
  todayCalendarDate,
  toDateInput,
  weekdayOf,
} from "./calendarDate";

test("isRealCalendarDate takes a real date and refuses one that doesn't exist", () => {
  assert.equal(isRealCalendarDate({ year: 2026, month: 11, day: 4 }), true);
  assert.equal(isRealCalendarDate({ year: 2024, month: 2, day: 29 }), true);
  assert.equal(isRealCalendarDate({ year: 2026, month: 2, day: 29 }), false);
  assert.equal(isRealCalendarDate({ year: 2026, month: 4, day: 31 }), false);
  assert.equal(isRealCalendarDate({ year: 2026, month: 13, day: 1 }), false);
  assert.equal(isRealCalendarDate({ year: 2026, month: 1, day: 1.5 }), false);
});

test("isRealCalendarDate keeps the year between 1900 and 2100", () => {
  assert.equal(isRealCalendarDate({ year: 1900, month: 1, day: 1 }), true);
  assert.equal(isRealCalendarDate({ year: 2100, month: 12, day: 31 }), true);
  assert.equal(isRealCalendarDate({ year: 1899, month: 12, day: 31 }), false);
  assert.equal(isRealCalendarDate({ year: 2101, month: 1, day: 1 }), false);
});

test("weekdayOf gives 0 for Sunday up to 6 for Saturday", () => {
  assert.equal(weekdayOf({ year: 2026, month: 11, day: 1 }), 0);
  assert.equal(weekdayOf({ year: 2026, month: 11, day: 4 }), 3);
  assert.equal(weekdayOf({ year: 2026, month: 11, day: 7 }), 6);
});

test("formatCalendarDate writes the date out in English", () => {
  assert.equal(formatCalendarDate({ year: 2026, month: 11, day: 4 }), "Wednesday, November 4, 2026");
});

test("monthGrid lays the month out in weeks from Sunday, with empty days around it", () => {
  // November 2026 starts on a Sunday and has 30 days: 5 weeks.
  const november = monthGrid(2026, 11);
  assert.equal(november.length, 5);
  assert.deepEqual(november[0], [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(november[4], [29, 30, null, null, null, null, null]);
  // February 2026 starts on a Sunday and has 28 days: exactly 4 weeks.
  assert.equal(monthGrid(2026, 2).length, 4);
  // August 2026 starts on a Saturday and has 31 days: 6 weeks.
  const august = monthGrid(2026, 8);
  assert.equal(august.length, 6);
  assert.deepEqual(august[0], [null, null, null, null, null, null, 1]);
  assert.deepEqual(august[5], [30, 31, null, null, null, null, null]);
});

test("toDateInput and fromDateInput turn a date into the date box's text and back", () => {
  assert.equal(toDateInput({ year: 2026, month: 3, day: 9 }), "2026-03-09");
  assert.deepEqual(fromDateInput("2026-03-09"), { year: 2026, month: 3, day: 9 });
  assert.equal(fromDateInput(""), null);
  assert.equal(fromDateInput("2026-02-30"), null);
  assert.equal(fromDateInput("3000-01-01"), null);
});

test("todayCalendarDate is the computer's own date", () => {
  assert.deepEqual(todayCalendarDate(new Date(2026, 10, 4, 23, 30)), { year: 2026, month: 11, day: 4 });
});
