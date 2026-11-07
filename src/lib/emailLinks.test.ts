import { test } from "node:test";
import assert from "node:assert/strict";
import { badLinkDestination, claimEmail, emailLinkPath, emailLinkResult, emailLinkSchema } from "./emailLinks";

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

const reset = { token_hash: "abc", type: "recovery" } as const;
const signUp = { token_hash: "abc", type: "email" } as const;

test("emailLinkResult: a good link opens Set a new password or home", () => {
  assert.equal(emailLinkResult(reset, null), "/set-password");
  assert.equal(emailLinkResult(signUp, null), "/");
});

test("emailLinkResult: a used or old link goes to login with its message", () => {
  assert.equal(emailLinkResult(reset, { code: "otp_expired", status: 403 }), "/login?error=reset");
  assert.equal(emailLinkResult(signUp, { code: "otp_expired", status: 403 }), "/login?error=confirm");
});

test("emailLinkResult: a banned teacher is told so, not that the link expired", () => {
  assert.equal(emailLinkResult(reset, { code: "user_banned", status: 403 }), "/login?error=blocked");
  assert.equal(emailLinkResult(signUp, { code: "user_banned", status: 403 }), "/login?error=blocked");
});

test("emailLinkResult: when Supabase didn't really check the link, it stays usable", () => {
  const retry = "/auth/confirm?token_hash=abc&type=recovery&retry=1";
  assert.equal(emailLinkResult(reset, { status: 0 }), retry); // no answer at all
  assert.equal(emailLinkResult(reset, { code: "over_request_rate_limit", status: 429 }), retry);
  assert.equal(emailLinkResult(reset, { status: 500 }), retry);
  assert.equal(emailLinkResult(reset, { status: 503 }), retry);
});

test("badLinkDestination: a broken reset link gets the reset words", () => {
  assert.equal(badLinkDestination("recovery"), "/login?error=reset");
  assert.equal(badLinkDestination("email"), "/login?error=confirm");
  assert.equal(badLinkDestination("magiclink"), "/login?error=confirm");
  assert.equal(badLinkDestination(undefined), "/login?error=confirm");
});

test("emailLinkPath is the link page's address, with retry when asked", () => {
  const link = { token_hash: "abc", type: "recovery" } as const;
  assert.equal(emailLinkPath(link), "/auth/confirm?token_hash=abc&type=recovery");
  assert.equal(emailLinkPath(link, true), "/auth/confirm?token_hash=abc&type=recovery&retry=1");
});

test("claimEmail gives the login's email, or null when it has none", () => {
  assert.equal(claimEmail({ email: "tess@school.ph" }), "tess@school.ph");
  assert.equal(claimEmail({ email: "" }), null);
  assert.equal(claimEmail({}), null);
  assert.equal(claimEmail({ email: 5 }), null);
  assert.equal(claimEmail(undefined), null);
});
