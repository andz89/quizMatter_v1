// Announcement fixes, put straight in the table: a corner box's auto-close line starts only once its ✕ shows; the
// "you can close this in…" countdown stops while the tab is in the background; a Facebook video asks Facebook for a
// player as wide as its box (a phone); Alt+click on a top bar's in-app link is left to the browser.
// Deletes every announcement in the local database first.
import { chromium } from "playwright";
import { APP, check, deleteTeacher, finish, loggedIn, makeTeacher, psql, round } from "./lib.mjs";

const CLOSE_AFTER = 8;
const AUTO_CLOSE = 5;
const MODAL_CLOSE_AFTER = 6;

const teacher = await makeTeacher({ first: "Fixes" });
psql(`
delete from public.announcement_dismissals;
delete from public.announcements;
insert into public.announcements
  (name, is_on, show_modal, modal_text, modal_attachment, modal_close_after, show_bar, bar_html, bar_close_after,
   repeat, pages, modal_size, modal_format, modal_html, modal_height, bar_format, bar_height, modal_display, modal_auto_close)
values
  ('Corner waits', true, true, 'A corner box that closes itself.', null, ${CLOSE_AFTER}, false, '', 0,
   'every_visit', '{saved}', 'small', 'post', '', 400, 'text', 60, 'corner', ${AUTO_CLOSE}),
  ('Facebook video', true, true, 'A Facebook video.',
   '{"kind":"facebook","href":"https://www.facebook.com/watch/?v=1234567890","video":true}',
   ${MODAL_CLOSE_AFTER}, false, '', 0, 'every_visit', '{my_presentations}', 'large', 'post', '', 400, 'text', 60, 'center', 0),
  ('Bar link', true, false, '', null, 0, true, '<p>Go to <a href="/saved">your saved presentations</a></p>', 0,
   'every_visit', '{account}', 'large', 'post', '', 400, 'text', 60, 'center', 0);
`);

const browser = await chromium.launch();
/** A fresh tab logged in as the teacher, with Facebook's player answered by a stand-in page. */
async function teacherPage(viewport = { width: 1366, height: 800 }) {
  const context = await loggedIn(browser, teacher, viewport);
  await context.route("https://www.facebook.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><p>Stand-in Facebook player</p>" }),
  );
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  return page;
}
/** Pretends the tab went to the background (true) or came back (false). */
const setTabHidden = (page, hidden) =>
  page.evaluate((isHidden) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (isHidden ? "hidden" : "visible") });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => isHidden });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
const countdown = (scope) => scope.locator('[title="You can close this soon"]').first();
/** Runs one part; a failure is a FAIL for that part, and the next part still runs. */
async function part(name, run) {
  try {
    await run();
  } catch (error) {
    check(`${name}: finished without an exception`, false, String(error).split("\n").slice(0, 4).join(" "));
  }
}

try {
  await part("corner box", async () => {
  // ── 1. A corner box that closes itself after 5 s, but whose ✕ shows only after 8 s ──────────────────────────────
  // The server remembers the maintenance status (with its announcements key) for 60 seconds, so it may take a reload.
  const p = await teacherPage();
  const box = p.getByRole("region", { name: "Announcement" });
  for (let i = 0; i < 10; i++) {
    await p.goto(`${APP}/saved`, { timeout: 120_000 });
    if (await box.waitFor({ timeout: 10_000 }).then(() => true, () => false)) break;
  }
  await box.waitFor();
  check("corner box: no auto-close line before its ✕ shows", (await box.locator(".animate-shrink").count()) === 0);
  await p.waitForTimeout((AUTO_CLOSE + 1.5) * 1000);
  check("corner box: still open after the auto-close time, while the ✕ isn't there yet", await box.isVisible());
  await box.getByRole("button", { name: "Close" }).waitFor({ timeout: 10_000 });
  check("corner box: the line starts once the ✕ shows", (await box.locator(".animate-shrink").count()) === 1);
  await box.waitFor({ state: "detached", timeout: (AUTO_CLOSE + 4) * 1000 });
  check("corner box: then it closes itself", true);
  });

  await part("modal countdown", async () => {
  // ── 2. The modal's countdown stops while the tab is in the background ──────────────────────────────────────────
  const p = await teacherPage();
  await p.goto(`${APP}/`, { timeout: 120_000 });
  const dialog = p.getByRole("dialog");
  await countdown(dialog).waitFor();
  await setTabHidden(p, true);
  const hiddenAt = Number(await countdown(dialog).textContent());
  await p.waitForTimeout(3500);
  const afterHidden = Number(await countdown(dialog).textContent().catch(() => "0"));
  check("modal: the countdown stops in a background tab", afterHidden >= hiddenAt - 1 && afterHidden > 0, `${hiddenAt} → ${afterHidden}`);
  await setTabHidden(p, false);
  await p.waitForTimeout(2500);
  const afterBack = Number(await countdown(dialog).textContent().catch(() => "0"));
  check("modal: and goes on once the tab is back", afterBack < afterHidden, `${afterHidden} → ${afterBack}`);
  });

  await part("phone", async () => {
  // ── 3. A Facebook video on a phone asks for a player as wide as its box ────────────────────────────────────────
  const p = await teacherPage({ width: 390, height: 844 });
  await p.goto(`${APP}/`, { timeout: 120_000 });
  const player = p.locator('iframe[title="Facebook video"]');
  await player.waitFor();
  const size = await player.boundingBox();
  const asked = Number(new URL(await player.getAttribute("src")).searchParams.get("width"));
  check("phone: the Facebook player is asked for its box's real width", Math.abs(asked - Math.round(size.width)) <= 1 && asked < 400, `asked ${asked}, box ${round(size)}`);
  });

  await part("bar", async () => {
  // ── 4. Alt+click on a top bar's in-app link: the browser's own (no move inside the app) ─────────────────────────
  const p = await teacherPage();
  await p.goto(`${APP}/account`, { timeout: 120_000 });
  const link = p.getByRole("link", { name: "your saved presentations" });
  await link.waitFor();
  p.on("download", (download) => download.cancel().catch(() => {}));
  await link.click({ modifiers: ["Alt"] });
  await p.waitForTimeout(2000);
  check("bar: Alt+click on an in-app link doesn't move the page", new URL(p.url()).pathname === "/account", p.url());
  await link.click();
  await p.waitForURL((url) => url.pathname === "/saved", { timeout: 30_000 }).catch(() => {});
  check("bar: a plain click still moves inside the app", new URL(p.url()).pathname === "/saved", p.url());
  });
} catch (error) {
  check("run finished without an exception", false, String(error).split("\n").slice(0, 6).join(" "));
} finally {
  psql("delete from public.announcement_dismissals; delete from public.announcements;");
  await deleteTeacher(teacher);
  await browser.close();
}
finish();
