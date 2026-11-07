import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { clearLock, lockedUntil, LOGIN_LIMIT, recordTry } from "./browserLimits";

// A plain stand-in for the browser's localStorage.
const stored = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) },
});
beforeEach(() => stored.clear());

const lockLogin = (now: number) => {
  for (let i = 0; i < LOGIN_LIMIT.max; i++) recordTry(LOGIN_LIMIT, now);
};

test("clearLock ends a lock at once", () => {
  lockLogin(1000);
  assert.notEqual(lockedUntil(LOGIN_LIMIT, 1001), null);
  clearLock(LOGIN_LIMIT);
  assert.equal(lockedUntil(LOGIN_LIMIT, 1001), null);
});

test("clearLock keeps the last lock, so another one soon still counts as a repeat", () => {
  lockLogin(1000);
  clearLock(LOGIN_LIMIT);
  lockLogin(2000);
  assert.equal(lockedUntil(LOGIN_LIMIT, 2000), 2000 + LOGIN_LIMIT.repeatLockMs);
});

test("clearLock does nothing when nothing is saved", () => {
  clearLock(LOGIN_LIMIT);
  assert.equal(lockedUntil(LOGIN_LIMIT, 1000), null);
});
