// Forgot password: the Forgot password page asks for an email and Supabase sends the reset email (read here from
// Mailpit, local Supabase's mail catcher). The "are you human?" box is a stand-in (fakeTurnstile).
import { chromium } from "playwright";
import { api, APP, check, deleteTeacher, env, fakeTurnstile, finish, loggedIn, makeTeacher, SHOTS } from "./lib.mjs";

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

/** Opens an email link and clicks Continue (the link is used only then); waits until it has left the link page. */
async function continueLink(page, url) {
  if (!page.url().startsWith(url)) await page.goto(url);
  const button = page.getByRole("button", { name: "Continue" });
  if (!(await button.isVisible().catch(() => false))) return;
  await button.click();
  await page.waitForURL((u) => u.pathname !== "/auth/confirm", { timeout: 10000 }).catch(() => {});
}

/** A password login from the local API: the session, or a thrown error when it's refused. */
async function passwordLogin(email, password) {
  const res = await fetch(`${env.API_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: env.ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login ${email}: ${res.status}`);
  return res.json();
}

const browser = await chromium.launch();
const teacher = await makeTeacher({ first: "Forgot" });
const resetter = await makeTeacher({ first: "Resetter" });
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
  const pageHash = await latestResetTokenHash(teacher.email, askedAt);
  check("a reset email arrives with a link", pageHash !== "");
  // The link the page itself asked for (the browser asks in PKCE mode) opens Set a new password too.
  const pageLink = await browser.newContext();
  const pageLinkTab = await pageLink.newPage();
  await continueLink(pageLinkTab, `${APP}/auth/confirm?token_hash=${pageHash}&type=recovery`);
  check("the page's own reset link opens Set a new password", new URL(pageLinkTab.url()).pathname === "/set-password", pageLinkTab.url());
  await pageLink.close();

  const nobody = `nobody-${Date.now()}@test.local`;
  const nobodySent = await sendFromPage(page, nobody);
  check("an email with no account gets the same Check your email screen", nobodySent && (await page.getByText(nobody).isVisible()));

  // Supabase's two email limits (local waits only 1 second between emails, so its answer is played back here, in
  // the shape the live one sends).
  const limited = (msg) => (route) =>
    route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ code: 429, error_code: "over_email_send_rate_limit", msg }) });
  await visitor.route("**/auth/v1/recover*", limited("For security purposes, you can only request this after 42 seconds."));
  // Within a minute Supabase refuses a real account but not an unknown email: the page must show the same screen,
  // or it would tell who has an account.
  const againSent = await sendFromPage(page, teacher.email);
  check("asking again within a minute shows the same Check your email screen", againSent && (await page.getByText(teacher.email).isVisible()));
  await visitor.unroute("**/auth/v1/recover*");
  await visitor.route("**/auth/v1/recover*", limited("Email rate limit exceeded"));
  await sendFromPage(page, teacher.email);
  check("the hourly email limit says try again in an hour", await page.getByText("We can't send more emails right now. Please try again in an hour.").isVisible());
  await visitor.close();

  // ─── Part 2: the email's link and Set a new password ─────────────────────────────────────────────────────────
  // Logged in somewhere else before the reset (its refresh token must stop working after it).
  const otherDevice = await passwordLogin(resetter.email, resetter.password);
  const resetAt = Date.now() - 1000;
  await askForReset(resetter.email);
  const hash = await latestResetTokenHash(resetter.email, resetAt);
  const resetLink = `${APP}/auth/confirm?token_hash=${hash}&type=recovery`;

  // Someone else logged in on this browser: the page says so, with no Continue (the link isn't used up).
  const someoneElse = await loggedIn(browser, teacher);
  const elsePage = await someoneElse.newPage();
  await elsePage.goto(resetLink);
  check(
    "logged in as someone else, the page says log out first",
    await elsePage.getByText(`You're logged in as ${teacher.email}. To use this link, log out first.`).isVisible().catch(() => false),
  );
  check("and has no Continue button", (await elsePage.getByRole("button", { name: "Continue" }).count()) === 0);
  await someoneElse.close();

  // A mail scanner opens the link first (a plain GET): that mustn't use it up.
  await fetch(resetLink);
  const fresh = await browser.newContext();
  const setPage = await fresh.newPage();
  await setPage.goto(resetLink);
  check("the link page shows the reset words", await setPage.getByText("Click Continue to set a new password.").isVisible().catch(() => false));
  await continueLink(setPage, resetLink);
  check("after a scanner, Continue still opens Set a new password", new URL(setPage.url()).pathname === "/set-password", setPage.url());
  check("it says Set a new password", await setPage.getByRole("heading", { name: "Set a new password" }).isVisible().catch(() => false));
  check("Set a new password says whose account", await setPage.getByText(`For ${resetter.email}`).isVisible().catch(() => false));

  const save = async (password, confirmPassword) => {
    await setPage.getByLabel("New password").fill(password);
    await setPage.getByLabel("Confirm password").fill(confirmPassword);
    await setPage.getByRole("button", { name: "Save password" }).click();
  };
  await save("New-pass-456", "New-pass-457");
  check("two different passwords are refused", await setPage.getByText("The two passwords don't match.").isVisible().catch(() => false));
  await save(resetter.password, resetter.password);
  check(
    "the current password is refused",
    await setPage.getByText("That's your current password. Pick a new one.").waitFor({ timeout: 10000 }).then(() => true, () => false),
  );
  await save("New-pass-456", "New-pass-456");
  const changed = await setPage.getByText("Password changed.").waitFor({ timeout: 10000 }).then(() => true, () => false);
  await setPage.waitForURL(`${APP}/`, { timeout: 10000 }).catch(() => {});
  check("a new password is saved and home opens", changed && new URL(setPage.url()).pathname === "/", setPage.url());
  await fresh.close();

  const refreshed = await fetch(`${env.API_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: env.ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: otherDevice.refresh_token }),
  });
  check("the other device is logged out (its refresh token no longer works)", !refreshed.ok, `${refreshed.status}`);
  check("the new password logs in", Boolean(await passwordLogin(resetter.email, "New-pass-456").catch(() => null)));
  check("the old password doesn't", !(await passwordLogin(resetter.email, resetter.password).catch(() => null)));

  const reused = await browser.newContext();
  const reusedPage = await reused.newPage();
  await continueLink(reusedPage, resetLink);
  check("the same link again goes to login", new URL(reusedPage.url()).search.includes("error=reset"), reusedPage.url());
  check(
    "it says the link expired",
    await reusedPage.getByText("This reset link has expired or was already used.").isVisible().catch(() => false),
  );
  await reusedPage.goto(`${APP}/set-password`);
  check("Set a new password needs a login", new URL(reusedPage.url()).pathname === "/login", reusedPage.url());
  await reusedPage.goto(`${APP}/auth/confirm?type=recovery`);
  check("a link with no token goes to login", new URL(reusedPage.url()).search.includes("error=confirm"), reusedPage.url());
  await reusedPage.goto(`${APP}/auth/confirm?token_hash=abc&type=magiclink`);
  check("a link with a type we don't send goes to login", new URL(reusedPage.url()).search.includes("error=confirm"), reusedPage.url());
  await reused.close();

  // Logged in as someone else, then Log out on the link page: the same link then works.
  const logOutAt = Date.now() - 1000;
  await askForReset(resetter.email);
  const logOutLink = `${APP}/auth/confirm?token_hash=${await latestResetTokenHash(resetter.email, logOutAt)}&type=recovery`;
  const switcher = await loggedIn(browser, teacher);
  const switchPage = await switcher.newPage();
  await switchPage.goto(logOutLink);
  await switchPage.getByRole("button", { name: "Log out" }).click();
  const continueShown = await switchPage.getByRole("button", { name: "Continue" }).waitFor({ timeout: 10000 }).then(() => true, () => false);
  check("Log out on the link page shows Continue", continueShown);
  await continueLink(switchPage, logOutLink);
  check("then the link opens Set a new password", new URL(switchPage.url()).pathname === "/set-password", switchPage.url());
  await switcher.close();

  // A sign up link (type=email; Supabase checks a magic link's token the same way, and local sign up needs no
  // confirmation) shows its own words and continues home.
  const generated = await api("/auth/v1/admin/generate_link", { method: "POST", body: JSON.stringify({ type: "magiclink", email: teacher.email }) });
  const signUpHash = generated.hashed_token ?? generated.properties?.hashed_token;
  const signUpLink = `${APP}/auth/confirm?token_hash=${signUpHash}&type=email`;
  const joiner = await browser.newContext();
  const joinPage = await joiner.newPage();
  await joinPage.goto(signUpLink);
  check("a sign up link shows its words", await joinPage.getByText("Click Continue to finish making your account.").isVisible().catch(() => false));
  await continueLink(joinPage, signUpLink);
  check("a sign up link continues home", new URL(joinPage.url()).pathname === "/", joinPage.url());
  await joiner.close();

  // ─── Part 3: sign up's "Check your email" doesn't promise an email ────────────────────────────────────────────
  // Supabase's sign up answer is played back (no account is made); for a used email it answers the same way.
  const signer = await browser.newContext();
  await fakeTurnstile(signer);
  await signer.route("**/auth/v1/signup*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "00000000-0000-0000-0000-000000000000" }) }),
  );
  const signUp = await signer.newPage();
  await signUp.goto(`${APP}/signup`);
  await signUp.locator("#firstName").fill("Sign");
  await signUp.locator("#lastName").fill("Upper");
  await signUp.locator("#contactNumber").fill("09171234567");
  await signUp.locator("#birthDate").fill("1990-05-05");
  await signUp.locator("#gender").selectOption("female");
  await signUp.locator("#educationLevel").selectOption("bachelor");
  await signUp.locator("#educationField").fill("Math");
  await signUp.locator("#email").fill(teacher.email);
  await signUp.locator("#password").fill("Sign-up-pass-123");
  await signUp.locator("#confirmPassword").fill("Sign-up-pass-123");
  await signUp.locator("#agreeTerms").check();
  await signUp.getByRole("button", { name: "Create account" }).click();
  const shown = await signUp.getByText("Check your email").waitFor({ timeout: 10000 }).then(() => true, () => false);
  check(
    "sign up says the link was sent only if the email isn't used yet",
    shown && (await signUp.getByText(`If ${teacher.email} isn't used yet, we sent a link to it.`).isVisible()),
  );
  check(
    "it links to Log in and to Forgot password",
    (await signUp.getByRole("link", { name: "Log in", exact: true }).getAttribute("href").catch(() => null)) === "/login" &&
      (await signUp.getByRole("link", { name: "reset your password" }).getAttribute("href").catch(() => null)) === "/forgot-password",
  );
  await signUp.screenshot({ path: `${SHOTS}signup-check-email.png` });
  await signer.close();
} finally {
  await deleteTeacher(teacher);
  await deleteTeacher(resetter);
  await browser.close();
}
finish();
