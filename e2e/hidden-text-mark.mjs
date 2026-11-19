// "+…" on cut-off text: slide text never shrinks, so a text whose end is past its box's bottom shows the mark in the
// editor (question, answer choice, text box, and while typing), never on text that fits, a table's cells, the slide
// thumbnails or presenting.
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { APP, SHOTS, api, check, deleteTeacher, finish, loggedIn, makeTeacher } from "./lib.mjs";

const LONG = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
const MARK = "[data-hidden-text-mark]";

const teacher = await makeTeacher({ first: "Hidden", last: "Text" });
const presentationId = randomUUID();
await api("/rest/v1/presentations", {
  method: "POST",
  body: JSON.stringify({ id: presentationId, owner_id: teacher.id, title: "Hidden text e2e", data_version: 1 }),
});
const box = (id, y, html) => ({ id, assetId: "text-box", x: 700, y, width: 300, height: 60, color: "#1B1530", containerId: null, text: { html } });
await api("/rest/v1/slides", {
  method: "POST",
  body: JSON.stringify([
    {
      presentation_id: presentationId,
      id: "s1",
      position: 0,
      data: {
        id: "s1",
        type: "choice",
        question: LONG,
        layout: "grid",
        options: [
          { id: "s1-a", text: LONG },
          { id: "s1-b", text: "B" },
          { id: "s1-c", text: "C" },
          { id: "s1-d", text: "D" },
        ],
        correctOptionId: null,
        elements: [],
        questionHeight: 100,
      },
    },
    {
      presentation_id: presentationId,
      id: "s2",
      position: 1,
      data: {
        id: "s2",
        type: "blank",
        question: "",
        layout: "grid",
        options: ["a", "b", "c", "d"].map((o) => ({ id: `s2-${o}`, text: "" })),
        correctOptionId: null,
        elements: [
          box("short", 100, "<p>Fits</p>"),
          box("long", 300, "<p>one</p><p>two</p><p>three</p>"),
          {
            id: "tbl",
            assetId: "table",
            x: 100,
            y: 400,
            width: 400,
            height: 100,
            color: "#1B1530",
            containerId: null,
            table: { rows: [[{ html: "<p>ok</p>" }, { html: `<p>${LONG}</p>` }]] },
          },
        ],
        questionHeight: 100,
      },
    },
  ]),
});

const browser = await chromium.launch();
const page = await (await loggedIn(browser, teacher, { width: 1600, height: 1000 })).newPage();
page.setDefaultTimeout(60_000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

try {
  await page.goto(`${APP}/presentation/${presentationId}/edit`, { timeout: 120_000 });
  const s1 = page.locator('[data-slide-id="s1"]');
  const s2 = page.locator('[data-slide-id="s2"]');
  await s2.waitFor();
  await s2.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);

  const marksIn = (locator) => locator.locator(MARK).count();
  const el = (id) => s2.locator(`[data-element-id="${id}"]`);

  check("the cut-off question and answer choice show the mark", (await marksIn(s1)) === 2, String(await marksIn(s1)));
  check("a text box that fits shows none", (await marksIn(el("short"))) === 0);
  check("a cut-off text box shows it", (await marksIn(el("long"))) === 1);
  check("a table never shows it, even on a cut-off cell", (await marksIn(el("tbl"))) === 0, String(await marksIn(el("tbl"))));
  await page.screenshot({ path: `${SHOTS}hidden-text-mark.png` });

  // Hovering the mark says why (a "title" shows only on something the pointer can reach).
  const markStyle = await el("long").locator(MARK).evaluate((m) => ({ events: getComputedStyle(m).pointerEvents, title: m.title }));
  check("the mark can be hovered for its tip", markStyle.events !== "none" && markStyle.title !== "", JSON.stringify(markStyle));

  // Selected: the bottom-right resize handle stays on top of the mark, so it can be seen and grabbed.
  await el("long").click();
  const corner = await page.evaluate(() => {
    // The handle nearest the box's bottom-right corner (the selection's handles sit in their own layer).
    const box = document.querySelector('[data-element-id="long"]').getBoundingClientRect();
    const handles = [...document.querySelectorAll('[title="Resize"]')].map((x) => ({ x, r: x.getBoundingClientRect() }));
    const away = (r) => Math.hypot(r.left + r.width / 2 - box.right, r.top + r.height / 2 - box.bottom);
    const h = handles.sort((p, q) => away(p.r) - away(q.r))[0];
    const top = document.elementFromPoint(h.r.left + h.r.width / 2, h.r.top + h.r.height / 2);
    return top === h.x;
  });
  check("the resize handle is on top of the mark", corner);
  await page.keyboard.press("Escape");

  // Typing until the text no longer fits brings it; undo takes it away again.
  await el("short").dblclick();
  await s2.locator('[contenteditable="true"]').waitFor();
  await page.keyboard.press("End");
  for (let i = 0; i < 6; i++) await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  check("typing past the box's bottom shows it", (await marksIn(el("short"))) === 1);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  // Typing near the bottom scrolls the box to the cursor; when typing stops it goes back to the top, so the
  // start of the text shows again and only its end is cut off (where the mark points).
  const scrolled = await el("short").locator(MARK).evaluate((m) => m.previousElementSibling.scrollTop);
  check("stopping typing scrolls the text back to its start", scrolled === 0, String(scrolled));
  for (let i = 0; i < 6; i++) await page.keyboard.press("Control+z");
  await page.waitForTimeout(300);
  check("undo back to text that fits takes it away", (await marksIn(el("short"))) === 0, String(await marksIn(el("short"))));

  // The mark takes the mouse (for its tip), but a double-click on it still starts typing in its box, and a click on
  // it while typing keeps the typing going.
  const m = await el("long").locator(MARK).boundingBox();
  // Its top-left part: the selected box's resize handle sits on the corner itself and takes presses there.
  const onMark = { x: m.x + 6, y: m.y + 6 };
  await page.mouse.dblclick(onMark.x, onMark.y);
  await page.waitForTimeout(300);
  const typing = el("long").locator('[contenteditable="true"]');
  check("double-clicking the mark starts typing", (await typing.count()) === 1);
  await page.mouse.click(onMark.x, onMark.y);
  await page.waitForTimeout(200);
  check("clicking the mark while typing keeps typing", await typing.evaluate((t) => t.contains(document.activeElement)).catch(() => false));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  // Making the text box taller than its text: gone.
  await el("long").click();
  // The lower of the two "Change height" handles.
  const handles = await Promise.all((await page.locator('[title="Change height"]').all()).map((h) => h.boundingBox()));
  const b = handles.filter(Boolean).sort((p, q) => q.y - p.y)[0];
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + 250, { steps: 25 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  check("making the box taller takes it away", (await marksIn(el("long"))) === 0);

  // The slide thumbnails never show it.
  check("no mark outside the editable slides", (await page.locator(MARK).count()) === (await marksIn(s1)) + (await marksIn(s2)));

  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("ran without throwing", false, e.message);
  await page.screenshot({ path: `${SHOTS}hidden-text-mark-error.png` }).catch(() => {});
} finally {
  await browser.close();
  await deleteTeacher(teacher);
}
finish();
