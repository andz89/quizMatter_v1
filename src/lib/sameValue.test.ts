import { test } from "node:test";
import assert from "node:assert/strict";
import { sameValue } from "./sameValue";

test("settings with the same fields in another order are the same (the database re-sorts saved keys)", () => {
  assert.equal(sameValue({ whole: 2, parts: 4, shaded: 3 }, { parts: 4, whole: 2, shaded: 3 }), true);
  assert.equal(sameValue({ count: 5, rows: 2, columns: 5 }, { rows: 2, count: 5, columns: 5 }), true);
});

test("a changed or missing field is not the same", () => {
  assert.equal(sameValue({ whole: 2, parts: 4, shaded: 3 }, { whole: 1, parts: 4, shaded: 3 }), false);
  assert.equal(sameValue({ parts: 4, shaded: 3 }, { whole: 1, parts: 4, shaded: 3 }), false);
  assert.equal(sameValue({ a: 1 }, undefined), false);
});

test("lists keep their order, and objects inside them are compared the same way", () => {
  assert.equal(sameValue({ hidden: [1, 2] }, { hidden: [2, 1] }), false);
  assert.equal(sameValue([{ text: "a", fill: "#fff" }], [{ fill: "#fff", text: "a" }]), true);
});
