// Auto save: an edit saves itself within 12 seconds with no toast; nothing is sent without a change; and it holds back
// when the day's auto saves are used up, after a refused save, for restored work, on a live QuizMatter lesson and on a
// Claude draft. A lost connection retries. A review saves its own draft.
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { APP, SHOTS, api, check, deleteTeacher, finish, loggedIn, makeTeacher, psql } from "./lib.mjs";

const TICK = 13_500;
const STORAGE_KEY = "qm-auto-saves";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());

const teacher = await makeTeacher({ first: "Autosave" });
const reviewer = await makeTeacher({ first: "Autoreview" });
const admin = await makeTeacher({ first: "Autoadmin", superAdmin: true });
psql(`insert into public.editors (user_id) values ('${reviewer.id}')`);

const slideData = (id) => ({
  id,
  type: "choice",
  question: id,
  layout: "grid",
  options: ["a", "b", "c", "d"].map((o) => ({ id: `${id}-${o}`, text: o.toUpperCase() })),
  correctOptionId: null,
  elements: [],
  questionHeight: 100,
});

/** A presentation with one slide, `s1`. */
async function makePresentation(ownerId, extra = {}) {
  const id = randomUUID();
  await api("/rest/v1/presentations", {
    method: "POST",
    body: JSON.stringify({ id, owner_id: ownerId, title: "Auto save e2e", data_version: 1, ...extra }),
  });
  await api("/rest/v1/slides", {
    method: "POST",
    body: JSON.stringify([{ presentation_id: id, id: "s1", position: 0, data: slideData("s1") }]),
  });
  return id;
}

const isHiddenInDb = async (id) => {
  const rows = await api(`/rest/v1/slides?presentation_id=eq.${id}&id=eq.s1&select=data`);
  return rows[0]?.data?.hidden === true;
};

/** Asks `test` every 250 ms until it's true; false after a full auto save tick. */
async function within(test, ms = TICK) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 250))) {
    if (await test()) return true;
  }
  return false;
}

const browser = await chromium.launch();
const saves = [];
const errors = [];

