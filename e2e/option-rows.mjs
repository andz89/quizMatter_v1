// Option row heights (spec: docs/superpowers/specs/2026-11-18-option-row-heights-design.md): "Fit rows to text" sizes
// each row by its text at its own size (never changing a size), the lines between list rows share room, Shuffle
// keeps a list row with its option and fits a grid's rows again, rows never pass the options area's bottom, an option
// with a picture keeps room for it, and presenting draws the same rows.
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { APP, SHOTS, api, check, deleteTeacher, finish, loggedIn, makeTeacher } from "./lib.mjs";

const LONG_A =
  "Dance provides active bodily immersion and emotional connection through rhythm, whereas visual arts provide permanent visual storytelling, both complementing each other to preserve heritage.";
const LONG_C = "Both together: a dance tells the legend in the moment, and a mural keeps the same story where people pass by it every day.";
const MARK = "[data-hidden-text-mark]";

const teacher = await makeTeacher({ first: "Option", last: "Rows" });
const presentationId = randomUUID();
await api("/rest/v1/presentations", {
  method: "POST",
  body: JSON.stringify({ id: presentationId, owner_id: teacher.id, title: "Option rows e2e", data_version: 6 }),
});
const slide = (id, position, layout, options, extra = {}) => ({
  presentation_id: presentationId,
  id,
  position,
  data: {
    id,
    type: "choice",
    question: "Which art form keeps the legends alive?",
    layout,
    options: options.map((o, i) => ({ id: `${id}-${"abcd"[i]}`, ...o })),
    correctOptionId: `${id}-a`,
    elements: [],
    questionHeight: 100,
    ...extra,
  },
});
await api("/rest/v1/slides", {
  method: "POST",
  body: JSON.stringify([
    // Your Q16: A long and small, the others short.
    slide("s1", 0, "list", [{ text: LONG_A, fontSize: 30 }, { text: "Visual arts" }, { text: "Dance" }, { text: "Neither" }]),
    // Text far too big for the room.
    slide("s2", 1, "list", [LONG_A, LONG_A, LONG_A, LONG_A].map((text) => ({ text, fontSize: 60 }))),
    // Grid with the two long options in the left column.
    slide("s3", 2, "grid", [{ text: LONG_C, fontSize: 30 }, { text: "Murals", fontSize: 30 }, { text: LONG_C, fontSize: 30 }, { text: "Sculptures", fontSize: 30 }]),
    // A short option with a tall picture.
    slide("s4", 3, "grid", [{ text: "Star" }, { text: "Moon" }, { text: LONG_A, fontSize: 30 }, { text: "D" }], {
      elements: [{ id: "pic", assetId: "star", x: 300, y: 4, width: 100, height: 100, color: "#FFC233", containerId: "s4-a" }],
    }),
    // A list option with a tall picture: a drag line stops at it.
    slide("s5", 4, "list", [{ text: "Sun" }, { text: "B" }, { text: "C" }, { text: "D" }], {
      elements: [{ id: "pic5", assetId: "star", x: 300, y: 4, width: 90, height: 90, color: "#FFC233", containerId: "s5-a" }],
    }),
  ]),
});

