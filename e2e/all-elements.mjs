// Every kind of element in the editor: every tile in the Elements panel added, drawn, saved and opened again, then
// pictures, shapes, lines, 3D solids, text boxes, photos and custom drawings handled by mouse and keyboard, and bad saved
// data. Every scenario gets its own presentation and page. ONLY="crop|layers" runs just the scenarios that match.
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { APP, SHOTS, api, check, deleteTeacher, finish, loggedIn, makeTeacher } from "./lib.mjs";

const UNDO_STEP_MS = 700;
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const near = (a, b, within = 2) => Math.abs(a - b) <= within;
const canon = (v) =>
  Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const PHOTO_SRC = "https://images.quizmatter.com/uploads/e2e-photo.png";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

// ─── What goes on the slides ─────────────────────────────────────────────────────────────────────────────────
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
const item = (assetId, id, x, y, width, height, extra = {}) => ({ id, assetId, x, y, width, height, color: "#3B82F6", containerId: null, ...extra });
const star = (id, x = 300, y = 200, extra) => item("star", id, x, y, 200, 200, extra);
const square = (id, x, y, extra) => item("square", id, x, y, 150, 150, extra);
const textBox = (id, x, y, html = "<p>Hello</p>", extra) => item("text-box", id, x, y, 320, 120, { text: { html }, ...extra });
const photo = (id, x, y, extra) => item("photo", id, x, y, 400, 300, { image: { src: PHOTO_SRC, width: 800, height: 600 }, ...extra });

// ─── The tools every scenario uses ───────────────────────────────────────────────────────────────────────────
function tools(page, presentationId, name) {
  const button = (title) => page.locator(`button[title="${title}"]`);
  const element = (id) => page.locator(`[data-element-id="${id}"]`).first();
  const ok = (label, passed, detail) => check(`${name}: ${label}`, passed, detail);
  const wait = (ms = UNDO_STEP_MS) => page.waitForTimeout(ms);
  const undo = button("Undo (Ctrl+Z)");
  const saveButton = page.locator(`button[title="Save (Ctrl+S)"], button[title^="Couldn't save"], button[title^="Saving is paused"]`);
  const tool = (title) => page.locator(`button[title="${title}"], span[title="${title}"] button`);
  const labelled = (label) => page.locator("label", { hasText: new RegExp(`^${label}`) });
  const slider = (label) => labelled(label).locator('input[type="range"]');
  const appears = (locator, timeout = 4000) => locator.first().waitFor({ timeout }).then(() => true, () => false);
  const saveLabel = async () => (await saveButton.innerText()).trim();
  const savedSlide = async (id = "s") => (await api(`/rest/v1/slides?presentation_id=eq.${presentationId}&id=eq.${id}&select=data`))[0]?.data;
  const savedOne = async (id, slideId = "s") => (await savedSlide(slideId))?.elements.find((e) => e.id === id);
  const editable = page.locator('[contenteditable="true"]');

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
  async function drag(box, dx, dy, { shift = false } = {}) {
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    if (shift) await page.keyboard.down("Shift");
    await page.mouse.move(from.x + dx / 2, from.y + dy / 2);
    await page.mouse.move(from.x + dx, from.y + dy);
    await page.mouse.up();
    if (shift) await page.keyboard.up("Shift");
    await wait(120);
  }
  const place = async (id) => {
    const box = await element(id).boundingBox();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  };
  // The slide itself: its wrapper in the workspace is taller.
  const slideBox = () => page.locator('[data-slide-id="s"] [data-canvas-root]').first().boundingBox();
  const handle = (title) => page.locator(`div[title="${title}"]`);
  const order = () => page.locator('[data-slide-id="s"] [data-element-id]').evaluateAll((list) => list.map((el) => el.dataset.elementId));
  return { page, button, tool, element, ok, wait, undo, slider, appears, saveLabel, savedSlide, savedOne, editable, save, reload, drag, place, slideBox, handle, order, presentationId };
}

async function makePresentation(title, slides) {
  const id = randomUUID();
  await api("/rest/v1/presentations", { method: "POST", body: JSON.stringify({ id, owner_id: teacher.id, title, data_version: 3 }) });
  await api("/rest/v1/slides", { method: "POST", body: JSON.stringify(slides.map((data, position) => ({ presentation_id: id, id: data.id, position, data }))) });
  return id;
}
const removePresentation = (id) => api(`/rest/v1/presentations?id=eq.${id}`, { method: "DELETE" }).catch(() => {});

async function scenario(name, slides, work, { before, waitUntil = "load" } = {}) {
  if (ONLY && !ONLY.test(name)) return;
  console.log(`\n── ${name}`);
  const id = await makePresentation(`e2e ${name}`, slides);
  const page = await mainContext.newPage();
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && /hydrat/i.test(m.text()) && errors.push(m.text().slice(0, 300)));
  // What was still loading when a page got stuck: only printed if the scenario fails.
  const pending = new Set();
  page.on("request", (r) => pending.add(r));
  for (const done of ["requestfinished", "requestfailed"]) page.on(done, (r) => pending.delete(r));
  try {
    if (before) await before(page);
    await page.goto(`${APP}/presentation/${id}/edit`, { timeout: 120_000, waitUntil });
    await page.locator(`[data-slide-id="${slides[0].id}"]`).waitFor({ timeout: 90_000 });
    await work(tools(page, id, name));
    check(`${name}: no page errors`, errors.length === 0, errors.join(" | ").slice(0, 400));
  } catch (error) {
    check(`${name}: ran to the end`, false, String(error).split("\n").slice(0, 6).join(" "));
    if (pending.size) console.log(`   still loading: ${[...pending].map((r) => r.url().slice(0, 140)).join(" | ")}`);
    await page.screenshot({ path: `${SHOTS}elements-failure-${name.replace(/\W+/g, "-")}.png` }).catch(() => {});
  } finally {
    await page.close().catch(() => {});
    await removePresentation(id);
  }
}

