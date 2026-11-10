// Diagrams, clocks and calendars used together, in the situations diagrams.mjs and table-date-time.mjs don't reach.
// Every scenario gets its own presentation and page, so one failure can't hide the next.
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { APP, SHOTS, api, check, deleteTeacher, finish, loggedIn, makeTeacher } from "./lib.mjs";

// Changes closer together than 500 ms are one undo step (HISTORY_GROUP_MS), and a script clicks far faster than that.
const UNDO_STEP_MS = 700;
const OUTSIDE = [1500, 900];
// ONLY="date box|zoomed" runs just the scenarios whose names match.
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const near = (a, b, within = 3) => Math.abs(a - b) <= within;
const pad = (n) => String(n).padStart(2, "0");
const canon = (v) =>
  Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

// ─── What goes on the slides ─────────────────────────────────────────────────────────────────────────────────
const slideOf = (id, type, elements, extra = {}) => ({
  id,
  type,
  question: "",
  layout: "grid",
  options: ["a", "b", "c", "d"].map((o) => ({ id: `${id}-${o}`, text: type === "blank" ? "" : o.toUpperCase() })),
  correctOptionId: null,
  elements,
  questionHeight: 100,
  ...extra,
});
const blank = (id, elements) => slideOf(id, "blank", elements);
const item = (assetId, id, x, y, width, height, extra = {}) => ({ id, assetId, x, y, width, height, color: "#3B82F6", containerId: null, ...extra });
const flow = (id, x, y, w = 480, h = 140, steps = ["One", "Two", "Three"], extra = {}) =>
  item("flowchart", id, x, y, w, h, { flowchart: { steps: steps.map((text) => ({ text })) }, ...extra });
const clock = (id, x, y, clockTime = { hours: 3, minutes: 30 }, extra = {}) => item("clock", id, x, y, 200, 200, { clockTime, ...extra });
const digital = (id, x, y, clockTime = { hours: 9, minutes: 5, pm: true }, extra = {}) =>
  item("digital-clock", id, x, y, 200, 200, { clockTime, ...extra });
const D = { year: 2024, month: 12, day: 25 };
const calPage = (id, x, y, calendarDate = D, extra = {}) => item("calendar-page", id, x, y, 200, 200, { calendarDate, ...extra });
const month = (id, x, y, calendarDate = D, extra = {}) => item("month-calendar", id, x, y, 240, 240, { calendarDate, ...extra });

const mix = () => [flow("f", 40, 40), clock("c", 600, 40), digital("d", 840, 40), calPage("p", 600, 280), month("m", 840, 280)];

// What a date should look like, worked out here without the app's own code.
const dateParts = (text) => {
  const [year, m, day] = text.split("-").map(Number);
  const at = new Date(Date.UTC(year, m - 1, day));
  const en = (options) => at.toLocaleDateString("en-US", { timeZone: "UTC", ...options });
  const first = new Date(Date.UTC(year, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return {
    year,
    m,
    day,
    days,
    weeks: Math.ceil((first + days) / 7),
    weekdayOfDay: (d) => new Date(Date.UTC(year, m - 1, d)).getUTCDay(),
    monthName: en({ month: "long" }).toUpperCase(),
    weekday: en({ weekday: "long" }).toUpperCase(),
    readout: en({ weekday: "long", year: "numeric", month: "long", day: "numeric" }),
  };
};

/** Where a clock's hand tips should be at this time, to one decimal. */
function handTips(hours, minutes) {
  const tip = (angle, radius) => {
    const rad = (angle * Math.PI) / 180;
    return [(50 + radius * Math.sin(rad)).toFixed(1), (50 - radius * Math.cos(rad)).toFixed(1)].join();
  };
  return { hour: tip((hours % 12) * 30 + minutes * 0.5, 18), minute: tip(minutes * 6, 29) };
}
async function handsIn(root) {
  const end = async (width) => {
    const hand = root.locator(`line[stroke-linecap="round"][stroke-width="${width}"]`).first();
    return [Number(await hand.getAttribute("x2")).toFixed(1), Number(await hand.getAttribute("y2")).toFixed(1)].join();
  };
  return { hour: await end(4), minute: await end(2.5) };
}
const sameHands = (a, b) => a.hour === b.hour && a.minute === b.minute;

// ─── The tools every scenario uses ───────────────────────────────────────────────────────────────────────────
function tools(page, presentationId, slides, name) {
  const button = (title) => page.locator(`button[title="${title}"]`);
  const element = (id) => page.locator(`[data-element-id="${id}"]`).first();
  const outline = page.locator('[title="Drag to move this box, double-click to type"]');
  const textArea = page.locator('[data-slide-id] textarea, textarea[class*="cursor-text"]').first();
  const toolbar = page.locator("[data-element-toolbar]");
  const dateBox = page.locator('input[type="date"][aria-label="Date"]');
  const setTime = button("Set time");
  const setDate = button("Set date");
  const undo = button("Undo (Ctrl+Z)");
  const redo = button("Redo (Ctrl+Y)");
  const saveButton = button("Save (Ctrl+S)");
  const slider = (label) => page.locator("label", { hasText: new RegExp(`^${label}`) }).locator('input[type="range"]');
  const readout = (text) => page.getByText(text, { exact: true }).first();
  const drawn = (id) => element(id).locator("svg text").allTextContents();
  const ok = (label, passed, detail) => check(`${name}: ${label}`, passed, detail);
  const wait = (ms = UNDO_STEP_MS) => page.waitForTimeout(ms);
  const clickOutside = () => page.mouse.click(...OUTSIDE);
  const appears = (locator, timeout = 4000) => locator.first().waitFor({ timeout }).then(() => true, () => false);

  const boxes = (id) =>
    element(id)
      .locator("svg text")
      .evaluateAll((list) =>
        list.map((t) => {
          const box = t.getBoundingClientRect();
          return {
            text: [...t.querySelectorAll("tspan")].map((s) => s.textContent).join(" ") || t.textContent,
            lines: t.querySelectorAll("tspan").length,
            screenX: box.x + box.width / 2,
            screenY: box.y + box.height / 2,
            size: Number(t.getAttribute("font-size")),
          };
        }),
      );
  const texts = async (id) => (await boxes(id)).map((b) => b.text);
  const boxNamed = async (id, text) => {
    const found = (await boxes(id)).find((b) => b.text === text);
    if (!found) throw new Error(`no box "${text}" in ${id}: ${(await texts(id)).join(" | ")}`);
    return found;
  };
  const diagramButtons = page.locator('[data-slide-id] button[title="Remove this box"], [data-slide-id] button[title="Add the next step"], [data-slide-id] button[title="Add a step after"]');

  async function goToSlide(id) {
    await page.locator(`[data-slide-id="${id}"]`).evaluate((slide) => slide.scrollIntoView({ block: "center" }));
    const number = slides.findIndex((s) => s.id === id) + 1;
    await page.waitForFunction((text) => document.querySelector('[title="Slide you\'re on / all slides"]')?.textContent.trim().startsWith(text), `${number} /`);
  }
  async function selectDiagram(id) {
    const [first] = await boxes(id);
    await page.mouse.click(first.screenX, first.screenY);
    await diagramButtons.first().waitFor();
  }
  async function pickBox(id, text) {
    const box = await boxNamed(id, text);
    await page.mouse.click(box.screenX, box.screenY);
    await outline.waitFor();
  }
  async function startTyping(id, text) {
    const box = await boxNamed(id, text);
    await page.mouse.dblclick(box.screenX, box.screenY);
    await textArea.waitFor();
  }
  async function typeIn(id, text, value, finishKey = "Enter") {
    await startTyping(id, text);
    await textArea.fill(value);
    await page.keyboard.press(finishKey);
    await textArea.waitFor({ state: "detached" });
  }
  async function dragBy(box, dx, dy) {
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + dx / 2, from.y + dy / 2);
    await page.mouse.move(from.x + dx, from.y + dy);
    await page.mouse.up();
  }
  /** Clicks the first part of a date box (the browser remembers the last part used, so focus alone isn't enough). */
  async function clickFirstPart(box) {
    const place = await box.boundingBox();
    await page.mouse.click(place.x + 20, place.y + place.height / 2);
  }
  async function dateKeys(start, keys) {
    await dateBox.fill(start);
    await clickFirstPart(dateBox);
    await page.keyboard.type(keys, { delay: 60 });
    await wait(250);
    return dateBox.inputValue();
  }
  async function addTile(slideId, title) {
    const ids = () => page.locator(`[data-slide-id="${slideId}"] [data-element-id]`).evaluateAll((els) => els.map((el) => el.dataset.elementId));
    const before = await ids();
    if ((await button(title).count()) === 0) await button("Elements").click();
    await button(title).first().scrollIntoViewIfNeeded();
    await button(title).first().click();
    for (let i = 0; i < 40; i++) {
      const added = (await ids()).find((id) => !before.includes(id));
      if (added) return added;
      await page.waitForTimeout(100);
    }
    throw new Error(`"${title}" added nothing`);
  }
  const savedSlide = async (id) => (await api(`/rest/v1/slides?presentation_id=eq.${presentationId}&id=eq.${id}&select=data`))[0]?.data;
  const savedOne = async (slideId, id) => (await savedSlide(slideId))?.elements.find((e) => e.id === id);
  /** Ctrl+S, then waits for `test` to be true of the database (25 s: a save already running ignores Ctrl+S). */
  async function save(test) {
    await page.keyboard.press("Control+s");
    for (let i = 0; i < 100; i++) {
      if (await test()) return true;
      await page.waitForTimeout(250);
    }
    return false;
  }
  /** Every drawn text sits inside the element's first box (the clock's face, the calendar's paper). */
  const textStaysInside = (id) =>
    element(id).evaluate((el) => {
      const frame = el.querySelector("svg rect").getBBox();
      return [...el.querySelectorAll("svg text")].every((t) => {
        const b = t.getBBox();
        return b.x >= frame.x && b.x + b.width <= frame.x + frame.width && b.y >= frame.y && b.y + b.height <= frame.y + frame.height;
      });
    });
  const saveLabel = async () => (await saveButton.innerText()).trim();

  return {
    page, button, element, outline, textArea, toolbar, dateBox, setTime, setDate, undo, redo, saveButton, slider, readout, drawn, ok, wait,
    clickOutside, appears, boxes, texts, boxNamed, diagramButtons, goToSlide, selectDiagram, pickBox, startTyping, typeIn, dragBy, dateKeys, clickFirstPart,
    addTile, savedSlide, savedOne, save, textStaysInside, saveLabel, presentationId,
  };
}

async function makePresentation(title, slides) {
  const id = randomUUID();
  await api("/rest/v1/presentations", {
    method: "POST",
    body: JSON.stringify({ id, owner_id: teacher.id, title, data_version: 3 }),
  });
  await api("/rest/v1/slides", {
    method: "POST",
    body: JSON.stringify(slides.map((data, position) => ({ presentation_id: id, id: data.id, position, data }))),
  });
  return id;
}
const removePresentation = (id) => api(`/rest/v1/presentations?id=eq.${id}`, { method: "DELETE" }).catch(() => {});

async function scenario(name, slides, work, { context = mainContext, before } = {}) {
  if (ONLY && !ONLY.test(name)) return;
  console.log(`\n── ${name}`);
  const id = await makePresentation(`e2e ${name}`, slides);
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && /hydrat/i.test(m.text()) && errors.push(m.text().slice(0, 300)));
  try {
    if (before) await before(page);
    await page.goto(`${APP}/presentation/${id}/edit`, { timeout: 120_000 });
    await page.locator(`[data-slide-id="${slides[0].id}"]`).waitFor({ timeout: 60_000 });
    await work(tools(page, id, slides, name));
    check(`${name}: no page errors`, errors.length === 0, errors.join(" | ").slice(0, 400));
  } catch (error) {
    check(`${name}: ran to the end`, false, String(error).split("\n").slice(0, 6).join(" "));
    await page.screenshot({ path: `${SHOTS}ddt-failure-${name.replace(/\W+/g, "-")}.png` }).catch(() => {});
  } finally {
    await page.close().catch(() => {});
    await removePresentation(id);
  }
}