async function newPage(person) {
  const page = await (await loggedIn(browser, person, { width: 1600, height: 1000 })).newPage();
  page.setDefaultTimeout(60_000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  page.on("request", (r) => {
    if (r.method() === "POST" && /\/rpc\/save_(presentation|review_draft)/.test(r.url())) saves.push(r.url());
  });
  return page;
}

const hideButton = (page) => page.locator('button[title="Hide slide when presenting"]').first();
const showButton = (page) => page.locator('button[title="Show slide"]').first();
const toasts = (page, text) => page.locator("[data-sonner-toast]").filter({ hasText: text });
const saveButtonSays = (page, text) => page.getByRole("button", { name: text, exact: true }).count().then((n) => n > 0);

async function open(page, path) {
  await page.goto(`${APP}${path}`, { timeout: 120_000 });
  await hideButton(page).waitFor();
  saves.length = 0;
}

const teacherPage = await newPage(teacher);

try {
  // ─── An edit saves itself ─────────────────────────────────────────────────────────────────────────────────
  const plain = await makePresentation(teacher.id);
  await open(teacherPage, `/presentation/${plain}/edit`);
  await hideButton(teacherPage).click();
  check("an edit reaches the database by itself within 12 seconds", await within(() => isHiddenInDb(plain)));
  check("it was one save", saves.length === 1, `${saves.length} saves`);
  check('no "Presentation saved." toast', (await toasts(teacherPage, "Presentation saved").count()) === 0);
  check("the Save button says Saved", await within(() => saveButtonSays(teacherPage, "Saved"), 2000));
  const stored = await teacherPage.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  check("the auto save was counted for today", stored === JSON.stringify({ day: today, count: 1 }), stored ?? "");

  saves.length = 0;
  await teacherPage.waitForTimeout(TICK);
  check("with no change, nothing is sent", saves.length === 0, `${saves.length} saves`);

  // ─── The day's auto saves are used up ─────────────────────────────────────────────────────────────────────
  const usedUp = await makePresentation(teacher.id);
  await teacherPage.evaluate(
    ([key, day]) => localStorage.setItem(key, JSON.stringify({ day, count: 600 })),
    [STORAGE_KEY, today],
  );
  await open(teacherPage, `/presentation/${usedUp}/edit`);
  await hideButton(teacherPage).click();
  await teacherPage.waitForTimeout(TICK);
  check("used up: nothing is sent", saves.length === 0, `${saves.length} saves`);
  check("used up: one toast says so", (await toasts(teacherPage, "Auto save has stopped").count()) === 1);
  await teacherPage.keyboard.press("Control+s");
  check("used up: Ctrl+S still saves", await within(() => isHiddenInDb(usedUp), 5000));
  await teacherPage.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);

  // ─── A refused save stops it ──────────────────────────────────────────────────────────────────────────────
  const conflict = await makePresentation(teacher.id);
  await open(teacherPage, `/presentation/${conflict}/edit`);
  psql(`update public.presentations set updated_at = updated_at + interval '1 minute' where id = '${conflict}'`);
  await hideButton(teacherPage).click();
  check("conflict: auto save tries once", await within(() => saves.length === 1));
  check("conflict: the toast says why", await within(() => toasts(teacherPage, "saved in another tab").count().then((n) => n === 1), 3000));
  await showButton(teacherPage).click();
  await teacherPage.waitForTimeout(TICK);
  check("conflict: no more tries, even after another edit", saves.length === 1, `${saves.length} saves`);
  check("conflict: still one toast", (await toasts(teacherPage, "saved in another tab").count()) === 1);

  // ─── A lost connection retries ────────────────────────────────────────────────────────────────────────────
  const offline = await makePresentation(teacher.id);
  await open(teacherPage, `/presentation/${offline}/edit`);
  const blockSaves = (route) => route.abort();
  await teacherPage.route("**/rpc/save_presentation*", blockSaves);
  await hideButton(teacherPage).click();
  check("offline: auto save tries", await within(() => saves.length >= 1));
  check("offline: the Save button says it failed", await within(() => saveButtonSays(teacherPage, "Retry"), 3000));
  check("offline: no toast", (await toasts(teacherPage, "Couldn't save").count()) === 0);
  await teacherPage.unroute("**/rpc/save_presentation*", blockSaves);
  check("offline: saved by the next try once back", await within(() => isHiddenInDb(offline)));

  // ─── Work that came back waits for the teacher's choice ───────────────────────────────────────────────────
  const restored = await makePresentation(teacher.id);
  await open(teacherPage, `/presentation/${restored}/edit`);
  await teacherPage.route("**/rpc/save_presentation*", blockSaves);
  await hideButton(teacherPage).click();
  await teacherPage.locator('a[title="My presentations"]').click();
  await teacherPage.waitForURL(`${APP}/`, { timeout: 30_000 });
  await teacherPage.unroute("**/rpc/save_presentation*", blockSaves);
  await teacherPage.goto(`${APP}/presentation/${restored}/edit`, { timeout: 120_000 });
  await toasts(teacherPage, "Your unsaved changes are back").waitFor();
  saves.length = 0;
  await teacherPage.waitForTimeout(TICK);
  check("restored: auto save waits", saves.length === 0 && !(await isHiddenInDb(restored)), `${saves.length} saves`);
  await teacherPage.keyboard.press("Control+s");
  check("restored: Ctrl+S saves it", await within(() => isHiddenInDb(restored), 5000));
  await teacherPage.waitForTimeout(500);
  await showButton(teacherPage).click();
  check("restored: auto save is back after that save", await within(async () => !(await isHiddenInDb(restored))));

  // ─── A Claude draft stays a draft ─────────────────────────────────────────────────────────────────────────
  const draftId = randomUUID();
  const recipe = JSON.stringify({ details: { title: "Claude draft" }, slides: [{ type: "blank", design: [] }] }).replaceAll("'", "''");
  const sqlFile = join(mkdtempSync(join(tmpdir(), "qm-e2e-")), "draft.sql");
  writeFileSync(sqlFile, `INSERT INTO drafts (id, owner_id, recipe, created_at) VALUES ('${draftId}', '${teacher.id}', '${recipe}', ${Date.now()});`);
  execSync(`npx wrangler d1 execute DRAFTS_DB --local --file "${sqlFile}"`, { stdio: "ignore" });
  await open(teacherPage, `/presentation/new?draft=${draftId}`);
  await hideButton(teacherPage).click();
  await teacherPage.waitForTimeout(TICK);
  check("Claude draft: an edit isn't saved by itself", saves.length === 0, `${saves.length} saves`);
  const draftRows = () => api(`/rest/v1/presentations?id=eq.${draftId}&select=id`);
  check("Claude draft: it isn't a presentation yet", (await draftRows()).length === 0);
  await teacherPage.keyboard.press("Control+s");
  check("Claude draft: Ctrl+S makes it a presentation", await within(async () => (await draftRows()).length === 1, 5000));
  await teacherPage.waitForTimeout(500);
  saves.length = 0;
  await showButton(teacherPage).click();
  check("Claude draft: once saved, auto save works", await within(() => saves.length === 1));

  // ─── A live QuizMatter lesson waits for Save ──────────────────────────────────────────────────────────────
  const adminPage = await newPage(admin);
  const lesson = await makePresentation(admin.id, { from_admin: true, is_published: true });
  await open(adminPage, `/presentation/${lesson}/edit`);
  await hideButton(adminPage).click();
  await adminPage.waitForTimeout(TICK);
  check("live lesson: an edit isn't saved by itself", saves.length === 0 && !(await isHiddenInDb(lesson)), `${saves.length} saves`);
  await adminPage.keyboard.press("Control+s");
  check("live lesson: Ctrl+S saves it", await within(() => isHiddenInDb(lesson), 5000));

  // ─── A review saves its own draft ─────────────────────────────────────────────────────────────────────────
  const reviewed = await makePresentation(admin.id, { from_admin: true, is_published: true });
  psql(
    `insert into public.presentation_reviews (presentation_id, reviewer_id, status, started_at) values ('${reviewed}', '${reviewer.id}', 'reviewing', now())`,
  );
  const reviewerPage = await newPage(reviewer);
  await open(reviewerPage, `/presentation/${reviewed}/edit`);
  await hideButton(reviewerPage).click();
  const draftSaved = () => psql(`select draft_updated_at is not null from public.presentation_reviews where presentation_id = '${reviewed}'`) === "t";
  check("review: an edit saves the draft by itself", await within(draftSaved));
  check("review: teachers still see the old slide", !(await isHiddenInDb(reviewed)));
  check("review: the button says Draft saved", await within(() => saveButtonSays(reviewerPage, "Draft saved"), 2000));
  psql(`delete from public.presentation_reviews where presentation_id = '${reviewed}'`);

  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (error) {
  check("run finished without an exception", false, String(error).split("\n").slice(0, 4).join(" "));
  await teacherPage.screenshot({ path: SHOTS + "auto-save-failure.png" });
} finally {
  await browser.close();
  await deleteTeacher(teacher);
  await deleteTeacher(reviewer);
  // A super admin who still owns QuizMatter presentations can't be deleted.
  await api(`/rest/v1/presentations?owner_id=eq.${admin.id}`, { method: "DELETE" }).catch((e) => console.log(`cleanup: ${e.message}`));
  await deleteTeacher(admin);
}

finish();
