// Account → Password asks for the current password, and Supabase itself checks it (config.toml:
// [auth.email] require_current_password), so a stolen login can't change the password with a direct call either.
import { chromium } from "playwright";
import { APP, check, deleteTeacher, env, finish, loggedIn, loginSession, makeTeacher } from "./lib.mjs";

const NEW_PASSWORD = "New-pass-456";

/** A password change sent straight to local Supabase with the teacher's own login (no page): its status and code. */
async function changeDirectly(teacher, body) {
  const { access_token } = await loginSession(teacher);
  const res = await fetch(`${env.API_URL}/auth/v1/user`, {
    method: "PUT",
    headers: { apikey: env.ANON_KEY, Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, code: (await res.json()).error_code };
}

/** True when this password logs the teacher in. */
async function logsIn(teacher, password) {
  const res = await fetch(`${env.API_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: env.ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: teacher.email, password }),
  });
  return res.ok;
}

const browser = await chromium.launch();
const teacher = await makeTeacher({ first: "Password" });
try {
  // ── A direct call (what someone with a stolen login would do) ────────────────────────────────────────────────
  const without = await changeDirectly(teacher, { password: NEW_PASSWORD });
  check("a direct change without the current password is refused", without.status === 400 && without.code === "current_password_required", `${without.status} ${without.code}`);
  const wrong = await changeDirectly(teacher, { password: NEW_PASSWORD, current_password: "Not-the-password-1" });
  check("a direct change with a wrong current password is refused", wrong.status === 400 && wrong.code === "current_password_invalid", `${wrong.status} ${wrong.code}`);
  check("the password is still the old one", (await logsIn(teacher, teacher.password)) && !(await logsIn(teacher, NEW_PASSWORD)));

  // ── The Account page ─────────────────────────────────────────────────────────────────────────────────────────
  const context = await loggedIn(browser, teacher);
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  await page.goto(`${APP}/account`, { timeout: 120_000 });
  const card = page.locator("form", { has: page.getByRole("heading", { name: "Password" }) });
  const button = card.getByRole("button", { name: "Change password" });
  const fill = async (current, password, again) => {
    await card.getByLabel("Current password").fill(current);
    await card.getByLabel("New password").fill(password);
    await card.getByLabel("Type it again").fill(again);
  };
  const shows = (text) => page.getByText(text).first().waitFor({ timeout: 10_000 }).then(() => true, () => false);

  check("the Password card has a Current password box", await card.getByLabel("Current password").isVisible());
  await fill("", NEW_PASSWORD, NEW_PASSWORD);
  check("the button waits for the current password", await button.isDisabled());

  await fill(teacher.password, NEW_PASSWORD, "New-pass-457");
  await button.click();
  check("two different new passwords are refused", await shows("The two passwords don't match."));

  await fill(teacher.password, teacher.password, teacher.password);
  await button.click();
  check("the current password as the new one is refused", await shows("That's your current password. Pick a new one."));

  await fill("Not-the-password-1", NEW_PASSWORD, NEW_PASSWORD);
  await button.click();
  check("a wrong current password is refused in plain words", await shows("That isn't your current password."));
  check("and nothing changed", (await logsIn(teacher, teacher.password)) && !(await logsIn(teacher, NEW_PASSWORD)));

  await fill(teacher.password, NEW_PASSWORD, NEW_PASSWORD);
  await button.click();
  check("the right current password changes it", await shows("Password changed."));
  check("the boxes are emptied", (await card.getByLabel("Current password").inputValue()) === "");
  check("the new password logs in and the old one doesn't", (await logsIn(teacher, NEW_PASSWORD)) && !(await logsIn(teacher, teacher.password)));
  await page.reload();
  check("this browser stays logged in", new URL(page.url()).pathname === "/account", page.url());
  await context.close();
} finally {
  await deleteTeacher(teacher);
  await browser.close();
}
finish();
