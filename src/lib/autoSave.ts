// The editor's auto save: how often it runs, and how many it may do in a day. No imports, so the tests can load it.

export const AUTO_SAVE_MS = 12_000;

// Every save counts toward the database's presentation_save_daily limit (1,000 a day, Philippine time; three days in
// a row at the limit bans the account). Saving every 12 seconds would reach it in about 3.3 hours of editing, so auto
// save stops at 600 and leaves the rest for the Save button. Change it together with that limit.
export const AUTO_SAVES_PER_DAY = 600;

const STORAGE_KEY = "qm-auto-saves";

/** How many auto saves this browser did on `today`. Throws if the browser blocks storage. */
function countOn(today: string): number {
  const raw = localStorage.getItem(STORAGE_KEY);
  try {
    const saved = JSON.parse(raw ?? "null");
    return saved?.day === today && Number.isInteger(saved.count) ? saved.count : 0;
  } catch {
    return 0;
  }
}

/** Whether auto save may run on `today` ("YYYY-MM-DD"). Not when the browser blocks storage: nothing could be counted. */
export function hasAutoSavesLeft(today: string): boolean {
  try {
    return countOn(today) < AUTO_SAVES_PER_DAY;
  } catch {
    return false;
  }
}

/** Counts one auto save that reached the database on `today`. */
export function countAutoSave(today: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ day: today, count: countOn(today) + 1 }));
  } catch {
    // Blocked storage: hasAutoSavesLeft is false then, so this isn't reached again.
  }
}
