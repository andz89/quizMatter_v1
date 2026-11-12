import { test } from "node:test";
import assert from "node:assert/strict";
import { safeNextPath } from "./nextPath";

const origin = "https://quizmatter.com";

test("a page on this site comes back with its query and hash", () => {
  assert.equal(safeNextPath("/presentation/abc/edit?x=1#s2", origin), "/presentation/abc/edit?x=1#s2");
});

test("no next means the home page", () => {
  assert.equal(safeNextPath(null, origin), "/");
  assert.equal(safeNextPath("", origin), "/");
});

test("another site is never followed: the answer always stays on this site", () => {
  for (const next of ["https://evil.example/", "//evil.example/x", "/\evil.example"]) {
    const result = safeNextPath(next, origin);
    assert.ok(result.startsWith("/") && !result.startsWith("//"), result);
    assert.equal(new URL(result, origin).origin, origin);
  }
});

test("the verify page itself is never the next page (no loop)", () => {
  assert.equal(safeNextPath("/login/verify?next=%2Fadmin", origin), "/");
});
