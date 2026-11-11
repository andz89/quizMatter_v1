import { test } from "node:test";
import assert from "node:assert/strict";
import { securityHeaders } from "./securityHeaders";

const SECURITY_HEADERS = securityHeaders("https://abc.supabase.co");
const header = (key: string) => SECURITY_HEADERS.find((h) => h.key === key)?.value ?? "";
/** The sources one directive of a policy allows, e.g. directive("frame-src", policy). */
const directive = (name: string, policy: string) =>
  policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `)) ?? "";

test("nobody can put the app in a frame (clickjacking)", () => {
  assert.equal(header("X-Frame-Options"), "DENY");
  assert.equal(directive("frame-ancestors", header("Content-Security-Policy")), "frame-ancestors 'none'");
});

test("the enforced policy never names scripts or styles, so it can't break a page", () => {
  const enforced = header("Content-Security-Policy");
  assert.equal(directive("script-src", enforced), "");
  assert.equal(directive("style-src", enforced), "");
  assert.equal(directive("default-src", enforced), "");
});

test("browsers stay on https for a year", () => {
  const match = /max-age=(\d+)/.exec(header("Strict-Transport-Security"));
  assert.ok(match && Number(match[1]) >= 31536000, header("Strict-Transport-Security"));
});

test("files are read as the type we send, and other sites get only our origin as the referrer", () => {
  assert.equal(header("X-Content-Type-Options"), "nosniff");
  assert.equal(header("Referrer-Policy"), "strict-origin-when-cross-origin");
});

test("camera, microphone and location are off, but fullscreen is left alone (presenting, YouTube)", () => {
  const policy = header("Permissions-Policy");
  for (const feature of ["camera", "microphone", "geolocation"]) assert.match(policy, new RegExp(`${feature}=\(\)`));
  assert.doesNotMatch(policy, /fullscreen/);
});

test("the report-only policy allows every outside service a page may use", () => {
  const reportOnly = header("Content-Security-Policy-Report-Only");
  const frames = directive("frame-src", reportOnly);
  for (const host of [
    "https://challenges.cloudflare.com", // Turnstile
    "https://www.youtube.com", // embed slides
    "https://player.vimeo.com",
    "https://docs.google.com",
    "https://www.canva.com",
    "https://www.facebook.com", // announcement posts and videos
  ]) {
    assert.ok(frames.includes(host), `frame-src is missing ${host}`);
  }
  assert.ok(directive("script-src", reportOnly).includes("https://challenges.cloudflare.com"), "Turnstile's script");
  assert.ok(directive("connect-src", reportOnly).includes("https://abc.supabase.co"), "Supabase calls");
  assert.ok(directive("connect-src", reportOnly).includes("wss://abc.supabase.co"), "Supabase's live channel");
  assert.ok(/img-src [^;]*https:/.test(reportOnly), "embed image slides load any https picture");
  assert.ok(directive("frame-ancestors", reportOnly) === "", "frame-ancestors is enforced, not reported");
});

test("the local Docker Supabase (http) is allowed on the test server, and a missing address falls back", () => {
  const local = securityHeaders("http://127.0.0.1:54321").find((h) => h.key === "Content-Security-Policy-Report-Only")!.value;
  assert.ok(directive("connect-src", local).includes("http://127.0.0.1:54321 ws://127.0.0.1:54321"), local);
  const none = securityHeaders(undefined).find((h) => h.key === "Content-Security-Policy-Report-Only")!.value;
  assert.ok(directive("connect-src", none).includes("https://*.supabase.co wss://*.supabase.co"), none);
});
