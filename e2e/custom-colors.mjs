// The Color panel's custom color picker: 36 preset colors, the hex box (a picked box, and the words picked while
// typing), dragging the square, Recent colors kept after a reload, and saved.
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { APP, SHOTS, api, check, deleteTeacher, finish, loggedIn, makeTeacher } from "./lib.mjs";

const teacher = await makeTeacher({ first: "Custom", last: "Colors" });
const presentationId = randomUUID();
await api("/rest/v1/presentations", {
  method: "POST",
  body: JSON.stringify({ id: presentationId, owner_id: teacher.id, title: "Custom colors e2e", data_version: 1 }),
});
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
        question: "What is the capital? PARIS",
        questionHtml: "<p>What is the capital? PARIS</p>",
        layout: "grid",
        options: ["a", "b", "c", "d"].map((l) => ({ id: `s1-${l}`, text: l.toUpperCase() })),
        correctOptionId: null,
        elements: [],
        questionHeight: 150,
      },
    },
  ]),
});

const browser = await chromium.launch();
const page = await (await loggedIn(browser, teacher, { width: 1600, height: 1000 })).newPage();
page.setDefaultTimeout(60_000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

// The text color of the word(s) `text` in the question, as the browser shows it.
const colorOf = (text) =>
  page.evaluate((text) => {
    const box = [...document.querySelectorAll('[data-slide-id="s1"] .ProseMirror')].find((el) => el.textContent.includes("capital"));
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.textContent.includes(text)) return getComputedStyle(node.parentElement).color;
    }
    return null;
  }, text);

