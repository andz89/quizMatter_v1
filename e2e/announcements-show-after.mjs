// "Shows after N seconds" (modal_show_after): the super admin sets it in the form; a teacher's modal waits for the
// tab's clock, which keeps counting across a reload and an in-app move, pauses in a background tab and while
// presenting, and starts over in a new tab. A corner box with no wait shows at once, then waits while the modal is up.
// Deletes every announcement in the local database first.
import { chromium } from "playwright";
import { APP, SHOTS, check, deleteTeacher, finish, loggedIn, makeTeacher, psql } from "./lib.mjs";

const WAIT = 8;
psql("delete from public.announcement_dismissals; delete from public.announcements;");
const superAdmin = await makeTeacher({ first: "Super", last: "Admin", superAdmin: true });
const teacher = await makeTeacher();

const browser = await chromium.launch();
try {
  // ── 1. Admin: the form ─────────────────────────────────────────────────────────────────────────────────────
  const a = await (await loggedIn(browser, superAdmin)).newPage();
  await a.goto(`${APP}/admin/announcements/new`);
  await a.getByRole("heading", { name: "New announcement" }).waitFor({ timeout: 120_000 });
  await a.fill("#announcement-name", "Later modal");
  const showAfter = a.getByLabel(/It shows after/);
  check("form: a modal has 'It shows after', 0 to start", (await showAfter.inputValue()) === "0");
  await a.getByLabel("Corner box", { exact: true }).check();
  check("form: a corner box has it too", await showAfter.isVisible());
  await a.getByLabel(/^Top bar/).check();
  check("form: a top bar doesn't (it shows at once)", (await a.getByLabel(/It shows after/).count()) === 0);
  await a.getByLabel("Modal", { exact: true }).check();
  await a.getByLabel("The modal's text").fill("A modal that waits.");
  await showAfter.fill(String(WAIT));
  await a.locator('input[type="number"][max="60"]').first().fill("0");
  // Every visit (once / once a day / every visit): a new tab gets it again, so parts 3 and 4 can wait for it.
  await a.locator('input[name="repeat"]').nth(2).check();
  await a.getByRole("button", { name: "Save and turn on" }).click();
  await a.waitForURL(`${APP}/admin/announcements`, { timeout: 60_000 });
  await a.getByText("Later modal").waitFor();
  check(`list: shows 'Modal · shows after ${WAIT} s'`, await a.getByText(`Modal · shows after ${WAIT} s`).isVisible());
  const saved = psql("select modal_show_after from public.announcements where name = 'Later modal';").trim();
  check(`database: saved as ${WAIT}`, saved.includes(String(WAIT)), saved);
  const id = psql("select id from public.announcements where name = 'Later modal';");
  await a.goto(`${APP}/admin/announcements/${id}`, { timeout: 120_000 });
  await a.getByLabel(/It shows after/).waitFor({ timeout: 120_000 });
  check("edit page: the field keeps it", (await a.getByLabel(/It shows after/).inputValue()) === String(WAIT));
  await a.screenshot({ path: SHOTS + "announcements-show-after-form.png" });

  // A corner box with no wait, put straight in the table.
  psql(`
insert into public.announcements
  (name, is_on, show_modal, modal_text, modal_close_after, show_bar, bar_html, bar_close_after, repeat, pages,
   modal_size, modal_display, modal_show_after)
values ('Corner now', true, true, 'A corner box right away.', 0, false, '', 0, 'every_visit', '{all}', 'small', 'corner', 0);
`);

  // ── 2. Teacher: the clock counts on across a reload and a move ─────────────────────────────────────────────
  const teacherContext = await loggedIn(browser, teacher, { width: 1366, height: 800 });
  const p = await teacherContext.newPage();
  const modal = p.getByText("A modal that waits.");
  const box = p.getByRole("region", { name: "Announcement" });
  await p.goto(`${APP}/`, { timeout: 120_000 });
  await box.waitFor({ timeout: 60_000 });
  const opened = Date.now();
  check("home: the corner box (no wait) shows at once", await box.getByText("A corner box right away.").isVisible());
  check("home: the modal isn't there yet", !(await modal.isVisible()));

  await p.waitForTimeout(3_000);
  await p.reload();
  await box.waitFor({ timeout: 60_000 });
  const reloaded = Date.now();
  check("after a reload: still waiting", !(await modal.isVisible()));
  await p.getByRole("link", { name: /^Saved/ }).click();
  await p.waitForURL(`${APP}/saved`);
  check("saved: still waiting right after the move", !(await modal.isVisible()));
  await modal.waitFor({ timeout: WAIT * 1000 });
  const seconds = (Date.now() - opened) / 1000;
  const sinceReload = (Date.now() - reloaded) / 1000;
  check(`the modal waits about ${WAIT} s in the tab`, seconds >= WAIT - 1, `${seconds.toFixed(1)} s`);
  // Started over on the reload or the move, it would need the full wait after it; counted on, it shows sooner.
  check("the clock kept counting across the reload and the move", sinceReload < WAIT - 1, `${sinceReload.toFixed(1)} s after the reload`);
  check("while the modal is up, the corner box waits", !(await box.isVisible()));
  await p.screenshot({ path: SHOTS + "announcements-show-after.png" });

  await p.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await box.waitFor({ timeout: 10_000 });
  check("after closing the modal, the corner box shows again", await box.isVisible());
  await p.goto(`${APP}/`);
  await box.waitFor({ timeout: 60_000 });
  await p.waitForTimeout(1_500);
  check("the closed modal doesn't come back on the next page", !(await modal.isVisible()));

  // ── 3. A new tab starts over, and a background tab doesn't count ───────────────────────────────────────────
  const hiddenTab = await teacherContext.newPage();
  await hiddenTab.goto(`${APP}/`);
  await hiddenTab.getByRole("region", { name: "Announcement" }).waitFor({ timeout: 60_000 });
  check("new tab: the modal waits again (its own clock)", !(await hiddenTab.getByText("A modal that waits.").isVisible()));
  // The browser says the tab is in the background (as when the teacher switches tabs).
  await hiddenTab.evaluate(() => Object.defineProperty(document, "hidden", { configurable: true, get: () => true }));
  await hiddenTab.waitForTimeout((WAIT + 2) * 1000);
  check("background tab: the clock doesn't count", !(await hiddenTab.getByText("A modal that waits.").isVisible()));
  await hiddenTab.evaluate(() => Object.defineProperty(document, "hidden", { configurable: true, get: () => false }));
  await hiddenTab.waitForTimeout(1_500);
  check("back in front: it still waits (not shown at once)", !(await hiddenTab.getByText("A modal that waits.").isVisible()));
  await hiddenTab.getByText("A modal that waits.").waitFor({ timeout: WAIT * 1000 });
  check("back in front: it shows once the clock reaches the wait", true);

  // ── 4. Presenting doesn't count ────────────────────────────────────────────────────────────────────────────
  const presentingTab = await teacherContext.newPage();
  await presentingTab.goto(`${APP}/`);
  await presentingTab.getByRole("region", { name: "Announcement" }).waitFor({ timeout: 60_000 });
  // PresentationView's mark on <html> (what the watch reads when the browser refuses fullscreen).
  await presentingTab.evaluate(() => (document.documentElement.dataset.presenting = ""));
  await presentingTab.waitForTimeout((WAIT + 2) * 1000);
  await presentingTab.evaluate(() => delete document.documentElement.dataset.presenting);
  await presentingTab.waitForTimeout(1_500);
  check("after presenting: it still waits (presenting didn't count)", !(await presentingTab.getByText("A modal that waits.").isVisible()));
  await presentingTab.getByText("A modal that waits.").waitFor({ timeout: WAIT * 1000 });
  check("after presenting: it shows once the clock reaches the wait", true);
} finally {
  await browser.close();
  psql("delete from public.announcement_dismissals; delete from public.announcements;");
  await deleteTeacher(teacher);
  await deleteTeacher(superAdmin);
}
finish();
