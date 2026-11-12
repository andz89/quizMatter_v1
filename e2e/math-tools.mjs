// The math tools (number lines, fractions, counting frame, base-ten blocks, thermometer, bar graph, protractor, rulers,
// set squares, dice, coins): each panel at its limits, then saved and opened again. Every scenario gets its own
// presentation and page, so one failure can't hide the next. ONLY="bar graph|undo" runs just the scenarios that match.
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { APP, SHOTS, api, check, deleteTeacher, finish, loggedIn, makeTeacher } from "./lib.mjs";

const UNDO_STEP_MS = 700;
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const near = (a, b, within = 1) => Math.abs(a - b) <= within;
const canon = (v) =>
  Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const range = (from, count, step = 1) => Array.from({ length: count }, (_, i) => String(from + i * step));

// ─── What goes on the slides ─────────────────────────────────────────────────────────────────────────────────
const COLOR = "#3B82F6";
const slideOf = (id, type, elements) => ({
  id,
  type,
  question: "",
  layout: "grid",
  options: ["a", "b", "c", "d"].map((o) => ({ id: `${id}-${o}`, text: type === "blank" ? "" : o.toUpperCase() })),
  correctOptionId: null,
  elements,
  questionHeight: 200,
});
const blank = (id, elements) => slideOf(id, "blank", elements);
const item = (assetId, id, x, y, width, height, extra = {}) => ({ id, assetId, x, y, width, height, color: COLOR, containerId: null, ...extra });
const numberLine = (id, x, y, extra) => item("number-line", id, x, y, 520, 104, extra);
const integerLine = (id, x, y, extra) => item("integer-number-line", id, x, y, 780, 156, extra);
const bar = (id, x, y, extra) => item("fraction-bar", id, x, y, 480, 96, extra);
const circle = (id, x, y, extra) => item("fraction-circle", id, x, y, 200, 200, extra);
const written = (id, x, y, extra) => item("fraction-number", id, x, y, 200, 200, extra);
const frame = (id, x, y, extra) => item("ten-frame", id, x, y, 220, 92, extra);
const blocks = (id, x, y, extra) => item("base-ten-blocks", id, x, y, 280, 144, extra);
const thermometer = (id, x, y, extra) => item("thermometer", id, x, y, 90, 300, extra);
const graph = (id, x, y, extra) => item("bar-graph", id, x, y, 400, 300, extra);
const protractor = (id, x, y, extra) => item("protractor", id, x, y, 400, 220, extra);

// ─── The tools every scenario uses ───────────────────────────────────────────────────────────────────────────
function tools(page, presentationId, name) {
  const button = (title) => page.locator(`button[title="${title}"]`);
  const element = (id) => page.locator(`[data-element-id="${id}"]`).first();
  const ok = (label, passed, detail) => check(`${name}: ${label}`, passed, detail);
  const wait = (ms = UNDO_STEP_MS) => page.waitForTimeout(ms);
  const undo = button("Undo (Ctrl+Z)");
  const redo = button("Redo (Ctrl+Y)");
  const saveButton = button("Save (Ctrl+S)");
  const labelled = (label) => page.locator("label", { hasText: new RegExp(`^${label}`) });
  const slider = (label) => labelled(label).locator('input[type="range"]');
  const numberBox = (label) => labelled(label).locator('input[type="number"]');
  const panel = (title) => button(title).locator("xpath=following-sibling::div");
  const section = (title, label) => panel(title).locator("div").filter({ has: page.getByText(label, { exact: true }) }).last();
  const chip = (scope, text) => scope.getByRole("button", { name: text, exact: true });
  const isOn = async (locator) => (await locator.getAttribute("class")).includes("bg-accent");
  const readout = (text) => page.getByText(text, { exact: true }).first();
  const drawn = (id) => element(id).locator("svg text").allTextContents();
  const appears = (locator, timeout = 4000) => locator.first().waitFor({ timeout }).then(() => true, () => false);
  const saveLabel = async () => (await saveButton.innerText()).trim();
  const savedSlide = async (id = "s") => (await api(`/rest/v1/slides?presentation_id=eq.${presentationId}&id=eq.${id}&select=data`))[0]?.data;
  const savedOne = async (id, slideId = "s") => (await savedSlide(slideId))?.elements.find((e) => e.id === id);

  /** Picks the element and opens one of its toolbar panels. */
  async function open(id, title) {
    await element(id).click();
    await button(title).click();
    await panel(title).waitFor();
  }
  /** Ctrl+S, then waits for `test` to be true of the database (a save already running ignores Ctrl+S). */
  async function save(test) {
    await page.keyboard.press("Control+s");
    for (let i = 0; i < 100; i++) {
      if (await test()) return true;
      await page.waitForTimeout(250);
    }
    return false;
  }
  async function reload(id) {
    await page.reload({ timeout: 120_000 });
    await element(id).waitFor({ timeout: 60_000 });
    await wait(300);
  }
  /** The drawn words, left to right: none overlaps the next, and all stay inside the drawing. */
  const wordsFit = (id) =>
    element(id).evaluate((el) => {
      const svg = el.querySelector("svg");
      const [, , width] = svg.getAttribute("viewBox").split(" ").map(Number);
      const boxes = [...svg.querySelectorAll("text")].map((t) => t.getBBox()).sort((a, b) => a.x - b.x);
      return boxes.every((b, i) => b.x >= -0.5 && b.x + b.width <= width + 0.5 && (i === 0 || boxes[i - 1].x + boxes[i - 1].width <= b.x + 0.5));
    });
  const place = async (id) => {
    const box = await element(id).boundingBox();
    return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
  };
  return {
    page, button, element, ok, wait, undo, redo, saveButton, slider, numberBox, panel, section, chip, isOn, readout, drawn, appears, saveLabel,
    savedSlide, savedOne, open, save, reload, wordsFit, place, presentationId,
  };
}

/** How a tool's drawing reads, worked out from the SVG alone. */
const drawing = {
  barParts: (t, id) => t.element(id).locator("svg rect").evaluateAll((list, color) => ({ parts: list.length, shaded: list.filter((r) => r.getAttribute("fill") === color).length }), COLOR),
  circleParts: (t, id) => t.element(id).locator('svg path[stroke-linejoin="round"]').evaluateAll((list, color) => ({ parts: list.length, shaded: list.filter((p) => p.getAttribute("fill") === color).length }), COLOR),
  frame: async (t, id) => ({ boxes: await t.element(id).locator("svg rect").count(), dots: await t.element(id).locator("svg circle").count() }),
  blocks: (t, id) =>
    t.element(id).locator("svg rect").evaluateAll((list) => {
      const size = (r) => `${r.getAttribute("width")}x${r.getAttribute("height")}`;
      return { flats: list.filter((r) => size(r) === "40x40").length, rods: list.filter((r) => size(r) === "4x40").length, cubes: list.filter((r) => size(r) === "4x4").length };
    }),
  liquidTop: (t, id) => t.element(id).locator('svg rect[x="26"]').getAttribute("y").then(Number),
  bars: (t, id) => t.element(id).locator(`svg rect[fill="${COLOR}"]`).evaluateAll((list) => list.map((r) => Math.round(Number(r.getAttribute("height")) * 10) / 10)),
  tip: async (t, id) => {
    const hand = t.element(id).locator('svg line[stroke-width="2"][stroke-linecap="round"]').nth(1);
    return { x: Number(await hand.getAttribute("x2")), y: Number(await hand.getAttribute("y2")) };
  },
};

