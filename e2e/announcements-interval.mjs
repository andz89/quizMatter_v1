// "Again every N minutes": the super admin picks it in the form; the teacher's modal comes back N minutes after it
// was closed, in the same tab (across an in-app move and a reload), not while presenting, at once in a new tab, and
// nothing is saved in the database. Playwright's clock moves the browser's time forward instead of waiting.
// Deletes every announcement in the local database first.
import { chromium } from "playwright";
import { APP, SHOTS, check, deleteTeacher, finish, loggedIn, makeTeacher, psql } from "./lib.mjs";

const MINUTES = 2;
psql("delete from public.announcement_dismissals; delete from public.announcements;");
const superAdmin = await makeTeacher({ first: "Super", last: "Admin", superAdmin: true });
const teacher = await makeTeacher();

const browser = await chromium.launch();
try {
  // ── 1. Admin: the form ─────────────────────────────────────────────────────────────────────────────────────
  const a = await (await loggedIn(browser, superAdmin)).newPage();
  await a.goto(`${APP}/admin/announcements/new`);
  await a.getByRole("heading", { name: "New announcement" }).waitFor({ timeout: 120_000 });
  await a.fill("#announcement-name", "Every few minutes");
  await a.getByLabel("The modal's text").fill("A modal that comes back.");
  await a.locator('input[type="number"][max="60"]').first().fill("0");
  check("form: no minutes box before it's picked", (await a.getByLabel("Minutes", { exact: true }).count()) === 0);
  await a.locator('input[name="repeat"]').nth(3).check();
  const minutesBox = a.getByLabel("Minutes", { exact: true });
  check("form: picking 'Again every N minutes' starts the box at 15", (await minutesBox.inputValue()) === "15");
  await minutesBox.fill("");
  check(
    "form: emptying the box while typing keeps the choice and its box",
    (await a.locator('input[name="repeat"]').nth(3).isChecked()) && (await minutesBox.isVisible()),
  );
  // Backspacing to retype: the box can be emptied (it must not snap back and turn "30" into "130").
  await minutesBox.fill("15");
  await minutesBox.press("End");
  await minutesBox.press("Backspace");
  await minutesBox.press("Backspace");
  await minutesBox.pressSequentially("30");
  check("form: backspacing and typing 30 gives 30", (await minutesBox.inputValue()) === "30", await minutesBox.inputValue());
  await minutesBox.fill(String(MINUTES));
  await a.getByRole("button", { name: "Save and turn on" }).click();
  await a.waitForURL(`${APP}/admin/announcements`, { timeout: 60_000 });
  await a.getByText("Every few minutes").waitFor();
  check(`list: shows 'again every ${MINUTES} min'`, await a.getByText(`Modal · again every ${MINUTES} min`).isVisible());
  const saved = psql("select repeat || ' ' || repeat_minutes from public.announcements where name = 'Every few minutes';");
  check(`database: saved as interval ${MINUTES}`, saved === `interval ${MINUTES}`, saved);

  // ── 2. Teacher: closed, it comes back N minutes later in the same tab ───────────────────────────────────────
  const context = await loggedIn(browser, teacher, { width: 1366, height: 800 });
  await context.clock.install();
  const p = await context.newPage();
  const modal = p.getByText("A modal that comes back.");
  const close = () => p.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await p.goto(`${APP}/`, { timeout: 120_000 });
  await modal.waitFor({ timeout: 60_000 });
  check("home: the modal shows", true);
  await close();
  await p.getByRole("link", { name: /^Saved/ }).click();
  await p.waitForURL(`${APP}/saved`);
  await p.waitForTimeout(500);
  check("closed: still gone after an in-app move", !(await modal.isVisible()));
  await p.clock.fastForward("01:58");
  await p.waitForTimeout(500);
  check(`closed: still gone just before ${MINUTES} minutes`, !(await modal.isVisible()));
  await p.clock.fastForward("00:03");
  await modal.waitFor({ timeout: 5_000 });
  check(`back after ${MINUTES} minutes`, true);
  await p.screenshot({ path: SHOTS + "announcements-interval.png" });

  // 3. Closed again, then a reload: the closed time survives it.
  await close();
  await p.reload();
  await p.getByRole("link", { name: /^Saved/ }).waitFor({ timeout: 60_000 });
  await p.waitForTimeout(1_000);
  check("after a reload: still gone", !(await modal.isVisible()));
  await p.clock.fastForward("02:01");
  await modal.waitFor({ timeout: 5_000 });
  check("after a reload: back once the minutes pass", true);

  // 3b. A laptop sleep: the clock jumps but no timer fires; coming back to the tab brings it back at once.
  await close();
  const now = await p.evaluate(() => Date.now());
  await p.clock.setSystemTime(now + (MINUTES * 60 + 5) * 1000);
  await p.waitForTimeout(1_000);
  await p.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await modal.waitFor({ timeout: 5_000 }).catch(() => undefined);
  check("after a sleep: back as soon as the tab is in front again", await modal.isVisible());

  // 4. Due while presenting: hidden until presenting ends.
  await close();
  await p.evaluate(() => (document.documentElement.dataset.presenting = ""));
  await p.clock.fastForward("02:01");
  await p.waitForTimeout(1_000);
  check("while presenting: not shown, even when due", !(await modal.isVisible()));
  await p.evaluate(() => delete document.documentElement.dataset.presenting);
  await modal.waitFor({ timeout: 5_000 });
  check("after presenting: it shows", true);

  // 5. Closed here, a new tab shows it at once (remembered only in the tab), and nothing reached the database.
  await close();
  const newTab = await context.newPage();
  await newTab.goto(`${APP}/`);
  await newTab.getByText("A modal that comes back.").waitFor({ timeout: 60_000 });
  check("new tab: shows at once", true);
  const rows = psql("select count(*) from public.announcement_dismissals;");
  check("database: no closed record was saved", rows === "0", rows);
} finally {
  await browser.close();
  psql("delete from public.announcement_dismissals; delete from public.announcements;");
  await deleteTeacher(teacher);
  await deleteTeacher(superAdmin);
}
finish();
