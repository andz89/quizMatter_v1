import { test } from "node:test";
import assert from "node:assert/strict";
import { ADMIN_LIST_MAX, ADMIN_LIST_STEP, adminListQuery, parseAdminList } from "./listParams";

test("an empty link gives the defaults", () => {
  assert.deepEqual(parseAdminList({}), { q: "", sort: "updated", shown: ADMIN_LIST_STEP });
});

test("reads the search, sort and count", () => {
  assert.deepEqual(parseAdminList({ q: "  fractions ", sort: "newest", shown: "30" }), {
    q: "fractions",
    sort: "newest",
    shown: 30,
  });
});

test("odd values fall back to the defaults", () => {
  const odd = parseAdminList({ q: "x".repeat(500), sort: "title", shown: "15" });
  assert.deepEqual(odd, { q: "", sort: "updated", shown: ADMIN_LIST_STEP });
  assert.equal(parseAdminList({ shown: String(ADMIN_LIST_MAX + ADMIN_LIST_STEP) }).shown, ADMIN_LIST_STEP);
  assert.equal(parseAdminList({ shown: "-10" }).shown, ADMIN_LIST_STEP);
});

test("a value given twice keeps the first", () => {
  assert.equal(parseAdminList({ q: ["a b", "c"] }).q, "a b");
});

test("the link leaves out defaults and starts the count over", () => {
  assert.equal(adminListQuery({ q: "", sort: "updated" }), "");
  assert.equal(adminListQuery({ q: "grade 4", sort: "newest" }), "?q=grade+4&sort=newest");
});
