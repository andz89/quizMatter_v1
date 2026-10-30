import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PROVINCES } from "./provinces";

const MIGRATION = new URL("../../supabase/migrations/20261220000000_age_gender_address.sql", import.meta.url);

test("PROVINCES has 84 unique names", () => {
  assert.equal(PROVINCES.length, 84);
  assert.equal(new Set(PROVINCES).size, 84);
});

test("the migration checks the same provinces", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  const list = sql.slice(sql.indexOf("-- provinces:start"), sql.indexOf("-- provinces:end"));
  const names = [...list.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual([...names].sort(), [...PROVINCES].sort());
});
