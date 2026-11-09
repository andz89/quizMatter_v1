import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTO_SAVES_PER_DAY, countAutoSave, hasAutoSavesLeft } from "./autoSave";

const KEY = "qm-auto-saves";

// The browser's localStorage, which Node doesn't have.
function setStorage(storage: Pick<Storage, "getItem" | "setItem">) {
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
}

function makeStorage(): Map<string, string> {
  const items = new Map<string, string>();
  setStorage({ getItem: (key) => items.get(key) ?? null, setItem: (key, value) => void items.set(key, value) });
  return items;
}

test("the daily cap stays well under the database's 1,000 saves a day", () => {
  assert.ok(AUTO_SAVES_PER_DAY <= 600);
});

test("auto saves are left on a day with none counted", () => {
  makeStorage();
  assert.equal(hasAutoSavesLeft("2026-11-09"), true);
});

test("counting adds one to today's count", () => {
  const items = makeStorage();
  countAutoSave("2026-11-09");
  countAutoSave("2026-11-09");
  assert.deepEqual(JSON.parse(items.get(KEY)!), { day: "2026-11-09", count: 2 });
});

test("none are left once today's count reaches the cap", () => {
  const items = makeStorage();
  items.set(KEY, JSON.stringify({ day: "2026-11-09", count: AUTO_SAVES_PER_DAY - 1 }));
  assert.equal(hasAutoSavesLeft("2026-11-09"), true);
  countAutoSave("2026-11-09");
  assert.equal(hasAutoSavesLeft("2026-11-09"), false);
});

test("a new day starts at zero", () => {
  const items = makeStorage();
  items.set(KEY, JSON.stringify({ day: "2026-11-09", count: AUTO_SAVES_PER_DAY }));
  assert.equal(hasAutoSavesLeft("2026-11-10"), true);
  countAutoSave("2026-11-10");
  assert.deepEqual(JSON.parse(items.get(KEY)!), { day: "2026-11-10", count: 1 });
});

test("a broken saved value counts as zero", () => {
  const items = makeStorage();
  items.set(KEY, "not json");
  assert.equal(hasAutoSavesLeft("2026-11-09"), true);
  countAutoSave("2026-11-09");
  assert.deepEqual(JSON.parse(items.get(KEY)!), { day: "2026-11-09", count: 1 });
  items.set(KEY, JSON.stringify({ day: "2026-11-09", count: "lots" }));
  assert.equal(hasAutoSavesLeft("2026-11-09"), true);
});

test("a browser that blocks storage gets no auto save, since nothing can be counted", () => {
  setStorage({
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  });
  assert.equal(hasAutoSavesLeft("2026-11-09"), false);
  assert.doesNotThrow(() => countAutoSave("2026-11-09"));
});
