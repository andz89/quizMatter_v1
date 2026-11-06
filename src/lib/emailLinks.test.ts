import { test } from "node:test";
import assert from "node:assert/strict";
import { emailLinkDestination, emailLinkSchema } from "./emailLinks";

test("emailLinkSchema accepts a reset link", () => {
  assert.equal(emailLinkSchema.safeParse({ token_hash: "abc", type: "recovery" }).success, true);
});

test("emailLinkSchema refuses a link without a token", () => {
  assert.equal(emailLinkSchema.safeParse({ type: "recovery" }).success, false);
  assert.equal(emailLinkSchema.safeParse({ token_hash: "", type: "recovery" }).success, false);
});

test("emailLinkSchema refuses a token over 200 characters", () => {
  assert.equal(emailLinkSchema.safeParse({ token_hash: "x".repeat(201), type: "email" }).success, false);
});

test("emailLinkSchema refuses a type we don't send", () => {
  assert.equal(emailLinkSchema.safeParse({ token_hash: "abc", type: "magiclink" }).success, false);
});

test("emailLinkDestination: a good link opens Set a new password or home", () => {
  assert.equal(emailLinkDestination("recovery", true), "/set-password");
  assert.equal(emailLinkDestination("email", true), "/");
});

test("emailLinkDestination: a bad link goes to login with its message", () => {
  assert.equal(emailLinkDestination("recovery", false), "/login?error=reset");
  assert.equal(emailLinkDestination("email", false), "/login?error=confirm");
});
