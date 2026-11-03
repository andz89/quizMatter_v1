// Announcements, made by the super admin through the form (a corner box, an HTML modal), then seen by a teacher.
// Deletes every announcement in the local database first.
import { chromium } from "playwright";
import { APP, SHOTS, check, deleteTeacher, finish, loggedIn, makeTeacher, psql, round } from "./lib.mjs";

psql("delete from public.announcement_dismissals; delete from public.announcements;");
const superAdmin = await makeTeacher({ first: "Super", last: "Admin", superAdmin: true });
const teacher = await makeTeacher();
const consoleErrors = [];

const browser = await chromium.launch();
try {
  // ── Admin: a corner box through the form ───────────────────────────────────────────────────────────────────
  const a = await (await loggedIn(browser, superAdmin)).newPage();
  await a.goto(`${APP}/admin/announcements/new`);
  await a.getByRole("heading", { name: "New announcement" }).waitFor({ timeout: 120_000 });
  await a.fill("#announcement-name", "Corner test");
  await a.getByLabel("Corner box", { exact: true }).check();
  check("form: Corner box section shows", await a.getByRole("heading", { name: "Corner box" }).isVisible());
  check("form: no Large size for a corner box", (await a.getByText("Large (672 wide, normal)").count()) === 0);
  await a.getByLabel("The modal's text").fill("Hello from the corner box. New Grade 5 lessons are ready.");
  const autoAfter = a.locator('input[name="auto-close"]').nth(1);
  await autoAfter.check();
  const autoNumber = a.locator(`input[type="number"][min="5"]`);
  await autoNumber.fill("");
  check("form: emptying the seconds keeps 'After'", await autoAfter.isChecked());
  await autoNumber.fill("8");
  await a.locator('input[type="number"][max="60"]').first().fill("2");

  await a.getByRole("button", { name: "Preview" }).first().click();
  const previewBox = a.getByRole("region", { name: "Announcement" });
  await previewBox.waitFor();
  const box = await previewBox.boundingBox();
  check(
    "preview: box at the bottom-right",
    Math.abs(1366 - 16 - (box.x + box.width)) <= 2 && Math.abs(800 - 16 - (box.y + box.height)) <= 2,
    round(box),
  );
  check("preview: a new (Large) one switched to Corner box is Medium, 500 wide", Math.round(box.width) === 500);
  await a.screenshot({ path: SHOTS + "announcements-1-admin-preview.png" });
  await a.locator("#announcement-name").click();
  await a.keyboard.type(" (typed while the box shows)");
  check(
    "preview: the page stays usable under the box",
    (await a.inputValue("#announcement-name")) === "Corner test (typed while the box shows)",
  );
  check("preview: countdown circle first", await previewBox.getByLabel(/You can close this in/).isVisible());
  await previewBox.getByRole("button", { name: "Close" }).waitFor({ timeout: 5000 });
  check("preview: ✕ after the close delay", true);
  const line = previewBox.locator(".animate-shrink");
  await previewBox.hover();
  const pausedOnHover = await line.evaluate((el) => getComputedStyle(el).animationPlayState);
  await a.mouse.move(10, 10);
  const runningAfter = await line.evaluate((el) => getComputedStyle(el).animationPlayState);
  check("preview: line pauses on hover", pausedOnHover === "paused" && runningAfter === "running", `${pausedOnHover} → ${runningAfter}`);
  await previewBox.getByRole("button", { name: "Close" }).click();
  await a.fill("#announcement-name", "Corner test");
  await a.getByRole("button", { name: "Save and turn on" }).click();
  await a.waitForURL(`${APP}/admin/announcements`, { timeout: 60_000 });
  await a.getByText("Corner test").waitFor();
  check("list: shows 'Corner box · closes after 8 s'", await a.getByText(/Corner box · closes after 8 s/).isVisible());
  check("list: status Live", await a.getByText("Live", { exact: true }).first().isVisible());

  // ── Admin: an HTML modal (a # link and a tall page inside) ─────────────────────────────────────────────────
  await a.goto(`${APP}/admin/announcements/new`);
  await a.getByRole("heading", { name: "New announcement" }).waitFor();
  await a.fill("#announcement-name", "Html modal");
  await a.getByLabel("HTML (sealed box)").first().check();
  await a.fill(
    "#announcement-html",
    '<div style="font:16px sans-serif;padding:16px"><a href="#bottom">Go down</a><div style="height:900px"></div><p id="bottom">Bottom of the box</p></div>',
  );
  await a.locator('input[type="number"][max="60"]').first().fill("0");
  await a.getByRole("button", { name: "Save and turn on" }).click();
  await a.waitForURL(`${APP}/admin/announcements`, { timeout: 60_000 });
  await a.getByText("Html modal").waitFor();
  check("list: the HTML modal and the corner box are both on", (await a.getByText("Live", { exact: true }).count()) === 2);

  // ── Teacher: what they see ─────────────────────────────────────────────────────────────────────────────────
  const teacherContext = await loggedIn(browser, teacher);
  const t = await teacherContext.newPage();
  t.on("console", (msg) => msg.type() === "error" && consoleErrors.push(msg.text()));
  await t.goto(`${APP}/`);
  const dialog = t.getByRole("dialog", { name: "Announcement" });
  await dialog.waitFor({ timeout: 120_000 });
  check("teacher: the HTML modal shows", true);
  check("teacher: the corner box waits while the modal shows", !(await t.getByRole("region", { name: "Announcement" }).isVisible()));
  await t.screenshot({ path: SHOTS + "announcements-2-teacher-modal.png" });
  const frame = t.frameLocator('iframe[title="Announcement"]');
  await frame.getByText("Go down").click();
  await t.waitForTimeout(800);
  const scrolled = await frame.locator("body").evaluate(() => window.scrollY);
  check(
    "teacher: a # link scrolls inside the box",
    scrolled > 0 && teacherContext.pages().length === 1,
    `scrollY ${scrolled}, tabs ${teacherContext.pages().length}`,
  );
  await frame.getByText("Bottom of the box").click();
  await t.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden", timeout: 5000 });
  check("teacher: Escape inside the box closes the modal", true);

  const corner = t.getByRole("region", { name: "Announcement" });
  await corner.waitFor({ timeout: 5000 });
  check("teacher: the corner box shows after the modal closed", true);
  await t.screenshot({ path: SHOTS + "announcements-3-teacher-corner.png" });
  await t.getByRole("link").first().hover();
  await corner.waitFor({ state: "hidden", timeout: 15_000 });
  check("teacher: the corner box closes itself", true);
  await t.reload();
  await t.waitForTimeout(4000);
  check("teacher: after a reload neither comes back (once, closed)", !(await corner.isVisible()) && !(await dialog.isVisible()));
  const rows = psql(
    `select count(*) from public.announcement_dismissals where user_id = '${teacher.id}' and part = 'modal'`,
  );
  check("database: two closed records (the self-close counts)", rows === "2", `rows ${rows}`);
} catch (error) {
  check("run finished without an exception", false, String(error).split("\n")[0]);
} finally {
  await browser.close();
  psql("delete from public.announcement_dismissals; delete from public.announcements;");
  await deleteTeacher(superAdmin);
  await deleteTeacher(teacher);
}

if (consoleErrors.length) console.log("Console errors:\n" + consoleErrors.slice(0, 10).join("\n"));
finish();
