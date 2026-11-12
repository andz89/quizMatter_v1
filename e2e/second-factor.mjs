// Two-step login for admins (src/lib/secondFactor.ts, supabase/migrations/20261231001300_admin_second_factor.sql).
// An admin without an authenticator app is sent from the admin pages to Account → Two-step login, sets it up with
// the QR code's key and lands in Admin. A new login (password only, aal1) is sent to /login/verify from the admin
// pages: a wrong code is refused, the right one opens Admin, and the login page itself goes to the verify page
// after the password. A teacher gets "page not found" on the set-up page and the admin pages, and the verify page
// says they have nothing to check.
import { chromium } from "playwright";
import {
  APP,
  check,
  deleteTeacher,
  fakeTurnstile,
  finish,
  forgetLogin,
  loggedIn,
  makeTeacher,
  psql,
  rpc,
  totpCode,
} from "./lib.mjs";

const admin = await makeTeacher({ first: "Twostep", last: "Admin" }); // no authenticator app yet
psql(`insert into public.admins (user_id, is_super) values ('${admin.id}', false)`);
const teacher = await makeTeacher({ first: "Twostep", last: "Teacher" });

const browser = await chromium.launch();
try {
  // ── A member without the second step: not an admin to the database, sent to set it up ─────────────────────
  const before = await rpc(admin, "is_admin");
  check("without a second step the database says not an admin", before.body === false, JSON.stringify(before.body));

  const context = await loggedIn(browser, admin);
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  await page.goto(`${APP}/admin`, { timeout: 120_000 });
  await page.waitForURL(/\/account\/two-step$/);
  check("Admin sends them to the set-up page", true);
  const secret = (await page.getByTestId("totp-secret").textContent()).trim();
  check("the page shows the key for the app", /^[A-Z2-7]{16,}$/.test(secret), secret);
  check("and the QR code", await page.getByAltText("QR code for the authenticator app").isVisible());

  await page.locator("#code").fill("000000");
  await page.getByRole("button", { name: "Turn on" }).click();
  await page.getByText("That code didn't work").waitFor();
  check("a wrong code is refused at set-up", true);

  await page.locator("#code").fill(totpCode(secret));
  await page.getByRole("button", { name: "Turn on" }).click();
  await page.waitForURL(/\/admin$/);
  await page.getByRole("heading", { name: "Admin" }).first().waitFor();
  check("the right code turns it on and opens Admin", true);
  admin.totpSecret = secret;
  admin.factorId = psql(`select id from auth.mfa_factors where user_id = '${admin.id}' and status = 'verified'`);
  forgetLogin(admin); // the earlier rpc cached a password-only token
  await page.goto(`${APP}/account/two-step`);
  await page.getByText("Two-step login is on").waitFor();
  check("the set-up page now says it's on", true);
  await context.close();

  // ── A new login with the password only: the admin pages ask for the code ──────────────────────────────────
  const aal1 = await loggedIn(browser, admin, undefined, { skipSecondStep: true });
  const page2 = await aal1.newPage();
  page2.setDefaultTimeout(60_000);
  await page2.goto(`${APP}/admin/teachers`, { timeout: 120_000 });
  await page2.waitForURL(/\/login\/verify\?next=%2Fadmin$/);
  check("password-only login: Admin asks for the code", true);
  await page2.locator("#code").fill("123456");
  await page2.getByRole("button", { name: "Continue" }).click();
  await page2.getByText("That code didn't work").waitFor();
  check("a wrong code is refused", true);
  await page2.locator("#code").fill(totpCode(secret));
  await page2.getByRole("button", { name: "Continue" }).click();
  await page2.waitForURL(/\/admin$/);
  await page2.getByRole("heading", { name: "Admin" }).first().waitFor();
  check("the right code opens Admin", true);
  await page2.goto(`${APP}/admin/teachers`);
  await page2.getByRole("heading", { name: "Admin" }).first().waitFor();
  check("and the admin pages stay open after it", /\/admin\/teachers$/.test(page2.url()), page2.url());
  await aal1.close();

  const after = await rpc(admin, "is_admin");
  check("with the second step the database says admin", after.body === true, JSON.stringify(after.body));

  // ── The login page itself goes to the verify page after the password ──────────────────────────────────────
  const fresh = await browser.newContext({ viewport: { width: 1366, height: 800 } });
  await fakeTurnstile(fresh);
  const page3 = await fresh.newPage();
  page3.setDefaultTimeout(60_000);
  await page3.goto(`${APP}/login?next=%2Faccount`, { timeout: 120_000 });
  await page3.locator("#email").fill(admin.email);
  await page3.locator("#password").fill(admin.password);
  await page3.getByRole("button", { name: "Log in" }).click();
  await page3.waitForURL(/\/login\/verify\?next=%2Faccount$/);
  check("login goes to the verify page, remembering the page", true);
  await page3.locator("#code").fill(totpCode(secret));
  await page3.getByRole("button", { name: "Continue" }).click();
  await page3.waitForURL(/\/account$/);
  check("the code opens the remembered page", true);
  await fresh.close();

  // ── A teacher ─────────────────────────────────────────────────────────────────────────────────────────────
  const teacherContext = await loggedIn(browser, teacher);
  const page4 = await teacherContext.newPage();
  page4.setDefaultTimeout(60_000);
  // Status 200, not 404: account/loading.tsx was already sent (like the admin pages, see submissions.mjs).
  await page4.goto(`${APP}/account/two-step`, { timeout: 120_000 });
  await page4.getByText("Page not found").waitFor();
  check("a teacher gets page not found on the set-up page", true);
  await page4.goto(`${APP}/login/verify`);
  await page4.getByText("no authenticator app set up").waitFor();
  check("the verify page tells a teacher there is nothing to check", true);
  const admins = await page4.goto(`${APP}/admin`);
  check("and Admin is still page not found", admins.status() === 404);
  await teacherContext.close();
} finally {
  await browser.close();
  await deleteTeacher(admin);
  await deleteTeacher(teacher);
}
finish();
