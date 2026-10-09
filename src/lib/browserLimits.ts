// Locks kept in this browser's own storage (localStorage): too many sign ups, or too many wrong logins, lock that
// page on this browser for a while. A speed bump for someone clicking by hand: clearing the browser, a private window
// or a script gets around it. The real walls are on Supabase's side (Turnstile, its rate limits, and the sign up
// limit per internet address). If storage is blocked or broken, nothing is ever locked, so a real teacher is never
// stuck by mistake. Admin → Safety shows these numbers.

export type BrowserLimit = {
  key: string;
  // This many tries within `withinMs` locks the page.
  max: number;
  withinMs: number;
  firstLockMs: number;
  // Used instead when the last lock started less than `repeatWithinMs` ago.
  repeatLockMs: number;
  repeatWithinMs: number;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// Sign ups that went through (the "Check your email" screen).
export const SIGN_UP_LIMIT: BrowserLimit = {
  key: "qm-sign-up-limit",
  max: 3,
  withinMs: HOUR,
  firstLockMs: HOUR,
  repeatLockMs: 24 * HOUR,
  repeatWithinMs: 24 * HOUR,
};

// Wrong email or password only. Shorter than sign up: a teacher who forgot their password must not wait a day.
export const LOGIN_LIMIT: BrowserLimit = {
  key: "qm-login-limit",
  max: 5,
  withinMs: 15 * MINUTE,
  firstLockMs: 15 * MINUTE,
  repeatLockMs: HOUR,
  repeatWithinMs: 24 * HOUR,
};

// Not a browser lock: the sign up limit per internet address, checked by the database (hook_before_user_created in
// 20261108000000_sign_up_limit.sql). Here so Admin → Safety can show it; keep both the same.
export const SIGN_UPS_PER_ADDRESS = 10;
// The start of that hook's refusal, to recognize it on the sign up page.
export const SIGN_UP_ADDRESS_MESSAGE = "Too many accounts were made from this internet connection.";

type Saved = { times: number[]; lockedUntil: number; lastLockAt: number };

/** What this browser saved, or null if storage is blocked (then nothing is counted). Broken data reads as empty. */
function read(limit: BrowserLimit): Saved | null {
  let text: string | null;
  try {
    text = localStorage.getItem(limit.key);
  } catch {
    return null;
  }
  let saved: Partial<Record<keyof Saved, unknown>> | null = null;
  try {
    saved = JSON.parse(text ?? "null");
  } catch {}
  return {
    times: Array.isArray(saved?.times) ? saved.times.filter((time) => typeof time === "number") : [],
    lockedUntil: typeof saved?.lockedUntil === "number" ? saved.lockedUntil : 0,
    lastLockAt: typeof saved?.lastLockAt === "number" ? saved.lastLockAt : 0,
  };
}

function write(limit: BrowserLimit, saved: Saved) {
  try {
    localStorage.setItem(limit.key, JSON.stringify(saved));
  } catch {
    // Blocked storage: nothing is counted.
  }
}

/** When this browser's lock ends, or null if it isn't locked. */
export function lockedUntil(limit: BrowserLimit, now = Date.now()): number | null {
  const saved = read(limit);
  return saved && saved.lockedUntil > now ? saved.lockedUntil : null;
}

/** Counts one try. Returns when the lock ends if this try started one, else null. */
export function recordTry(limit: BrowserLimit, now = Date.now()): number | null {
  const saved = read(limit);
  if (!saved) return null;
  const times = [...saved.times.filter((time) => now - time < limit.withinMs), now];
  if (times.length < limit.max) {
    write(limit, { ...saved, times });
    return null;
  }
  const isRepeat = saved.lastLockAt > 0 && now - saved.lastLockAt < limit.repeatWithinMs;
  const until = now + (isRepeat ? limit.repeatLockMs : limit.firstLockMs);
  write(limit, { times: [], lockedUntil: until, lastLockAt: now });
  return until;
}

/** Forgets the tries (e.g. after a correct login). The last lock is kept, so another one soon still counts as a repeat. */
export function clearTries(limit: BrowserLimit) {
  const saved = read(limit);
  if (saved) write(limit, { ...saved, times: [] });
}

/** "3:45 PM", or "tomorrow, 3:45 PM" when it's on another day. */
export function tryAgainAfter(time: number, now = Date.now()): string {
  const clock = new Date(time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return new Date(time).toDateString() === new Date(now).toDateString() ? clock : `tomorrow, ${clock}`;
}