/** A slide holding one bad element still opens, and the good one next to it is still there. */
async function opensWith(name, bad) {
  if (ONLY && !ONLY.test("bad saved data")) return;
  const id = await makePresentation(`e2e bad ${name}`, [blank("s", [star("good", 40, 40), ...bad])]);
  const page = await mainContext.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(`${APP}/presentation/${id}/edit`, { timeout: 120_000 });
    const opened = await page.locator('[data-element-id="good"]').waitFor({ timeout: 45_000 }).then(() => true, () => false);
    const said = opened ? "" : (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 100);
    check(`bad saved data: ${name} still opens the presentation`, opened, said);
    if (opened) {
      await page.waitForTimeout(500);
      check(`bad saved data: ${name} raises no page error`, errors.length === 0, errors.join(" | ").slice(0, 200));
    }
  } catch (error) {
    check(`bad saved data: ${name} ran to the end`, false, String(error).split("\n")[0]);
  } finally {
    await page.close().catch(() => {});
    await removePresentation(id);
  }
}

// ─── The run ─────────────────────────────────────────────────────────────────────────────────────────────────
const teacher = await makeTeacher({ first: "Elements" });
const browser = await chromium.launch();
const mainContext = await loggedIn(browser, teacher, { width: 1600, height: 1000 });
await mainContext.route(PHOTO_SRC, (route) => route.fulfill({ contentType: "image/png", body: PNG }));

