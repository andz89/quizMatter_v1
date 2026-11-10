// A table, both clocks and both calendars together on one slide: add each from the Elements panel and move it to its
// own spot, type in the table, Set time, Set date (bad dates are ignored), undo, duplicate, save, reload, present.
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { APP, SHOTS, api, check, deleteTeacher, finish, loggedIn, makeTeacher } from "./lib.mjs";

// Changes closer together than 500 ms are one undo step (HISTORY_GROUP_MS), and a script clicks far faster than that.
const UNDO_STEP_MS = 700;

const teacher = await makeTeacher({ first: "Timetable" });
const presentationId = randomUUID();
await api("/rest/v1/presentations", {
  method: "POST",
  body: JSON.stringify({ id: presentationId, owner_id: teacher.id, title: "Table, date and time e2e", data_version: 3 }),
});
const blankSlide = (id, elements) => ({
  id,
  type: "blank",
  question: "",
  layout: "grid",
  options: ["a", "b", "c", "d"].map((o) => ({ id: `${id}-${o}`, text: "" })),
  correctOptionId: null,
  elements,
  questionHeight: 100,
});
// The second slide holds a time no clock can show, as if it was saved before the limits or sent by hand.
const badClock = {
  id: "bad-clock",
  assetId: "digital-clock",
  x: 400,
  y: 200,
  width: 300,
  height: 300,
  color: "#191A2C",
  containerId: null,
  clockTime: { hours: 99999, minutes: 5 },
};
await api("/rest/v1/slides", {
  method: "POST",
  body: JSON.stringify(
    [blankSlide("s1", []), blankSlide("s2", [badClock])].map((data, position) => ({
      presentation_id: presentationId,
      id: data.id,
      position,
      data,
    })),
  ),
});

/** The saved elements of the slide, straight from the local database. */
async function savedElements() {
  const rows = await api(`/rest/v1/slides?presentation_id=eq.${presentationId}&id=eq.s1&select=data`);
  return rows[0]?.data?.elements ?? [];
}

/** Where a clock's hand tips should be at this time (the same math as the drawing), to one decimal. */
function handTips(hours, minutes) {
  const tip = (angle, radius) => {
    const rad = (angle * Math.PI) / 180;
    return [(50 + radius * Math.sin(rad)).toFixed(1), (50 - radius * Math.cos(rad)).toFixed(1)].join();
  };
  return { hour: tip((hours % 12) * 30 + minutes * 0.5, 18), minute: tip(minutes * 6, 29) };
}

/** Where the hands drawn inside `root` really point. */
async function handsIn(root) {
  const end = async (width) => {
    const hand = root.locator(`line[stroke-linecap="round"][stroke-width="${width}"]`).first();
    return [Number(await hand.getAttribute("x2")).toFixed(1), Number(await hand.getAttribute("y2")).toFixed(1)].join();
  };
  return { hour: await end(4), minute: await end(2.5) };
}
const sameHands = (a, b) => a.hour === b.hour && a.minute === b.minute;
const drawnText = (root) => root.locator("svg text").allTextContents();

const browser = await chromium.launch();
const page = await (await loggedIn(browser, teacher, { width: 1600, height: 1000 })).newPage();
page.setDefaultTimeout(60_000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const slide = page.locator('[data-slide-id="s1"]');
const element = (id) => slide.locator(`[data-element-id="${id}"]`);
const elementIds = () => slide.locator("[data-element-id]").evaluateAll((els) => els.map((el) => el.dataset.elementId));
const slider = (label) => page.locator("label", { hasText: new RegExp(`^${label}`) }).locator('input[type="range"]');
const setTimeButton = page.locator('button[title="Set time"]');
const setDateButton = page.locator('button[title="Set date"]');
const dateBox = page.locator('input[type="date"][aria-label="Date"]');
const saveButton = page.locator('button[title="Save (Ctrl+S)"]');
const readout = (text) => page.getByText(text, { exact: true }).first();

/** Clicks a tile in the Elements panel, and returns the new element's id. */
async function addElement(tile) {
  const before = await elementIds();
  await tile.scrollIntoViewIfNeeded();
  await tile.click();
  for (let i = 0; i < 40; i++) {
    const added = (await elementIds()).find((id) => !before.includes(id));
    if (added) return added;
    await page.waitForTimeout(250);
  }
  throw new Error("the tile added no element");
}

/** Drags an element so its middle is at this place on the slide (0–1 across and down). */
async function moveTo(id, across, down) {
  const box = await element(id).boundingBox();
  const area = await slide.boundingBox();
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const to = { x: area.x + area.width * across, y: area.y + area.height * down };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2);
  await page.mouse.move(to.x, to.y);
  await page.mouse.up();
}

