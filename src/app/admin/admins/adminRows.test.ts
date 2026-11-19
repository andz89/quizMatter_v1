import { test } from "node:test";
import assert from "node:assert/strict";
import type { User } from "@supabase/supabase-js";
import { buildAdminRows } from "./adminRows";

const now = Date.parse("2026-11-19T12:00:00Z");

function user(id: string, email: string, factorStatus?: "verified" | "unverified"): User {
  return {
    id,
    email,
    created_at: "2026-10-01T00:00:00Z",
    last_sign_in_at: "2026-11-19T10:00:00Z",
    factors: factorStatus ? [{ id: "f", status: factorStatus, factor_type: "totp", created_at: "", updated_at: "" }] : undefined,
  } as unknown as User;
}

test("buildAdminRows: super admins first, then by email; a missing account is left out", () => {
  const users = new Map([
    ["a", user("a", "zed@x.com", "verified")],
    ["b", user("b", "amy@x.com")],
    ["c", user("c", "boss@x.com", "verified")],
  ]);
  const rows = buildAdminRows(
    [
      { user_id: "a", is_super: false },
      { user_id: "b", is_super: false },
      { user_id: "c", is_super: true },
      { user_id: "gone", is_super: false },
    ],
    users,
    new Map([["a", "Zed"]]),
    now,
  );
  assert.deepEqual(rows.map((row) => row.email), ["boss@x.com", "amy@x.com", "zed@x.com"]);
  assert.equal(rows[0].isSuper, true);
  assert.equal(rows[2].name, "Zed");
  assert.equal(rows[1].name, "");
});

test("buildAdminRows: two-step is on only with a verified factor", () => {
  const users = new Map([
    ["a", user("a", "a@x.com", "verified")],
    ["b", user("b", "b@x.com", "unverified")],
    ["c", user("c", "c@x.com")],
  ]);
  const rows = buildAdminRows(
    ["a", "b", "c"].map((id) => ({ user_id: id, is_super: false })),
    users,
    new Map(),
    now,
  );
  assert.deepEqual(rows.map((row) => row.hasTwoStep), [true, false, false]);
  assert.match(rows[0].meta, /^Joined .+ · Last login 2 hr ago$/);
});
