// Shared helpers for the browser tests (see e2e/CLAUDE.md). LOCAL Docker Supabase only: it stops if the keys
// aren't for 127.0.0.1, and every request to *.supabase.co (the live project) is blocked and fails the run.
import { execSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The app started by `npm run e2e:dev`. */
export const APP = "http://localhost:3100";
export const SHOTS = fileURLToPath(new URL("./shots/", import.meta.url));
mkdirSync(SHOTS, { recursive: true });

/** The local Docker Supabase's keys, read fresh from `supabase status` (never saved in a file). */
export const env = Object.fromEntries(
  execSync("npx -y supabase@latest status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    .split(/\r?\n/)
    .filter((line) => line.includes("="))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), line.slice(i + 1).replace(/^"|"$/g, "")];
    }),
);
if (!env.API_URL?.startsWith("http://127.0.0.1")) {
  throw new Error("The local Supabase isn't running (npx -y supabase@latest start). Stopping.");
}

// ─── Checks ──────────────────────────────────────────────────────────────────────────────────────────────────
const results = [];
const liveHits = [];

export function check(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

/** Prints the totals and ends the run (exit 1 if any check failed). */
export function finish() {
  check("no request reached the live Supabase", liveHits.length === 0, liveHits.slice(0, 2).join(", "));
  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed} of ${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

// ─── Database ────────────────────────────────────────────────────────────────────────────────────────────────
/** A call to the local Supabase API with the service role key (skips the database rules). */
export async function api(path, init = {}) {
  const res = await fetch(`${env.API_URL}${path}`, {
    ...init,
    headers: {
      apikey: env.SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const tokens = new Map();
/**
 * A call to the local API as `person` (the anon key + their own login token), so the database rules apply to them,
 * like the app's browser calls. Never throws on a refusal: { ok, status, body } (body.code is the refusal's code).
 */
export async function asUser(person, path, init = {}) {
  if (!tokens.has(person.id)) tokens.set(person.id, (await loginSession(person)).access_token);
  const res = await fetch(`${env.API_URL}${path}`, {
    ...init,
    headers: {
      apikey: env.ANON_KEY,
      Authorization: `Bearer ${tokens.get(person.id)}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text ? JSON.parse(text) : null };
}

/** Forgets `person`'s cached login token, so the next asUser / rpc logs in again (e.g. after enrollSecondFactor). */
export function forgetLogin(person) {
  tokens.delete(person.id);
}

/** A database function called as `person` (see asUser). */
export const rpc = (person, name, args = {}) =>
  asUser(person, `/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(args) });

/** Runs SQL as postgres in the local Docker database and returns the plain result. */
export function psql(sql) {
  return execSync(`docker exec -i supabase_db_quizBuilder psql -U postgres -v ON_ERROR_STOP=1 -tA`, {
    input: sql,
    encoding: "utf8",
  }).trim();
}

const PASSWORD = "Local-test-pass-123";

/**
 * A new confirmed teacher with a unique email. `superAdmin` makes them the super admin, `admin` a plain admin; both
 * get an authenticator app set up (admins need the second step, see enrollSecondFactor), so their logins below are
 * full admin logins (aal2). An admin WITHOUT the second step: make a teacher and insert the admins row yourself.
 */
export async function makeTeacher({ first = "Tess", last = "Teacher", superAdmin = false, admin = false } = {}) {
  const email = `e2e-${first.toLowerCase()}-${Date.now()}@test.local`;
  const user = await api("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { first_name: first, last_name: last },
    }),
  });
  const teacher = { id: user.id, email, password: PASSWORD };
  if (superAdmin || admin) {
    psql(`insert into public.admins (user_id, is_super) values ('${user.id}', ${superAdmin})`);
    await enrollSecondFactor(teacher);
  }
  return teacher;
}

// ─── Two-step login (admins) ─────────────────────────────────────────────────────────────────────────────────
/** A call to Supabase's login API as the holder of `accessToken`. */
async function authApi(accessToken, path, body) {
  const res = await fetch(`${env.API_URL}/auth/v1${path}`, {
    method: "POST",
    headers: { apikey: env.ANON_KEY, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST /auth/v1${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

/** The 6-digit code an authenticator app shows for this base32 secret right now (TOTP: SHA-1, 30 seconds). */
export function totpCode(secret, at = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.toUpperCase().replace(/=+$/, "")) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const number = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(number % 1_000_000).padStart(6, "0");
}

/**
 * Sets up and verifies an authenticator app for `teacher` (what Account → Two-step login does), keeping its secret
 * on `teacher.totpSecret`, so their later logins (sessionCookies, asUser) pass the second step too.
 */
export async function enrollSecondFactor(teacher) {
  const { access_token } = await loginSession(teacher);
  const factor = await authApi(access_token, "/factors", { factor_type: "totp", friendly_name: "e2e", issuer: "QuizMatter" });
  const challenge = await authApi(access_token, `/factors/${factor.id}/challenge`, {});
  await authApi(access_token, `/factors/${factor.id}/verify`, { challenge_id: challenge.id, code: totpCode(factor.totp.secret) });
  teacher.totpSecret = factor.totp.secret;
  teacher.factorId = factor.id;
}

/**
 * A fresh login as `teacher` (Supabase's session object). With an authenticator app set up (`totpSecret`) it also
 * passes the second step, so the session is aal2, like an admin's real login. `skipSecondStep` stops after the
 * password (aal1), for tests of the verify page.
 */
export async function loginSession(teacher, { skipSecondStep = false } = {}) {
  const res = await fetch(`${env.API_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: env.ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: teacher.email, password: teacher.password }),
  });
  if (!res.ok) throw new Error(`login ${teacher.email}: ${res.status}`);
  const session = await res.json();
  if (!teacher.totpSecret || skipSecondStep) return session;
  const challenge = await authApi(session.access_token, `/factors/${teacher.factorId}/challenge`, {});
  return authApi(session.access_token, `/factors/${teacher.factorId}/verify`, { challenge_id: challenge.id, code: totpCode(teacher.totpSecret) });
}

/** Deletes a test account (and with it their presentations). Call it in `finally`. */
export async function deleteTeacher(teacher) {
  await api(`/auth/v1/admin/users/${teacher.id}`, { method: "DELETE" }).catch((e) => console.log(`cleanup: ${e.message}`));
}

// ─── Browser ─────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * A fresh login session for `teacher` as @supabase/ssr's cookie pieces, [name, value][]. `change` may edit the
 * session first (e.g. make it look expired, so the app refreshes it). `options` go to loginSession
 * (`skipSecondStep`: an admin's login before the code).
 */
export async function sessionCookies(teacher, change = (session) => session, options = {}) {
  const value = "base64-" + Buffer.from(JSON.stringify(change(await loginSession(teacher, options)))).toString("base64url");
  const name = `sb-${new URL(env.API_URL).hostname.split(".")[0]}-auth-token`;
  return value.length <= 3180 ? [[name, value]] : value.match(/.{1,3180}/g).map((v, i) => [`${name}.${i}`, v]);
}

/**
 * A browser context logged in as `teacher`: the session goes straight into @supabase/ssr's cookie (base64url,
 * cut in 3180-character pieces), so the login page's "Verify you are human" box is never needed. `options` go to
 * Playwright's newContext (e.g. `timezoneId`, `locale`).
 */
export async function loggedIn(browser, teacher, viewport = { width: 1366, height: 800 }, options = {}) {
  const { skipSecondStep = false, ...contextOptions } = options;
  const pieces = await sessionCookies(teacher, (session) => session, { skipSecondStep });
  const context = await browser.newContext({ viewport, ...contextOptions });
  await context.addCookies(pieces.map(([n, v]) => ({ name: n, value: v, domain: "localhost", path: "/" })));
  await context.route(
    (url) => url.hostname.endsWith("supabase.co"),
    (route) => {
      liveHits.push(route.request().url());
      return route.abort();
    },
  );
  return context;
}

/**
 * Cloudflare's real "are you human?" box doesn't pass in a headless browser. This answers its script address with a
 * stand-in that passes at once with a made-up token: local Supabase has no captcha, so the token isn't checked.
 * Call it on a context before opening a page with the box (sign up, Forgot password).
 */
export async function fakeTurnstile(context) {
  await context.route("https://challenges.cloudflare.com/turnstile/**", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `window.turnstile = { render: (el, o) => { setTimeout(() => o.callback("e2e-token"), 50); return "e2e"; }, remove() {} };`,
    }),
  );
}

/** Bounding box in words, for a check's detail. */
export const round = (b) =>
  b ? `x ${Math.round(b.x)}, y ${Math.round(b.y)}, ${Math.round(b.width)}×${Math.round(b.height)}` : "none";
