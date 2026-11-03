// The date the calendar elements (Calendar Page, Month Calendar) show: the element's `calendarDate`. The names are
// always English, never the browser's language, so the server and every browser draw the same words. No imports, so
// the tests and schema.ts can load it.

export interface CalendarDate {
  year: number;
  // 1–12
  month: number;
  day: number;
}

export const CALENDAR_YEARS = { min: 1900, max: 2100 };

// What an element without its own date shows (only an element saved by hand could lack one: a new one gets today).
export const DEFAULT_CALENDAR_DATE: CalendarDate = { year: 2026, month: 1, day: 1 };

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** True for a date that exists (no 30 February), with whole numbers and a year from 1900 to 2100. */
export function isRealCalendarDate({ year, month, day }: CalendarDate): boolean {
  if (![year, month, day].every(Number.isInteger)) return false;
  if (year < CALENDAR_YEARS.min || year > CALENDAR_YEARS.max) return false;
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf({ year, month, day }: CalendarDate): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** "Wednesday, November 4, 2026". */
export function formatCalendarDate(date: CalendarDate): string {
  return `${WEEKDAY_NAMES[weekdayOf(date)]}, ${MONTH_NAMES[date.month - 1]} ${date.day}, ${date.year}`;
}

/** The month in weeks of 7 days, Sunday first; days outside the month are null. */
export function monthGrid(year: number, month: number): (number | null)[][] {
  const first = weekdayOf({ year, month, day: 1 });
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells = [
    ...Array.from({ length: first }, () => null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    const week = cells.slice(i, i + 7);
    weeks.push([...week, ...Array.from({ length: 7 - week.length }, () => null)]);
  }
  return weeks;
}

/** The text a date box (`<input type="date">`) holds: "2026-03-09". */
export function toDateInput({ year, month, day }: CalendarDate): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** A date box's text as a date, or null when it's empty or not a date the calendars take. */
export function fromDateInput(text: string): CalendarDate | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split("-").map(Number);
  const date = { year, month, day };
  return isRealCalendarDate(date) ? date : null;
}

/** Today on this computer's own calendar. */
export function todayCalendarDate(now = new Date()): CalendarDate {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}