async function makePresentation(title, slides) {
  const id = randomUUID();
  await api("/rest/v1/presentations", { method: "POST", body: JSON.stringify({ id, owner_id: teacher.id, title, data_version: 3 }) });
  await api("/rest/v1/slides", { method: "POST", body: JSON.stringify(slides.map((data, position) => ({ presentation_id: id, id: data.id, position, data }))) });
  return id;
}
const removePresentation = (id) => api(`/rest/v1/presentations?id=eq.${id}`, { method: "DELETE" }).catch(() => {});

async function scenario(name, slides, work, { context = mainContext } = {}) {
  if (ONLY && !ONLY.test(name)) return;
  console.log(`\n── ${name}`);
  const id = await makePresentation(`e2e ${name}`, slides);
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && /hydrat/i.test(m.text()) && errors.push(m.text().slice(0, 300)));
  try {
    await page.goto(`${APP}/presentation/${id}/edit`, { timeout: 120_000 });
    await page.locator(`[data-slide-id="${slides[0].id}"]`).waitFor({ timeout: 60_000 });
    await work(tools(page, id, name));
    check(`${name}: no page errors`, errors.length === 0, errors.join(" | ").slice(0, 400));
  } catch (error) {
    check(`${name}: ran to the end`, false, String(error).split("\n").slice(0, 6).join(" "));
    await page.screenshot({ path: `${SHOTS}math-failure-${name.replace(/\W+/g, "-")}.png` }).catch(() => {});
  } finally {
    await page.close().catch(() => {});
    await removePresentation(id);
  }
}

/** A slide holding one bad value still opens: one element must not lock a teacher out of the whole presentation. */
async function opensWith(name, bad, limit) {
  if (ONLY && !ONLY.test("bad saved data")) return;
  const good = numberLine("good", 40, 40);
  const id = await makePresentation(`e2e bad ${name}`, [blank("s", [good, bad])]);
  const page = await mainContext.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(`${APP}/presentation/${id}/edit`, { timeout: 120_000 });
    const opened = await page.locator('[data-slide-id="s"]').waitFor({ timeout: 45_000 }).then(() => true, () => false);
    const said = opened ? "" : (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 100);
    check(`bad saved data: ${name} still opens the presentation`, opened, said);
    if (opened) {
      await page.locator('[data-element-id="good"] svg text').first().waitFor({ timeout: 45_000 });
      check(`bad saved data: ${name} leaves the good tool and raises no page error`, errors.length === 0, errors.join(" | ").slice(0, 200));
      if (limit) {
        const shapes = await page.locator(`[data-element-id="bad"] svg ${limit.shape}`).count();
        check(`bad saved data: ${name} draws no more than the panel allows`, shapes <= limit.max, `${shapes} drawn, most ${limit.max}`);
      }
    }
  } catch (error) {
    check(`bad saved data: ${name} ran to the end`, false, String(error).split("\n")[0]);
  } finally {
    await page.close().catch(() => {});
    await removePresentation(id);
  }
}

// ─── The run ─────────────────────────────────────────────────────────────────────────────────────────────────
const teacher = await makeTeacher({ first: "Mathtools" });
const browser = await chromium.launch();
const mainContext = await loggedIn(browser, teacher, { width: 1600, height: 1000 });

