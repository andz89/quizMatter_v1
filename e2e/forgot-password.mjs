// Forgot password: the Forgot password page asks for an email and Supabase sends the reset email (read here from
// Mailpit, local Supabase's mail catcher). The "are you human?" box is a stand-in (fakeTurnstile).
import { execSync } from "node:child_process";
import { chromium } from "playwright";
import { api, APP, check, deleteTeacher, env, fakeTurnstile, finish, loggedIn, makeTeacher, psql, sessionCookies, SHOTS } from "./lib.mjs";

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

/** How many emails Mailpit holds for `email`. */
async function emailsTo(email) {
  const found = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json();
  return found.messages?.length ?? 0;
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

/** Local Supabase's answer to a login: its status, and its body (the session, or the error_code). */
async function token(grant, body) {
  const res = await fetch(`${env.API_URL}/auth/v1/token?grant_type=${grant}`, {
    method: "POST",
    headers: { apikey: env.ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
const passwordLogin = (email, password) => token("password", { email, password });

/** The footer's "Keep QuizMatter free" link, which the login pages leave out. */
const hasDonationLink = (page) => page.getByText("Help keep it running").isVisible();

const LOG_OUT_FAILED = "Couldn't log out. Please try again.";
const LINK_STILL_WORKS = "Something went wrong on our side. Your link still works, so click Continue to try again.";

/**
 * Stops or starts local Supabase's gateway (the outage check): the app then can't reach Supabase at all, at once.
 * Stopping only the login service isn't steady: the gateway may keep trying its old address for a long time.
 */
const docker = (command) => execSync(`docker ${command} supabase_kong_quizBuilder`, { stdio: "ignore" });
let isGatewayDown = false;
// Stopped by hand (Ctrl+C) during the outage check: the gateway must come back.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (isGatewayDown) docker("start");
    process.exit(1);
  });
}

/** Waits until Supabase's login service answers again (up to 30 seconds). */
async function authBack() {
  for (let i = 0; i < 60; i++) {
    const res = await fetch(`${env.API_URL}/auth/v1/health`, { headers: { apikey: env.ANON_KEY } }).catch(() => null);
    if (res?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("The local login service didn't come back.");
}

const browser = await chromium.launch();
const teacher = await makeTeacher({ first: "Forgot" });
const resetter = await makeTeacher({ first: "Resetter" });
const banned = await makeTeacher({ first: "Banned" });
const limited = await makeTeacher({ first: "Limited" });
const boss = await makeTeacher({ first: "Boss", superAdmin: true });
let joinerId = null;
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
  check("the Forgot password page has no donation link", !(await hasDonationLink(page)));

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
  const refusal = (msg) => (route) =>
    route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ code: 429, error_code: "over_email_send_rate_limit", msg }) });
  await visitor.route("**/auth/v1/recover*", refusal("For security purposes, you can only request this after 42 seconds."));
  // Within a minute Supabase refuses a real account but not an unknown email: the page must show the same screen,
  // or it would tell who has an account.
  const againSent = await sendFromPage(page, teacher.email);
  check("asking again within a minute shows the same Check your email screen", againSent && (await page.getByText(teacher.email).isVisible()));
  await visitor.unroute("**/auth/v1/recover*");
  await visitor.route("**/auth/v1/recover*", refusal("Email rate limit exceeded"));
  // The hourly limit refuses a real account only, too.
  const hourlySent = await sendFromPage(page, teacher.email);
  check("the hourly email limit shows the same Check your email screen", hourlySent && (await page.getByText(teacher.email).isVisible()));
  check(
    "it says to try again later",
    await page.getByText("No email after a few minutes? Check your spam folder, or try again later.").isVisible().catch(() => false),
  );
  await visitor.unroute("**/auth/v1/recover*");
  // Every other refusal still shows its words.
  await visitor.route("**/auth/v1/recover*", (route) =>
    route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: 400, error_code: "captcha_failed", msg: "captcha protection" }) }),
  );
  const expiredSent = await sendFromPage(page, teacher.email);
  check("an expired security check still says so", !expiredSent && (await page.getByText("The security check expired. Please try again.").isVisible()));
  await visitor.close();

  // ─── Part 2: the email's link and Set a new password ─────────────────────────────────────────────────────────
  // Logged in somewhere else before the reset (its refresh token must stop working after it).
  const otherDevice = (await passwordLogin(resetter.email, resetter.password)).body;
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
  check("the link page has no donation link", !(await hasDonationLink(setPage)));
  await continueLink(setPage, resetLink);
  check("after a scanner, Continue still opens Set a new password", new URL(setPage.url()).pathname === "/set-password", setPage.url());
  check("it says Set a new password", await setPage.getByRole("heading", { name: "Set a new password" }).isVisible().catch(() => false));
  check("Set a new password says whose account", await setPage.getByText(`For ${resetter.email}`).isVisible().catch(() => false));
  check("Set a new password has no donation link", !(await hasDonationLink(setPage)));
  check("it has a way out", (await setPage.getByRole("link", { name: "Go to home" }).getAttribute("href", { timeout: 5000 }).catch(() => null)) === "/");

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
  // Locked out of login by wrong tries on this browser: a new password ends the lock.
  const loginLock = () => setPage.evaluate(() => JSON.parse(localStorage.getItem("qm-login-limit") ?? "{}").lockedUntil ?? 0);
  await setPage.evaluate(() =>
    localStorage.setItem("qm-login-limit", JSON.stringify({ times: [], lockedUntil: Date.now() + 3600000, lastLockAt: Date.now() })),
  );
  await save("New-pass-456", "New-pass-456");
  const changed = await setPage.getByText("Password changed.").waitFor({ timeout: 10000 }).then(() => true, () => false);
  await setPage.waitForURL(`${APP}/`, { timeout: 10000 }).catch(() => {});
  check("a new password is saved and home opens", changed && new URL(setPage.url()).pathname === "/", setPage.url());
  check("a new password ends the login lock on this browser", (await loginLock()) === 0);
  await fresh.close();

  const refreshed = await token("refresh_token", { refresh_token: otherDevice.refresh_token });
  check(
    "the other device is logged out (its refresh token no longer works)",
    refreshed.status === 400 && /refresh_token/.test(refreshed.body.error_code ?? ""),
    `${refreshed.status} ${refreshed.body.error_code}`,
  );
  const withNew = await passwordLogin(resetter.email, "New-pass-456");
  check("the new password logs in", withNew.status === 200 && Boolean(withNew.body.access_token), `${withNew.status}`);
  const withOld = await passwordLogin(resetter.email, resetter.password);
  check("the old password doesn't", withOld.status === 400 && withOld.body.error_code === "invalid_credentials", `${withOld.status} ${withOld.body.error_code}`);

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
  check("a reset link with no token gets the reset words", new URL(reusedPage.url()).search.includes("error=reset"), reusedPage.url());
  await reusedPage.goto(`${APP}/auth/confirm?type=email`);
  check("a sign up link with no token gets the sign up words", new URL(reusedPage.url()).search.includes("error=confirm"), reusedPage.url());
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
  // Logging out fails (no internet): it says so, and the button works again.
  await switcher.route("**/auth/v1/logout*", (route) => route.abort());
  await switchPage.getByRole("button", { name: "Log out" }).click();
  check(
    "a failed log out on the link page says so",
    await switchPage.getByText(LOG_OUT_FAILED).waitFor({ timeout: 10000 }).then(() => true, () => false),
  );
  await switcher.unroute("**/auth/v1/logout*");
  await switchPage.getByRole("button", { name: "Log out" }).click();
  const continueShown = await switchPage.getByRole("button", { name: "Continue" }).waitFor({ timeout: 10000 }).then(() => true, () => false);
  check("Log out on the link page shows Continue", continueShown);
  await continueLink(switchPage, logOutLink);
  check("then the link opens Set a new password", new URL(switchPage.url()).pathname === "/set-password", switchPage.url());
  await switcher.close();

  // Someone logged in on this browser in another tab after the link page opened: Continue refuses (never a swap),
  // and the link isn't used up.
  const staleAt = Date.now() - 1000;
  await askForReset(resetter.email);
  const staleLink = `${APP}/auth/confirm?token_hash=${await latestResetTokenHash(resetter.email, staleAt)}&type=recovery`;
  const stale = await browser.newContext();
  const stalePage = await stale.newPage();
  await stalePage.goto(staleLink);
  const pieces = await sessionCookies(teacher);
  await stale.addCookies(pieces.map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
  await stalePage.getByRole("button", { name: "Continue" }).click();
  const refused = await stalePage.getByText(`You're logged in as ${teacher.email}.`).waitFor({ timeout: 10000 }).then(() => true, () => false);
  check("Continue while logged in refuses and says log out first", refused, stalePage.url());
  await stale.clearCookies();
  await stalePage.reload();
  await continueLink(stalePage, staleLink);
  check("and the link still works after logging out", new URL(stalePage.url()).pathname === "/set-password", stalePage.url());
  await stale.close();

  // A banned teacher's reset link: the ban stays, and the words say so (not "expired", which sends them round again).
  await api(`/auth/v1/admin/users/${banned.id}`, { method: "PUT", body: JSON.stringify({ ban_duration: "24h" }) });
  const bannedAt = Date.now() - 1000;
  await askForReset(banned.email);
  const bannedLink = `${APP}/auth/confirm?token_hash=${await latestResetTokenHash(banned.email, bannedAt)}&type=recovery`;
  const blocked = await browser.newContext();
  const blockedPage = await blocked.newPage();
  await continueLink(blockedPage, bannedLink);
  check("a banned teacher's link goes to login", new URL(blockedPage.url()).search.includes("error=blocked"), blockedPage.url());
  check("it says the account is blocked", await blockedPage.getByText("This account is blocked.").isVisible().catch(() => false));
  await blocked.close();

  // A real sign up link: a new account that isn't confirmed yet shows its own words, and Continue confirms it.
  const generated = await api("/auth/v1/admin/generate_link", {
    method: "POST",
    body: JSON.stringify({ type: "signup", email: `e2e-joiner-${Date.now()}@test.local`, password: "Local-test-pass-123" }),
  });
  joinerId = generated.id ?? generated.user?.id;
  const signUpHash = generated.hashed_token ?? generated.properties?.hashed_token;
  const confirmedAt = async () => (await api(`/auth/v1/admin/users/${joinerId}`)).email_confirmed_at;
  check("a generated sign up account isn't confirmed yet", !(await confirmedAt()));
  const signUpLink = `${APP}/auth/confirm?token_hash=${signUpHash}&type=email`;
  const joiner = await browser.newContext();
  const joinPage = await joiner.newPage();
  await joinPage.goto(signUpLink);
  check("a sign up link shows its words", await joinPage.getByText("Click Continue to finish making your account.").isVisible().catch(() => false));
  await continueLink(joinPage, signUpLink);
  check("a sign up link continues home", new URL(joinPage.url()).pathname === "/", joinPage.url());
  check("and it confirms the account", Boolean(await confirmedAt()));
  await joiner.close();

  // The account menu's Log out, failing the same way.
  const member2 = await loggedIn(browser, teacher);
  await member2.route("**/auth/v1/logout*", (route) => route.abort());
  const menuPage = await member2.newPage();
  await menuPage.goto(`${APP}/`);
  await menuPage.getByRole("button", { name: "Account menu" }).click();
  await menuPage.getByRole("button", { name: "Log out" }).click();
  check(
    "a failed log out in the account menu says so",
    await menuPage.getByText(LOG_OUT_FAILED).waitFor({ timeout: 10000 }).then(() => true, () => false),
  );
  check("and the menu's Log out works again", await menuPage.getByRole("button", { name: "Log out" }).isEnabled());
  await member2.close();

  // Supabase can't be reached when Continue is clicked: the link isn't used up, and the page says so.
  const outageAt = Date.now() - 1000;
  await askForReset(resetter.email);
  const outageLink = `${APP}/auth/confirm?token_hash=${await latestResetTokenHash(resetter.email, outageAt)}&type=recovery`;
  const outage = await browser.newContext();
  const outagePage = await outage.newPage();
  await outagePage.goto(outageLink);
  try {
    isGatewayDown = true;
    docker("stop -t 1");
    await outagePage.getByRole("button", { name: "Continue" }).click();
    await outagePage.getByText(LINK_STILL_WORKS).waitFor({ timeout: 15000 }).catch(() => {});
    check("an outage says the link still works", await outagePage.getByText(LINK_STILL_WORKS).isVisible());
    check("it stays on the link page", new URL(outagePage.url()).pathname === "/auth/confirm", outagePage.url());
  } finally {
    docker("start");
    isGatewayDown = false;
    await authBack();
  }
  await outagePage.getByRole("button", { name: "Continue" }).click();
  await outagePage.waitForURL((u) => !u.pathname.startsWith("/auth/confirm"), { timeout: 15000 }).catch(() => {});
  check("after the outage, the same link works", new URL(outagePage.url()).pathname === "/set-password", outagePage.url());
  await outage.close();

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

  // ─── Part 4: 3 reset emails a day per teacher, 10 requests an hour per internet address ───────────────────────
  const limits = await browser.newContext();
  await fakeTurnstile(limits);
  const limitsPage = await limits.newPage();
  let recoverCalls = 0;
  await limits.route("**/auth/v1/recover*", (route) => {
    recoverCalls++;
    return route.continue();
  });
  // Cloudflare adds the address on the live site; here the test adds it to the page's request to the server.
  const askFrom = async (ip) => {
    await limits.unroute(`${APP}/forgot-password`).catch(() => {});
    await limits.route(`${APP}/forgot-password`, (route) =>
      route.request().method() === "POST"
        ? route.continue({ headers: { ...route.request().headers(), "cf-connecting-ip": ip } })
        : route.continue(),
    );
  };

  await askFrom("203.0.113.70");
  for (let i = 0; i < 3; i++) {
    await sendFromPage(limitsPage, limited.email);
    await new Promise((resolve) => setTimeout(resolve, 1300)); // local Supabase waits 1 second between emails
  }
  check("3 resets a day each send an email", (await emailsTo(limited.email)) === 3 && recoverCalls === 3, `${await emailsTo(limited.email)} emails, ${recoverCalls} calls`);
  const fourth = await sendFromPage(limitsPage, limited.email);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  check("the 4th shows the same Check your email screen", fourth && (await limitsPage.getByText(limited.email).isVisible()));
  check("and sends no email", (await emailsTo(limited.email)) === 3 && recoverCalls === 3, `${await emailsTo(limited.email)} emails, ${recoverCalls} calls`);

  // One internet address that already asked 10 times this hour: refused, also for an email with no account.
  psql("insert into public.password_reset_requests (ip) select '203.0.113.71' from generate_series(1, 10)");
  await askFrom("203.0.113.71");
  const eleventh = await sendFromPage(limitsPage, `nobody-${Date.now()}@test.local`);
  check("the 11th request from an address shows the same screen", eleventh);
  check("and doesn't reach Supabase", recoverCalls === 3, `${recoverCalls} calls`);
  await askFrom("203.0.113.72");
  await sendFromPage(limitsPage, `nobody-${Date.now()}@test.local`);
  check("another address still reaches Supabase", recoverCalls === 4, `${recoverCalls} calls`);
  await limits.close();

  // ─── Part 5: Admin → Safety → Password resets lists them for the super admin ───────────────────────────────────
  psql("insert into public.password_reset_requests (ip) values ('2001:db8:5:6::/64')");
  const bossContext = await loggedIn(browser, boss);
  const safety = await bossContext.newPage();
  const resetsSection = safety.locator("section", { has: safety.getByRole("heading", { name: "Password resets" }) });
  const openSafety = async () => {
    await safety.goto(`${APP}/admin/safety`);
    return resetsSection.waitFor({ timeout: 30000 }).then(() => true, () => false);
  };
  const rowText = (text) => resetsSection.locator("li", { hasText: text }).first().innerText({ timeout: 5000 }).catch(() => "");
  check("Admin → Safety has a Password resets section", await openSafety());
  const limitedRow = await rowText(limited.email);
  check("a teacher with 3 reset emails today shows 3 of 3 and Limit reached", /3 of 3/.test(limitedRow) && /Limit reached/.test(limitedRow), limitedRow);
  check("the teacher's name shows too", /Limited Teacher/.test(limitedRow), limitedRow);
  const fullAddress = await rowText("203.0.113.71");
  check("an address with 10 requests this hour shows 10 of 10 and Limit reached", /10 of 10/.test(fullAddress) && /Limit reached/.test(fullAddress), fullAddress);
  const usedAddress = await rowText("203.0.113.70");
  check("an address under the limit shows its count", /4 of 10/.test(usedAddress) && !/Limit reached/.test(usedAddress), usedAddress);
  const ipv6Network = await rowText("2001:db8:5:6::/64");
  check("an IPv6 network shows as one address", /1 of 10/.test(ipv6Network), ipv6Network);
  // A script that skipped the page: Supabase sent a 4th email anyway.
  psql(`insert into public.password_reset_sends (user_id) values ('${limited.id}')`);
  await openSafety();
  const overRow = await rowText(limited.email);
  check("more than 3 shows Over the limit", /4 of 3/.test(overRow) && /Over the limit/.test(overRow), overRow);
  await safety.screenshot({ path: `${SHOTS}admin-safety-resets.png`, fullPage: true });
  await bossContext.close();
} finally {
  await deleteTeacher(teacher);
  await deleteTeacher(resetter);
  await deleteTeacher(banned);
  await deleteTeacher(limited);
  await deleteTeacher(boss);
  psql("delete from public.password_reset_requests where ip << '203.0.113.0/24' or ip << '2001:db8::/32'");
  if (joinerId) await deleteTeacher({ id: joinerId });
  await browser.close();
}
finish();
