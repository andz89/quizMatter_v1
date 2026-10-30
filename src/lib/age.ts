// A teacher's age from their birthday (user_settings.birth_date), worked out on today's date in Philippine time. The
// database does the same math (age_on and manila_today in 20261220000000_age_gender_address.sql), so the form and
// the database agree. No imports, so the tests can load it.

// Sign up and the Account page take teachers 18 to 100 years old.
export const MIN_AGE = 18;
export const MAX_AGE = 100;

/** "2026-10-30" → [2026, 10, 30], or null if it isn't a real calendar date (e.g. "2001-02-30"). */
function parts(date: string): [number, number, number] | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return [year, month, day];
}

/**
 * The age in whole years on `today` (both "YYYY-MM-DD"): the years between, minus 1 if the birthday hasn't come yet
 * this year. A 29 February birthday turns a year older on 1 March in other years.
 */
export function ageOn(birthDate: string, today: string): number {
  const [birthYear, birthMonth, birthDay] = birthDate.split("-").map(Number);
  const [year, month, day] = today.split("-").map(Number);
  const beforeBirthday = month < birthMonth || (month === birthMonth && day < birthDay);
  return year - birthYear - (beforeBirthday ? 1 : 0);
}

/** A real date, not after today, and 18 to 100 years old on `today`. */
export function isAllowedBirthDate(birthDate: string, today: string): boolean {
  if (!parts(birthDate) || birthDate > today) return false;
  const age = ageOn(birthDate, today);
  return age >= MIN_AGE && age <= MAX_AGE;
}

/** The date `years` years before `today`; a 29 February that year doesn't have becomes 28 February. */
function yearsBefore(today: string, years: number): Date {
  const [year, month, day] = today.split("-").map(Number);
  const date = new Date(Date.UTC(year - years, month - 1, day));
  // Date.UTC rolls 29 February into 1 March: step back to 28 February.
  if (date.getUTCMonth() !== month - 1) date.setUTCDate(0);
  return date;
}

/** The birthday date picker's limits on `today`: max = 18 today, min = the earliest birthday still 100 today. */
export function birthDateRange(today: string): { min: string; max: string } {
  const max = yearsBefore(today, MIN_AGE);
  const min = yearsBefore(today, MAX_AGE + 1);
  min.setUTCDate(min.getUTCDate() + 1);
  return { min: min.toISOString().slice(0, 10), max: max.toISOString().slice(0, 10) };
}

/** Today's date in the Philippines, "YYYY-MM-DD". */
export function todayInManila(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
}