try {
  // The panel's own list, so a category added later is tested by itself.
  let categories = [];
  await scenario("the Elements panel lists its categories", [blank("s", [])], async (t) => {
    await t.button("Elements").click();
    const headings = t.page.locator(".side-panel h3");
    await headings.first().waitFor();
    categories = (await headings.allTextContents()).map((text) => text.trim()).filter((text) => text !== "Recently used");
    t.ok("it has categories", categories.length > 20, categories.join(", "));
  });
  if (ONLY && !ONLY.test("every tile")) categories = [];

  for (const category of categories) {
    await scenario(`every tile: ${category}`, [blank("s", [])], async (t) => {
      await t.button("Elements").click();
      const heading = t.page.locator(".side-panel h3", { hasText: new RegExp(`^${category}$`) });
      await heading.scrollIntoViewIfNeeded();
      await heading.locator("xpath=following-sibling::button").click();
      const tiles = t.page.locator('.side-panel button[draggable="true"]');
      await tiles.first().waitFor();
      const total = await tiles.count();
      const count = () => t.page.locator('[data-slide-id="s"] [data-element-id]').count();
      const refused = [];
      for (let i = 0; i < total; i++) {
        const before = await count();
        await tiles.nth(i).click();
        const added = await t.page.waitForFunction((n) => document.querySelectorAll('[data-slide-id="s"] [data-element-id]').length > n, before, { timeout: 5000 }).then(() => true, () => false);
        if (!added) refused.push(await tiles.nth(i).getAttribute("title"));
      }
      t.ok(`all ${total} tiles add an element`, refused.length === 0, refused.slice(0, 8).join(", "));
      await t.wait(600);
      const slide = await t.slideBox();
      const report = await t.page.locator('[data-slide-id="s"] [data-element-id]').evaluateAll((list, slideRect) => {
        const out = { blank: [], nan: [], outside: [], tiny: [] };
        for (const el of list) {
          const name = el.dataset.elementId;
          const picture = el.querySelector("svg");
          const shows = el.querySelector("img") || (picture && (() => { try { const b = picture.getBBox(); return b.width > 0 || b.height > 0; } catch { return false; } })());
          if (!shows) out.blank.push(name);
          if (el.outerHTML.includes("NaN") || el.outerHTML.includes("Infinity")) out.nan.push(name);
          const box = el.getBoundingClientRect();
          if (box.left < slideRect.x - 1 || box.top < slideRect.y - 1 || box.right > slideRect.x + slideRect.width + 1 || box.bottom > slideRect.y + slideRect.height + 1) out.outside.push(name);
          if (box.width < 20 || box.height < 20) out.tiny.push(name);
        }
        return out;
      }, slide);
      const assetOf = async (ids) => {
        await t.save(async () => (await t.savedSlide())?.elements.length === total);
        const saved = (await t.savedSlide())?.elements ?? [];
        return ids.slice(0, 8).map((id) => saved.find((e) => e.id === id)?.assetId).join(", ");
      };
      for (const [what, ids] of [["draw something", report.blank], ["have no broken numbers in the drawing", report.nan], ["start on the slide", report.outside], ["start big enough to see", report.tiny]]) {
        t.ok(`all ${what}`, ids.length === 0, ids.length ? `${ids.length}: ${await assetOf(ids)}` : "");
      }
      t.ok("saved: all of them", await t.save(async () => (await t.savedSlide())?.elements.length === total), String((await t.savedSlide())?.elements.length));
      const first = (await t.savedSlide())?.elements[0]?.id;
      await t.page.waitForTimeout(400);
      const savedBefore = (await t.savedSlide())?.elements;
      await t.reload(first);
      await t.wait(800);
      t.ok("all open again", (await count()) === total, String(await count()));
      t.ok("the saved data is unchanged", same(savedBefore, (await t.savedSlide())?.elements));
      const label = await t.saveLabel();
      let changed = "";
      if (label !== "Saved") {
        // Says what opening changed: saves it and compares.
        await t.save(async () => (await t.saveLabel()) === "Saved");
        const after = (await t.savedSlide())?.elements ?? [];
        const moved = savedBefore.flatMap((e) => {
          const now = after.find((a) => a.id === e.id);
          return now && !same(e, now) ? [`${e.assetId} ${e.width}x${e.height} -> ${now.width}x${now.height}`] : [];
        });
        changed = `${moved.length} changed: ${moved.slice(0, 3).join("; ")}`;
      }
      t.ok("opening counts as no change", label === "Saved", changed);
    });
  }

  await scenario("a letter opened again and again", [blank("s", [item("number-4", "n", 300, 200, 200, 300)])], async (t) => {
    await t.wait(800);
    const sizes = [];
    for (let i = 0; i < 6; i++) {
      await t.save(async () => (await t.saveLabel()) === "Saved");
      await t.wait(400);
      const saved = await t.savedOne("n");
      sizes.push(Number(saved.height.toFixed(2)));
      await t.reload("n");
      await t.wait(800);
    }
    t.ok("its size settles and doesn't keep shrinking", near(sizes[1], sizes[5], 0.75), sizes.join(" → "));
  });

  await scenario("a picture: resize, drag and rotate", [blank("s", [star("a"), star("b", 900, 400)])], async (t) => {
    await t.element("a").click();
    const start = await t.place("a");
    await t.drag(await t.handle("Resize").last().boundingBox(), 80, 80);
    const grown = await t.place("a");
    t.ok("a corner makes it bigger", grown.width > start.width + 40, JSON.stringify(grown));
    t.ok("a corner keeps its shape", near(grown.width / grown.height, start.width / start.height, 0.03), JSON.stringify(grown));
    t.ok("the opposite corner stays put", near(grown.x, start.x) && near(grown.y, start.y), JSON.stringify(grown));
    await t.wait();
    await t.drag(await t.handle("Resize").last().boundingBox(), -900, -900);
    const least = await t.place("a");
    t.ok("it can't shrink below 24 px", near(Math.min(least.width, least.height), 24, 1.5) && Math.max(least.width, least.height) < 40, JSON.stringify(least));
    await t.wait();
    await t.undo.click();
    await t.wait(150);
    t.ok("one undo takes back a whole resize", near((await t.place("a")).width, grown.width), JSON.stringify(await t.place("a")));

    const slide = await t.slideBox();
    await t.drag(await t.element("a").boundingBox(), 1500, 0);
    let now = await t.place("a");
    t.ok("dragged far right, half stays on the slide", near(now.x + now.width / 2, slide.x + slide.width, 3), JSON.stringify(now));
    // Half of it is off the slide now, so this grabs the half still on it.
    const onSlide = await t.element("a").boundingBox();
    await t.drag({ ...onSlide, width: onSlide.width / 2 }, -2500, -1500);
    now = await t.place("a");
    t.ok("dragged far up-left, half stays on the slide", near(now.x + now.width / 2, slide.x, 3) && near(now.y + now.height / 2, slide.y, 3), JSON.stringify({ now, slide }));
    for (let i = 0; i < 3; i++) await t.page.keyboard.press("ArrowLeft");
    await t.wait(100);
    const pressed = await t.place("a");
    t.ok("an arrow key can't push it further off", near(pressed.x, now.x, 1), JSON.stringify(pressed));

    await t.element("b").click();
    const box = await t.place("b");
    const rotate = await t.handle("Rotate (hold Shift to snap)").boundingBox();
    await t.page.mouse.move(rotate.x + rotate.width / 2, rotate.y + rotate.height / 2);
    await t.page.mouse.down();
    await t.page.keyboard.down("Shift");
    await t.page.mouse.move(box.x + box.width + 150, box.y + box.height / 2 + 10);
    await t.page.mouse.up();
    await t.page.keyboard.up("Shift");
    await t.wait(150);
    await t.save(async () => (await t.savedOne("b"))?.rotation !== undefined);
    const turned = (await t.savedOne("b"))?.rotation;
    t.ok("Shift snaps the turn to 15° steps", typeof turned === "number" && turned % 15 === 0 && turned !== 0, String(turned));

    await t.button("Opacity").click();
    t.ok("Opacity stops at 5%", (await t.slider("Opacity").getAttribute("min")) === "5");
    await t.slider("Opacity").fill("5");
    await t.button("Opacity").click();
    await t.button("Flip").click();
    await t.page.getByRole("button", { name: "Flip vertical" }).click();
    await t.button("Flip").click();
    t.ok("saved: opacity and flip", await t.save(async () => (await t.savedOne("b"))?.opacity === 5 && (await t.savedOne("b"))?.flipY === true), JSON.stringify(await t.savedOne("b")));
    await t.reload("b");
    t.ok("opens again with no change", (await t.saveLabel()) === "Saved", await t.saveLabel());
  });

  await scenario("crop a photo", [blank("s", [photo("p", 300, 150), photo("q", 800, 300, { rotation: 30, width: 200, height: 150 })])], async (t) => {
    t.ok("a photo draws its picture", await t.appears(t.element("p").locator("img, svg image")));
    await t.element("p").click();
    t.ok("a photo has no Color button", (await t.button("Color").count()) === 0);
    await t.button("Crop (or double-click the picture)").click();
    await t.handle("Crop").first().waitFor();
    const before = await t.place("p");
    await t.drag(await t.handle("Crop").last().boundingBox(), -120, -90);
    await t.page.keyboard.press("Enter");
    await t.wait(150);
    const cut = await t.place("p");
    t.ok("cropping makes the box smaller", cut.height < before.height - 50, JSON.stringify(cut));
    t.ok("Enter stops cropping", (await t.handle("Crop").count()) === 0);
    t.ok(
      "saved: the crop is inside the picture",
      await t.save(async () => {
        const crop = (await t.savedOne("p"))?.crop;
        return !!crop && crop.x >= 0 && crop.y >= 0 && crop.x + crop.width <= 1.0001 && crop.y + crop.height <= 1.0001;
      }),
      JSON.stringify((await t.savedOne("p"))?.crop),
    );
    await t.reload("p");
    t.ok("opens the same size", near((await t.place("p")).height, cut.height), JSON.stringify(await t.place("p")));
    await t.element("p").click();
    await t.button("Show the whole picture again").click();
    await t.wait(150);
    t.ok("Reset crop shows the whole picture", near((await t.place("p")).height, before.height, 3), JSON.stringify(await t.place("p")));
    t.ok("a crop cut down to its smallest keeps 24 px", await (async () => {
      await t.button("Crop (or double-click the picture)").click();
      await t.handle("Crop").first().waitFor();
      await t.drag(await t.handle("Crop").last().boundingBox(), -900, -900);
      await t.page.keyboard.press("Enter");
      await t.wait(150);
      const small = await t.place("p");
      return small.height >= 23 && small.height <= 40;
    })(), JSON.stringify(await t.place("p")));
    await t.element("q").click();
    await t.button("Crop (or double-click the picture)").click();
    await t.handle("Crop").first().waitFor();
    await t.drag(await t.handle("Crop").last().boundingBox(), 0, -60);
    await t.page.keyboard.press("Escape");
    await t.wait(150);
    t.ok("Escape stops cropping a turned photo", (await t.handle("Crop").count()) === 0);
    t.ok("saved: a turned photo's crop", await t.save(async () => !!(await t.savedOne("q"))?.crop), JSON.stringify((await t.savedOne("q"))?.crop));
  });

  await scenario("a photo that can't be loaded", [blank("s", [photo("p", 300, 150, { image: { src: "https://images.quizmatter.com/uploads/missing.png", width: 800, height: 600 } })])], async (t) => {
    await t.element("p").click();
    t.ok("it can still be picked", await t.appears(t.button("Duplicate"), 3000));
    t.ok("it has a size to click", (await t.place("p")).width > 100);
  }, { before: (page) => page.route("**/uploads/missing.png", (route) => route.fulfill({ status: 404, body: "" })) });

  await scenario("a photo that never answers", [blank("s", [photo("p", 300, 150, { image: { src: "https://images.quizmatter.com/uploads/hangs.png", width: 800, height: 600 } }), star("a", 900, 200)])], async (t) => {
    await t.element("a").click();
    t.ok("the editor opens anyway", await t.appears(t.button("Duplicate"), 5000));
  }, { before: (page) => page.route("**/uploads/hangs.png", () => {}), waitUntil: "domcontentloaded" });

  await scenario("square: stretch, corners and border", [blank("s", [square("q", 300, 200), square("r", 800, 200, { borderColor: "#FF0000", borderWidth: 12, cornerRadius: 50 })])], async (t) => {
    await t.element("q").click();
    const start = await t.place("q");
    await t.drag(await t.handle("Change width").last().boundingBox(), 150, 0);
    const wide = await t.place("q");
    t.ok("a side handle changes only the width", near(wide.width, start.width + 150, 3) && near(wide.height, start.height, 1), JSON.stringify(wide));
    t.ok("the corners keep their round drawing square", near(wide.x, start.x), JSON.stringify(wide));
    await t.drag(await t.handle("Change width").last().boundingBox(), -900, 0);
    t.ok("the width stops at 24 px", near((await t.place("q")).width, 24, 1.5), JSON.stringify(await t.place("q")));
    await t.drag(await t.handle("Change height").last().boundingBox(), 0, 80);
    t.ok("a bottom handle changes the height", near((await t.place("q")).height, start.height + 80, 3), JSON.stringify(await t.place("q")));
    await t.button("Corner radius").click();
    t.ok("Corner radius stops at 50", (await t.slider("Corner radius").getAttribute("max")) === "50");
    await t.slider("Corner radius").fill("30");
    await t.button("Corner radius").click();
    t.ok("saved: the sizes and corners", await t.save(async () => (await t.savedOne("q"))?.cornerRadius === 30), JSON.stringify(await t.savedOne("q")));
    await t.reload("r");
    t.ok("opens with its border kept", same((await t.savedOne("r")).borderWidth, 12) && (await t.saveLabel()) === "Saved", await t.saveLabel());
    t.ok("a square has no Crop button", await (async () => {
      await t.element("r").click();
      await t.wait(100);
      return (await t.button("Crop (or double-click the picture)").count()) === 0;
    })());
  });

  await scenario("lines", [blank("s", [item("line", "l", 300, 200, 220, 44), item("line-arrow", "a", 300, 400, 220, 44, { rotation: 45 })])], async (t) => {
    await t.element("l").click();
    const start = await t.place("l");
    t.ok("a line has only side handles to stretch it", (await t.handle("Change width").count()) >= 2);
    await t.drag(await t.handle("Change width").last().boundingBox(), 200, 0);
    const long = await t.place("l");
    t.ok("stretching makes it longer, not thicker", near(long.width, start.width + 200, 3) && near(long.height, start.height, 1), JSON.stringify(long));
    await t.drag(await t.handle("Change width").last().boundingBox(), -900, 0);
    t.ok("a line stops at 24 px", near((await t.place("l")).width, 24, 1.5), JSON.stringify(await t.place("l")));
    await t.element("a").click();
    const beforeTurned = await t.savedOne("a");
    await t.drag(await t.handle("Change width").last().boundingBox(), 100, 100);
    t.ok(
      "saved: a turned line stretched along its own direction",
      await t.save(async () => (await t.savedOne("a"))?.width > beforeTurned.width + 100),
      JSON.stringify(await t.savedOne("a")),
    );
    t.ok("a line has no Crop button", (await t.button("Crop (or double-click the picture)").count()) === 0);
  });

  await scenario("3D solids", [blank("s", [item("cube", "c", 300, 200, 240, 240), item("icosahedron", "i", 700, 200, 240, 240, { rotation3d: { x: -90, y: 180 } })])], async (t) => {
    await t.element("c").click();
    t.ok("a solid has no flat Rotate button", (await t.button("Rotate").count()) === 0);
    t.ok("a solid has no Crop button", (await t.button("Crop (or double-click the picture)").count()) === 0);
    await t.button("Rotate 3D").click();
    for (const [x, y] of [[-90, -180], [90, 180], [0, 0], [33, -77]]) {
      await t.slider("Tilt").fill(String(x));
      await t.slider("Turn").fill(String(y));
      await t.wait(60);
      const shapes = await t.element("c").locator("svg *").count();
      const broken = await t.element("c").evaluate((el) => el.outerHTML.includes("NaN"));
      t.ok(`tilt ${x}, turn ${y} draws a whole shape`, shapes > 0 && !broken, String(shapes));
    }
    t.ok("saved: the 3D angle", await t.save(async () => same((await t.savedOne("c"))?.rotation3d, { x: 33, y: -77 })), JSON.stringify((await t.savedOne("c"))?.rotation3d));
    await t.reload("i");
    t.ok("opens with no change", (await t.saveLabel()) === "Saved", await t.saveLabel());
  });

  await scenario("text boxes", [blank("s", [textBox("t", 300, 100), textBox("e", 300, 300, ""), textBox("u", 800, 100, "<p>Turned</p>", { rotation: 30 })])], async (t) => {
    await t.element("t").dblclick();
    await t.editable.first().waitFor();
    await t.page.keyboard.press("Control+a");
    await t.page.keyboard.type("Typed <b>not bold</b> & ñ 😀");
    for (const key of ["Delete", "ArrowLeft", "Backspace"]) await t.page.keyboard.press(key);
    await t.page.keyboard.press("End");
    await t.page.keyboard.type("!");
    await t.page.keyboard.press("Escape");
    await t.page.waitForFunction(() => !document.querySelector('[contenteditable="true"]'));
    t.ok("Delete and arrows while typing keep the box", (await t.element("t").count()) === 1);
    t.ok("typing shows as plain words", (await t.element("t").innerText()).includes("<b>not bold</b>"), await t.element("t").innerText());
    t.ok("an empty text box can still be picked", await (async () => {
      await t.element("e").click();
      return t.appears(t.button("Duplicate"), 2000);
    })());
    await t.element("u").dblclick();
    t.ok("a turned text box can be typed in", await t.appears(t.editable, 3000));
    await t.page.keyboard.press("Escape");
    await t.wait(150);

    await t.element("t").click();
    await t.wait(150);
    const size = t.button("Text size (it still shrinks to fit its box)");
    for (let i = 0; i < 20; i++) await t.button("Bigger text").click();
    t.ok("Bigger text stops at 96", (await size.innerText()).trim() === "96", await size.innerText());
    await t.button("Bold (Ctrl+B)").click();
    t.ok(
      "saved: words and size",
      await t.save(async () => {
        const saved = await t.savedOne("t");
        return saved?.text?.html.includes("&lt;b&gt;") && typeof saved?.text?.fontSize === "number";
      }),
      JSON.stringify((await t.savedOne("t"))?.text),
    );
    await t.reload("t");
    t.ok("the words open as plain words", (await t.element("t").locator("b:text-is('not bold')").count()) === 0 && (await t.element("t").innerText()).includes("<b>not bold</b>"), await t.element("t").innerText());
    t.ok("opens with no change", (await t.saveLabel()) === "Saved", await t.saveLabel());
  });

  await scenario("a text box past its limit", [blank("s", [textBox("t", 300, 100)])], async (t) => {
    await t.element("t").dblclick();
    await t.editable.first().waitFor();
    await t.page.keyboard.press("Control+a");
    await t.page.evaluate(() => document.execCommand("insertText", false, "word ".repeat(11000)));
    await t.wait(300);
    await t.page.keyboard.press("Escape");
    await t.wait(300);
    await t.page.keyboard.press("Control+s");
    const told = await t.appears(t.page.locator("[data-sonner-toast]"), 8000);
    const words = told ? (await t.page.locator("[data-sonner-toast]").first().innerText()).replace(/\s+/g, " ") : "";
    t.ok("a save over the limit tells the teacher why", told && /long|limit|too|characters/i.test(words), words.slice(0, 200));
    t.ok("nothing too long reached the database", ((await t.savedOne("t"))?.text?.html.length ?? 0) <= 50000);
    t.ok("the box still shows unsaved", (await t.saveLabel()) !== "Saved", await t.saveLabel());
  });

  await scenario(
    "custom drawings",
    [blank("s", [
      item("custom-svg", "x", 100, 100, 200, 200, { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" onload="window.__ran=1"><script>window.__ran=1</script><circle cx="50" cy="50" r="40" fill="red"/></svg>` }),
      item("custom-svg", "y", 400, 100, 200, 200, { svg: "not a drawing at all" }),
      item("custom-svg", "z", 700, 100, 200, 200, { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><image href="https://example.com/track.png" width="10" height="10"/></svg>` }),
    ])],
    async (t) => {
      let outside = 0;
      t.page.on("request", (request) => request.url().includes("example.com") && outside++);
      await t.reload("x");
      await t.wait(500);
      t.ok("a script inside a drawing doesn't run", (await t.page.evaluate(() => window.__ran)) === undefined);
      t.ok("a drawing can't load things from other sites", outside === 0, String(outside));
      await t.element("y").click();
      t.ok("a broken drawing can still be picked", await t.appears(t.button("Duplicate"), 2000));
      await t.page.keyboard.press("Delete");
      await t.wait(150);
      t.ok("a broken drawing can be deleted", (await t.element("y").count()) === 0);
      t.ok("saved: the others are kept", await t.save(async () => (await t.savedSlide())?.elements.length === 2));
    },
  );

  await scenario("layers, align, group", [blank("s", [square("a", 100, 100), square("b", 180, 180, { height: 90, width: 90 }), square("c", 600, 300, { width: 200, height: 60 })])], async (t) => {
    await t.element("a").click();
    await t.page.keyboard.press("Control+]");
    await t.wait(150);
    t.ok("Ctrl+] brings it forward one layer", (await t.order()).join() === "b,a,c", (await t.order()).join());
    await t.button("Arrange").click();
    await t.tool("Bring to front (Ctrl+Alt+])").click();
    await t.wait(150);
    t.ok("Bring to front puts it on top", (await t.order()).join() === "b,c,a", (await t.order()).join());
    t.ok("at the front, Bring forward is off", await t.tool("Bring forward (Ctrl+])").isDisabled());
    await t.tool("Send to back (Ctrl+Alt+[)").click();
    await t.wait(150);
    t.ok("Send to back puts it at the bottom", (await t.order()).join() === "a,b,c", (await t.order()).join());
    await t.tool("Align left").click();
    t.ok("Align left on one item goes to the slide's edge", near((await t.place("a")).x, (await t.slideBox()).x), JSON.stringify(await t.place("a")));
    await t.button("Arrange").click();

    for (const id of ["a", "b", "c"]) {
      await t.element(id).click({ modifiers: id === "a" ? [] : ["Shift"], position: { x: 8, y: 8 } });
      await t.wait(80);
    }
    t.ok("three picked says so", await t.appears(t.page.getByText("3 selected", { exact: true }), 2000));
    await t.button("Arrange").click();
    const top = async () => Promise.all(["a", "b", "c"].map(async (id) => (await t.place(id)).y));
    await t.tool("Align top").click();
    await t.wait(150);
    const tops = await top();
    t.ok("Align top lines all three up", near(tops[0], tops[1]) && near(tops[1], tops[2]), tops.join());
    await t.tool("Space evenly across").click();
    await t.wait(150);
    const [pa, pb, pc] = await Promise.all(["a", "b", "c"].map((id) => t.place(id)));
    t.ok("Space evenly across leaves equal gaps", near(pb.x - (pa.x + pa.width), pc.x - (pb.x + pb.width), 3), JSON.stringify([pa, pb, pc]));
    await t.tool("Make all items the size of the first one you selected").click();
    await t.wait(150);
    const sized = await Promise.all(["a", "b", "c"].map((id) => t.place(id)));
    t.ok("Same size copies the first one's size", sized.every((p) => near(p.width, sized[0].width) && near(p.height, sized[0].height)), JSON.stringify(sized));
    await t.button("Arrange").click();

    await t.button("Group (Ctrl+G)").click();
    await t.wait(150);
    await t.page.mouse.click(1500, 900);
    await t.wait(100);
    const lefts = await Promise.all(["a", "b", "c"].map(async (id) => (await t.place(id)).x));
    await t.element("b").click();
    await t.wait(100);
    t.ok("clicking one picks the whole group", await t.appears(t.page.getByText("Group of 3", { exact: true }), 2000));
    await t.drag(await t.element("b").boundingBox(), 40, 70);
    const moved = await Promise.all(["a", "b", "c"].map(async (id) => (await t.place(id)).x));
    t.ok("a group moves together", moved.every((x, i) => near(x - lefts[i], moved[0] - lefts[0], 3)) && moved[0] !== lefts[0], moved.join());

    const before = await t.order();
    await t.page.keyboard.press("Control+c");
    await t.page.keyboard.press("Control+v");
    await t.wait(300);
    const after = await t.order();
    t.ok("a pasted group is three new elements", after.length === 6, String(after.length));
    t.ok(
      "saved: a pasted group has its own group id",
      await t.save(async () => {
        const list = (await t.savedSlide())?.elements ?? [];
        if (list.length !== 6) return false;
        const groups = new Set(list.map((e) => e.groupId));
        return groups.size === 2 && !groups.has(undefined);
      }),
      JSON.stringify((await t.savedSlide())?.elements.map((e) => e.groupId)),
    );
    const copy = after.find((id) => !before.includes(id));
    await t.element(copy).click();
    await t.wait(100);
    await t.page.keyboard.press("Delete");
    await t.wait(200);
    t.ok("Delete on a group removes all of it", (await t.order()).length === 3, String((await t.order()).length));
    await t.element("a").click();
    await t.page.keyboard.press("Control+Shift+g");
    await t.wait(150);
    await t.page.mouse.click(1500, 900);
    await t.wait(100);
    await t.element("b").click();
    t.ok("after Ungroup, one is picked alone", await t.appears(t.button("Rotate"), 2000) && (await t.page.getByText("Group of 3", { exact: true }).count()) === 0);
  });

  await scenario("a group resized past its corner", [blank("s", [square("a", 300, 200), square("b", 500, 300)])], async (t) => {
    await t.element("a").click({ position: { x: 8, y: 8 } });
    await t.element("b").click({ position: { x: 8, y: 8 }, modifiers: ["Shift"] });
    await t.wait(150);
    const start = await Promise.all(["a", "b"].map((id) => t.place(id)));
    await t.drag(await t.handle("Resize group").last().boundingBox(), -900, -900);
    const after = await Promise.all(["a", "b"].map((id) => t.place(id)));
    t.ok("dragging far past the opposite corner doesn't make it bigger", after[0].width < start[0].width, JSON.stringify({ start: start[0].width, after: after[0].width }));
  });

  // Drags by hand, and says what is under the mouse at the moment of the drop.
  const dragInto = async (t, id, target, { alt = false } = {}) => {
    const box = await t.element(id).boundingBox();
    const to = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
    await t.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    if (alt) await t.page.keyboard.down("Alt");
    await t.page.mouse.down();
    await t.page.mouse.move(to.x, to.y, { steps: 8 });
    const under = await t.page.evaluate(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return `element ${hit?.closest("[data-element-id]")?.dataset.elementId ?? "none"}, box ${hit?.closest("[data-container-id]")?.dataset.containerId ?? "none"}`;
    }, [to.x, to.y]);
    await t.page.mouse.up();
    if (alt) await t.page.keyboard.up("Alt");
    await t.wait(200);
    return under;
  };
  const optionBox = (t, id) => t.page.locator(`[data-slide-id="s"] [data-container-id="${id}"]`).boundingBox();
  const inBox = async (t, box, id) => (await t.page.locator(`[data-container-id="${box}"] [data-element-id="${id}"]`).count()) === 1;

  await scenario("moving a small picture into a box", [slideOf("s", "choice", [star("a", 900, 60, { width: 120, height: 120 })])], async (t) => {
    const under = await dragInto(t, "a", await optionBox(t, "s-b"));
    t.ok("a small picture dragged onto an answer box goes into it", await inBox(t, "s-b", "a"), `under the mouse: ${under}`);
  });

  await scenario("a free picture laid over a box", [slideOf("s", "choice", [star("a", 900, 60, { width: 120, height: 120 })])], async (t) => {
    const option = await optionBox(t, "s-b");
    await dragInto(t, "a", option, { alt: true });
    t.ok("Alt keeps it on the slide", !(await inBox(t, "s-b", "a")));
    const box = await t.place("a");
    t.ok("Alt put it over the box", box.x >= option.x - box.width && box.x <= option.x + option.width, JSON.stringify(box));
    await t.wait();
    await t.drag(await t.element("a").boundingBox(), 30, 10);
    t.ok("nudging it doesn't pull it into the box", !(await inBox(t, "s-b", "a")));
    const near_ = await t.place("a");
    t.ok("nudging still moves it", !near(near_.x, box.x, 5), JSON.stringify(near_));
    t.ok("saved: it stays free", await t.save(async () => (await t.savedOne("a"))?.containerId === null && (await t.saveLabel()) === "Saved"), JSON.stringify(await t.savedOne("a")));
  });

  await scenario("moving a group between boxes", [slideOf("s", "choice", [star("b", 20, 20, { containerId: "question", width: 100, height: 100, groupId: "g" }), star("c", 140, 20, { containerId: "question", width: 100, height: 100, groupId: "g" })])], async (t) => {
    const under = await dragInto(t, "b", await optionBox(t, "s-c"));
    t.ok("a group dragged from one box to another goes together", (await inBox(t, "s-c", "b")) && (await inBox(t, "s-c", "c")), `under the mouse: ${under}`);
  });

  await scenario("moving a big picture into a box", [slideOf("s", "choice", [item("star", "big", 500, 250, 700, 460)])], async (t) => {
    const option = await optionBox(t, "s-a");
    const from = await t.place("big");
    await t.element("big").click();
    const under = await dragInto(t, "big", option);
    t.ok("it goes into the box", await inBox(t, "s-a", "big"), `under the mouse: ${under}`);
    const landed = await t.place("big");
    t.ok("a picture too big for a box shrinks to fit", landed.x >= option.x - 1 && landed.y >= option.y - 1 && landed.x + landed.width <= option.x + option.width + 4 && landed.y + landed.height <= option.y + option.height + 4, JSON.stringify({ landed, option }));
    await t.page.keyboard.press("Control+z");
    await t.wait(200);
    t.ok("undo brings it back to the slide", near((await t.place("big")).width, from.width, 3), JSON.stringify(await t.place("big")));
    await t.wait();
    await t.page.keyboard.press("Control+y");
    await t.wait(200);
    t.ok("saved: a picture moved into a box", await t.save(async () => (await t.savedOne("big"))?.containerId === "s-a"), JSON.stringify(await t.savedOne("big")));
    await t.reload("big");
    t.ok("opens in its box", await inBox(t, "s-a", "big"));
  });

  const many = (n) => Array.from({ length: n }, (_, i) => item("dots", `m${i}`, (i % 40) * 30, Math.floor(i / 40) * 28, 26, 26));
  await scenario("a slide at its limit of 1,000", [blank("s", many(1000))], async (t) => {
    await t.page.locator('[data-element-id="m0"]').waitFor({ timeout: 90_000 });
    await t.element("m0").click();
    await t.button("Duplicate").click();
    await t.wait(800);
    await t.page.keyboard.press("Control+s");
    const told = await t.appears(t.page.locator("[data-sonner-toast]"), 15_000);
    const words = told ? (await t.page.locator("[data-sonner-toast]").first().innerText()).replace(/\s+/g, " ") : "";
    t.ok("one over the limit: the save says why", told && /element|too many|limit|1,?000/i.test(words), words.slice(0, 200));
    t.ok("one over the limit: nothing past 1,000 is saved", (await t.savedSlide()).elements.length <= 1000, String((await t.savedSlide()).elements.length));
  });

  const SHOW = [
    star("a", 40, 40, { rotation: 30, flipX: true, opacity: 40 }),
    square("b", 300, 40, { cornerRadius: 30, borderColor: "#FF0000", borderWidth: 6 }),
    item("line-arrow", "l", 520, 60, 300, 44, { flipX: true }),
    item("cube", "c", 880, 40, 180, 180, { rotation3d: { x: 20, y: 40 } }),
    textBox("t", 40, 300, "<p>Words here</p>", { rotation: -10 }),
    photo("p", 500, 300, { crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, width: 200, height: 150 }),
  ];
  await scenario("present and the view page", [blank("s", SHOW)], async (t) => {
    const countIn = (scope) => scope.locator("[data-element-id], svg").count();
    // Seeded pictures settle their trimmed size on first draw, so save that first.
    if ((await t.saveLabel()) !== "Saved") await t.save(async () => (await t.saveLabel()) === "Saved");
    t.ok("the editor draws them all", (await t.order()).length === SHOW.length);
    await t.button("Present (fullscreen)").first().click();
    const screen = t.page.locator(".fixed.inset-0.z-50").filter({ has: t.button("Exit presentation (Esc)") });
    const shown = screen.locator('[aria-hidden="false"]');
    await shown.getByText("Words here").waitFor();
    t.ok("presenting shows the words", (await shown.getByText("Words here").count()) >= 1);
    t.ok("presenting draws the pictures", (await countIn(shown)) >= 4, String(await countIn(shown)));
    t.ok("presenting shows the cropped photo", await t.appears(shown.locator("img, svg image"), 3000));
    await t.page.screenshot({ path: `${SHOTS}elements-present.png` });
    await t.page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await t.page.mouse.move(800, 300);
    await t.page.mouse.move(810, 310);
    await t.button("Exit presentation (Esc)").click();
    await screen.waitFor({ state: "detached" });
    t.ok("presenting counts as no change", (await t.saveLabel()) === "Saved", await t.saveLabel());
    await t.page.goto(`${APP}/presentation/${t.presentationId}`, { timeout: 120_000 });
    t.ok("the view page shows the words", await t.appears(t.page.getByText("Words here"), 30_000));
  });

  // Hand-edited requests: only zod and the drawings stand between these and a teacher's screen.
  const BAD = [
    ["an unknown kind of element", [item("no-such-thing", "x", 400, 200, 100, 100)]],
    ["an element with no kind", [{ id: "x", x: 400, y: 200, width: 100, height: 100, color: "#000000", containerId: null }]],
    ["x as text", [star("x", "400")]],
    ["no y", [(() => { const e = star("x"); delete e.y; return e; })()]],
    ["a width of 0", [item("star", "x", 400, 200, 0, 100)]],
    ["a negative height", [item("star", "x", 400, 200, 100, -50)]],
    ["a billion-pixel width", [item("star", "x", 400, 200, 1e9, 100)]],
    ["a place far off the slide", [item("star", "x", 1e9, -1e9, 100, 100)]],
    ["a color that's a number", [star("x", 400, 200, { color: 5 })]],
    ["a box that doesn't exist", [star("x", 400, 200, { containerId: "nope" })]],
    ["a box id that's a number", [star("x", 400, 200, { containerId: 5 })]],
    ["rotation as text", [star("x", 400, 200, { rotation: "90" })]],
    ["opacity as text", [star("x", 400, 200, { opacity: "50" })]],
    ["an opacity of 500", [star("x", 400, 200, { opacity: 500 })]],
    ["flip as text", [star("x", 400, 200, { flipX: "yes" })]],
    ["3D angles as text", [item("cube", "x", 400, 200, 100, 100, { rotation3d: { x: "a", y: 0 } })]],
    ["a corner radius of 99", [square("x", 400, 200, { cornerRadius: 99 })]],
    ["a border of 99", [square("x", 400, 200, { borderColor: "#000000", borderWidth: 99 })]],
    ["a crop past the picture", [photo("x", 400, 200, { crop: { x: 2, y: 0, width: 1, height: 1 } })]],
    ["a text box with null text", [item("text-box", "x", 400, 200, 100, 100, { text: null })]],
    ["a text box with text as a number", [item("text-box", "x", 400, 200, 100, 100, { text: { html: 5 } })]],
    ["a text box over 50,000 letters", [item("text-box", "x", 400, 200, 100, 100, { text: { html: "x".repeat(50001) } })]],
    ["a table with uneven rows", [item("table", "x", 400, 200, 300, 100, { table: { rows: [[{ html: "" }, { html: "" }], [{ html: "" }]] } })]],
    ["a table as text", [item("table", "x", 400, 200, 300, 100, { table: "x" })]],
    ["a drawing that's a number", [item("custom-svg", "x", 400, 200, 100, 100, { svg: 5 })]],
    ["a photo from another site", [item("photo", "x", 400, 200, 100, 100, { image: { src: "https://evil.example/a.png", width: 10, height: 10 } })]],
    ["a photo with no picture", [item("photo", "x", 400, 200, 100, 100)]],
    ["an empty element", [null]],
    ["two elements with one id", [star("x", 400, 200), star("x", 700, 200)]],
    ["one element alone in a group", [star("x", 400, 200, { groupId: "lonely" })]],
    ["1,001 elements on a slide", many(1000)],
  ];
  for (const [name, bad] of BAD) await opensWith(name, bad);
} finally {
  await browser.close();
  await deleteTeacher(teacher);
}

finish();
