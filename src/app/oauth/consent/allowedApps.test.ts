import { test } from "node:test";
import assert from "node:assert/strict";
import { isAllowedRedirect } from "./allowedApps";

test("Claude's own login addresses are allowed", () => {
  assert.equal(isAllowedRedirect("https://claude.ai/api/mcp/auth_callback"), true);
  assert.equal(isAllowedRedirect("https://claude.com/api/mcp/auth_callback"), true);
});

test("any other address is refused", () => {
  assert.equal(isAllowedRedirect("http://claude.ai/x"), false); // not https
  assert.equal(isAllowedRedirect("https://claude.ai.evil.com/x"), false); // only looks like claude.ai
  assert.equal(isAllowedRedirect("https://evil.example/cb"), false);
  assert.equal(isAllowedRedirect("not a url"), false);
});