try {
  await page.goto(`${APP}/presentation/${presentationId}/edit`, { timeout: 120_000 });
  const slide = page.locator('[data-slide-id="s1"]');
  const box = slide.locator(".ProseMirror", { hasText: "capital" });
  await box.waitFor();

  // A picked box: open Color.
  await box.click();
  await page.locator('button[title="Text color"]').click();
  const solid = page.locator("h3", { hasText: "Solid" }).locator("xpath=following-sibling::div[1]").locator("button");
  check("36 preset colors", (await solid.count()) === 36, String(await solid.count()));

  await page.locator('button[title="Custom color"]').click();
  const hex = page.getByLabel("Hex color");
  await hex.fill("#123456");
  await hex.press("Enter");
  await page.waitForTimeout(300);
  check("hex colors the picked box", (await colorOf("What")) === "rgb(18, 52, 86)", await colorOf("What"));
  check("recent shows the color", (await page.locator('button[title="#123456"]').count()) === 1);
  await page.waitForTimeout(800);

  // Dragging the square changes the color.
  const square = page.locator('[title="Drag to pick a shade"]');
  const area = await square.boundingBox();
  await page.mouse.move(area.x + area.width * 0.9, area.y + area.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(area.x + area.width * 0.95, area.y + area.height * 0.1, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const dragged = await hex.inputValue();
  check("drag changes the hex", dragged !== "#123456" && /^#[0-9A-F]{6}$/.test(dragged), dragged);
  check("drag colors the text", (await colorOf("What")) !== "rgb(18, 52, 86)", await colorOf("What"));
  check("drag result is in recent", (await page.locator(`button[title="${dragged}"]`).count()) === 1, dragged);
  await page.screenshot({ path: `${SHOTS}custom-colors-panel.png` });
  await page.waitForTimeout(800);

  // Typing with words picked: the hex box colors only them.
  await box.dblclick();
  await slide.locator('[contenteditable="true"]').waitFor();
  await page.keyboard.press("Control+End");
  for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowLeft");
  // Starting to type closes the panel (as before); open it and the picker again, which keeps the words picked.
  if (!(await hex.isVisible())) {
    if (!(await page.locator('button[title="Custom color"]').isVisible())) await page.locator('button[title="Text color"]').click();
    await page.locator('button[title="Custom color"]').click();
  }
  await hex.click();
  await hex.fill("aa0000");
  await hex.press("Enter");
  await page.waitForTimeout(300);
  check("hex while typing colors the picked words", (await colorOf("PARIS")) === "rgb(170, 0, 0)", await colorOf("PARIS"));
  check("…and not the rest", (await colorOf("What")) !== "rgb(170, 0, 0)", await colorOf("What"));
  check("the hex box keeps the words' color", (await hex.inputValue()).toUpperCase() === "#AA0000", await hex.inputValue());
  await page.waitForTimeout(800);

  // After the hex box, the square still colors only those words, and one drag (with a pause) is one undo step.
  const whatBefore = await colorOf("What");
  const area2 = await square.boundingBox();
  await page.mouse.move(area2.x + area2.width * 0.5, area2.y + area2.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(area2.x + area2.width * 0.6, area2.y + area2.height * 0.4, { steps: 3 });
  await page.waitForTimeout(1000);
  await page.mouse.move(area2.x + area2.width * 0.7, area2.y + area2.height * 0.3, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  check("a drag after the hex colors the words", (await colorOf("PARIS")) !== "rgb(170, 0, 0)", await colorOf("PARIS"));
  check("…and still not the rest", (await colorOf("What")) === whatBefore, `${await colorOf("What")} vs ${whatBefore}`);
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(300);
  check("one undo takes back the whole drag", (await colorOf("PARIS")) === "rgb(170, 0, 0)", await colorOf("PARIS"));

  // A bad hex changes nothing.
  await hex.fill("zzz");
  await hex.press("Enter");
  check("bad hex goes back", /^#[0-9A-F]{6}$/.test(await hex.inputValue()), await hex.inputValue());

  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+s");
  let json = "";
  for (let i = 0; i < 30 && !json.toLowerCase().includes("aa0000") && !json.includes("170, 0, 0"); i++) {
    await page.waitForTimeout(500);
    const [saved] = await api(`/rest/v1/slides?presentation_id=eq.${presentationId}&select=data`);
    json = JSON.stringify(saved?.data?.questionHtml ?? "");
  }
  check("saved", json.toLowerCase().includes("aa0000") || json.includes("170, 0, 0"), json);

  // Opens the custom picker while typing (starting to type closes the panel).
  const openPicker = async () => {
    if (!(await hex.isVisible())) {
      if (!(await page.locator('button[title="Custom color"]').isVisible())) await page.locator('button[title="Text color"]').click();
      await page.locator('button[title="Custom color"]').click();
    }
  };
  const typeHex = async (value) => {
    await hex.click();
    await hex.fill(value);
    await hex.press("Enter");
    await page.waitForTimeout(300);
  };

  // Typing with only a cursor (no words picked): the hex colors the whole text.
  await box.dblclick();
  await slide.locator('[contenteditable="true"]').waitFor();
  await page.keyboard.press("Control+End");
  await openPicker();
  await typeHex("123456");
  check("a cursor only: the hex colors the whole text", (await colorOf("What")) === "rgb(18, 52, 86)" && (await colorOf("PARIS")) === "rgb(18, 52, 86)", `${await colorOf("What")} ${await colorOf("PARIS")}`);

  // Words in another color, then the box's own color typed in the hex box: the words take it.
  await box.dblclick();
  await slide.locator('[contenteditable="true"]').waitFor();
  await page.keyboard.press("Control+End");
  for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowLeft");
  await openPicker();
  await typeHex("aa0000");
  await box.dblclick();
  await slide.locator('[contenteditable="true"]').waitFor();
  await page.keyboard.press("Control+End");
  for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowLeft");
  await openPicker();
  await typeHex("123456");
  check("the box's own color still goes to the words", (await colorOf("PARIS")) === "rgb(18, 52, 86)", await colorOf("PARIS"));

  // Pasted with spaces around it.
  await typeHex("  #1E8E4F ");
  check("a hex with spaces around it works", (await colorOf("PARIS")) === "rgb(30, 142, 79)", await colorOf("PARIS"));
  await page.keyboard.press("Escape");

  // A table cell: the hex colors the words picked in it, although its text editor is gone once typing ends.
  await page.locator('button[title="Elements"]').click();
  await page.getByRole("button", { name: "Table", exact: true }).click();
  const firstCell = slide.locator('[data-table-row="0"][data-table-column="0"]');
  await firstCell.waitFor();
  await firstCell.dblclick();
  await slide.locator('[contenteditable="true"]').waitFor();
  await page.keyboard.type("Cell words");
  for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowLeft");
  await openPicker();
  await typeHex("aa00aa");
  const cellColor = (text) =>
    firstCell.evaluate((cell, text) => {
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.textContent.includes(text)) return getComputedStyle(node.parentElement).color;
      }
      return null;
    }, text);
  check("hex colors the words picked in a table cell", (await cellColor("words")) === "rgb(170, 0, 170)", await cellColor("words"));
  check("…and not the rest of the cell", (await cellColor("Cell")) !== "rgb(170, 0, 170)", await cellColor("Cell"));
  check("the cell's color is in recent", (await page.locator('button[title="#AA00AA"]').count()) === 1);
  // Take the table away again (it lies over the question box): close the panel, let go of the cell, Delete.
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Escape");
  await page.keyboard.press("Delete");
  await firstCell.waitFor({ state: "detached" });
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(1500);

  // Recent stays after a reload.
  await page.reload();
  await box.waitFor();
  await box.click();
  await page.locator('button[title="Text color"]').click();
  check("recent kept after reload", (await page.locator('button[title="#AA0000"]').count()) === 1);
  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("ran without throwing", false, e.message);
  await page.screenshot({ path: `${SHOTS}custom-colors-error.png` }).catch(() => {});
} finally {
  await browser.close();
  await deleteTeacher(teacher);
}
finish();