try {
  const TILES = [
    "Number Line", "Integer Number Line", "Fraction Bar", "Fraction Circle", "Written Fraction", "Counting Frame", "Base-Ten Blocks", "Thermometer", "Bar Graph", "Protractor",
    "Ruler (cm)", "Ruler (inch)", "Dual Ruler", "Set Square 45°", "Set Square 30°/60°", "Dice 1", "Dice 6", "25 Sentimo", "₱20 Coin",
  ];
  await scenario("every tile added from the Elements panel", [blank("s", [])], async (t) => {
    await t.button("Elements").click();
    const heading = t.page.locator("h3", { hasText: "Math Tools" });
    await heading.scrollIntoViewIfNeeded();
    await heading.locator("xpath=following-sibling::button").click();
    const ids = () => t.page.locator('[data-slide-id="s"] [data-element-id]').evaluateAll((list) => list.map((el) => el.dataset.elementId));
    const added = [];
    for (const tile of TILES) {
      const before = await ids();
      await t.button(tile).first().scrollIntoViewIfNeeded();
      await t.button(tile).first().click();
      let id;
      for (let i = 0; i < 40 && !id; i++) {
        id = (await ids()).find((x) => !before.includes(x));
        if (!id) await t.wait(100);
      }
      t.ok(`${tile} is added`, !!id);
      if (!id) continue;
      added.push(id);
      const shapes = await t.element(id).locator("svg *").count();
      t.ok(`${tile} draws something`, shapes > 0, String(shapes));
    }
    t.ok("adding them shows as a change", (await t.saveLabel()) !== "Saved", await t.saveLabel());
    t.ok("saved: every tile is in the database", await t.save(async () => (await t.savedSlide())?.elements.length === TILES.length), String((await t.savedSlide())?.elements.length));
    await t.reload(added[0]);
    t.ok("every tile opens again", (await t.page.locator('[data-slide-id="s"] [data-element-id]').count()) === TILES.length);
    t.ok("opening counts as no change", (await t.saveLabel()) === "Saved", await t.saveLabel());
  });

  await scenario("number line", [blank("s", [numberLine("n", 100, 100)])], async (t) => {
    t.ok("starts at 0 to 10", (await t.drawn("n")).join() === range(0, 11).join(), (await t.drawn("n")).join());
    await t.open("n", "Edit numbers");
    const start = t.numberBox("Start");
    const before = await t.place("n");
    await start.fill("5");
    t.ok("Start 5 draws 5 to 15", (await t.drawn("n")).join() === range(5, 11).join(), (await t.drawn("n")).join());
    await start.press("Delete");
    await start.press("ArrowLeft");
    await t.wait(150);
    t.ok("Delete and arrows in the Start box leave the tool where it is", same(await t.place("n"), before) && (await t.element("n").count()) === 1);
    await start.fill("-3");
    t.ok("a negative start works", (await t.drawn("n")).join() === range(-3, 11).join(), (await t.drawn("n")).join());
    await start.fill("1.5");
    t.ok("a decimal start works", (await t.drawn("n"))[1] === "2.5", (await t.drawn("n")).join());
    await start.fill("");
    await t.wait(100);
    t.ok("an empty box keeps the numbers", (await t.drawn("n"))[0] === "1.5", (await t.drawn("n")).join());
    await start.evaluate((box) => box.blur());
    await t.wait(100);
    t.ok("leaving the empty box shows the number again", (await start.inputValue()) === "1.5", await start.inputValue());
    await start.fill("123456789");
    t.ok("a very long number still fits between the ticks", await t.wordsFit("n"));
    await start.fill("5");

    const step = t.section("Edit numbers", "Step");
    for (const [size, last] of [[2, "25"], [5, "55"], [10, "105"], [2, "25"]]) {
      await t.chip(step, String(size)).click();
      t.ok(`step ${size} ends at ${last}`, (await t.drawn("n")).at(-1) === last, (await t.drawn("n")).at(-1));
      t.ok(`step ${size}: the words fit`, await t.wordsFit("n"));
    }
    const hide = t.section("Edit numbers", "Hide numbers");
    t.ok("Hide numbers lists the shown numbers", (await hide.getByRole("button").allTextContents()).join() === range(5, 11, 2).join(), (await hide.getByRole("button").allTextContents()).join());
    await t.chip(hide, "9").click();
    t.ok("a hidden number leaves the line", !(await t.drawn("n")).includes("9"));
    t.ok("a hidden number becomes an empty box", (await t.element("n").locator('svg rect[fill="none"]').count()) === 1);
    await t.chip(hide, "25").click();

    t.ok(
      "saved: start, step and hidden numbers",
      await t.save(async () => same((await t.savedOne("n"))?.numberLine, { start: 5, step: 2, hidden: [2, 10] })),
      JSON.stringify((await t.savedOne("n"))?.numberLine),
    );
    await t.reload("n");
    t.ok("opens again with the same numbers", (await t.drawn("n")).join() === "5,7,11,13,15,17,19,21,23", (await t.drawn("n")).join());
    await t.open("n", "Edit numbers");
    t.ok("the panel reads Start back", (await t.numberBox("Start").inputValue()) === "5", await t.numberBox("Start").inputValue());
    t.ok("the panel reads Step back", await t.isOn(t.chip(t.section("Edit numbers", "Step"), "2")));
    t.ok("the panel reads the hidden number back", await t.isOn(t.chip(t.section("Edit numbers", "Hide numbers"), "9")));
    await t.page.getByRole("button", { name: "Reset", exact: true }).click();
    t.ok("Reset goes back to 0 to 10", (await t.drawn("n")).join() === range(0, 11).join(), (await t.drawn("n")).join());
    t.ok("Reset empties the Start box too", (await t.numberBox("Start").inputValue()) === "0", await t.numberBox("Start").inputValue());
  });

  await scenario("integer number line", [blank("s", [integerLine("i", 100, 100)])], async (t) => {
    t.ok("has 0 in the middle", (await t.drawn("i")).join() === range(-8, 17).join(), (await t.drawn("i")).join());
    await t.open("i", "Edit numbers");
    t.ok("has no Start box", (await t.numberBox("Start").count()) === 0);
    for (const [size, last] of [[2, "16"], [5, "40"], [10, "80"]]) {
      await t.chip(t.section("Edit numbers", "Step"), String(size)).click();
      t.ok(`step ${size} ends at ${last}`, (await t.drawn("i")).at(-1) === last, (await t.drawn("i")).at(-1));
      t.ok(`step ${size}: the words fit`, await t.wordsFit("i"));
    }
    await t.chip(t.section("Edit numbers", "Hide numbers"), "-80").click();
    t.ok(
      "saved: step and hidden number",
      await t.save(async () => same((await t.savedOne("i"))?.numberLine, { start: 0, step: 10, hidden: [0] })),
      JSON.stringify((await t.savedOne("i"))?.numberLine),
    );
    await t.reload("i");
    t.ok("opens again the same", (await t.drawn("i"))[0] === "-70" && (await t.drawn("i")).length === 16, (await t.drawn("i")).join());
  });

  await scenario("fraction bar and circle", [blank("s", [bar("b", 100, 100), circle("c", 700, 100)])], async (t) => {
    for (const [id, read] of [["b", drawing.barParts], ["c", drawing.circleParts]]) {
      t.ok(`${id}: starts at 1/4`, same(await read(t, id), { parts: 4, shaded: 1 }), JSON.stringify(await read(t, id)));
      await t.open(id, "Edit fraction");
      await t.slider("Parts").fill("12");
      await t.slider("Shaded").fill("12");
      t.ok(`${id}: 12/12 is all shaded`, same(await read(t, id), { parts: 12, shaded: 12 }), JSON.stringify(await read(t, id)));
      t.ok(`${id}: the panel says 12/12`, await t.appears(t.readout("12/12")));
      await t.slider("Parts").fill("2");
      t.ok(`${id}: fewer parts lowers the shaded ones`, same(await read(t, id), { parts: 2, shaded: 2 }), JSON.stringify(await read(t, id)));
      t.ok(`${id}: Parts stops at 2`, (await t.slider("Parts").getAttribute("min")) === "2");
      await t.slider("Shaded").fill("0");
      t.ok(`${id}: none shaded`, same(await read(t, id), { parts: 2, shaded: 0 }), JSON.stringify(await read(t, id)));
      await t.slider("Parts").fill("7");
      await t.slider("Shaded").fill("3");
      await t.button("Edit fraction").click();
    }
    t.ok(
      "saved: both fractions",
      await t.save(async () => same((await t.savedOne("b"))?.fraction, { parts: 7, shaded: 3 }) && same((await t.savedOne("c"))?.fraction, { parts: 7, shaded: 3 })),
      JSON.stringify((await t.savedOne("c"))?.fraction),
    );
    await t.reload("b");
    t.ok("the bar opens again the same", same(await drawing.barParts(t, "b"), { parts: 7, shaded: 3 }));
    t.ok("the circle opens again the same", same(await drawing.circleParts(t, "c"), { parts: 7, shaded: 3 }));
    await t.open("c", "Edit fraction");
    t.ok("the panel reads it back", (await t.slider("Parts").inputValue()) === "7" && (await t.slider("Shaded").inputValue()) === "3");
    await t.page.getByRole("button", { name: "Reset", exact: true }).click();
    t.ok("Reset goes back to 1/4", same(await drawing.circleParts(t, "c"), { parts: 4, shaded: 1 }));
  });

  await scenario("written fraction", [blank("s", [written("w", 100, 100)])], async (t) => {
    t.ok("starts at 1/2", (await t.drawn("w")).join() === "1,2", (await t.drawn("w")).join());
    await t.open("w", "Edit fraction");
    const top = t.numberBox("Numerator");
    const bottom = t.numberBox("Denominator");
    await top.fill("5");
    await bottom.fill("4");
    t.ok("an improper fraction works", (await t.drawn("w")).join() === "5,4", (await t.drawn("w")).join());
    await top.fill("999");
    await bottom.fill("999");
    t.ok("999/999 is drawn", (await t.drawn("w")).join() === "999,999", (await t.drawn("w")).join());
    t.ok("999 fits in the drawing", await t.element("w").evaluate((el) => [...el.querySelectorAll("svg text")].every((x) => { const b = x.getBBox(); return b.x >= 0 && b.x + b.width <= 100; })));
    for (const [box, bad, what] of [[top, "1000", "1000 on top"], [bottom, "1000", "1000 below"], [bottom, "0", "a denominator of 0"], [top, "-1", "a negative number"], [top, "1.5", "a decimal"]]) {
      await box.fill(bad);
      await t.wait(100);
      t.ok(`${what} is refused`, (await t.drawn("w")).join() === "999,999", (await t.drawn("w")).join());
      await box.evaluate((b) => b.blur());
      await t.wait(100);
      t.ok(`after ${what} the box shows the fraction again`, (await box.inputValue()) === "999", await box.inputValue());
    }
    await top.fill("");
    await t.wait(100);
    t.ok("an empty box keeps the fraction", (await t.drawn("w")).join() === "999,999");
    t.ok("a box can be empty while typing", (await top.inputValue()) === "", await top.inputValue());
    await top.fill("0");
    await bottom.fill("12");
    t.ok("0/12 is allowed", (await t.drawn("w")).join() === "0,12", (await t.drawn("w")).join());
    t.ok("saved: the written fraction", await t.save(async () => same((await t.savedOne("w"))?.fraction, { parts: 12, shaded: 0 })), JSON.stringify((await t.savedOne("w"))?.fraction));
    await t.reload("w");
    t.ok("opens again the same", (await t.drawn("w")).join() === "0,12", (await t.drawn("w")).join());
    await t.open("w", "Edit fraction");
    t.ok("the panel reads it back", (await t.numberBox("Numerator").inputValue()) === "0" && (await t.numberBox("Denominator").inputValue()) === "12");
    await t.page.getByRole("button", { name: "Reset", exact: true }).click();
    await t.wait(100);
    t.ok("Reset goes back to 1/2", (await t.drawn("w")).join() === "1,2" && (await t.numberBox("Numerator").inputValue()) === "1", (await t.drawn("w")).join());
  });

  await scenario("counting frame", [blank("s", [frame("f", 300, 100)])], async (t) => {
    t.ok("starts with 5 dots on 10 boxes", same(await drawing.frame(t, "f"), { boxes: 10, dots: 5 }), JSON.stringify(await drawing.frame(t, "f")));
    const start = await t.place("f");
    await t.open("f", "Edit count");
    await t.slider("Count").fill("8");
    await t.chip(t.panel("Edit count"), "5").click();
    t.ok("the 5 frame lowers 8 dots to 5", same(await drawing.frame(t, "f"), { boxes: 5, dots: 5 }), JSON.stringify(await drawing.frame(t, "f")));
    await t.chip(t.panel("Edit count"), "20").click();
    t.ok("the 20 frame has 20 boxes", (await drawing.frame(t, "f")).boxes === 20);
    t.ok("the 20 frame is on", await t.isOn(t.chip(t.panel("Edit count"), "20")));
    await t.slider("Rows").fill("10");
    await t.slider("Columns").fill("10");
    await t.slider("Count").fill("100");
    t.ok("10 × 10 full", same(await drawing.frame(t, "f"), { boxes: 100, dots: 100 }), JSON.stringify(await drawing.frame(t, "f")));
    const big = await t.element("f").boundingBox();
    const slide = await t.page.locator('[data-slide-id="s"]').boundingBox();
    t.ok("10 × 10 stays on the slide", big.y >= slide.y - 1 && big.y + big.height <= slide.y + slide.height + 1 && big.x + big.width <= slide.x + slide.width + 1, JSON.stringify(big));
    t.ok("10 × 10 keeps square boxes", near(big.width / big.height, 390 / 388, 0.02), `${big.width} × ${big.height}`);
    await t.slider("Rows").fill("1");
    await t.slider("Columns").fill("1");
    t.ok("1 × 1 holds one dot", same(await drawing.frame(t, "f"), { boxes: 1, dots: 1 }), JSON.stringify(await drawing.frame(t, "f")));
    await t.slider("Rows").fill("2");
    await t.slider("Columns").fill("5");
    t.ok("back to 2 × 5, it's its first size", near((await t.place("f")).width, start.width, 2) && near((await t.place("f")).height, start.height, 2), JSON.stringify([await t.place("f"), start]));
    await t.slider("Count").fill("7");
    t.ok(
      "saved: the frame and its grid",
      await t.save(async () => same((await t.savedOne("f"))?.tenFrame, { count: 7, rows: 2, columns: 5 })),
      JSON.stringify((await t.savedOne("f"))?.tenFrame),
    );
    await t.reload("f");
    t.ok("opens again the same", same(await drawing.frame(t, "f"), { boxes: 10, dots: 7 }), JSON.stringify(await drawing.frame(t, "f")));
    await t.open("f", "Edit count");
    t.ok("the panel reads it back", (await t.slider("Count").inputValue()) === "7" && (await t.slider("Rows").inputValue()) === "2" && (await t.slider("Columns").inputValue()) === "5");
  });

  await scenario("base-ten blocks", [blank("s", [blocks("t", 900, 100)])], async (t) => {
    t.ok("starts at 123", same(await drawing.blocks(t, "t"), { flats: 1, rods: 2, cubes: 3 }), JSON.stringify(await drawing.blocks(t, "t")));
    await t.open("t", "Edit blocks");
    t.ok("the panel adds them up", await t.appears(t.readout("123")));
    for (const part of ["Hundreds", "Tens", "Ones"]) await t.slider(part).fill("9");
    t.ok("999 draws 9 of each", same(await drawing.blocks(t, "t"), { flats: 9, rods: 9, cubes: 9 }), JSON.stringify(await drawing.blocks(t, "t")));
    t.ok("the panel says 999", await t.appears(t.readout("999")));
    const wide = await t.element("t").boundingBox();
    const slide = await t.page.locator('[data-slide-id="s"]').boundingBox();
    t.ok("999 stays on the slide", wide.x >= slide.x - 1 && wide.x + wide.width <= slide.x + slide.width + 1, JSON.stringify(wide));
    for (const part of ["Hundreds", "Tens", "Ones"]) await t.slider(part).fill("0");
    t.ok("0 draws no blocks", same(await drawing.blocks(t, "t"), { flats: 0, rods: 0, cubes: 0 }));
    const empty = await t.element("t").boundingBox();
    t.ok("0 blocks still has a box to click", empty.width >= 20 && empty.height >= 20, JSON.stringify(empty));
    await t.button("Edit blocks").click();
    await t.page.mouse.click(1500, 900);
    await t.wait(150);
    await t.element("t").click();
    t.ok("0 blocks can be picked again", await t.appears(t.button("Edit blocks"), 2000));
    await t.button("Edit blocks").click();
    await t.slider("Hundreds").fill("2");
    await t.slider("Tens").fill("0");
    await t.slider("Ones").fill("6");
    t.ok("saved: the blocks", await t.save(async () => same((await t.savedOne("t"))?.baseTen, { hundreds: 2, tens: 0, ones: 6 })), JSON.stringify((await t.savedOne("t"))?.baseTen));
    await t.reload("t");
    t.ok("opens again the same", same(await drawing.blocks(t, "t"), { flats: 2, rods: 0, cubes: 6 }), JSON.stringify(await drawing.blocks(t, "t")));
    await t.open("t", "Edit blocks");
    t.ok("the panel adds them up again", await t.appears(t.readout("206")));
  });

  await scenario("thermometer", [blank("s", [thermometer("h", 200, 100)])], async (t) => {
    const top = (temp) => 150 - ((temp + 20) / 70) * 130;
    t.ok("starts at 25", near(await drawing.liquidTop(t, "h"), top(25), 0.1), String(await drawing.liquidTop(t, "h")));
    await t.open("h", "Set temperature");
    for (const temp of [-20, 0, 37, 50]) {
      await t.slider("Temperature").fill(String(temp));
      t.ok(`${temp} °C reaches its mark`, near(await drawing.liquidTop(t, "h"), top(temp), 0.1), String(await drawing.liquidTop(t, "h")));
    }
    await t.slider("Temperature").focus();
    await t.page.keyboard.press("ArrowLeft");
    await t.wait(100);
    t.ok("an arrow key steps the slider", (await t.slider("Temperature").inputValue()) === "49", await t.slider("Temperature").inputValue());
    await t.slider("Temperature").fill("-7");
    t.ok("saved: the temperature", await t.save(async () => same((await t.savedOne("h"))?.thermometer, { value: -7 })), JSON.stringify((await t.savedOne("h"))?.thermometer));
    await t.reload("h");
    t.ok("opens again the same", near(await drawing.liquidTop(t, "h"), top(-7), 0.1));
    await t.open("h", "Set temperature");
    t.ok("the panel reads it back", (await t.slider("Temperature").inputValue()) === "-7", await t.slider("Temperature").inputValue());
    await t.page.getByRole("button", { name: "Reset", exact: true }).click();
    t.ok("Reset goes back to 25", near(await drawing.liquidTop(t, "h"), top(25), 0.1));
  });

  await scenario("bar graph", [blank("s", [graph("g", 200, 100)])], async (t) => {
    const labels = async () => (await t.drawn("g")).slice(6);
    const panelBars = (i) => t.panel("Edit graph").locator('input[type="range"]').nth(i);
    const panelName = (i) => t.panel("Edit graph").locator('input[type="text"]').nth(i);
    t.ok("starts with A, B, C", (await labels()).join() === "A,B,C", (await labels()).join());
    t.ok("starts at 4, 7, 2", (await drawing.bars(t, "g")).join() === "46,80.5,23", (await drawing.bars(t, "g")).join());
    await t.open("g", "Edit graph");
    const counts = t.panel("Edit graph");
    await t.chip(counts, "6").click();
    t.ok("6 bars", (await labels()).join() === "A,B,C,D,E,F", (await labels()).join());
    await panelBars(0).fill("0");
    await panelBars(1).fill("10");
    t.ok("0 and 10 draw empty and full", (await drawing.bars(t, "g")).slice(0, 2).join() === "0,115", (await drawing.bars(t, "g")).join());
    await panelName(0).fill("");
    await panelName(0).pressSequentially("Twelve letters and more");
    t.ok("a name stops at 12 letters", (await panelName(0).inputValue()).length === 12, await panelName(0).inputValue());
    await panelName(1).fill("Ñino <b>&");
    t.ok("a name is plain text", (await labels())[1] === "Ñino <b>&", (await labels())[1]);
    const namesApart = () =>
      t.element("g").evaluate((el) => {
        const words = [...el.querySelectorAll('svg text[font-weight="600"]')].map((x) => x.getBBox()).sort((a, b) => a.x - b.x);
        return words.every((b, i) => i === 0 || words[i - 1].x + words[i - 1].width <= b.x + 0.5);
      });
    await panelName(0).fill("Mathematics");
    await panelName(1).fill("Grandmothers");
    for (let i = 2; i < 6; i++) await panelName(i).fill("Mathematical");
    t.ok("6 long everyday names don't run into each other", await namesApart());
    for (let i = 2; i < 6; i++) await panelName(i).fill("MMMMMMMMMMMM");
    t.ok("6 names of the widest letter don't run into each other", await namesApart());
    await panelName(0).fill("Twelve lette");
    await panelName(1).fill("Ñino <b>&");
    await panelName(2).fill("");
    t.ok("a name can be empty", (await labels()).length === 6 || (await labels()).length === 5, (await labels()).join());
    const before = await t.place("g");
    await panelName(3).press("Delete");
    await panelName(3).press("ArrowLeft");
    await t.wait(150);
    t.ok("Delete and arrows in a name leave the graph where it is", same(await t.place("g"), before) && (await t.element("g").count()) === 1);
    await t.chip(counts, "2").click();
    t.ok("2 bars keeps the first two", (await drawing.bars(t, "g")).join() === "0,115", (await drawing.bars(t, "g")).join());
    await t.chip(counts, "4").click();
    const bars = [{ label: "Twelve lette", value: 0 }, { label: "Ñino <b>&", value: 10 }, { label: "C", value: 5 }, { label: "D", value: 5 }];
    t.ok("adding bars back names them by letter", (await labels()).join() === bars.map((b) => b.label).join(), (await labels()).join());
    t.ok("saved: names and values", await t.save(async () => same((await t.savedOne("g"))?.barGraph, { bars })), JSON.stringify((await t.savedOne("g"))?.barGraph));
    await t.reload("g");
    t.ok("opens again the same", (await labels()).join() === bars.map((b) => b.label).join(), (await labels()).join());
    await t.open("g", "Edit graph");
    t.ok("the panel reads the names back", (await panelName(1).inputValue()) === "Ñino <b>&", await panelName(1).inputValue());
    t.ok("the panel reads the values back", (await panelBars(1).inputValue()) === "10", await panelBars(1).inputValue());
    await t.page.getByRole("button", { name: "Reset", exact: true }).click();
    t.ok("Reset goes back to A, B, C", (await labels()).join() === "A,B,C", (await labels()).join());
  });

  await scenario("protractor", [blank("s", [protractor("p", 200, 100)])], async (t) => {
    const tip = (deg) => ({ x: 100 + 92 * Math.cos((deg * Math.PI) / 180), y: 100 - 92 * Math.sin((deg * Math.PI) / 180) });
    const at = async (deg) => {
      const now = await drawing.tip(t, "p");
      return near(now.x, tip(deg).x, 0.1) && near(now.y, tip(deg).y, 0.1);
    };
    t.ok("starts at 45°", await at(45));
    await t.open("p", "Set angle");
    for (const deg of [0, 1, 90, 179, 180, 123]) {
      await t.slider("Angle").fill(String(deg));
      t.ok(`${deg}° points at its mark`, await at(deg), JSON.stringify(await drawing.tip(t, "p")));
    }
    t.ok("saved: the angle", await t.save(async () => same((await t.savedOne("p"))?.protractor, { angle: 123 })), JSON.stringify((await t.savedOne("p"))?.protractor));
    await t.reload("p");
    t.ok("opens again the same", await at(123));
    await t.open("p", "Set angle");
    t.ok("the panel reads it back", (await t.slider("Angle").inputValue()) === "123", await t.slider("Angle").inputValue());
    await t.page.getByRole("button", { name: "Reset", exact: true }).click();
    t.ok("Reset goes back to 45°", await at(45));
  });

  const NO_SETTINGS = [
    ["number line", numberLine("n", 40, 40), "Edit numbers"],
    ["fraction bar", bar("b", 620, 40), "Edit fraction"],
    ["written fraction", written("w", 1100, 40), "Edit fraction"],
    ["counting frame", frame("f", 40, 260), "Edit count"],
    ["base-ten blocks", blocks("t", 320, 260), "Edit blocks"],
    ["thermometer", thermometer("h", 650, 260), "Set temperature"],
    ["bar graph", graph("g", 800, 260), "Edit graph"],
    ["protractor", protractor("p", 40, 460), "Set angle"],
  ];
  // One scenario each: once a presentation shows unsaved, every later "still saved" check would fail with it.
  const unchanged = async (name, el, title, press) =>
    scenario(`nothing changes: ${name}`, [blank("s", [el])], async (t) => {
      await t.open(el.id, title);
      await press(t);
      await t.wait(150);
      t.ok("it stays saved", (await t.saveLabel()) === "Saved", await t.saveLabel());
      t.ok("it adds no undo step", await t.undo.isDisabled());
    });
  const reset = (t) => t.page.getByRole("button", { name: "Reset", exact: true }).click();
  for (const [name, el, title] of NO_SETTINGS) await unchanged(`Reset on an untouched ${name}`, el, title, reset);
  await unchanged("the Step already on", numberLine("n", 40, 40), "Edit numbers", (t) => t.chip(t.section("Edit numbers", "Step"), "1").click());
  await unchanged("the frame size already on", frame("f", 40, 260), "Edit count", (t) => t.chip(t.panel("Edit count"), "10").click());
  await unchanged("the bar count already on", graph("g", 800, 260), "Edit graph", (t) => t.chip(t.panel("Edit graph"), "3").click());

  await scenario("undo with the panel open", [blank("s", [numberLine("n", 40, 40), written("w", 700, 40), frame("f", 40, 300), graph("g", 700, 300)])], async (t) => {
    await t.open("n", "Edit numbers");
    await t.wait();
    await t.numberBox("Start").fill("20");
    await t.wait();
    await t.undo.click();
    t.ok("undo takes the line back", await t.appears(t.element("n").locator("svg text", { hasText: /^10$/ }), 2500) && (await t.drawn("n"))[0] === "0", (await t.drawn("n")).join());
    t.ok("undo shows in the Start box too", (await t.numberBox("Start").inputValue()) === "0", await t.numberBox("Start").inputValue());
    await t.redo.click();
    await t.wait(150);
    t.ok("redo brings it back", (await t.drawn("n"))[0] === "20", (await t.drawn("n")).join());
    t.ok("redo shows in the Start box too", (await t.numberBox("Start").inputValue()) === "20", await t.numberBox("Start").inputValue());
    await t.button("Edit numbers").click();

    await t.open("w", "Edit fraction");
    await t.wait();
    await t.numberBox("Numerator").fill("7");
    await t.wait();
    await t.undo.click();
    await t.wait(150);
    t.ok("undo shows in the Numerator box", (await t.drawn("w"))[0] === "1" && (await t.numberBox("Numerator").inputValue()) === "1", await t.numberBox("Numerator").inputValue());
    await t.button("Edit fraction").click();

    await t.open("f", "Edit count");
    const size = await t.place("f");
    await t.wait();
    await t.slider("Columns").fill("10");
    await t.wait();
    await t.undo.click();
    await t.wait(150);
    t.ok("undo takes back the frame's boxes and its size in one step", same(await drawing.frame(t, "f"), { boxes: 10, dots: 5 }) && near((await t.place("f")).width, size.width, 2), JSON.stringify(await t.place("f")));
    t.ok("undo shows on the slider", (await t.slider("Columns").inputValue()) === "5", await t.slider("Columns").inputValue());
    await t.button("Edit count").click();

    await t.open("g", "Edit graph");
    await t.wait();
    const name = t.panel("Edit graph").locator('input[type="text"]').first();
    await name.fill("Rice");
    await t.wait();
    await t.undo.click();
    await t.wait(150);
    t.ok("undo shows in a bar's name", (await name.inputValue()) === "A", await name.inputValue());
    await t.wait();
    await t.page.keyboard.press("Control+y");
    await t.wait(150);
    t.ok("saving after undo and redo keeps it", await t.save(async () => (await t.savedOne("g"))?.barGraph !== undefined || (await t.savedOne("n"))?.numberLine?.start === 20), JSON.stringify((await t.savedOne("n"))?.numberLine));
  });

  await scenario("copy, paste and duplicate", [blank("a", [graph("g", 40, 40, { barGraph: { bars: [{ label: "Rice", value: 9 }, { label: "Corn", value: 3 }] } }), frame("f", 700, 40, { tenFrame: { count: 3, rows: 1, columns: 5 } })]), blank("b", [])], async (t) => {
    const onSlide = (id) => t.page.locator(`[data-slide-id="${id}"] [data-element-id]`).evaluateAll((els) => els.map((el) => el.dataset.elementId));
    const graphSettings = { bars: [{ label: "Rice", value: 9 }, { label: "Corn", value: 3 }] };
    await t.element("g").click();
    const before = await onSlide("a");
    await t.button("Duplicate").click();
    await t.wait(200);
    const copy = (await onSlide("a")).find((id) => !before.includes(id));
    t.ok("a duplicate keeps the names", (await t.drawn(copy)).slice(6).join() === "Rice,Corn", (await t.drawn(copy)).join());
    await t.open(copy, "Edit graph");
    await t.panel("Edit graph").locator('input[type="text"]').first().fill("Bread");
    t.ok("changing the duplicate leaves the first alone", (await t.drawn("g")).slice(6).join() === "Rice,Corn" && (await t.drawn(copy)).slice(6).join() === "Bread,Corn");
    await t.button("Edit graph").click();

    await t.element("f").click();
    await t.page.keyboard.press("Control+c");
    await t.page.locator('[data-slide-id="b"]').evaluate((s) => s.scrollIntoView({ block: "center" }));
    await t.page.waitForFunction(() => document.querySelector('[title="Slide you\'re on / all slides"]')?.textContent.trim().startsWith("2 /"));
    await t.page.keyboard.press("Control+v");
    await t.wait(300);
    const [pasted] = await onSlide("b");
    t.ok("a pasted frame keeps its grid and dots", !!pasted && same(await drawing.frame(t, pasted), { boxes: 5, dots: 3 }), pasted ? JSON.stringify(await drawing.frame(t, pasted)) : "nothing pasted");

    await t.page.locator('[data-slide-id="a"]').evaluate((s) => s.scrollIntoView({ block: "center" }));
    await t.button("Duplicate slide").first().click();
    await t.page.locator("[data-slide-id]").nth(2).waitFor();
    await t.wait(800);
    const ids = await t.page.locator("[data-slide-id]").evaluateAll((list) => list.map((s) => s.dataset.slideId));
    const newSlide = ids.find((id) => !["a", "b"].includes(id));
    t.ok(
      "saved: the duplicate slide and everything copied",
      await t.save(async () => {
        const dup = await t.savedSlide(newSlide);
        const first = await t.savedSlide("a");
        return dup?.elements.length === 3 && same(first?.elements[0].barGraph, graphSettings) && same(dup.elements[0].barGraph, graphSettings);
      }),
      JSON.stringify((await t.savedSlide(newSlide))?.elements?.map((e) => e.assetId)),
    );
  });

  await scenario("rotate, flip, opacity and color", [blank("s", [protractor("p", 300, 200, { protractor: { angle: 60 } })])], async (t) => {
    await t.element("p").click();
    await t.button("Flip").click();
    await t.page.getByRole("button", { name: "Flip horizontal" }).click();
    await t.button("Rotate").click();
    await t.page.getByRole("button", { name: "45°", exact: true }).click();
    await t.button("Opacity").click();
    await t.slider("Opacity").fill("40");
    await t.button("Set angle").click();
    await t.slider("Angle").fill("70");
    t.ok("a turned, flipped tool can still be edited", (await drawing.tip(t, "p")).y < 20);
    t.ok(
      "saved: all of it together",
      await t.save(async () => {
        const saved = await t.savedOne("p");
        return saved?.flipX === true && saved?.opacity === 40 && saved?.rotation === 45 && saved?.protractor?.angle === 70;
      }),
      JSON.stringify(await t.savedOne("p")),
    );
    await t.reload("p");
    await t.element("p").click();
    t.ok("the settings button is there after reload", await t.appears(t.button("Set angle"), 2000));
  });

  await scenario(
    "two tools together",
    [blank("s", [written("a", 100, 100), written("b", 500, 100), thermometer("h", 900, 100)])],
    async (t) => {
      await t.element("a").click();
      await t.element("b").click({ modifiers: ["Shift"] });
      await t.wait(150);
      t.ok("two picked offers no fraction panel", (await t.button("Edit fraction").count()) === 0);
      await t.button("Group (Ctrl+G)").click();
      await t.wait(200);
      t.ok("saved: the group", await t.save(async () => (await t.savedOne("a"))?.groupId && (await t.savedOne("a"))?.groupId === (await t.savedOne("b"))?.groupId), (await t.savedOne("a"))?.groupId);
      await t.element("h").click();
      await t.button("Set temperature").click();
      await t.element("a").click();
      await t.wait(150);
      t.ok("picking something else closes the panel", (await t.slider("Temperature").count()) === 0);
      t.ok("a group offers no fraction panel", (await t.button("Edit fraction").count()) === 0);
    },
  );

  await scenario(
    "inside the question and answer boxes",
    [slideOf("s", "choice", [frame("f", 10, 10, { containerId: "question", width: 110, height: 46 }), blocks("t", 5, 5, { containerId: "s-a", width: 140, height: 72 })])],
    async (t) => {
      const fits = async (id, container) => {
        const [el, area] = [await t.element(id).boundingBox(), await t.page.locator(`[data-slide-id="s"] [data-container-id="${container}"]`).boundingBox()];
        return { inside: el.x >= area.x - 1 && el.y >= area.y - 1 && el.x + el.width <= area.x + area.width + 4 && el.y + el.height <= area.y + area.height + 4, el, area };
      };
      await t.open("f", "Edit count");
      await t.slider("Rows").fill("10");
      await t.slider("Columns").fill("10");
      const frameFit = await fits("f", "question");
      t.ok("a 10 × 10 frame stays in the question box", frameFit.inside, JSON.stringify(frameFit));
      await t.button("Edit count").click();
      await t.open("t", "Edit blocks");
      for (const part of ["Hundreds", "Tens", "Ones"]) await t.slider(part).fill("9");
      const blockFit = await fits("t", "s-a");
      t.ok("999 blocks stay in the answer box", blockFit.inside, JSON.stringify(blockFit));
      t.ok("saved: both stay in their boxes", await t.save(async () => (await t.savedOne("t"))?.baseTen?.hundreds === 9 && (await t.savedOne("f"))?.tenFrame?.rows === 10));
      await t.reload("f");
      t.ok("the frame is still in its box after opening again", (await fits("f", "question")).inside);
    },
  );

  const FULL = [
    numberLine("n", 10, 10, { numberLine: { start: -7, step: 5, hidden: [0, 3, 10] } }),
    integerLine("i", 10, 130, { numberLine: { start: 0, step: 2, hidden: [8] } }),
    bar("b", 600, 10, { fraction: { parts: 12, shaded: 5 } }),
    circle("c", 1080, 10, { fraction: { parts: 3, shaded: 3 } }),
    written("w", 1080, 230, { fraction: { parts: 999, shaded: 1 } }),
    frame("f", 10, 300, { tenFrame: { count: 11, rows: 3, columns: 4 } }),
    blocks("t", 300, 300, { baseTen: { hundreds: 0, tens: 9, ones: 1 } }),
    thermometer("h", 650, 300, { thermometer: { value: -20 } }),
    graph("g", 770, 400, { barGraph: { bars: [{ label: "", value: 10 }, { label: "Ñ", value: 0 }] } }),
    protractor("p", 10, 480, { protractor: { angle: 180 }, rotation: 15, flipY: true, opacity: 60 }),
    item("dice-4", "d", 1180, 560, 80, 80),
    item("coin-5-peso", "m", 1100, 560, 70, 70),
  ];
  await scenario("nothing is lost when saved again", [blank("s", FULL), blank("s2", [written("x", 100, 100)])], async (t) => {
    t.ok("opening counts as no change", (await t.saveLabel()) === "Saved", await t.saveLabel());
    await t.page.locator('[data-slide-id="s2"]').evaluate((s) => s.scrollIntoView({ block: "center" }));
    await t.open("x", "Edit fraction");
    await t.numberBox("Numerator").fill("3");
    t.ok("saved: the other slide's change", await t.save(async () => (await t.savedOne("x", "s2"))?.fraction?.shaded === 3));
    const after = await t.savedSlide("s");
    for (const before of FULL) {
      const now = after.elements.find((e) => e.id === before.id);
      t.ok(`${before.assetId} is unchanged`, same(before, now), same(before, now) ? "" : JSON.stringify(now).slice(0, 240));
    }
    await t.reload("n");
    t.ok("opens again with no change", (await t.saveLabel()) === "Saved", await t.saveLabel());
    t.ok("the number line leaves out its hidden numbers", (await t.drawn("n")).join() === "-2,3,13,18,23,28,33,38", (await t.drawn("n")).join());
  });

  await scenario(
    "present, all slides and the view page",
    [blank("s", [numberLine("n", 40, 40, { numberLine: { start: 100, step: 10, hidden: [] } }), graph("g", 700, 40, { barGraph: { bars: [{ label: "Rice", value: 5 }] } }), written("w", 40, 300, { fraction: { parts: 8, shaded: 3 } })])],
    async (t) => {
      await t.button("All slides").click();
      const gridTitle = t.page.getByRole("heading", { name: "All slides (1)" });
      await gridTitle.waitFor({ timeout: 60_000 });
      t.ok("the all-slides grid draws them", await t.appears(t.page.locator(".fixed.inset-0.z-50").filter({ has: gridTitle }).locator("svg text", { hasText: "Rice" })));
      await t.page.keyboard.press("Escape");
      await gridTitle.waitFor({ state: "detached" });
      await t.button("Present (fullscreen)").first().click();
      const screen = t.page.locator(".fixed.inset-0.z-50").filter({ has: t.button("Exit presentation (Esc)") });
      const shown = screen.locator('[aria-hidden="false"]');
      await shown.locator("svg text", { hasText: "Rice" }).waitFor();
      const words = await shown.locator("svg text").allTextContents();
      t.ok("presenting draws every tool", ["100", "200", "Rice", "3", "8"].every((w) => words.includes(w)), words.join("|").slice(0, 200));
      await t.page.screenshot({ path: `${SHOTS}math-present.png` });
      await t.page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
      await t.page.mouse.move(800, 300);
      await t.page.mouse.move(810, 310);
      await t.button("Exit presentation (Esc)").click();
      await screen.waitFor({ state: "detached" });
      t.ok("presenting counts as no change", (await t.saveLabel()) === "Saved", await t.saveLabel());
      await t.page.goto(`${APP}/presentation/${t.presentationId}`, { timeout: 120_000 });
      t.ok("the view page draws them", await t.appears(t.page.locator("svg text", { hasText: "Rice" }), 30_000));
      t.ok("the view page draws the fraction", (await t.page.locator("svg text", { hasText: /^8$/ }).count()) >= 1);
    },
  );

  const small = await loggedIn(browser, teacher, { width: 1280, height: 720 });
  await scenario(
    "panels on a small screen",
    [blank("s", [integerLine("i", 0, 0), graph("g", 880, 420, { barGraph: { bars: ["A", "B", "C", "D", "E", "F"].map((label) => ({ label, value: 5 })) } }), protractor("p", 0, 500)])],
    async (t) => {
      const seen = (b) => !!b && b.x >= 0 && b.y >= 0 && b.x + b.width <= 1280 && b.y + b.height <= 720;
      for (const [id, title] of [["i", "Edit numbers"], ["g", "Edit graph"], ["p", "Set angle"]]) {
        await t.open(id, title);
        const box = await t.panel(title).boundingBox();
        t.ok(`${title} fits on a 1280 × 720 screen`, seen(box), JSON.stringify(box));
        await t.page.screenshot({ path: `${SHOTS}math-small-${id}.png` });
        await t.button(title).click();
      }
    },
    { context: small },
  );

  // Hand-edited requests: the database doesn't look inside the slides, so only zod and the drawings stop these.
  const BAD = [
    ["a fraction's parts as text", "fraction-bar", { fraction: { parts: "4", shaded: 1 } }],
    ["an empty fraction (null)", "fraction-circle", { fraction: null }],
    ["a fraction with no shaded", "fraction-bar", { fraction: { parts: 4 } }],
    ["a number line with no hidden list", "number-line", { numberLine: { start: 0, step: 1 } }],
    ["a number line as text", "number-line", { numberLine: "x" }],
    ["a frame's count as text", "ten-frame", { tenFrame: { count: "5" } }],
    ["an empty frame (null)", "ten-frame", { tenFrame: null }],
    ["blocks with no ones", "base-ten-blocks", { baseTen: { hundreds: 1, tens: 1 } }],
    ["a temperature as text", "thermometer", { thermometer: { value: "hot" } }],
    ["a bar graph with no bars list", "bar-graph", { barGraph: {} }],
    ["a bar's name as a number", "bar-graph", { barGraph: { bars: [{ label: 5, value: 5 }] } }],
    ["a bar's name too long", "bar-graph", { barGraph: { bars: [{ label: "x".repeat(101), value: 5 }] } }],
    ["51 bars", "bar-graph", { barGraph: { bars: Array.from({ length: 51 }, () => ({ label: "x", value: 1 })) } }],
    ["an angle as text", "protractor", { protractor: { angle: "x" } }],
    // The right type, but numbers no panel can make.
    ["0 fraction parts", "fraction-bar", { fraction: { parts: 0, shaded: 0 } }],
    ["negative fraction parts", "fraction-circle", { fraction: { parts: -3, shaded: 1 } }],
    ["a decimal number of parts", "fraction-bar", { fraction: { parts: 1.5, shaded: 1 } }],
    ["a written fraction over 0", "fraction-number", { fraction: { parts: 0, shaded: 1 } }],
    ["a number line step of 0", "number-line", { numberLine: { start: 0, step: 0, hidden: [] } }],
    ["a frame with 0 rows", "ten-frame", { tenFrame: { count: 1, rows: 0, columns: 0 } }],
    ["negative blocks", "base-ten-blocks", { baseTen: { hundreds: -1, tens: -1, ones: -1 } }],
    ["no bars", "bar-graph", { barGraph: { bars: [] } }],
    ["a negative bar", "bar-graph", { barGraph: { bars: [{ label: "x", value: -5 }] } }],
    ["a temperature of 500", "thermometer", { thermometer: { value: 500 } }],
    ["an angle of 999", "protractor", { protractor: { angle: 999 } }],
  ];
  for (const [name, assetId, fields] of BAD) await opensWith(name, item(assetId, "bad", 700, 300, 240, 200, fields));

  // Numbers big enough to slow every teacher who opens the slide.
  await opensWith("20,000 fraction parts", item("fraction-bar", "bad", 700, 300, 240, 48, { fraction: { parts: 20000, shaded: 1 } }), { shape: "rect", max: 12 });
  await opensWith("a 150 × 150 frame", item("ten-frame", "bad", 700, 300, 240, 200, { tenFrame: { count: 1, rows: 150, columns: 150 } }), { shape: "rect", max: 100 });
  await opensWith("3,000 hundreds", item("base-ten-blocks", "bad", 700, 300, 240, 100, { baseTen: { hundreds: 3000, tens: 0, ones: 0 } }), { shape: "rect", max: 27 });
} finally {
  await browser.close();
  await deleteTeacher(teacher);
}

finish();
