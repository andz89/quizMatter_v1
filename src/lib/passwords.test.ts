import { test } from "node:test";
import assert from "node:assert/strict";
import { changePasswordSchema, newPasswordSchema, resetEmailSchema, resetErrorMessage, SAME_PASSWORD_MESSAGE } from "./passwords";

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

test("changePasswordSchema accepts the current password and a new one typed twice", () => {
  const fields = { currentPassword: "old-pass-1", password: "abcdefgh", confirmPassword: "abcdefgh" };
  assert.equal(changePasswordSchema.safeParse(fields).success, true);
});

test("changePasswordSchema refuses an empty current password", () => {
  const result = changePasswordSchema.safeParse({ currentPassword: "", password: "abcdefgh", confirmPassword: "abcdefgh" });
  assert.equal(result.success, false);
  assert.deepEqual(result.error?.issues[0].path, ["currentPassword"]);
  assert.equal(result.error?.issues[0].message, "Type your current password.");
});

test("changePasswordSchema refuses two different new passwords", () => {
  const result = changePasswordSchema.safeParse({ currentPassword: "old-pass-1", password: "abcdefgh", confirmPassword: "abcdefgX" });
  assert.equal(result.error?.issues[0].message, "The two passwords don't match.");
});

test("changePasswordSchema refuses a new password that is the current one", () => {
  const result = changePasswordSchema.safeParse({ currentPassword: "abcdefgh", password: "abcdefgh", confirmPassword: "abcdefgh" });
  assert.equal(result.error?.issues[0].message, SAME_PASSWORD_MESSAGE);
});

test("resetErrorMessage says nothing when the email was sent", () => {
  assert.equal(resetErrorMessage(null), null);
});

test("resetErrorMessage says nothing for Supabase's two email limits (they refuse only a real account)", () => {
  assert.equal(resetErrorMessage({ code: "over_email_send_rate_limit", message: "Email rate limit exceeded" }), null);
  assert.equal(resetErrorMessage({ message: "For security purposes, you can only request this after 42 seconds." }), null);
  assert.equal(resetErrorMessage({ message: "For security purposes, you can only request this after 1 second." }), null);
});

test("resetErrorMessage keeps the words of refusals that don't depend on the account", () => {
  assert.equal(resetErrorMessage({ code: "captcha_failed", message: "captcha protection" }), "The security check expired. Please try again.");
  assert.equal(resetErrorMessage({ code: "over_request_rate_limit", message: "x" }), "Too many tries. Please wait a few minutes and try again.");
  assert.equal(resetErrorMessage({ name: "AuthRetryableFetchError", message: "fetch failed" }), "Couldn't reach the server. Check your internet and try again.");
  assert.equal(resetErrorMessage({ message: "boom" }), "Something went wrong. Please try again.");
});
