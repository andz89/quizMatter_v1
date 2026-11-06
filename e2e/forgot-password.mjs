// Forgot password: the Forgot password page asks for an email and Supabase sends the reset email (read here from
// Mailpit, local Supabase's mail catcher). The "are you human?" box is a stand-in (fakeTurnstile).
import { chromium } from "playwright";
import { APP, check, deleteTeacher, env, fakeTurnstile, finish, loggedIn, makeTeacher } from "./lib.mjs";

const MAILPIT = "http://127.0.0.1:54324";

/** The token_hash in the newest email sent to `email` since `after` (waits up to 10 seconds for it). */
async function latestResetTokenHash(email, after = 0) {
  for (let i = 0; i < 20; i++) {
    const found = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json();
    const newest = (found.messages ?? []).find((m) => new Date(m.Created).getTime() >= after);
    if (newest) {
      const message = await (await fetch(`${MAILPIT}/api/v1/message/${newest.ID}`)).json();
      const hash = /token_hash=([^&"'\s]+)/.exec(message.HTML ?? message.Text ?? "")?.[1];
      if (hash) return hash;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return "";
}

/** Asks for a reset email straight from the local API (as the page does, without the captcha). */
async function askForReset(email) {
  const res = await fetch(`${env.API_URL}/auth/v1/recover`, {
    method: "POST",
    headers: { apikey: env.ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(`recover ${email}: ${res.status} ${await res.text()}`);
}

/** Opens /forgot-password, types `email` and sends it; true once "Check your email" shows. */
async function sendFromPage(page, email) {
  await page.goto(`${APP}/forgot-password`);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send link" }).click();
  return page
    .getByText("Check your email")
    .waitFor({ timeout: 10000 })
    .then(() => true, () => false);
}

const browser = await chromium.launch();
const teacher = await makeTeacher({ first: "Forgot" });
try {
  // ─── Part 1: the Forgot password page and the email ──────────────────────────────────────────────────────────
  const visitor = await browser.newContext();
  await fakeTurnstile(visitor);
  const page = await visitor.newPage();
  await page.goto(`${APP}/login`);
  const link = page.getByRole("link", { name: "Forgot password?" });
  check("login has a Forgot password? link", (await link.getAttribute("href").catch(() => null)) === "/forgot-password");

  await page.goto(`${APP}/forgot-password`);
  check("the Forgot password page opens logged out", new URL(page.url()).pathname === "/forgot-password", page.url());
  check("it says Type your email", await page.getByText("Type your email").isVisible().catch(() => false));

  const member = await loggedIn(browser, teacher);
  const memberPage = await member.newPage();
  await memberPage.goto(`${APP}/forgot-password`);
  check("logged in, it goes home", new URL(memberPage.url()).pathname === "/", memberPage.url());
  await member.close();

  const askedAt = Date.now() - 1000;
  // Typed with spaces and capitals: the page trims it and makes it small letters.
  const sent = await sendFromPage(page, `  ${teacher.email.toUpperCase()} `);
  check("the page shows Check your email with the address", sent && (await page.getByText(teacher.email).isVisible()));
  check("a reset email arrives with a link", (await latestResetTokenHash(teacher.email, askedAt)) !== "");

  const nobody = `nobody-${Date.now()}@test.local`;
  const nobodySent = await sendFromPage(page, nobody);
  check("an email with no account gets the same Check your email screen", nobodySent && (await page.getByText(nobody).isVisible()));

  // Supabase's two email limits (local waits only 1 second between emails, so its answer is played back here, in
  // the shape the live one sends).
  const limited = (msg) => (route) =>
    route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ code: 429, error_code: "over_email_send_rate_limit", msg }) });
  await visitor.route("**/auth/v1/recover*", limited("For security purposes, you can only request this after 42 seconds."));
  await sendFromPage(page, teacher.email);
  check("asking again within a minute says to wait", await page.getByText("We just sent a link. Please wait a minute before asking again.").isVisible());
  await visitor.unroute("**/auth/v1/recover*");
  await visitor.route("**/auth/v1/recover*", limited("Email rate limit exceeded"));
  await sendFromPage(page, teacher.email);
  check("the hourly email limit says try again in an hour", await page.getByText("We can't send more emails right now. Please try again in an hour.").isVisible());
  await visitor.close();
} finally {
  await deleteTeacher(teacher);
  await browser.close();
}
finish();