/** A slide holding one bad value still opens: one element must not lock a teacher out of the whole presentation. */
async function opensWith(name, bad) {
  if (ONLY && !ONLY.test("bad saved data")) return;
  const id = await makePresentation(`e2e bad ${name}`, [blank("s", [flow("good", 40, 40), bad])]);
  const page = await mainContext.newPage();
  try {
    await page.goto(`${APP}/presentation/${id}/edit`, { timeout: 120_000 });
    const opened = await page.locator('[data-slide-id="s"]').waitFor({ timeout: 30_000 }).then(() => true, () => false);
    const said = opened ? "" : (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 120);
    check(`bad saved data: ${name} still opens the presentation`, opened, said);
    if (opened) check(`bad saved data: ${name} leaves the good diagram`, (await page.locator('[data-element-id="good"] svg text').count()) === 3);
  } finally {
    await page.close().catch(() => {});
    await removePresentation(id);
  }
}

// ─── The run ─────────────────────────────────────────────────────────────────────────────────────────────────
const teacher = await makeTeacher({ first: "Mixed" });
const browser = await chromium.launch();
const mainContext = await loggedIn(browser, teacher, { width: 1600, height: 1000 });

try {
  await scenario("clock times", [blank("s", [clock("c", 100, 100), digital("d", 500, 100)])], async (t) => {
    await t.element("c").click();
    await t.setTime.click();
    for (const [h, m] of [[12, 0], [12, 59], [1, 0], [6, 30], [11, 59], [9, 5]]) {
      await t.slider("Hour").fill(String(h));
      await t.slider("Minute").fill(String(m));
      await t.readout(`${h}:${pad(m)}`).waitFor();
      const hands = await handsIn(t.element("c"));
      t.ok(`the hands point at ${h}:${pad(m)}`, sameHands(hands, handTips(h, m)), JSON.stringify(hands));
    }
    await t.setTime.click();
    await t.element("d").click();
    await t.setTime.click();
    for (const [h, m, half] of [[12, 0, "AM"], [12, 0, "PM"], [1, 5, "AM"], [12, 59, "PM"], [11, 59, "PM"]]) {
      await t.slider("Hour").fill(String(h));
      await t.slider("Minute").fill(String(m));
      await t.page.getByRole("button", { name: half, exact: true }).click();
      await t.readout(`${h}:${pad(m)} ${half}`).waitFor();
      t.ok(`the digital clock draws ${h}:${pad(m)} ${half}`, (await t.drawn("d")).includes(`${h}:${pad(m)}${half}`), (await t.drawn("d")).join());
      t.ok(`${h}:${pad(m)} ${half} stays inside the face`, await t.textStaysInside("d"));
    }
  });

  await scenario("calendar drawings", [blank("s", [calPage("p", 100, 100), month("m", 500, 100)])], async (t) => {
    const DATES = [
      ["2015-02-14", "a month of 4 weeks"], ["2026-08-15", "a month of 6 weeks"], ["2024-02-29", "a leap day"],
      ["1900-02-28", "1900, no leap year"], ["2100-02-28", "2100, no leap year"], ["1900-01-01", "the first date allowed"],
      ["2100-12-31", "the last date allowed"], ["2026-09-30", "the longest month name"], ["2026-12-31", "the last day of a year"], ["2027-01-01", "the first day of a year"],
    ];
    await t.element("m").click();
    await t.setDate.click();
    for (const [text, what] of DATES) {
      const want = dateParts(text);
      await t.dateBox.fill(text);
      await t.readout(want.readout).waitFor();
      const cells = await t.element("m").locator("svg text").evaluateAll((list) =>
        list.map((n) => ({ text: n.textContent, x: Number(n.getAttribute("x")), y: Number(n.getAttribute("y")), fill: n.getAttribute("fill") })).filter((n) => /^\d+$/.test(n.text)),
      );
      t.ok(`${what}: all ${want.days} days are drawn`, cells.length === want.days, String(cells.length));
      const wrong = cells.filter((c) => Math.round((c.x - 4) / (92 / 7) - 0.5) !== want.weekdayOfDay(Number(c.text)));
      t.ok(`${what}: every day is under its weekday`, wrong.length === 0, wrong.map((c) => c.text).join());
      t.ok(`${what}: ${want.weeks} rows`, new Set(cells.map((c) => c.y)).size === want.weeks, String(new Set(cells.map((c) => c.y)).size));
      const chosen = cells.filter((c) => c.fill === "#FFFFFF");
      t.ok(`${what}: only the chosen day is marked`, chosen.length === 1 && Number(chosen[0].text) === want.day, chosen.map((c) => c.text).join());
      t.ok(`${what}: the month fits its frame`, await t.textStaysInside("m"));
    }
    await t.setDate.click();
    await t.element("p").click();
    await t.setDate.click();
    for (const [text, what] of DATES) {
      const want = dateParts(text);
      await t.dateBox.fill(text);
      await t.readout(want.readout).waitFor();
      const shown = await t.drawn("p");
      t.ok(`${what}: the page shows it`, [want.monthName, String(want.day), want.weekday, String(want.year)].every((w) => shown.includes(w)), shown.join());
      t.ok(`${what}: the page's words fit`, await t.textStaysInside("p"));
    }
    await t.dateBox.fill("2024-02-29");
    for (const refused of ["1899-12-31", "2101-01-01"]) {
      await t.dateBox.fill(refused);
      await t.wait(200);
      t.ok(`${refused} is refused`, (await t.readout("Thursday, February 29, 2024").count()) === 1);
      await t.dateBox.evaluate((box) => box.blur());
      await t.wait(150);
      t.ok(`after ${refused}, leaving the box shows the last date`, (await t.dateBox.inputValue()) === "2024-02-29", await t.dateBox.inputValue());
    }
  });

  await scenario("the date box by keyboard", [blank("s", [month("m", 500, 100)])], async (t) => {
    // A plain date box the app doesn't control: it shows which part comes first on this computer (Chrome takes that
    // from Windows, not from Playwright's locale), and that the same keys work without the app.
    await t.page.evaluate(() => {
      const plain = document.createElement("input");
      plain.type = "date";
      plain.id = "plain-date";
      plain.value = "2024-06-15";
      plain.style.cssText = "position:fixed;left:500px;top:8px;z-index:9999;width:180px;padding:4px 12px";
      document.body.appendChild(plain);
    });
    const plain = t.page.locator("#plain-date");
    await t.clickFirstPart(plain);
    await t.page.keyboard.press("ArrowUp");
    const dayFirst = (await plain.inputValue()) === "2024-06-16";
    console.log(`NOTE  this browser's date box has the ${dayFirst ? "day" : "month"} first`);
    const fullDate = dayFirst ? "15032025" : "03152025";
    await plain.evaluate((box) => (box.value = "2024-12-25"));
    await t.clickFirstPart(plain);
    await t.page.keyboard.type(fullDate, { delay: 60 });
    t.ok("control: a plain date box takes 15 March 2025", (await plain.inputValue()) === "2025-03-15", await plain.inputValue());
    await plain.evaluate((box) => box.remove());

    await t.element("m").click();
    await t.setDate.click();
    await t.dateBox.waitFor();
    const typed = await t.dateKeys("2024-12-25", fullDate);
    t.ok("typing a whole date sets 15 March 2025", typed === "2025-03-15", typed);
    // Halfway through, these two are 31 February: a date that doesn't exist.
    const [from, keys, want] = dayFirst ? ["2025-02-15", "3103", "2025-03-31"] : ["2025-01-31", "0215", "2025-02-15"];
    const across = await t.dateKeys(from, keys);
    t.ok(`from ${from}, typing ${keys} gets past a date that doesn't exist`, across === want, across);

    await t.dateBox.fill("2024-06-15");
    await t.clickFirstPart(t.dateBox);
    const placeBefore = await t.element("m").boundingBox();
    await t.page.keyboard.press("ArrowUp");
    await t.wait(150);
    const stepped = dayFirst ? "2024-06-16" : "2024-07-15";
    t.ok("ArrowUp changes the part it's on", (await t.dateBox.inputValue()) === stepped, await t.dateBox.inputValue());
    const placeAfter = await t.element("m").boundingBox();
    t.ok("ArrowUp in the box doesn't move the calendar", placeAfter.y === placeBefore.y && placeAfter.x === placeBefore.x);

    for (const key of ["Backspace", "Delete"]) {
      await t.page.keyboard.press(key);
      await t.wait(150);
      t.ok(`${key} in the box keeps the calendar`, (await t.element("m").count()) === 1);
    }
    t.ok("a part left empty stays empty while typing", (await t.dateBox.inputValue()) === "", await t.dateBox.inputValue());
    await t.dateBox.evaluate((box) => box.blur());
    await t.wait(150);
    t.ok("leaving a half-typed box shows the calendar's date again", (await t.dateBox.inputValue()) === stepped, await t.dateBox.inputValue());
    await t.dateBox.fill("2024-06-15");
    await t.wait();
    await t.dateBox.fill("2024-11-20");
    await t.readout("Wednesday, November 20, 2024").waitFor();
    await t.wait();
    await t.undo.click();
    t.ok("the Undo button takes the date back, the box stays open", await t.appears(t.readout("Saturday, June 15, 2024")) && (await t.dateBox.count()) === 1);
    await t.redo.click();
    await t.readout("Wednesday, November 20, 2024").waitFor();
    await t.dateBox.focus();
    await t.wait();
    await t.page.keyboard.press("Control+z");
    t.ok("Ctrl+Z in the date box takes the date back (like the Set time sliders)", await t.appears(t.readout("Saturday, June 15, 2024"), 2500));
    await t.page.keyboard.press("Control+y");
    t.ok("Ctrl+Y in the date box brings it back", await t.appears(t.readout("Wednesday, November 20, 2024"), 2500));
    await t.clickFirstPart(t.dateBox);
    await t.page.keyboard.press("Backspace");
    await t.wait(150);
    await t.page.keyboard.press("Control+z");
    t.ok("Ctrl+Z over a half-typed date shows the date it went back to", await t.appears(t.readout("Saturday, June 15, 2024"), 2500) && (await t.dateBox.inputValue()) === "2024-06-15", await t.dateBox.inputValue());
  });

  await scenario("the time sliders by keyboard and mouse", [blank("s", [clock("c", 500, 100)])], async (t) => {
    await t.element("c").click();
    await t.setTime.click();
    await t.slider("Hour").focus();
    const before = await t.element("c").boundingBox();
    await t.page.keyboard.press("ArrowRight");
    await t.readout("4:30").waitFor();
    const after = await t.element("c").boundingBox();
    t.ok("an arrow key on the slider changes the time, not the clock's place", after.x === before.x && after.y === before.y);
    await t.page.keyboard.press("Delete");
    await t.wait(150);
    t.ok("Delete on the slider keeps the clock", (await t.element("c").count()) === 1);

    await t.wait();
    const track = await t.slider("Minute").boundingBox();
    await t.page.mouse.move(track.x + track.width * 0.5, track.y + track.height / 2);
    await t.page.mouse.down();
    await t.page.mouse.move(track.x + track.width * 0.85, track.y + track.height / 2, { steps: 8 });
    await t.page.mouse.up();
    const dragged = await t.slider("Minute").inputValue();
    t.ok("dragging the minute slider changes the minutes", Number(dragged) > 40, dragged);
    await t.wait();
    await t.undo.click();
    t.ok("one undo takes back the whole slider drag", await t.appears(t.readout("4:30"), 2500), `slider at ${await t.slider("Minute").inputValue()}`);
  });

  const today = (() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  })();
  await scenario("buttons that change nothing", [blank("s", [digital("d", 100, 100, { hours: 10, minutes: 10, pm: false }), calPage("p", 500, 100, today), item("digital-clock", "n", 100, 400, 200, 200), item("icosahedron", "b", 500, 400, 200, 200)])], async (t) => {
    await t.element("d").click();
    await t.setTime.click();
    await t.page.getByRole("button", { name: "Reset", exact: true }).click();
    await t.wait(200);
    t.ok("Reset on a clock already at 10:10 AM leaves it saved", (await t.saveLabel()) === "Saved", await t.saveLabel());
    t.ok("and adds no undo step", await t.undo.isDisabled());
    await t.setTime.click();
    await t.element("p").click();
    await t.setDate.click();
    await t.page.getByRole("button", { name: "Today", exact: true }).click();
    await t.wait(200);
    t.ok("Today on a calendar already on today leaves it saved", (await t.saveLabel()) === "Saved", await t.saveLabel());
    await t.setDate.click();

    const resetIn = async (id, tool, label) => {
      await t.element(id).click();
      const open = t.page.locator(`button[title="${tool}"]`);
      await open.click();
      await t.page.getByRole("button", { name: "Reset", exact: true }).click();
      await t.wait(200);
      t.ok(`${label} leaves it saved`, (await t.saveLabel()) === "Saved", await t.saveLabel());
      await open.click();
    };
    await resetIn("n", "Set time", "Reset on a clock with no saved time");
    await resetIn("n", "Opacity", "Reset on Opacity already at 100%");
    await resetIn("n", "Rotate", "Reset on Rotate already at 0°");
    await resetIn("b", "Rotate 3D", "Reset on Rotate 3D already at its start");

    await t.element("n").click();
    const rotate = t.page.locator('button[title="Rotate"]');
    await rotate.click();
    await t.page.getByRole("button", { name: "45°", exact: true }).click();
    await t.wait(200);
    t.ok("a real change still counts", (await t.saveLabel()) !== "Saved", await t.saveLabel());
    await t.page.getByRole("button", { name: "Reset", exact: true }).click();
    await t.wait(200);
    t.ok("Reset still takes a real change back", (await t.slider("Angle").inputValue()) === "0", await t.slider("Angle").inputValue());
  });

  await scenario("switching between kinds on one slide", [blank("s", mix())], async (t) => {
    await t.element("c").click();
    t.ok("a clock offers Set time, not Set date", (await t.setTime.count()) === 1 && (await t.setDate.count()) === 0);
    await t.setTime.click();
    await t.slider("Hour").waitFor();
    await t.element("m").click();
    t.ok("picking a calendar closes the time panel", (await t.slider("Hour").count()) === 0);
    t.ok("a calendar offers Set date, not Set time", (await t.setDate.count()) === 1 && (await t.setTime.count()) === 0);
    await t.setDate.click();
    await t.dateBox.waitFor();
    await t.selectDiagram("f");
    t.ok("picking a diagram closes the date panel", (await t.dateBox.count()) === 0);
    t.ok("a diagram offers its box styles, not Set date", (await t.toolbar.getByText("All boxes", { exact: true }).count()) === 1 && (await t.setDate.count()) === 0);
    await t.pickBox("f", "Two");
    await t.element("c").click();
    t.ok("picking a clock lets go of the picked box", (await t.outline.count()) === 0);

    await t.element("p").click({ modifiers: ["Shift"] });
    t.ok("two picked together offer neither Set time nor Set date", (await t.setTime.count()) === 0 && (await t.setDate.count()) === 0);
    await t.clickOutside();

    await t.element("c").click();
    await t.element("f").click({ modifiers: ["Shift"] });
    await t.page.keyboard.press("Control+g");
    await t.toolbar.getByText("Group of 2", { exact: true }).waitFor();
    t.ok("a clock and a diagram can be grouped", true);
    t.ok("a group shows no box buttons", (await t.diagramButtons.count()) === 0);
    const c0 = await t.element("c").boundingBox();
    const f0 = await t.element("f").boundingBox();
    await t.wait();
    await t.dragBy(c0, 30, 50);
    const c1 = await t.element("c").boundingBox();
    const f1 = await t.element("f").boundingBox();
    t.ok("dragging one moves both by the same amount", near(c1.x - c0.x, f1.x - f0.x, 1) && near(c1.y - c0.y, f1.y - f0.y, 1) && c1.y > c0.y + 10);
    await t.wait();
    await t.undo.click();
    await t.wait(150);
    const c2 = await t.element("c").boundingBox();
    const f2 = await t.element("f").boundingBox();
    t.ok("one undo puts both back", near(c2.y, c0.y, 1) && near(f2.y, f0.y, 1));
    await t.clickOutside();
    await t.element("c").click();
    await t.element("c").dblclick();
    t.ok("double-click picks the clock out of its group", await t.appears(t.setTime));
    t.ok(
      "saved: the group is kept",
      await t.save(async () => {
        const s = await t.savedSlide("s");
        const [a, b] = ["c", "f"].map((id) => s?.elements.find((e) => e.id === id));
        return !!a?.groupId && a.groupId === b?.groupId;
      }),
    );
  });

  await scenario("elements on top of each other", [blank("s", [flow("f", 100, 100, 600, 200), clock("c", 300, 100)])], async (t) => {
    const middle = await t.element("c").boundingBox();
    const point = [middle.x + middle.width / 2, middle.y + middle.height / 2];
    await t.page.mouse.click(...point);
    t.ok("a click on the clock on top picks the clock", await t.appears(t.setTime));
    t.ok("and not the diagram under it", (await t.diagramButtons.count()) === 0);
    await t.page.keyboard.press("Control+BracketLeft");
    await t.wait(150);
    await t.clickOutside();
    await t.page.mouse.click(...point);
    t.ok("sent behind, the same click picks the diagram", await t.appears(t.diagramButtons));
    t.ok("and Set time is gone", (await t.setTime.count()) === 0);
  });

  await scenario("undo across different kinds", [blank("s", mix())], async (t) => {
    await t.element("c").click();
    await t.setTime.click();
    await t.slider("Minute").fill("45");
    await t.readout("3:45").waitFor();
    await t.setTime.click();
    await t.wait();
    await t.selectDiagram("f");
    await t.typeIn("f", "Two", "Typed");
    await t.clickOutside();
    await t.wait();
    await t.element("m").click();
    await t.setDate.click();
    await t.dateBox.fill("2024-02-29");
    await t.readout("Thursday, February 29, 2024").waitFor();
    await t.setDate.click();
    await t.clickOutside();
    await t.wait();
    const state = async () => ({
      minute: (await handsIn(t.element("c"))).minute,
      text: (await t.texts("f"))[1],
      month: (await t.drawn("m")).find((x) => /\d{4}/.test(x)),
    });
    const at345 = handTips(3, 45).minute;
    const at330 = handTips(3, 30).minute;
    await t.undo.click();
    await t.wait(200);
    let s = await state();
    t.ok("undo 1 takes back the date only", s.month === "DECEMBER 2024" && s.text === "Typed" && s.minute === at345, JSON.stringify(s));
    await t.undo.click();
    await t.wait(200);
    s = await state();
    t.ok("undo 2 takes back the typing only", s.month === "DECEMBER 2024" && s.text === "Two" && s.minute === at345, JSON.stringify(s));
    await t.undo.click();
    await t.wait(200);
    s = await state();
    t.ok("undo 3 takes back the time", s.minute === at330, JSON.stringify(s));
    for (let i = 0; i < 3; i++) {
      await t.redo.click();
      await t.wait(200);
    }
    s = await state();
    t.ok("three redos bring all three back", s.month === "FEBRUARY 2024" && s.text === "Typed" && s.minute === at345, JSON.stringify(s));
  });

  await scenario("undo taking away what's picked", [blank("s", []), blank("s2", [flow("f", 100, 100)])], async (t) => {
    await t.page.locator('button[title="Elements"]').click();
    const cal = await t.addTile("s", "Month Calendar");
    await t.setDate.click();
    await t.dateBox.waitFor();
    await t.wait();
    await t.undo.click();
    await t.element(cal).waitFor({ state: "detached" });
    t.ok("undoing the new calendar closes its date panel", (await t.dateBox.count()) === 0);

    await t.goToSlide("s2");
    await t.selectDiagram("f");
    await t.pickBox("f", "Three");
    await t.button("Edit flowchart").click();
    await t.slider("Steps").fill("2");
    await t.wait(200);
    t.ok("a picked box removed by the slider leaves no outline", (await t.outline.count()) === 0);
    t.ok("the two others stay", (await t.boxes("f")).length === 2);
    await t.slider("Steps").fill("3");
    await t.wait(200);
    t.ok("adding it back still draws three", (await t.boxes("f")).length === 3);
    await t.button("Edit flowchart").click();
    await t.pickBox("f", "One");
    await t.page.keyboard.press("Delete");
    await t.wait(200);
    t.ok("Delete on a picked box keeps the diagram", (await t.element("f").count()) === 1 && (await t.texts("f")).join() === "Two,Step 3", (await t.texts("f")).join());
  });

  const treeOf = (root, branches) => ({ root: { text: root }, branches: branches.map(([label, ...leaves]) => ({ label: { text: label }, leaves: leaves.map((text) => ({ text })) })) });
  await scenario(
    "Delete on a picked box",
    [
      blank("s", [
        flow("f", 40, 40),
        item("cycle", "c", 600, 20, 300, 300, { cycle: { steps: ["Rain", "River", "Sea", "Cloud"].map((text) => ({ text })) } }),
        item("mind-map", "m", 940, 20, 320, 300, { mindMap: { center: { text: "Main" }, ideas: ["North", "South", "East"].map((text) => ({ text })) } }),
        item("tree-diagram", "t", 40, 300, 520, 300, { tree: treeOf("Top", [["Left", "Leaf"], ["Middle"], ["Right"]]) }),
        item("factor-tree", "k", 620, 360, 320, 320, { factorTree: { root: { text: "12", children: [{ text: "3" }, { text: "4", children: [{ text: "2" }, { text: "2" }] }] } } }),
      ]),
    ],
    async (t) => {
      const del = async () => {
        await t.page.keyboard.press("Delete");
        await t.wait(150);
      };
      const words = async (id) => (await t.texts(id)).slice().sort().join();
      const start = await t.boxNamed("f", "One");
      await t.selectDiagram("f");
      await t.pickBox("f", "Two");
      await del();
      t.ok("flowchart: only the picked box goes", (await t.texts("f")).join() === "One,Three", (await t.texts("f")).join());
      const after = await t.boxNamed("f", "One");
      t.ok("flowchart: the others stay where they are", near(after.screenX, start.screenX) && near(after.screenY, start.screenY), `${after.screenX - start.screenX}, ${after.screenY - start.screenY}`);
      t.ok("flowchart: the diagram stays selected with no box picked", (await t.diagramButtons.count()) > 0 && (await t.outline.count()) === 0);
      await t.wait();
      await t.undo.click();
      t.ok("flowchart: one undo brings the box back", await t.appears(t.page.locator('[data-element-id="f"] svg text', { hasText: "Two" }), 2500) && (await t.texts("f")).length === 3, (await t.texts("f")).join());
      await t.wait();
      await t.pickBox("f", "Three");
      await del();
      await t.wait();
      await t.pickBox("f", "One");
      await del();
      t.ok("flowchart: at its fewest boxes, Delete keeps them", (await t.texts("f")).join() === "One,Two", (await t.texts("f")).join());
      await t.page.keyboard.press("Escape");
      await t.wait(150);
      await t.clickOutside();

      await t.selectDiagram("c");
      await t.pickBox("c", "River");
      await del();
      t.ok("cycle: only the picked box goes", (await words("c")) === "Cloud,Rain,Sea", await words("c"));
      await t.wait();
      await t.pickBox("c", "Sea");
      await del();
      t.ok("cycle: at its fewest boxes, Delete keeps them", (await words("c")) === "Cloud,Rain,Sea", await words("c"));
      await t.clickOutside();

      await t.selectDiagram("m");
      await t.pickBox("m", "Main");
      await del();
      t.ok("mind map: the main idea stays", (await words("m")) === "East,Main,North,South", await words("m"));
      await t.pickBox("m", "South");
      await del();
      t.ok("mind map: only the picked idea goes", (await words("m")) === "East,Main,North", await words("m"));
      await t.clickOutside();

      await t.selectDiagram("t");
      await t.pickBox("t", "Top");
      await del();
      t.ok("tree: the top box stays", (await t.texts("t")).length === 5, (await t.texts("t")).join());
      await t.pickBox("t", "Leaf");
      await del();
      t.ok("tree: only the picked small box goes", (await words("t")) === "Left,Middle,Right,Top", await words("t"));
      await t.wait();
      await t.pickBox("t", "Right");
      await del();
      t.ok("tree: a picked branch goes", (await words("t")) === "Left,Middle,Top", await words("t"));
      await t.clickOutside();

      // A factor tree's buttons have their own names, so this picks it without selectDiagram.
      const twelve = await t.boxNamed("k", "12");
      await t.page.mouse.click(twelve.screenX, twelve.screenY);
      await t.button("Remove this pair").first().waitFor();
      await t.pickBox("k", "12");
      await del();
      t.ok("factor tree: the top number stays", (await t.texts("k")).length === 5, (await t.texts("k")).join());
      await t.pickBox("k", "3");
      await del();
      t.ok("factor tree: a number goes with its partner and what's under them, like its ×", (await t.texts("k")).join() === "12", (await t.texts("k")).join());
      await t.clickOutside();

      await t.selectDiagram("f");
      await t.pickBox("f", "One");
      await t.page.keyboard.press("Escape");
      await t.wait(150);
      await del();
      t.ok("with no box picked, Delete still removes the whole diagram", (await t.element("f").count()) === 0);
      t.ok(
        "saved: what's left of each",
        await t.save(async () => {
          const saved = await t.savedSlide("s");
          const of = (id) => saved?.elements.find((e) => e.id === id);
          return !of("f") && of("c")?.cycle?.steps.length === 3 && of("m")?.mindMap?.ideas.length === 2 && of("t")?.tree?.branches.length === 2 && of("t")?.tree?.branches[0].leaves.length === 0 && !of("k")?.factorTree?.root.children;
        }),
      );
    },
  );

  await scenario(
    "typing in a diagram box",
    [blank("s", [flow("a", 40, 40), flow("b", 40, 300, 480, 140, ["Alpha", "Beta"]), clock("c", 800, 100)])],
    async (t) => {
      const unselected = await t.boxNamed("a", "One");
      await t.page.mouse.dblclick(unselected.screenX, unselected.screenY);
      t.ok("double-click on a diagram not yet selected starts typing", await t.appears(t.textArea));
      if ((await t.textArea.count()) === 0) await t.startTyping("a", "One");
      await t.textArea.fill("Kept");
      const beta = await t.boxNamed("b", "Beta");
      await t.page.mouse.click(beta.screenX, beta.screenY);
      await t.textArea.waitFor({ state: "detached" });
      t.ok("clicking another diagram finishes the typing and keeps the text", (await t.texts("a"))[0] === "Kept", (await t.texts("a")).join());
      t.ok("the other diagram is the one selected now", await t.appears(t.diagramButtons));

      await t.clickOutside();
      await t.selectDiagram("a");
      await t.startTyping("a", "Two");
      await t.textArea.fill("Mid typing");
      t.ok(
        "Ctrl+S while still typing saves what's typed so far",
        await t.save(async () => (await t.savedOne("s", "a"))?.flowchart?.steps[1].text === "Mid typing"),
        JSON.stringify((await t.savedOne("s", "a"))?.flowchart?.steps[1]),
      );
      t.ok("and the box stays open", (await t.textArea.count()) === 1);
      await t.page.keyboard.press("Enter");
      await t.textArea.waitFor({ state: "detached" });

      await t.wait();
      await t.typeIn("a", "Three", "Undo me");
      await t.wait();
      await t.undo.click();
      await t.wait(200);
      t.ok("one undo takes the typed text back", (await t.texts("a"))[2] === "Three", (await t.texts("a")).join());
      await t.redo.click();
      await t.wait(200);
      t.ok("redo brings it back", (await t.texts("a"))[2] === "Undo me", (await t.texts("a")).join());

      const place = await t.element("a").boundingBox();
      await t.startTyping("a", "Undo me");
      for (const key of ["ArrowLeft", "ArrowUp", "Delete", "Backspace"]) await t.page.keyboard.press(key);
      const typedPlace = await t.element("a").boundingBox();
      t.ok("arrows, Delete and Backspace while typing only change the text", (await t.element("a").count()) === 1 && typedPlace.x === place.x && typedPlace.y === place.y);
      await t.textArea.fill("");
      await t.page.keyboard.type("abc");
      await t.wait();
      await t.page.keyboard.press("Control+z");
      await t.wait(150);
      t.ok("Ctrl+Z while typing undoes the typing, the diagram stays", (await t.textArea.count()) === 1 && (await t.textArea.inputValue()) !== "abc", await t.textArea.inputValue());
      await t.textArea.fill("🦋 Egg");
      await t.page.keyboard.press("Enter");
      await t.textArea.waitFor({ state: "detached" });
      t.ok("an emoji shows", (await t.texts("a"))[2].includes("🦋"), (await t.texts("a"))[2]);

      // Text of only spaces has no size on screen, so the box's spot is taken before it's emptied.
      const spot = (await t.boxes("a"))[2];
      await t.typeIn("a", (await t.texts("a"))[2], "   ");
      t.ok("spaces only: the box stays", (await t.boxes("a")).length === 3, (await t.texts("a")).join("|"));
      await t.page.mouse.dblclick(spot.screenX, spot.screenY);
      t.ok("the box can still be typed in afterwards", await t.appears(t.textArea));
      if ((await t.textArea.count()) === 0) throw new Error("the blank box can't be opened");
      await t.textArea.fill(Array.from({ length: 12 }, (_, i) => `line ${i}`).join("\n"));
      await t.page.keyboard.press("Enter");
      await t.textArea.waitFor({ state: "detached" });
      const many = (await t.boxes("a"))[2];
      t.ok("12 lines shrink to fit", many.lines === 12 && many.size >= 1 && many.size < 12, JSON.stringify(many));

      const manyText = many.text;
      await t.page.mouse.dblclick(many.screenX, many.screenY);
      await t.textArea.waitFor();
      await t.textArea.fill("");
      const started = Date.now();
      await t.page.keyboard.insertText("word ".repeat(12_000));
      const length = (await t.textArea.inputValue()).length;
      t.ok("a 60,000 letter paste stops at the 50,000 limit", length === 50_000, String(length));
      await t.page.keyboard.press("Enter");
      await t.textArea.waitFor({ state: "detached" });
      const took = Date.now() - started;
      t.ok("a 50,000 letter box stays quick", took < 8000, `${took} ms`);
      t.ok(
        "a 50,000 letter box saves",
        await t.save(async () => (await t.savedOne("s", "a"))?.flowchart?.steps[2].text.length === 50_000),
        `old text was ${manyText.length}`,
      );
    },
  );

  await scenario("diagrams while zoomed", [blank("s", [flow("f", 60, 60)])], async (t) => {
    await t.button("Elements").click();
    await t.wait(300);
    const narrowed = await t.page.locator('[data-slide-id="s"]').evaluate((slide) => {
      const area = slide.closest(".overflow-y-auto");
      const [s, a] = [slide.getBoundingClientRect(), area.getBoundingClientRect()];
      return Math.round(s.left + s.width / 2 - (a.left + area.clientWidth / 2));
    });
    t.ok("a side panel narrowing the work area keeps the slide centered", near(narrowed, 0, 2), String(narrowed));
    await t.button("Elements").click();
    await t.wait(300);
    for (const zoom of [0.5, 1.5]) {
      await t.page.locator('input[title^="Zoom"]').fill(String(zoom));
      await t.wait(200);
      const place = await t.page.locator('[data-slide-id="s"]').evaluate((slide) => {
        const area = slide.closest(".overflow-y-auto");
        const [s, a] = [slide.getBoundingClientRect(), area.getBoundingClientRect()];
        return { off: Math.round(s.left + s.width / 2 - (a.left + area.clientWidth / 2)), extra: area.scrollWidth - area.clientWidth };
      });
      t.ok(`at ${zoom * 100}% the slide opens centered`, near(place.off, 0, 2), JSON.stringify(place));
      if (zoom < 1) t.ok("a slide that fits needs no sideways scrolling", place.extra <= 0, JSON.stringify(place));
      await t.element("f").evaluate((el) => el.scrollIntoView({ block: "center", inline: "center" }));
      await t.wait(200);
      // Scrolled as far left as it goes, the slide's left edge must be reachable.
      const reach = await t.page.locator('[data-slide-id="s"]').evaluate((slide) => {
        let box = slide.parentElement;
        while (box && !(box.scrollWidth > box.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(box).overflowX))) box = box.parentElement;
        if (!box) return { scrolls: false, slideLeft: slide.getBoundingClientRect().left, areaLeft: 0 };
        const before = box.scrollLeft;
        box.scrollLeft = 0;
        const result = { scrolls: true, slideLeft: slide.getBoundingClientRect().left, areaLeft: box.getBoundingClientRect().left };
        box.scrollLeft = before;
        return result;
      });
      t.ok(`at ${zoom * 100}% the slide's left edge can be scrolled to`, reach.slideLeft >= reach.areaLeft - 1, JSON.stringify(reach));
      const lastBox = (await t.boxes("f")).at(-1);
      await t.page.mouse.click(lastBox.screenX, lastBox.screenY);
      await t.diagramButtons.first().waitFor();
      await t.pickBox("f", "Two");
      const start = await t.boxes("f");
      await t.wait();
      await t.dragBy(await t.outline.boundingBox(), 50, 60);
      const end = await t.boxes("f");
      t.ok(`at ${zoom * 100}% a dragged box follows the mouse`, near(end[1].screenX - start[1].screenX, 50, 4) && near(end[1].screenY - start[1].screenY, 60, 4), `${end[1].screenX - start[1].screenX}, ${end[1].screenY - start[1].screenY}`);
      t.ok(`at ${zoom * 100}% the others stay`, near(end[2].screenX, start[2].screenX, 3) && near(end[2].screenY, start[2].screenY, 3));
      await t.wait();
      await t.undo.click();
      await t.wait(200);
      const handle = (await Promise.all((await t.page.locator('[title="Change width"]').all()).map((h) => h.boundingBox()))).sort((a, b) => a.x - b.x).at(-1);
      const width = (await t.outline.boundingBox()).width;
      await t.wait();
      await t.dragBy(handle, 30, 0);
      const grown = (await t.outline.boundingBox()).width;
      t.ok(`at ${zoom * 100}% a side handle follows the mouse`, near(grown - width, 30, 4), `${grown - width}`);
      await t.wait();
      await t.undo.click();
      await t.wait(200);
      await t.typeIn("f", "Three", `Zoom ${zoom}`);
      t.ok(`at ${zoom * 100}% double-click types in the box under the mouse`, (await t.texts("f"))[2] === `Zoom ${zoom}`, (await t.texts("f")).join());
      await t.wait();
      await t.undo.click();
      await t.wait(200);
      await t.clickOutside();
    }
  });

  await scenario(
    "turned and flipped diagrams",
    [
      blank("r1", [flow("t45", 400, 240, 420, 120, ["One", "Two", "Three"], { rotation: 45 })]),
      blank("r2", [flow("t90", 400, 240, 420, 120, ["One", "Two", "Three"], { rotation: -90 })]),
      blank("r3", [flow("tf", 400, 240, 420, 120, ["One", "Two", "Three"], { rotation: 30, flipX: true })]),
      blank("r4", [flow("ff", 400, 240, 420, 120, ["One", "Two", "Three"], { rotation: 120, flipX: true, flipY: true })]),
    ],
    async (t) => {
      for (const [slide, id] of [["r1", "t45"], ["r2", "t90"], ["r3", "tf"], ["r4", "ff"]]) {
        await t.goToSlide(slide);
        await t.selectDiagram(id);
        await t.pickBox(id, "Two");
        const start = await t.boxes(id);
        await t.wait();
        await t.dragBy(await t.outline.boundingBox(), 40, 30);
        const end = await t.boxes(id);
        t.ok(`${id}: a dragged box follows the mouse`, near(end[1].screenX - start[1].screenX, 40, 5) && near(end[1].screenY - start[1].screenY, 30, 5), `${end[1].screenX - start[1].screenX}, ${end[1].screenY - start[1].screenY}`);
        t.ok(`${id}: the others stay`, near(end[0].screenX, start[0].screenX, 4) && near(end[2].screenY, start[2].screenY, 4));
        await t.typeIn(id, "One", "New");
        t.ok(`${id}: double-click types in the box under the mouse`, (await t.texts(id))[0] === "New", (await t.texts(id)).join());
        await t.clickOutside();
      }
    },
  );

  await scenario("a box dragged very far", [blank("s", [flow("f", 40, 300)])], async (t) => {
    // Zoomed out, so every drag starts on a box that's still on screen.
    await t.page.locator('input[title^="Zoom"]').fill("0.25");
    await t.wait(300);
    await t.selectDiagram("f");
    await t.pickBox("f", "Three");
    for (let i = 0; i < 4; i++) {
      await t.element("f").evaluate((el) => el.scrollIntoView({ block: "center", inline: "start" }));
      await t.dragBy(await t.outline.boundingBox(), 250, 0);
      await t.wait(150);
    }
    await t.page.waitForTimeout(200);
    t.ok(
      "saved: a box dragged to the limit is still valid",
      await t.save(async () => {
        const step = (await t.savedOne("s", "f"))?.flowchart?.steps[2];
        return typeof step?.x === "number" && step.x <= 2000;
      }),
      JSON.stringify((await t.savedOne("s", "f"))?.flowchart?.steps[2]),
    );
    await t.page.reload({ timeout: 120_000 });
    await t.element("f").waitFor();
    t.ok("it opens again", (await t.boxes("f")).length === 3);
    await t.selectDiagram("f");
    await t.button("Edit flowchart").click();
    await t.page.getByRole("button", { name: "Tidy up", exact: true }).click();
    await t.wait(300);
    await t.button("Edit flowchart").click();
    const after = await t.element("f").boundingBox();
    const slide = await t.page.locator('[data-slide-id="s"]').boundingBox();
    t.ok("Tidy up brings it back onto the slide", after.x + after.width <= slide.x + slide.width + 2, `${after.width} wide`);
  });

  await scenario("box text sizes at their limits", [blank("s", [flow("f", 40, 40)])], async (t) => {
    await t.selectDiagram("f");
    const bigger = t.toolbar.locator('button[title="Bigger text"]');
    const smaller = t.toolbar.locator('button[title="Smaller text"]');
    const size = async () => (await t.toolbar.locator('button[title^="Text size"]').innerText()).trim();
    for (let i = 0; i < 14; i++) await bigger.click();
    t.ok("Bigger stops at 36", (await size()) === "36", await size());
    for (let i = 0; i < 14; i++) await smaller.click();
    t.ok("Smaller stops at 6", (await size()) === "6", await size());
    t.ok(
      "saved: the size at the limit",
      await t.save(async () => (await t.savedOne("s", "f"))?.flowchart?.steps.every((step) => step.fontSize === 6)),
      JSON.stringify((await t.savedOne("s", "f"))?.flowchart?.steps[0]),
    );
  });

  await scenario("copy, paste and duplicate", [blank("a", mix()), blank("b", [])], async (t) => {
    const onB = () => t.page.locator('[data-slide-id="b"] [data-element-id]').evaluateAll((els) => els.map((el) => el.dataset.elementId));
    const paste = async () => {
      const before = await onB();
      await t.page.keyboard.press("Control+v");
      for (let i = 0; i < 40; i++) {
        const added = (await onB()).find((id) => !before.includes(id));
        if (added) return added;
        await t.page.waitForTimeout(100);
      }
      throw new Error("paste added nothing");
    };
    const copyOnto = async (id) => {
      await t.goToSlide("a");
      await t.element(id).click();
      await t.page.keyboard.press("Control+c");
      await t.goToSlide("b");
      return paste();
    };
    const c = await copyOnto("c");
    t.ok("a pasted clock keeps its time", sameHands(await handsIn(t.element(c)), handTips(3, 30)));
    await t.setTime.click();
    await t.slider("Minute").fill("50");
    await t.readout("3:50").waitFor();
    await t.setTime.click();
    t.ok("changing the pasted clock leaves the first one", sameHands(await handsIn(t.element("c")), handTips(3, 30)));

    const m = await copyOnto("m");
    t.ok("a pasted calendar keeps its date", (await t.drawn(m)).includes("DECEMBER 2024"));
    await t.setDate.click();
    await t.dateBox.fill("2024-02-29");
    await t.readout("Thursday, February 29, 2024").waitFor();
    await t.setDate.click();
    t.ok("changing the pasted calendar leaves the first one", (await t.drawn("m")).includes("DECEMBER 2024"));

    await t.goToSlide("a");
    await t.selectDiagram("f");
    await t.page.keyboard.press("Control+c");
    await t.goToSlide("b");
    const f = await paste();
    t.ok("a pasted diagram keeps its boxes", (await t.texts(f)).join() === "One,Two,Three", (await t.texts(f)).join());
    await t.typeIn(f, "Two", "Changed");
    t.ok("changing the pasted diagram leaves the first one", (await t.texts("f"))[1] === "Two");

    await t.goToSlide("a");
    await t.button("Duplicate slide").first().click();
    await t.page.locator("[data-slide-id]").nth(2).waitFor();
    const ids = await t.page.locator("[data-slide-id]").evaluateAll((list) => list.map((s) => s.dataset.slideId));
    const copyId = ids.find((id) => !["a", "b"].includes(id));
    const copied = t.page.locator(`[data-slide-id="${copyId}"]`);
    const copiedIds = await copied.locator("[data-element-id]").evaluateAll((list) => list.map((n) => n.dataset.elementId));
    t.ok("a duplicated slide has all 5", copiedIds.length === 5, String(copiedIds.length));
    t.ok("with new element ids", !copiedIds.some((id) => ["f", "c", "d", "p", "m"].includes(id)), copiedIds.join());
    t.ok(
      "saved: pasted and duplicated values",
      await t.save(async () => {
        const row = await t.savedSlide(copyId);
        const b = await t.savedSlide("b");
        return row?.elements.length === 5 && b?.elements.length === 3 && b.elements.some((e) => e.calendarDate?.day === 29);
      }),
    );
  });

  await scenario(
    "inside the question and answer boxes",
    [
      slideOf(
        "q",
        "choice",
        [
          clock("c", 20, 20, { hours: 7, minutes: 15 }, { containerId: "question", width: 120, height: 120 }),
          month("m", 200, 10, D, { containerId: "question", width: 150, height: 150 }),
          flow("f", 10, 10, 280, 90, ["A", "B", "C"], { containerId: "q-a" }),
          calPage("p", 10, 10, D, { containerId: "q-b", width: 100, height: 100 }),
        ],
        { questionHeight: 260 },
      ),
    ],
    async (t) => {
      const area = await t.page.locator('[data-slide-id="q"] [data-container-id="question"]').boundingBox();
      await t.element("c").click();
      await t.setTime.click();
      await t.slider("Minute").fill("45");
      await t.readout("7:45").waitFor();
      await t.setTime.click();
      t.ok("a clock in the question box takes a new time", sameHands(await handsIn(t.element("c")), handTips(7, 45)));
      await t.dragBy(await t.element("c").boundingBox(), 1500, 0);
      const moved = await t.element("c").boundingBox();
      const over = moved.x + moved.width - (area.x + area.width);
      t.ok("a clock stops at the question box's edge", over <= 4, `${over.toFixed(1)} px past its outer edge; its two 1.5 px borders make up to 3`);
      await t.clickOutside();
      await t.selectDiagram("f");
      await t.typeIn("f", "B", "In option");
      t.ok("typing works in an answer box", (await t.texts("f"))[1] === "In option");
      await t.clickOutside();
      await t.element("p").click();
      await t.setDate.click();
      await t.dateBox.fill("2024-02-29");
      await t.readout("Thursday, February 29, 2024").waitFor();
      await t.setDate.click();
      t.ok(
        "saved: each stays in its own box",
        await t.save(async () => {
          const s = await t.savedSlide("q");
          const by = (id) => s?.elements.find((e) => e.id === id);
          return by("c")?.clockTime?.minutes === 45 && by("c")?.containerId === "question" && by("f")?.containerId === "q-a" && by("p")?.containerId === "q-b" && by("p")?.calendarDate?.day === 29;
        }),
      );
    },
  );

  await scenario(
    "saved before these fields existed",
    [blank("s", [item("clock", "c", 100, 100, 200, 200), item("digital-clock", "d", 400, 100, 200, 200), item("calendar-page", "p", 700, 100, 200, 200), item("month-calendar", "m", 1000, 100, 240, 240)])],
    async (t) => {
      t.ok("a clock with no time shows 10:10", sameHands(await handsIn(t.element("c")), handTips(10, 10)));
      t.ok("a digital clock with no time shows 10:10 AM", (await t.drawn("d")).includes("10:10AM"), (await t.drawn("d")).join());
      t.ok("a calendar with no date shows 1 January 2026", (await t.drawn("m")).includes("JANUARY 2026"), (await t.drawn("m")).join());
      t.ok("opening counts as no change", (await t.saveLabel()) === "Saved", await t.saveLabel());
      await t.element("d").click();
      await t.setTime.click();
      await t.page.getByRole("button", { name: "PM", exact: true }).click();
      await t.readout("10:10 PM").waitFor();
      await t.setTime.click();
      await t.element("m").click();
      await t.setDate.click();
      await t.dateBox.fill("2024-02-29");
      await t.readout("Thursday, February 29, 2024").waitFor();
      await t.setDate.click();
      t.ok(
        "it can be given a time and a date, and saved",
        await t.save(async () => {
          const s = await t.savedSlide("s");
          const by = (id) => s?.elements.find((e) => e.id === id);
          return by("d")?.clockTime?.pm === true && by("d")?.clockTime?.hours === 10 && by("m")?.calendarDate?.day === 29;
        }),
      );
    },
  );

  console.log("\n── bad saved data");
  const BAD = [
    ["30 February", { calendarDate: { year: 2026, month: 2, day: 30 } }, "month-calendar"],
    ["month 13", { calendarDate: { year: 2026, month: 13, day: 1 } }, "calendar-page"],
    ["year 1800", { calendarDate: { year: 1800, month: 1, day: 1 } }, "month-calendar"],
    ["a year as text", { calendarDate: { year: "2026", month: 1, day: 1 } }, "calendar-page"],
    ["an empty date (null)", { calendarDate: null }, "month-calendar"],
    ["a date as text", { calendarDate: "2026-01-01" }, "calendar-page"],
    ["a clock with null", { clockTime: null }, "clock"],
    ["a clock at 13:61", { clockTime: { hours: 13, minutes: 61 } }, "digital-clock"],
    ["a clock with text", { clockTime: "3:30" }, "clock"],
    ["a null flowchart", { flowchart: null }, "flowchart"],
    ["a bad date on a clock", { calendarDate: { year: 2026, month: 2, day: 30 } }, "clock"],
  ];
  for (const [name, fields, assetId] of BAD) await opensWith(name, item(assetId, "bad", 700, 100, 240, 240, fields));

  // Every field a diagram, clock or calendar can save, at its limits: a save after opening must not lose or change any.
  const full = [
    item("flowchart", "ff", 40, 20, 500, 200, {
      rotation: 12,
      opacity: 80,
      flipY: true,
      flowchart: {
        vertical: true,
        steps: [
          { text: "Styled", x: 2000, y: -2000, width: 400, height: 300, fill: "#FF0000", border: "none", borderWidth: 8, textColor: "#00FF00", fontSize: 36, shape: "circle" },
          { text: "Small", x: 0, y: 0, width: 24, height: 16, fill: "none", border: "#0000FF", borderWidth: 1, fontSize: 6 },
        ],
      },
    }),
    item("cycle", "cy", 40, 400, 200, 200, { flipX: true, cycle: { steps: [{ text: "A" }, { text: "B" }, { text: "C" }] } }),
    item("mind-map", "mm", 260, 400, 260, 200, { mindMap: { center: { text: "Hub" }, ideas: [{ text: "X" }, { text: "Y" }] } }),
    item("tree", "tr", 540, 400, 260, 200, { tree: { root: { text: "R" }, branches: [{ label: { text: "L1" }, leaves: [{ text: "x" }] }, { label: { text: "L2" }, leaves: [] }] } }),
    item("factor-tree", "ft", 820, 400, 260, 200, { factorTree: { root: { text: "12", children: [{ text: "3" }, { text: "4" }] } } }),
    clock("cl", 600, 20, { hours: 12, minutes: 59 }, { groupId: "g1", opacity: 50 }),
    digital("di", 820, 20, { hours: 12, minutes: 0, pm: true }, { groupId: "g1", rotation: -30 }),
    calPage("pa", 1040, 20, { year: 1900, month: 1, day: 1 }, { flipX: true }),
    month("mo", 1040, 240, { year: 2100, month: 12, day: 31 }),
  ];
  await scenario("nothing lost when saved again", [blank("s", full), blank("other", [clock("touch", 100, 100)])], async (t) => {
    await t.goToSlide("other");
    await t.element("touch").click();
    await t.setTime.click();
    await t.slider("Minute").fill("45");
    await t.readout("3:45").waitFor();
    await t.setTime.click();
    t.ok("the save goes through", await t.save(async () => (await t.savedOne("other", "touch"))?.clockTime?.minutes === 45));
    const after = await t.savedSlide("s");
    for (const before of full) {
      const now = after.elements.find((e) => e.id === before.id);
      t.ok(`${before.assetId} (${before.id}) is unchanged`, same(before, now), same(before, now) ? "" : JSON.stringify(now).slice(0, 300));
    }
    t.ok("their order on the slide is unchanged", same(after.elements.map((e) => e.id), full.map((e) => e.id)));
  });

  const showSlides = [blank("s", mix()), blank("s2", [flow("f2", 100, 100, 480, 140, ["Second", "Slide"])])];
  await scenario("present, all slides and the view page", showSlides, async (t) => {
    await t.button("All slides").click();
    // The grid's code loads when it's opened, so this waits for the grid itself before pressing anything.
    const gridTitle = t.page.getByRole("heading", { name: "All slides (2)" });
    await gridTitle.waitFor({ timeout: 60_000 });
    await t.wait(300);
    const grid = t.page.locator(".fixed.inset-0.z-50").filter({ has: gridTitle }).locator("svg text", { hasText: "DECEMBER 2024" });
    t.ok("the all-slides grid draws the calendar", await t.appears(grid));
    await t.page.keyboard.press("Escape");
    const closed = await gridTitle.waitFor({ state: "detached", timeout: 3000 }).then(() => true, () => false);
    t.ok("Escape closes the all-slides grid", closed);
    if (!closed) {
      await t.button("Close (Esc)").first().click();
      await gridTitle.waitFor({ state: "detached" });
    }

    await t.button("Present (fullscreen)").first().click();
    const screen = t.page.locator(".fixed.inset-0.z-50").filter({ has: t.button("Exit presentation (Esc)") });
    const shown = screen.locator('[aria-hidden="false"]');
    await shown.locator("svg text", { hasText: "DECEMBER 2024" }).waitFor();
    const words = await shown.locator("svg text").allTextContents();
    t.ok("presenting: every kind draws together", ["One", "9:05PM", "DECEMBER", "WEDNESDAY", "DECEMBER 2024"].every((w) => words.includes(w)), words.join("|").slice(0, 200));
    t.ok("presenting: the hands point at 3:30", sameHands(await handsIn(shown), handTips(3, 30)));
    await t.page.screenshot({ path: `${SHOTS}ddt-present.png` });
    for (const key of ["Delete", "Control+z", "Control+s"]) await t.page.keyboard.press(key);
    await t.wait(300);
    t.ok("presenting: Delete, Ctrl+Z and Ctrl+S do nothing to the slide", (await shown.locator("svg text", { hasText: "DECEMBER 2024" }).count()) === 1);
    await t.page.keyboard.press("ArrowRight");
    t.ok("presenting: → goes to the next slide", await t.appears(shown.locator("svg text", { hasText: "Second" })));
    await t.page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await t.page.mouse.move(800, 300);
    await t.page.mouse.move(810, 310);
    await t.button("Exit presentation (Esc)").click();
    await screen.waitFor({ state: "detached" });
    t.ok("presenting counts as no change", (await t.saveLabel()) === "Saved", await t.saveLabel());

    await t.page.goto(`${APP}/presentation/${t.presentationId}`, { timeout: 120_000 });
    t.ok("the view page draws the calendar", await t.appears(t.page.locator("svg text", { hasText: "DECEMBER 2024" }), 30_000));
    t.ok("the view page draws the diagram", (await t.page.locator("svg text", { hasText: "Three" }).count()) >= 1);
  });

  // A small laptop: the toolbars and panels stay on screen for things at the slide's corners.
  const small = await loggedIn(browser, teacher, { width: 1280, height: 720 });
  await scenario(
    "toolbars and panels on a small screen",
    [blank("s", [flow("f", 10, 560, 480, 140), clock("c", 1070, 10), month("m", 1030, 470, D)])],
    async (t) => {
      const window = { width: 1280, height: 720 };
      const onScreen = (b) => !!b && b.x >= 0 && b.y >= 0 && b.x + b.width <= window.width && b.y + b.height <= window.height;
      await t.element("m").click();
      t.ok("the toolbar fits with a calendar picked", onScreen(await t.toolbar.boundingBox()), JSON.stringify(await t.toolbar.boundingBox()));
      await t.setDate.click();
      await t.dateBox.waitFor();
      t.ok("the date box is on screen", onScreen(await t.dateBox.boundingBox()), JSON.stringify(await t.dateBox.boundingBox()));
      await t.setDate.click();
      await t.element("c").click();
      t.ok("the toolbar fits with a clock picked", onScreen(await t.toolbar.boundingBox()), JSON.stringify(await t.toolbar.boundingBox()));
      await t.setTime.click();
      await t.slider("Minute").waitFor();
      t.ok("the time sliders are on screen", onScreen(await t.slider("Minute").boundingBox()), JSON.stringify(await t.slider("Minute").boundingBox()));
      await t.setTime.click();
      await t.selectDiagram("f");
      t.ok("the toolbar fits with a diagram picked", onScreen(await t.toolbar.boundingBox()), JSON.stringify(await t.toolbar.boundingBox()));
      await t.button("Edit flowchart").click();
      await t.slider("Steps").waitFor();
      t.ok("the diagram's panel is on screen", onScreen(await t.slider("Steps").boundingBox()), JSON.stringify(await t.slider("Steps").boundingBox()));
    },
    { context: small },
  );
  await small.close();

  // New Year's Eve in two places at one moment: a new calendar and Today follow the teacher's own computer. The clock
  // is set in the past, so the login session doesn't look expired. The German browser must still draw English words.
  const MOMENT = new Date("2025-12-31T16:30:00Z");
  for (const [zone, locale, want, monthWord, label] of [
    ["Asia/Manila", "de-DE", "2026-01-01", "JANUARY 2026", "Manila, already next year"],
    ["Pacific/Honolulu", "en-US", "2025-12-31", "DECEMBER 2025", "Honolulu, still the old year"],
  ]) {
    const context = await loggedIn(browser, teacher, { width: 1600, height: 1000 }, { timezoneId: zone, locale });
    await scenario(
      `time zone ${zone}`,
      [blank("s", [])],
      async (t) => {
        await t.page.locator('button[title="Elements"]').click();
        const added = await t.addTile("s", "Month Calendar");
        await t.setDate.click();
        await t.dateBox.waitFor();
        t.ok(`${label}: a new calendar starts on that day`, (await t.dateBox.inputValue()) === want, await t.dateBox.inputValue());
        t.ok(`${label}: it draws that month in English`, (await t.drawn(added)).includes(monthWord), (await t.drawn(added)).slice(0, 2).join());
        await t.dateBox.fill("2024-02-29");
        t.ok(`${label}: the weekday isn't a day off`, await t.appears(t.readout("Thursday, February 29, 2024")));
        await t.page.getByRole("button", { name: "Today", exact: true }).click();
        t.ok(`${label}: Today goes back to that day`, (await t.dateBox.inputValue()) === want, await t.dateBox.inputValue());
      },
      { context, before: (page) => page.clock.setFixedTime(MOMENT) },
    );
    await context.close();
  }
} catch (error) {
  check("run finished without an exception", false, String(error).split("\n").slice(0, 8).join(" "));
} finally {
  await browser.close();
  await deleteTeacher(teacher);
}

finish();
