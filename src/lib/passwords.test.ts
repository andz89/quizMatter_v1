import { test } from "node:test";
import assert from "node:assert/strict";
import { newPasswordSchema, resetEmailSchema } from "./passwords";

test("resetEmailSchema trims spaces and makes the email small letters", () => {
  assert.equal(resetEmailSchema.parse(" Tess@School.ph "), "tess@school.ph");
});

test("resetEmailSchema refuses something that isn't an email", () => {
  assert.equal(resetEmailSchema.safeParse("tess").success, false);
});

test("newPasswordSchema accepts two matching passwords", () => {
  assert.equal(newPasswordSchema.safeParse({ password: "abcdefgh", confirmPassword: "abcdefgh" }).success, true);
});

test("newPasswordSchema refuses two different passwords on the confirm box", () => {
  const result = newPasswordSchema.safeParse({ password: "abcdefgh", confirmPassword: "abcdefgX" });
  assert.equal(result.success, false);
  assert.deepEqual(result.error?.issues[0].path, ["confirmPassword"]);
  assert.equal(result.error?.issues[0].message, "The two passwords don't match.");
});

test("newPasswordSchema refuses a short password on the password box", () => {
  const result = newPasswordSchema.safeParse({ password: "short", confirmPassword: "short" });
  assert.equal(result.success, false);
  assert.deepEqual(result.error?.issues[0].path, ["password"]);
});