/** Duplicates the picked element, checks what `isSame` says about the copy, then deletes the copy. */
async function duplicateKeeps(name, isSame) {
  const before = await elementIds();
  await page.locator('button[title="Duplicate"]').click();
  await page.waitForFunction((n) => document.querySelectorAll('[data-slide-id="s1"] [data-element-id]').length === n, before.length + 1);
  const copy = (await elementIds()).find((id) => !before.includes(id));
  check(`a duplicate keeps its ${name}`, await isSame(element(copy)));
  await page.keyboard.press("Delete");
  await page.waitForFunction((n) => document.querySelectorAll('[data-slide-id="s1"] [data-element-id]').length === n, before.length);
}

try {
  await page.goto(`${APP}/presentation/${presentationId}/edit`, { timeout: 120_000 });
  await slide.waitFor();
  const badClockText = await drawnText(page.locator('[data-slide-id="s2"] [data-element-id="bad-clock"]'));
  check("a slide already holding an impossible time opens, showing 10:10", badClockText.includes("10:10AM"), badClockText.join());
  await page.locator('button[title="Elements"]').click();
  const today = await page.evaluate(() => {
    const now = new Date();
    return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
  });

  // ─── Table ─────────────────────────────────────────────────────────────────────────────────────────────────
  const tableId = await addElement(page.getByRole("button", { name: "Table", exact: true }));
  await moveTo(tableId, 0.31, 0.27);
  const cell = (row, column) => element(tableId).locator(`[data-table-row="${row}"][data-table-column="${column}"]`);
  const cellCount = () => element(tableId).locator("[data-table-row]").count();
  check("a new table has 9 cells", (await cellCount()) === 9, String(await cellCount()));
  await cell(0, 0).dblclick();
  await slide.locator('[contenteditable="true"]').waitFor();
  for (const [i, word] of ["Subject", "Time", "Room", "Math"].entries()) {
    if (i > 0) await page.keyboard.press("Tab");
    await page.keyboard.type(word);
  }
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector('[contenteditable="true"]'));
  check("Tab moves through the cells, row after row", (await cell(1, 0).innerText()).trim() === "Math", await cell(1, 0).innerText());
  await page.locator('button[title="Add a row"]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-slide-id="s1"] [data-table-row]').length === 12);
  check('the "+" adds a row', (await cellCount()) === 12, String(await cellCount()));

  // ─── Clock ─────────────────────────────────────────────────────────────────────────────────────────────────
  await page.getByText("Time & Date", { exact: true }).first().scrollIntoViewIfNeeded();
  const clockId = await addElement(page.locator('button[title="Clock"]').first());
  await moveTo(clockId, 0.76, 0.27);
  await setTimeButton.click();
  await readout("10:10").waitFor();
  check("a new clock starts at 10:10", sameHands(await handsIn(element(clockId)), handTips(10, 10)));
  await slider("Hour").fill("3");
  await slider("Minute").fill("30");
  await readout("3:30").waitFor();
  check("the panel says 3:30", true);
  check("the hands point at 3:30", sameHands(await handsIn(element(clockId)), handTips(3, 30)), JSON.stringify(await handsIn(element(clockId))));
  check("the analog clock has no AM/PM", (await page.getByRole("button", { name: "PM", exact: true }).count()) === 0);

  // Undo and Redo take back one change of time, with the Set time box staying open.
  await page.waitForTimeout(UNDO_STEP_MS);
  await slider("Minute").fill("45");
  await readout("3:45").waitFor();
  check("the hands move to 3:45", sameHands(await handsIn(element(clockId)), handTips(3, 45)));
  await page.waitForTimeout(UNDO_STEP_MS);
  await page.locator('button[title="Undo (Ctrl+Z)"]').click();
  await readout("3:30").waitFor({ timeout: 5_000 });
  check("Undo takes the time back to 3:30 and the box stays open", sameHands(await handsIn(element(clockId)), handTips(3, 30)));
  await page.locator('button[title="Redo (Ctrl+Y)"]').click();
  await readout("3:45").waitFor({ timeout: 5_000 });
  check("Redo brings back 3:45 and the box stays open", sameHands(await handsIn(element(clockId)), handTips(3, 45)));
  await page.locator('button[title="Undo (Ctrl+Z)"]').click();
  await readout("3:30").waitFor({ timeout: 5_000 });

  // Ctrl+Z works straight after moving a slider (the slider still has the focus).
  await page.waitForTimeout(UNDO_STEP_MS);
  await slider("Minute").fill("50");
  await readout("3:50").waitFor();
  await page.waitForTimeout(UNDO_STEP_MS);
  await page.keyboard.press("Control+z");
  await readout("3:30").waitFor({ timeout: 5_000 });
  check("Ctrl+Z on the slider takes the time back and the box stays open", sameHands(await handsIn(element(clockId)), handTips(3, 30)));
  await setTimeButton.click();

  // ─── Digital clock ─────────────────────────────────────────────────────────────────────────────────────────
  const digitalId = await addElement(page.locator('button[title="Digital Clock"]').first());
  await moveTo(digitalId, 0.5, 0.77);
  await setTimeButton.click();
  await readout("10:10 AM").waitFor();
  check("a new digital clock doesn't copy the other clock's time", (await drawnText(element(digitalId))).includes("10:10AM"));
  await slider("Hour").fill("12");
  await slider("Minute").fill("5");
  await page.getByRole("button", { name: "PM", exact: true }).click();
  await readout("12:05 PM").waitFor();
  check("the digital clock shows 12:05 PM", (await drawnText(element(digitalId))).includes("12:05PM"), (await drawnText(element(digitalId))).join());

  // Reset, then the time again.
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await readout("10:10 AM").waitFor();
  check("Reset goes back to 10:10 AM", (await drawnText(element(digitalId))).includes("10:10AM"));
  await slider("Hour").fill("12");
  await slider("Minute").fill("5");
  await page.getByRole("button", { name: "PM", exact: true }).click();
  await readout("12:05 PM").waitFor();
  await setTimeButton.click();
  await duplicateKeeps("time", async (copy) => (await drawnText(copy)).includes("12:05PM"));
  check("the other clock still says 3:30", sameHands(await handsIn(element(clockId)), handTips(3, 30)));

  // ─── Calendar page ─────────────────────────────────────────────────────────────────────────────────────────
  const pageId = await addElement(page.locator('button[title="Calendar Page"]').first());
  await moveTo(pageId, 0.14, 0.77);
  await setDateButton.click();
  await dateBox.waitFor();
  check("a new calendar starts on today", (await dateBox.inputValue()) === today, await dateBox.inputValue());
  await dateBox.fill("2024-12-25");
  await readout("Wednesday, December 25, 2024").waitFor();
  const pageText = await drawnText(element(pageId));
  check("the calendar page shows the date", ["DECEMBER", "25", "WEDNESDAY", "2024"].every((t) => pageText.includes(t)), pageText.join());

  // A date the calendars don't take is ignored.
  await dateBox.fill("");
  await page.waitForTimeout(200);
  check("an emptied date box keeps the last date", (await readout("Wednesday, December 25, 2024").count()) === 1);
  await dateBox.fill("1800-01-01");
  await page.waitForTimeout(200);
  check("a year before 1900 keeps the last date", (await readout("Wednesday, December 25, 2024").count()) === 1);
  await dateBox.fill("2024-12-25");
  await setDateButton.click();

  // ─── Month calendar ────────────────────────────────────────────────────────────────────────────────────────
  const monthId = await addElement(page.locator('button[title="Month Calendar"]').first());
  await moveTo(monthId, 0.84, 0.77);
  await setDateButton.click();
  await dateBox.fill("2024-02-29");
  await readout("Thursday, February 29, 2024").waitFor();
  const chosenDay = (root) => root.locator('svg text[fill="#FFFFFF"]', { hasText: /^29$/ }).count();
  check("the month calendar shows FEBRUARY 2024", (await drawnText(element(monthId))).includes("FEBRUARY 2024"));
  check("the chosen day is marked", (await chosenDay(element(monthId))) === 1);
  await setDateButton.click();
  await duplicateKeeps("date", async (copy) => (await drawnText(copy)).includes("FEBRUARY 2024"));
  check("the calendar page still says December", (await drawnText(element(pageId))).includes("DECEMBER"));

  await page.mouse.click(5, 500);
  await page.mouse.move(5, 5);
  await page.screenshot({ path: SHOTS + "table-date-time-editor.png" });

  // ─── Save ──────────────────────────────────────────────────────────────────────────────────────────────────
  await saveButton.click();
  await page.getByText("Presentation saved.", { exact: true }).waitFor();
  check('saving shows "Presentation saved."', true);
  const saved = await savedElements();
  const savedOne = (id) => saved.find((el) => el.id === id);
  check("saved: exactly the 5 elements (the duplicates are gone)", saved.length === 5, String(saved.length));
  check(
    "saved: the table's rows and text",
    savedOne(tableId)?.table.rows.length === 4 && savedOne(tableId).table.rows[1][0].html.includes("Math"),
  );
  // The database keeps a saved object's keys in its own order, so each one is compared by name.
  const matches = (value, wanted) => !!value && Object.entries(wanted).every(([key, v]) => value[key] === v);
  check("saved: the clock's time", matches(savedOne(clockId)?.clockTime, { hours: 3, minutes: 30 }), JSON.stringify(savedOne(clockId)?.clockTime));
  check("saved: the digital clock's time", matches(savedOne(digitalId)?.clockTime, { hours: 12, minutes: 5, pm: true }), JSON.stringify(savedOne(digitalId)?.clockTime));
  check("saved: the calendar page's date", matches(savedOne(pageId)?.calendarDate, { year: 2024, month: 12, day: 25 }), JSON.stringify(savedOne(pageId)?.calendarDate));
  check("saved: the month calendar's date", matches(savedOne(monthId)?.calendarDate, { year: 2024, month: 2, day: 29 }), JSON.stringify(savedOne(monthId)?.calendarDate));

  // ─── Reload ────────────────────────────────────────────────────────────────────────────────────────────────
  await page.reload({ timeout: 120_000 });
  await element(monthId).waitFor();
  check("after reload: the table's text", (await cell(1, 0).innerText()).trim() === "Math");
  check("after reload: the hands point at 3:30", sameHands(await handsIn(element(clockId)), handTips(3, 30)));
  check("after reload: the digital clock says 12:05 PM", (await drawnText(element(digitalId))).includes("12:05PM"));
  check("after reload: the calendar page says December", (await drawnText(element(pageId))).includes("DECEMBER"));
  check("after reload: the month calendar says February 2024", (await drawnText(element(monthId))).includes("FEBRUARY 2024"));
  check("opening it counts as no change", (await saveButton.innerText()).trim() === "Saved", await saveButton.innerText());

  // The toolbars read the saved values back.
  await element(clockId).click();
  await setTimeButton.click();
  await readout("3:30").waitFor();
  check("after reload: Set time opens on the saved time", true);
  await setTimeButton.click();
  await element(monthId).click();
  await setDateButton.click();
  check("after reload: Set date opens on the saved date", (await dateBox.inputValue()) === "2024-02-29", await dateBox.inputValue());
  await setDateButton.click();
  await page.mouse.click(5, 500);

  // ─── Present ───────────────────────────────────────────────────────────────────────────────────────────────
  await page.locator('button[title="Present (fullscreen)"]').first().click();
  const screen = page.locator(".fixed.inset-0.z-50").filter({ has: page.locator('button[title="Exit presentation (Esc)"]') });
  const shown = screen.locator('[aria-hidden="false"]');
  await shown.getByText("Subject", { exact: true }).waitFor();
  check("presenting is really fullscreen", await page.evaluate(() => document.fullscreenElement !== null));
  for (const word of ["Time", "Room", "Math"]) check(`present: the table shows "${word}"`, (await shown.getByText(word, { exact: true }).count()) === 1);
  check("present: the table has its 12 cells", (await shown.locator("[data-table-row]").count()) === 12, String(await shown.locator("[data-table-row]").count()));
  check("present: nothing can be typed in", (await shown.locator('[contenteditable="true"]').count()) === 0);
  check("present: the hands point at 3:30", sameHands(await handsIn(shown), handTips(3, 30)), JSON.stringify(await handsIn(shown)));
  const shownText = await drawnText(shown);
  check("present: the digital clock says 12:05 PM", shownText.includes("12:05PM"));
  check("present: the calendar page shows the date", ["DECEMBER", "25", "WEDNESDAY"].every((t) => shownText.includes(t)));
  check("present: the month calendar shows February 2024", shownText.includes("FEBRUARY 2024"));
  check("present: the chosen day is marked", (await chosenDay(shown)) === 1);
  await page.waitForTimeout(500);
  await page.screenshot({ path: SHOTS + "table-date-time-present.png" });

  // Next.js's dev badge sits on top of the Exit button (development only).
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.mouse.move(800, 300);
  await page.mouse.move(810, 310);
  await page.locator('button[title="Exit presentation (Esc)"]').click();
  await screen.waitFor({ state: "detached" });
  await page.waitForFunction(() => document.fullscreenElement === null);
  check("Exit leaves fullscreen and goes back to the editor", (await elementIds()).length === 5);
  check("presenting counts as no change", (await saveButton.innerText()).trim() === "Saved", await saveButton.innerText());

  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (error) {
  check("run finished without an exception", false, String(error).split("\n").slice(0, 14).join(" "));
  await page.screenshot({ path: SHOTS + "table-date-time-failure.png" }).catch(() => {});
} finally {
  await browser.close();
  await deleteTeacher(teacher);
}

finish();