const browser = await chromium.launch();
const page = await (await loggedIn(browser, teacher, { width: 1600, height: 1000 })).newPage();
page.setDefaultTimeout(60_000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const near = (a, b, by) => Math.abs(a - b) <= by;

try {
  await page.goto(`${APP}/presentation/${presentationId}/edit`, { timeout: 120_000 });
  const item = (id) => page.locator(`[data-slide-id="${id}"]`);
  const option = (id) => page.locator(`[data-container-id="${id}"]`);
  const box = async (id) => (await option(id).boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  const fontSize = (id) => option(id).locator('[style*="font-size"]').first().evaluate((el) => getComputedStyle(el).fontSize);
  const grid = (id) => item(id).locator('[style*="grid-template-rows"]').first();
  const fit = async (id) => {
    await item(id).scrollIntoViewIfNeeded();
    await item(id).getByTitle("Fit rows to text").click();
    await page.waitForTimeout(300);
  };
  await item("s1").waitFor();
  await page.waitForTimeout(800);

  // ─── List: no Fit button (grid only), the lines show ─────────────────────────────────────────────────────
  await item("s1").scrollIntoViewIfNeeded();
  check("a list slide has no Fit rows to text button", (await item("s1").getByTitle("Fit rows to text").count()) === 0);
  check("a list slide shows a line between each pair of rows", (await item("s1").getByRole("separator").count()) === 3);
  const sizesBefore = await Promise.all(["s1-a", "s1-b", "s1-c", "s1-d"].map(fontSize));

  // ─── List: a drag line ──────────────────────────────────────────────────────────────────────────────────
  const line = item("s1").getByRole("separator").first();
  const lineBox = await line.boundingBox();
  const bBefore = (await box("s1-b")).height;
  const aBefore = (await box("s1-a")).height;
  await page.mouse.move(lineBox.x + lineBox.width / 2, lineBox.y + lineBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(lineBox.x + lineBox.width / 2, lineBox.y + lineBox.height / 2 + 20, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const aGrew = (await box("s1-a")).height - aBefore;
  const bShrank = bBefore - (await box("s1-b")).height;
  check("dragging the line grows A and shrinks B by the same amount", aGrew > 5 && near(aGrew, bShrank, 1), `${aGrew} / ${bShrank}`);
  const sizesAfter = await Promise.all(["s1-a", "s1-b", "s1-c", "s1-d"].map(fontSize));
  check("dragging changes no text size", JSON.stringify(sizesBefore) === JSON.stringify(sizesAfter), `${sizesBefore} → ${sizesAfter}`);
  await page.waitForTimeout(1200);
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(300);
  check("one undo puts the drag back", near((await box("s1-a")).height, aBefore, 1), `${(await box("s1-a")).height} vs ${aBefore}`);

  // ─── List: Shuffle keeps a row with its option ─────────────────────────────────────────────────────────
  const aHeight = (await box("s1-a")).height;
  await item("s1").getByTitle("Shuffle options").click();
  await page.waitForTimeout(400);
  check("after Shuffle, A keeps its tall row", near((await box("s1-a")).height, aHeight, 1), `${(await box("s1-a")).height} vs ${aHeight}`);

  // ─── Text too big: rows stay inside, +… shows, sizes untouched ─────────────────────────────────────────
  await item("s2").scrollIntoViewIfNeeded();
  const area = await grid("s2").boundingBox();
  const last = await box("s2-d");
  check("too-big text: the rows end inside the options area", last.y + last.height <= area.y + area.height + 1, `${last.y + last.height} vs ${area.y + area.height}`);
  check("too-big text: +… shows", (await item("s2").locator(MARK).count()) > 0);
  check("too-big text: the size stays 60 px", (await fontSize("s2-a")) === "60px", await fontSize("s2-a"));

  // ─── Grid: rows fitted again after Shuffle, both columns end together ──────────────────────────────────
  const gridSizesBefore = await Promise.all(["s3-a", "s3-b", "s3-c", "s3-d"].map(fontSize));
  await fit("s3");
  const gridSizesAfter = await Promise.all(["s3-a", "s3-b", "s3-c", "s3-d"].map(fontSize));
  check("grid Fit changes no text size", JSON.stringify(gridSizesBefore) === JSON.stringify(gridSizesAfter), `${gridSizesBefore} → ${gridSizesAfter}`);
  const sameEnd = async () => {
    const ids = ["s3-a", "s3-b", "s3-c", "s3-d"];
    const boxes = await Promise.all(ids.map(box));
    const left = boxes.filter((b) => near(b.x, Math.min(...boxes.map((x) => x.x)), 2));
    const right = boxes.filter((b) => !left.includes(b));
    const end = (bs) => Math.max(...bs.map((b) => b.y + b.height));
    return { ok: near(end(left), end(right), 1), detail: `${end(left)} vs ${end(right)}` };
  };
  let ends = await sameEnd();
  check("grid: both columns end together after Fit", ends.ok, ends.detail);
  for (let i = 0; i < 3; i++) {
    await item("s3").getByTitle("Shuffle options").click();
    await page.waitForTimeout(300);
    ends = await sameEnd();
    check(`grid: both columns end together after Shuffle ${i + 1}`, ends.ok, ends.detail);
  }
  const gridArea = await grid("s3").boundingBox();
  const lowest = Math.max(...(await Promise.all(["s3-a", "s3-b", "s3-c", "s3-d"].map(box))).map((b) => b.y + b.height));
  check("grid: nothing runs past the options area", lowest <= gridArea.y + gridArea.height + 1);
  check("grid has no drag lines", (await item("s3").getByRole("separator").count()) === 0);

  // ─── An option with a picture keeps room for it ────────────────────────────────────────────────────────
  await fit("s4");
  const row = await box("s4-a");
  const pic = await item("s4").locator('[data-element-id="pic"]').boundingBox();
  check("a picture's row is never shorter than its picture", pic && pic.y + pic.height <= row.y + row.height + 1, pic && `${pic.y + pic.height} vs ${row.y + row.height}`);
  const rowsOnce = await grid("s4").getAttribute("style");
  await fit("s4");
  const picAgain = await item("s4").locator('[data-element-id="pic"]').boundingBox();
  check("Fit twice changes nothing (rows and picture)", (await grid("s4").getAttribute("style")) === rowsOnce && near(picAgain.height, pic.height, 0.5), `${pic.height} → ${picAgain.height}`);
  await page.screenshot({ path: `${SHOTS}/option-rows-editor.png` });

  // ─── A drag line stops at a picture, and sits in the middle of the real gap ────────────────────────────
  await item("s5").scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const pic5 = item("s5").locator('[data-element-id="pic5"]');
  // Like the question box: the text spans the whole option, and the picture sits on top of it.
  const card5 = await box("s5-a");
  const text5 = await option("s5-a").locator('[style*="font-size"]').first().boundingBox();
  check("an option with a picture keeps its text full width", text5.width > card5.width * 0.9, `${text5.width} of ${card5.width}`);
  const onTop = await pic5.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!hit && (el === hit || el.contains(hit));
  });
  check("the picture sits on top of the option's text", onTop);
  const picBefore = await pic5.boundingBox();
  const line5 = await item("s5").getByRole("separator").first().boundingBox();
  const aBox = await box("s5-a");
  const bBox = await box("s5-b");
  const gapMiddle = (aBox.y + aBox.height + bBox.y) / 2;
  check("the line sits in the middle of the gap between the rows", near(line5.y + line5.height / 2, gapMiddle, 1.5), `${line5.y + line5.height / 2} vs ${gapMiddle}`);
  await page.mouse.move(line5.x + line5.width / 2, line5.y + line5.height / 2);
  await page.mouse.down();
  await page.mouse.move(line5.x + line5.width / 2, line5.y - 150, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const picAfter = await pic5.boundingBox();
  const rowAfter = await box("s5-a");
  check("dragging up stops at the picture: it isn't squeezed", near(picAfter.height, picBefore.height, 0.5), `${picBefore.height} → ${picAfter.height}`);
  check("the row still holds the whole picture", picAfter.y + picAfter.height <= rowAfter.y + rowAfter.height + 1);

  // ─── Save, reload, present: the same rows ──────────────────────────────────────────────────────────────
  const editorRows = await grid("s1").getAttribute("style");
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(2500);
  await page.reload();
  await item("s1").waitFor();
  await page.waitForTimeout(800);
  check("after reload, the rows are as saved", (await grid("s1").getAttribute("style")) === editorRows);
  await item("s1").click({ position: { x: 5, y: 5 } });
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await page.waitForTimeout(1500);
  const presented = await page.evaluate(() =>
    [...document.querySelectorAll('[style*="grid-template-rows"]')].map((el) => el.getAttribute("style")),
  );
  const rowsOf = (style) => /grid-template-rows:\s*([^;]+)/.exec(style ?? "")?.[1]?.trim();
  check("presenting draws the same rows as the editor", presented.some((s) => rowsOf(s) === rowsOf(editorRows)), `${rowsOf(editorRows)}`);
  await page.screenshot({ path: `${SHOTS}/option-rows-present.png` });

  check("no page errors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  await deleteTeacher(teacher);
}
finish();
