// Diagrams (Flowchart, Cycle, Mind Map, Tree, Factor Tree), each on its own slide: the "+" and × on every box up to
// their limits, the panels, typing (new lines, long text, empty text, characters like < and &), dragging and resizing
// a box and its limits, Tidy up, Reset, undo, box styles, flip and rotate, a duplicate, a diagram inside a question
// box, slides saved earlier, save, reload and present.
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { APP, SHOTS, api, check, deleteTeacher, finish, loggedIn, makeTeacher } from "./lib.mjs";

// Changes closer together than 500 ms are one undo step (HISTORY_GROUP_MS), and a script clicks far faster than that.
const UNDO_STEP_MS = 700;
const near = (a, b, within = 2.5) => Math.abs(a - b) <= within;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const slideData = (id, type, question, elements, extra = {}) => ({
  id,
  type,
  question,
  layout: "grid",
  options: ["a", "b", "c", "d"].map((o) => ({ id: `${id}-${o}`, text: type === "blank" ? "" : o.toUpperCase() })),
  correctOptionId: null,
  elements,
  questionHeight: 100,
  ...extra,
});
const diagram = (id, assetId, x, y, width, height, settings, containerId = null) => ({
  id,
  assetId,
  x,
  y,
  width,
  height,
  color: "#3B82F6",
  containerId,
  ...settings,
});
/** A factor tree `levels` deep, every number splitting (31 boxes at 5 levels). */
const fullFactor = (levels, n = 1) => ({
  text: `f${n}`,
  ...(levels > 1 && { children: [fullFactor(levels - 1, n * 2), fullFactor(levels - 1, n * 2 + 1)] }),
});
/** A factor tree `levels` deep where only the second number of each pair splits. */
const deepFactor = (levels, n = 1) => ({
  text: `d${n}`,
  ...(levels > 1 && { children: [{ text: `x${n}` }, deepFactor(levels - 1, n + 1)] }),
});

const ORDER = ["flow", "cycle", "mind", "tree", "factor", "boxed", "limits", "older", "broken"];
const seeded = {
  flow: slideData("flow", "blank", "", []),
  cycle: slideData("cycle", "blank", "", []),
  mind: slideData("mind", "blank", "", []),
  tree: slideData("tree", "blank", "", []),
  factor: slideData("factor", "blank", "", []),
  // A flowchart inside the question box: it can't grow past the box's edge.
  boxed: slideData(
    "boxed",
    "choice",
    "",
    [diagram("in-box", "flowchart", 40, 40, 354, 96, { flowchart: { steps: [{ text: "Boxed A" }, { text: "Boxed B" }] } }, "question")],
    { questionHeight: 260 },
  ),
  limits: slideData("limits", "blank", "", [
    diagram("deep", "factor-tree", 40, 30, 560, 660, { factorTree: { root: deepFactor(8) } }),
    diagram("full", "factor-tree", 640, 30, 600, 300, { factorTree: { root: fullFactor(5) } }),
  ]),
  // Saved earlier: one with no settings at all (draws the defaults), one with a box that has its own place.
  older: slideData("older", "blank", "", [
    diagram("no-settings", "flowchart", 60, 60, 400, 120, {}),
    diagram("own-place", "flowchart", 60, 300, 500, 200, {
      flowchart: { steps: [{ text: "Placed", x: 300, y: 80, width: 100, height: 50 }, { text: "Auto" }] },
    }),
  ]),
  // Data the editor can't make (a request edited by hand): the presentation must still open.
  broken: slideData("broken", "blank", "", [
    diagram("too-many", "flowchart", 60, 40, 400, 120, { flowchart: { steps: Array.from({ length: 9 }, (_, i) => ({ text: `S${i}` })) } }),
    diagram("half-place", "flowchart", 60, 240, 400, 120, { flowchart: { steps: [{ text: "A", x: 5 }, { text: "B" }] } }),
    diagram("good-one", "flowchart", 60, 440, 400, 120, { flowchart: { steps: [{ text: "Still here" }, { text: "Me too" }] } }),
  ]),
};

const teacher = await makeTeacher({ first: "Diagrams" });
const presentationId = randomUUID();
await api("/rest/v1/presentations", {
  method: "POST",
  body: JSON.stringify({ id: presentationId, owner_id: teacher.id, title: "Diagrams e2e", data_version: 3 }),
});
await api("/rest/v1/slides", {
  method: "POST",
  body: JSON.stringify(ORDER.map((id, position) => ({ presentation_id: presentationId, id, position, data: seeded[id] }))),
});

const savedSlide = async (id) =>
  (await api(`/rest/v1/slides?presentation_id=eq.${presentationId}&id=eq.${id}&select=data`))[0]?.data;
async function waitForSaved(test) {
  // 25 seconds: a save already running ignores Ctrl+S, and then the next auto save (every 12 seconds) sends it.
  for (let i = 0; i < 100; i++) {
    if (await test()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const browser = await chromium.launch();
const context = await loggedIn(browser, teacher, { width: 1600, height: 1000 });
const page = await context.newPage();
page.setDefaultTimeout(30_000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const button = (title) => page.locator(`button[title="${title}"]`);
const element = (id) => page.locator(`[data-element-id="${id}"]`);
const outline = page.locator('[title="Drag to move this box, double-click to type"]');
const toolbar = page.locator("[data-element-toolbar]");
const textArea = page.locator('[data-slide-id] textarea, textarea[class*="cursor-text"]').first();
const undoButton = button("Undo (Ctrl+Z)");
const ALL_BUTTONS = '[data-slide-id] button[title="Remove this box"], [data-slide-id] button[title^="Add a"], [data-slide-id] button[title="Split into two"], [data-slide-id] button[title="Remove this pair"], [data-slide-id] button[title="Remove this branch"], [data-slide-id] button[title="Add the next step"]';

/** Every box of a diagram: its text, its middle measured from the slide's corner, and its text size. */
const boxes = (id) =>
  element(id)
    .locator("svg text")
    .evaluateAll((list) =>
      list.map((t) => {
        const box = t.getBoundingClientRect();
        const slide = t.closest("[data-slide-id]").getBoundingClientRect();
        return {
          text: [...t.querySelectorAll("tspan")].map((s) => s.textContent).join(" "),
          lines: t.querySelectorAll("tspan").length,
          screenX: box.x + box.width / 2,
          screenY: box.y + box.height / 2,
          x: box.x + box.width / 2 - slide.x,
          y: box.y + box.height / 2 - slide.y,
          size: Number(t.getAttribute("font-size")),
        };
      }),
    );
const texts = async (id) => (await boxes(id)).map((b) => b.text);
const boxNamed = async (id, name) => (await boxes(id)).find((b) => b.text === name);

async function waitForBoxes(id, count) {
  for (let i = 0; i < 40; i++) {
    if ((await boxes(id)).length === count) return true;
    await page.waitForTimeout(100);
  }
  throw new Error(`${id} never got ${count} boxes (has ${(await boxes(id)).length})`);
}

/** Scrolls to a slide; the slide in the middle of the workspace is the one elements are added to. */
async function goToSlide(id) {
  await page.locator(`[data-slide-id="${id}"]`).evaluate((slide) => slide.scrollIntoView({ block: "center" }));
  await page.waitForFunction((text) => document.querySelector('[title="Slide you\'re on / all slides"]')?.textContent.trim().startsWith(text), `${ORDER.indexOf(id) + 1} /`);
}

async function addDiagram(slideId, label) {
  const ids = () => page.locator(`[data-slide-id="${slideId}"] [data-element-id]`).evaluateAll((els) => els.map((el) => el.dataset.elementId));
  const before = await ids();
  // Opening the color panel takes the Elements panel's place.
  if ((await page.locator(`button[title="${label}"]`).count()) === 0) await page.locator('button[title="Elements"]').click();
  await page.locator(`button[title="${label}"]`).first().click();
  for (let i = 0; i < 40; i++) {
    const added = (await ids()).find((id) => !before.includes(id));
    if (added) return added;
    await page.waitForTimeout(100);
  }
  throw new Error(`"${label}" added nothing`);
}

/** Selects a diagram that isn't selected, by clicking its first box. */
async function selectDiagram(id) {
  const [first] = await boxes(id);
  await page.mouse.click(first.screenX, first.screenY);
  await page.locator(ALL_BUTTONS).first().waitFor();
}

/** Picks one box of the selected diagram (a click on it). */
async function pickBox(id, name) {
  const box = await boxNamed(id, name);
  await page.mouse.click(box.screenX, box.screenY);
  await outline.waitFor();
}

/** Double-clicks a box of the selected diagram and types in it. */
async function typeIn(id, name, value, finishKey = "Enter") {
  const box = await boxNamed(id, name);
  await page.mouse.dblclick(box.screenX, box.screenY);
  await textArea.waitFor();
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

/** Opens the diagram's panel, runs `work`, closes it. */
async function inPanel(title, work) {
  await button(title).click();
  await work();
  await button(title).click();
}
const slider = (label) => page.locator("label", { hasText: new RegExp(`^${label}`) }).locator('input[type="range"]');
const panelButton = (name) => page.getByRole("button", { name, exact: true });

/** "+" up to the most boxes (then none is offered), × down to the fewest (then none is offered), for one kind of list. */
async function limitsCase({ name, id, addTitle, removeTitle, start, max, min, extra = 0 }) {
  for (let count = start; count < max; count++) {
    await button(addTitle).first().click();
    await waitForBoxes(id, count + 1 + extra);
  }
  check(`${name}: the "+" stops at ${max}`, (await button(addTitle).count()) === 0, `${(await boxes(id)).length} boxes`);
  for (let count = max; count > min; count--) {
    await button(removeTitle).last().click();
    await waitForBoxes(id, count - 1 + extra);
  }
  check(`${name}: the × stops at ${min}`, (await button(removeTitle).count()) === 0, `${(await boxes(id)).length} boxes`);
}

try {
  await page.goto(`${APP}/presentation/${presentationId}/edit`, { timeout: 120_000 });
  await page.locator('[data-slide-id="flow"]').waitFor();
  await page.locator('button[title="Elements"]').click();

  // ─── Flowchart: the "+" and × ──────────────────────────────────────────────────────────────────────────────
  await goToSlide("flow");
  const flow = await addDiagram("flow", "Flowchart");
  check("flowchart: starts as First, Next, Last", same(await texts(flow), ["First", "Next", "Last"]), (await texts(flow)).join());
  check("flowchart: every box has a + after it", (await button("Add a step after").count()) === 3);
  check("flowchart: only the first box has a + before it", (await button("Add a step before").count()) === 1);
  check("flowchart: every box has a ×", (await button("Remove this box").count()) === 3);

  let before = await boxes(flow);
  await button("Add a step after").nth(1).click();
  await waitForBoxes(flow, 4);
  check("flowchart: + after the middle box goes between", same(await texts(flow), ["First", "Next", "Step 3", "Last"]), (await texts(flow)).join());
  let after = await boxes(flow);
  check("flowchart: the boxes before it don't move", near(after[0].x, before[0].x) && near(after[1].x, before[1].x));

  before = await boxes(flow);
  await button("Add a step before").click();
  await waitForBoxes(flow, 5);
  check("flowchart: + before the first box goes first", (await texts(flow))[0] === "Step 1" && (await texts(flow))[1] === "First");
  after = await boxes(flow);
  check("flowchart: + before doesn't move the others on the slide", near(after[1].x, before[0].x) && near(after[2].x, before[1].x), `${before[0].x} → ${after[1].x}`);

  await limitsCase({ name: "flowchart", id: flow, addTitle: "Add a step after", removeTitle: "Remove this box", start: 5, max: 8, min: 2 });
  check('flowchart: no "+ before" at the most boxes either', true);

  // The panel: the slider, Across / Down, Reset.
  await inPanel("Edit flowchart", async () => {
    await slider("Steps").fill("5");
    await waitForBoxes(flow, 5);
    check("flowchart panel: Steps 5 names the new boxes", same((await texts(flow)).slice(2), ["Step 3", "Step 4", "Step 5"]), (await texts(flow)).join());
    await panelButton("Down").click();
    await page.waitForTimeout(100);
    const down = await boxes(flow);
    check("flowchart panel: Down stacks the boxes", near(down[0].screenX, down[1].screenX, 5) && down[1].screenY > down[0].screenY + 10);
    await panelButton("Across").click();
    await page.waitForTimeout(100);
    const across = await boxes(flow);
    check("flowchart panel: Across puts them in a row", near(across[0].screenY, across[1].screenY, 5) && across[1].screenX > across[0].screenX + 10);
    await panelButton("Reset").click();
    await waitForBoxes(flow, 3);
    check("flowchart panel: Reset brings back the start", same(await texts(flow), ["First", "Next", "Last"]), (await texts(flow)).join());
  });

  // ─── Typing ────────────────────────────────────────────────────────────────────────────────────────────────
  await typeIn(flow, "First", "Plan");
  check("typing: Enter finishes and the box shows it", (await texts(flow))[0] === "Plan", (await texts(flow)).join());
  check("typing: the diagram stays selected", (await button("Remove this box").count()) === 3);

  await typeIn(flow, "Plan", "Plan again", "Escape");
  check("typing: Escape finishes too", (await texts(flow))[0] === "Plan again");

  const nextBox = await boxNamed(flow, "Next");
  await page.mouse.dblclick(nextBox.screenX, nextBox.screenY);
  await textArea.waitFor();
  check('typing: the box opens with its text', (await textArea.inputValue()) === "Next", await textArea.inputValue());
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("line");
  await page.keyboard.press("Enter");
  await textArea.waitFor({ state: "detached" });
  const twoLines = (await boxes(flow))[1];
  check("typing: Shift+Enter makes a second line", twoLines.lines === 2 && twoLines.text === "Next line", JSON.stringify(twoLines));

  const sizeBefore = await element(flow).boundingBox();
  await typeIn(flow, "Last", "A very long sentence for a small box that has to shrink so that all of it still fits inside the box");
  const longBox = (await boxes(flow))[2];
  check("typing: long text shrinks to fit", longBox.size < 12, `size ${longBox.size}`);
  const sizeAfter = await element(flow).boundingBox();
  check("typing: long text doesn't change the diagram's size", near(sizeBefore.width, sizeAfter.width) && near(sizeBefore.height, sizeAfter.height));

  // A long word shrinks instead of being cut in two. One too long for any size people can read is still cut.
  await typeIn(flow, longBox.text, "Caterpillar eggs");
  const wholeWords = (await boxes(flow))[2];
  check("typing: a long word shrinks instead of being cut in two", wholeWords.text === "Caterpillar eggs" && wholeWords.lines === 2, JSON.stringify(wholeWords));
  await typeIn(flow, wholeWords.text, "Supercalifragilisticexpialidocious");
  const veryLong = (await boxes(flow))[2];
  check("typing: a word too long for the box is cut, not made tiny", veryLong.lines > 1 && veryLong.size >= 6, JSON.stringify(veryLong));

  await typeIn(flow, veryLong.text, '<b>a</b> & "ñ" 数');
  check("typing: < > & and other letters show as plain text", (await texts(flow))[2].replace(/\s/g, "") === '<b>a</b>&"ñ"数', (await texts(flow))[2]);
  check("typing: no HTML is made from it", (await element(flow).locator("svg b").count()) === 0);

  const emptyTarget = (await boxes(flow))[2];
  await page.mouse.dblclick(emptyTarget.screenX, emptyTarget.screenY);
  await textArea.waitFor();
  await textArea.fill("");
  await page.keyboard.press("Enter");
  await textArea.waitFor({ state: "detached" });
  check("typing: an empty box stays a box", (await boxes(flow)).length === 3 && (await texts(flow))[2] === "", (await texts(flow)).join("|"));

  // A click outside while typing finishes too.
  const planBox = await boxNamed(flow, "Plan again");
  await page.mouse.dblclick(planBox.screenX, planBox.screenY);
  await textArea.waitFor();
  await page.mouse.click(1500, 900);
  await textArea.waitFor({ state: "detached" });
  check("typing: a click outside finishes and lets go", (await button("Remove this box").count()) === 0);
  await selectDiagram(flow);
  await inPanel("Edit flowchart", () => panelButton("Reset").click());
  await waitForBoxes(flow, 3);

  // ─── Picking, dragging, resizing ───────────────────────────────────────────────────────────────────────────
  await pickBox(flow, "Last");
  check("picking: a box gets its outline and 8 handles", (await page.locator('[title="Resize this box"]').count()) === 4 && (await page.locator('[title="Change width"], [title="Change height"]').count()) === 4);

  before = await boxes(flow);
  await page.waitForTimeout(UNDO_STEP_MS);
  await dragBy(await outline.boundingBox(), 40, 120);
  after = await boxes(flow);
  check("dragging: the picked box moves with the mouse", near(after[2].x, before[2].x + 40, 3) && near(after[2].y, before[2].y + 120, 3), `${after[2].x - before[2].x}, ${after[2].y - before[2].y}`);
  check("dragging: the other boxes stay", near(after[0].x, before[0].x) && near(after[0].y, before[0].y) && near(after[1].x, before[1].x));

  await page.waitForTimeout(UNDO_STEP_MS);
  await undoButton.click();
  await page.waitForTimeout(150);
  after = await boxes(flow);
  check("dragging: one undo puts it back", near(after[2].x, before[2].x) && near(after[2].y, before[2].y), `${after[2].x - before[2].x}, ${after[2].y - before[2].y}`);
  check("dragging: undo keeps the box picked", (await outline.count()) === 1);

  const start = await outline.boundingBox();
  const perUnit = start.width / 64; // a new step is 64 units wide
  const handles = async (title) =>
    (await Promise.all((await page.locator(`[title="${title}"]`).all()).map((h) => h.boundingBox()))).sort((a, b) => a.x + a.y - (b.x + b.y));
  await page.waitForTimeout(UNDO_STEP_MS);
  await dragBy((await handles("Change width")).at(-1), 50, 0);
  let box = await outline.boundingBox();
  check("resizing: a side handle changes only the width", near(box.width, start.width + 50, 3) && near(box.height, start.height, 2), `${start.width}×${start.height} → ${box.width}×${box.height}`);
  check("resizing: the opposite side stays", near(box.x, start.x, 2));

  const beforeCorner = await outline.boundingBox();
  await page.waitForTimeout(UNDO_STEP_MS);
  await dragBy((await handles("Resize this box"))[0], -30, -30);
  box = await outline.boundingBox();
  check("resizing: a corner keeps the box's shape", near(box.width / box.height, beforeCorner.width / beforeCorner.height, 0.05) && box.width > beforeCorner.width, `${box.width}×${box.height}`);
  check("resizing: the opposite corner stays", near(box.x + box.width, beforeCorner.x + beforeCorner.width, 3) && near(box.y + box.height, beforeCorner.y + beforeCorner.height, 3));

  // This box is at the diagram's corner: its outer corner handle overlaps the whole diagram's. Both still work.
  const diagramScale = () =>
    element(flow).evaluate((el) => el.getBoundingClientRect().width / Number(el.querySelector("svg").getAttribute("viewBox").split(" ")[2]));
  const scaleBefore = await diagramScale();
  const beforeOuter = await outline.boundingBox();
  await page.waitForTimeout(UNDO_STEP_MS);
  await dragBy((await handles("Resize this box")).at(-1), 30, 30);
  box = await outline.boundingBox();
  check("resizing: the box's corner at the diagram's corner resizes the box", box.width > beforeOuter.width + 10, `${beforeOuter.width} → ${box.width}`);
  check("resizing: and leaves the rest of the diagram the same size", near(await diagramScale(), scaleBefore, 0.01), `${scaleBefore} → ${await diagramScale()}`);

  await page.waitForTimeout(UNDO_STEP_MS);
  await dragBy((await handles("Resize")).at(-1), 40, 40);
  check("resizing: the whole diagram's corner handle still works with a box picked", (await diagramScale()) > scaleBefore + 0.02, `${scaleBefore} → ${await diagramScale()}`);
  await page.waitForTimeout(UNDO_STEP_MS);
  await undoButton.click();
  await page.waitForTimeout(150);
  check("resizing: one undo puts the diagram's size back", near(await diagramScale(), scaleBefore, 0.01));

  await dragBy((await handles("Change width")).at(-1), -1200, 0);
  box = await outline.boundingBox();
  check("resizing: the width stops at the smallest", near(box.width, 24 * perUnit, 3), `${box.width} (smallest ${24 * perUnit})`);
  await dragBy((await handles("Change height")).at(-1), 0, -600);
  box = await outline.boundingBox();
  check("resizing: the height stops at the smallest", near(box.height, 16 * perUnit, 3), `${box.height} (smallest ${16 * perUnit})`);
  await dragBy((await handles("Change width")).at(-1), 900, 0);
  box = await outline.boundingBox();
  check("resizing: the width stops at the biggest", near(box.width, 400 * perUnit, 4), `${box.width} (biggest ${400 * perUnit})`);

  // Tidy up: back in its own spot and size, text kept.
  await typeIn(flow, "Last", "Kept");
  await inPanel("Edit flowchart", () => panelButton("Tidy up").click());
  await page.waitForTimeout(150);
  after = await boxes(flow);
  check("Tidy up: the box goes back beside the others", near(after[2].y, after[1].y, 3) && near(after[2].x - after[1].x, before[1].x - before[0].x, 4), `${after[2].x - after[1].x}`);
  check("Tidy up: the text stays", after[2].text === "Kept", after[2].text);

  // Escape lets go of the box first, then of the diagram.
  await pickBox(flow, "Next");
  await page.keyboard.press("Escape");
  await outline.waitFor({ state: "detached" });
  check("Escape: lets go of the box, the diagram stays selected", (await button("Remove this box").count()) === 3);
  await page.keyboard.press("Escape");
  await page.locator(ALL_BUTTONS).first().waitFor({ state: "detached" });
  check("Escape: a second one lets go of the diagram", true);
  await selectDiagram(flow);

  // ─── Box styles ────────────────────────────────────────────────────────────────────────────────────────────
  await toolbar.getByText("All boxes", { exact: true }).waitFor();
  check('styles: nothing picked = "All boxes"', true);
  await toolbar.locator('button[title="Bigger text"]').click();
  await page.waitForTimeout(100);
  check("styles: the text size goes to every box", (await boxes(flow)).every((b) => b.size === 14), (await boxes(flow)).map((b) => b.size).join());

  await pickBox(flow, "Next");
  await toolbar.getByText("This box", { exact: true }).waitFor();
  check('styles: a picked box = "This box"', true);
  await toolbar.locator('button[title="Bigger text"]').click();
  await page.waitForTimeout(100);
  const sizes = (await boxes(flow)).map((b) => b.size);
  check("styles: the text size goes only to the picked box", same(sizes, [14, 16, 14]), sizes.join());

  const ellipses = () => element(flow).locator("svg ellipse").count();
  await toolbar.locator('button[title^="Box shape"]').click();
  await page.waitForTimeout(100);
  check("styles: the shape changes only the picked box", (await ellipses()) > 0 && (await element(flow).locator("svg rect").count()) > 0);
  await toolbar.locator('button[title="Box background"]').click();
  await page.locator('[title="None"]').first().click();
  await page.locator('[title="Close (Esc)"]').first().click();
  await page.waitForTimeout(100);

  await button("Add a step after").nth(1).click();
  await waitForBoxes(flow, 4);
  check("styles: + lets go of the picked box", (await outline.count()) === 0);
  // The drawn size can be smaller (text shrinks to fit), so the toolbar says what the box is set to.
  await pickBox(flow, "Step 3");
  const setSize = (await toolbar.locator('button[title^="Text size"]').innerText()).trim();
  check("styles: a new box copies the text size of the one beside it", setSize === "16", setSize);
  check("styles: a new box copies the shape of the one beside it", await toolbar.locator('button[title^="Box shape: circle"]').count() === 1);
  await inPanel("Edit flowchart", () => panelButton("Reset").click());
  await waitForBoxes(flow, 3);

  // ─── Flip and rotate ───────────────────────────────────────────────────────────────────────────────────────
  await inPanel("Flip", () => panelButton("Flip horizontal").click());
  await page.waitForTimeout(150);
  let flipped = await boxes(flow);
  check("flip: the boxes change sides", flipped[0].x > flipped[2].x, `${flipped[0].x} vs ${flipped[2].x}`);
  const plus = await button("Add a step after").first().boundingBox();
  check("flip: the first box's + moves to its new outer side", plus.x + plus.width / 2 < flipped[0].screenX, `${plus.x} vs ${flipped[0].screenX}`);
  await typeIn(flow, "First", "Flipped");
  let settings = (await boxes(flow)).map((b) => b.text);
  check("flip: a double-click types in the box under the mouse", settings[0] === "Flipped" && settings[1] === "Next", settings.join());
  await pickBox(flow, "Last");
  check("flip: a click picks the box under the mouse", (await outline.boundingBox()).x < flipped[0].screenX);
  before = await boxes(flow);
  await page.waitForTimeout(UNDO_STEP_MS);
  await dragBy(await outline.boundingBox(), -30, 60);
  after = await boxes(flow);
  check("flip: a dragged box follows the mouse", near(after[2].x, before[2].x - 30, 3) && near(after[2].y, before[2].y + 60, 3), `${after[2].x - before[2].x}, ${after[2].y - before[2].y}`);
  await page.keyboard.press("Escape");
  await inPanel("Flip", () => panelButton("Flip horizontal").click());

  await inPanel("Rotate", () => panelButton("90°").click());
  await page.waitForTimeout(150);
  const turned = await boxes(flow);
  check("rotate: the boxes turn with the diagram", near(turned[0].x, turned[1].x, 8) && turned[1].y > turned[0].y + 10, JSON.stringify(turned.map((b) => [b.x, b.y])));
  await typeIn(flow, "Next", "Turned");
  check("rotate: a double-click types in the box under the mouse", (await texts(flow))[1] === "Turned", (await texts(flow)).join());
  await inPanel("Rotate", () => panelButton("0°").click());
  await inPanel("Edit flowchart", () => panelButton("Reset").click());
  await waitForBoxes(flow, 3);

  // ─── A duplicate ───────────────────────────────────────────────────────────────────────────────────────────
  await typeIn(flow, "Next", "Copied text");
  await button("Duplicate").click();
  await page.waitForFunction(() => document.querySelectorAll('[data-slide-id="flow"] [data-element-id]').length === 2);
  const copy = await page.locator('[data-slide-id="flow"] [data-element-id]').last().getAttribute("data-element-id");
  check("duplicate: keeps the text", (await texts(copy)).includes("Copied text"), (await texts(copy)).join());
  check("duplicate: only the selected one shows its buttons", (await button("Remove this box").count()) === 3);
  await page.keyboard.press("Delete");
  await page.waitForFunction(() => document.querySelectorAll('[data-slide-id="flow"] [data-element-id]').length === 1);
  check("duplicate: Delete removes only the copy", (await texts(flow)).includes("Copied text"));

  // What's left for the save: a typed box, a bigger one and one with its own place.
  await selectDiagram(flow);
  await typeIn(flow, "Copied text", "Flow mark");
  await pickBox(flow, "Flow mark");
  await toolbar.locator('button[title="Bigger text"]').click();
  await pickBox(flow, "Last");
  await dragBy(await outline.boundingBox(), 20, 100);
  await page.mouse.click(1500, 900);
  await page.mouse.move(5, 5);
  await page.screenshot({ path: SHOTS + "diagrams-flowchart.png" });

  // ─── Cycle ─────────────────────────────────────────────────────────────────────────────────────────────────
  await goToSlide("cycle");
  const cycle = await addDiagram("cycle", "Cycle");
  check("cycle: starts with the 4 stages, no word cut in two", same(await texts(cycle), ["Egg", "Caterpillar", "Pupa", "Butterfly"]), (await texts(cycle)).join("|"));
  check("cycle: a short word keeps the full size", (await boxNamed(cycle, "Egg")).size === 12);
  await page.mouse.move(5, 5);
  await page.screenshot({ path: SHOTS + "diagrams-cycle.png" });
  await button("Add the next step").nth(1).click();
  await waitForBoxes(cycle, 5);
  check("cycle: + goes right after its box", (await texts(cycle))[2] === "Step 3", (await texts(cycle)).join());
  await limitsCase({ name: "cycle", id: cycle, addTitle: "Add the next step", removeTitle: "Remove this box", start: 5, max: 8, min: 3 });
  await inPanel("Edit cycle", async () => {
    await slider("Steps").fill("6");
    await waitForBoxes(cycle, 6);
    await panelButton("Reset").click();
    await waitForBoxes(cycle, 4);
  });
  check("cycle panel: Steps and Reset", (await texts(cycle))[0] === "Egg");
  await typeIn(cycle, "Egg", "Cycle mark");
  await page.mouse.click(1500, 900);

  // ─── Mind map ──────────────────────────────────────────────────────────────────────────────────────────────
  await goToSlide("mind");
  const mind = await addDiagram("mind", "Mind Map");
  check("mind map: the topic and 4 ideas", same(await texts(mind), ["Topic", "Idea 1", "Idea 2", "Idea 3", "Idea 4"]), (await texts(mind)).join());
  check("mind map: the topic has no ×", (await button("Remove this box").count()) === 4);
  await limitsCase({ name: "mind map", id: mind, addTitle: "Add an idea", removeTitle: "Remove this box", start: 4, max: 8, min: 2, extra: 1 });
  await inPanel("Edit mind map", async () => {
    await slider("Ideas").fill("3");
    await waitForBoxes(mind, 4);
  });
  await typeIn(mind, "Topic", "Mind mark");
  before = await boxes(mind);
  await pickBox(mind, "Mind mark");
  await page.waitForTimeout(UNDO_STEP_MS);
  await dragBy(await outline.boundingBox(), 30, 30);
  after = await boxes(mind);
  check("mind map: moving the topic leaves the ideas", near(after[1].x, before[1].x) && near(after[1].y, before[1].y) && near(after[0].x, before[0].x + 30, 3));
  await page.mouse.click(1500, 900);

  // ─── Tree ──────────────────────────────────────────────────────────────────────────────────────────────────
  await goToSlide("tree");
  const tree = await addDiagram("tree", "Tree");
  const treeWords = async () => [...(await texts(tree))].sort();
  check("tree: starts with its 6 boxes", same(await treeWords(), ["Animals", "Birds", "Cat", "Dog", "Eagle", "Mammals"].sort()), (await treeWords()).join());
  check("tree: the top box and every branch have a + for a branch", (await button("Add a branch").count()) === 3);
  check("tree: the top box has no ×, and at 2 branches they have none", (await button("Remove this branch").count()) === 0);
  check("tree: every box under a branch has a ×", (await button("Remove this box").count()) === 3);
  await button("Add a branch").first().click();
  await waitForBoxes(tree, 7);
  check('tree: a new branch is called "Group"', (await texts(tree)).includes("Group"));
  check("tree: at 3 branches each has a ×", (await button("Remove this branch").count()) === 3);
  await button("Add a branch").first().click();
  await waitForBoxes(tree, 8);
  check("tree: the + for a branch stops at 4", (await button("Add a branch").count()) === 0);
  const underButtons = await button("Add a box under").count();
  check("tree: every branch can still get a box under it", underButtons === 4, String(underButtons));
  for (let count = 2; count < 4; count++) {
    await button("Add a box under").first().click();
    await waitForBoxes(tree, 8 + count - 1);
  }
  check("tree: a branch stops at 4 boxes under it", (await button("Add a box under").count()) === 3, String(await button("Add a box under").count()));
  check("tree: its boxes offer no more + after them", (await button("Add a box after").count()) === 1, String(await button("Add a box after").count()));
  const beforeRemove = (await boxes(tree)).length;
  await button("Remove this branch").first().click();
  await waitForBoxes(tree, beforeRemove - 5);
  check("tree: removing a branch takes the boxes under it", (await boxes(tree)).length === beforeRemove - 5);
  await inPanel("Edit tree", async () => {
    await panelButton("Reset").click();
    await waitForBoxes(tree, 6);
    await panelButton("Add box").first().click();
    await waitForBoxes(tree, 7);
    await button("Remove box").first().click();
    await waitForBoxes(tree, 6);
    await panelButton("Add branch").click();
    await waitForBoxes(tree, 7);
    await button("Remove branch").last().click();
    await waitForBoxes(tree, 6);
  });
  check("tree panel: Add box, Remove box, Add branch, Remove branch", same(await treeWords(), ["Animals", "Birds", "Dog", "Cat", "Eagle", "Mammals"].sort()) || (await boxes(tree)).length === 6, (await treeWords()).join());
  await typeIn(tree, "Animals", "Tree mark");
  await page.mouse.click(1500, 900);

  // ─── Factor tree ───────────────────────────────────────────────────────────────────────────────────────────
  await goToSlide("factor");
  const factor = await addDiagram("factor", "Factor Tree");
  check("factor tree: starts with 9 numbers", (await boxes(factor)).length === 9, (await texts(factor)).join());
  check("factor tree: only the numbers with no split have a +", (await button("Split into two").count()) === 5);
  check("factor tree: every number but the top has a ×", (await button("Remove this pair").count()) === 8);
  await page.waitForTimeout(UNDO_STEP_MS);
  await button("Split into two").first().click();
  await waitForBoxes(factor, 11);
  check('factor tree: a split makes two "?"', (await texts(factor)).filter((t) => t === "?").length === 2);
  await page.waitForTimeout(UNDO_STEP_MS);
  await undoButton.click();
  await waitForBoxes(factor, 9);
  check("factor tree: one undo takes the split back", true);

  // Moving a number takes the numbers under it along, and only those.
  before = await boxes(factor);
  await pickBox(factor, "8");
  await page.waitForTimeout(UNDO_STEP_MS);
  await dragBy(await outline.boundingBox(), 60, 40);
  after = await boxes(factor);
  const moved = after.filter((b, i) => near(b.x, before[i].x + 60, 3) && near(b.y, before[i].y + 40, 3));
  const stayed = after.filter((b, i) => near(b.x, before[i].x) && near(b.y, before[i].y));
  check("factor tree: moving 8 takes its 4 numbers under it along", moved.length === 5, moved.map((b) => b.text).join());
  check("factor tree: the other numbers stay", stayed.length === 4, stayed.map((b) => b.text).join());
  await page.waitForTimeout(UNDO_STEP_MS);
  await undoButton.click();
  await page.waitForTimeout(150);

  // × takes the number, its partner and everything under both.
  await page.keyboard.press("Escape");
  await button("Remove this pair").first().click();
  await waitForBoxes(factor, 1);
  check("factor tree: × on a pair takes everything under it", (await texts(factor))[0] === "48");
  check("factor tree: the top number alone has a + and no ×", (await button("Split into two").count()) === 1 && (await button("Remove this pair").count()) === 0);
  await page.waitForTimeout(UNDO_STEP_MS);
  await undoButton.click();
  await waitForBoxes(factor, 9);
  await typeIn(factor, "48", "Factor mark");
  await page.mouse.click(1500, 900);

  // ─── Factor tree limits (saved as big as they can be) ──────────────────────────────────────────────────────
  await goToSlide("limits");
  check("limits: 8 levels and 31 boxes open", (await boxes("deep")).length === 15 && (await boxes("full")).length === 31, `${(await boxes("deep")).length}, ${(await boxes("full")).length}`);
  await selectDiagram("deep");
  check("limits: the 8th level can't split", (await button("Split into two").count()) === 6, String(await button("Split into two").count()));
  await page.mouse.click(1590, 990);
  await selectDiagram("full");
  check("limits: 31 boxes can't split any more", (await button("Split into two").count()) === 0, String(await button("Split into two").count()));
  await button("Remove this pair").last().click();
  await waitForBoxes("full", 29);
  check("limits: taking a pair away lets numbers split again", (await button("Split into two").count()) === 15, String(await button("Split into two").count()));
  await page.mouse.click(1590, 990);

  // ─── A diagram inside a question box ───────────────────────────────────────────────────────────────────────
  await goToSlide("boxed");
  const area = await page.locator('[data-slide-id="boxed"] [data-container-id="question"]').boundingBox();
  await selectDiagram("in-box");
  await pickBox("in-box", "Boxed B");
  await dragBy(await outline.boundingBox(), 40, 20);
  const small = await boxNamed("in-box", "Boxed B");
  check("question box: a box can move inside", small.y > 0, JSON.stringify(small));
  await dragBy(await outline.boundingBox(), 1400, 0);
  let edge = await element("in-box").boundingBox();
  check("question box: a dragged box stops at the box's right edge", edge.x + edge.width <= area.x + area.width + 2, `${edge.x + edge.width} vs ${area.x + area.width}`);
  await dragBy(await outline.boundingBox(), 0, 700);
  edge = await element("in-box").boundingBox();
  check("question box: and at its bottom edge", edge.y + edge.height <= area.y + area.height + 2, `${edge.y + edge.height} vs ${area.y + area.height}`);
  await page.mouse.click(1590, 990);

  // ─── Slides saved earlier ──────────────────────────────────────────────────────────────────────────────────
  await goToSlide("older");
  check("saved earlier: no settings draws the starting boxes", same(await texts("no-settings"), ["First", "Next", "Last"]), (await texts("no-settings")).join());
  const placed = await boxes("own-place");
  check("saved earlier: a box keeps its own place", placed[0].x > placed[1].x, JSON.stringify(placed.map((b) => [b.text, b.x])));
  await selectDiagram("no-settings");
  await typeIn("no-settings", "Next", "Older mark");
  await page.mouse.click(1590, 990);

  // ─── A diagram the editor couldn't have made ───────────────────────────────────────────────────────────────
  await goToSlide("broken");
  check("broken data: too many steps opens with the starting boxes", same(await texts("too-many"), ["First", "Next", "Last"]), (await texts("too-many")).join());
  check("broken data: half a place opens with the starting boxes", same(await texts("half-place"), ["First", "Next", "Last"]), (await texts("half-place")).join());
  check("broken data: the good diagram beside them is untouched", same(await texts("good-one"), ["Still here", "Me too"]), (await texts("good-one")).join());
  await selectDiagram("too-many");
  await typeIn("too-many", "Next", "Fixed");
  check("broken data: the diagram can be edited again", (await texts("too-many"))[1] === "Fixed");
  await page.mouse.click(1590, 990);

  // ─── Save ──────────────────────────────────────────────────────────────────────────────────────────────────
  await page.keyboard.press("Control+s");
  const element0 = async (id) => (await savedSlide(id))?.elements[0];
  // Auto save may have sent the earlier slides already, so this waits for the very last edit.
  check("saved: the last edit reached the database", await waitForSaved(async () => (await element0("broken"))?.flowchart?.steps[1].text === "Fixed"));
  check("saved: the repaired diagram is within the limits", (await element0("broken")).flowchart.steps.length === 3);
  await page.locator('button[title="Save (Ctrl+S)"]', { hasText: /^Saved$/ }).waitFor();
  const flowSaved = () => savedSlide("flow").then((s) => s?.elements.find((e) => e.id === flow));
  check(
    "saved: the flowchart's text, size and own place",
    await waitForSaved(async () => {
      const steps = (await flowSaved())?.flowchart?.steps;
      return steps?.[1].text === "Flow mark" && steps?.[1].fontSize === 14 && ["x", "y", "width", "height"].every((k) => typeof steps?.[2][k] === "number");
    }),
    JSON.stringify((await flowSaved())?.flowchart?.steps),
  );
  const steps = (await flowSaved()).flowchart.steps;
  check("saved: a box not moved has no place of its own", ["x", "y", "width", "height"].every((k) => steps[0][k] === undefined), JSON.stringify(steps[0]));
  check("saved: nothing picked or typed is saved", !JSON.stringify(await flowSaved()).includes("picked"));
  check("saved: the cycle", (await element0("cycle")).cycle.steps[0].text === "Cycle mark");
  check("saved: the mind map", (await element0("mind")).mindMap.center.text === "Mind mark");
  check("saved: the tree", (await element0("tree")).tree.root.text === "Tree mark");
  check("saved: the factor tree", (await element0("factor")).factorTree.root.text === "Factor mark");
  check("saved: a diagram that had no settings", (await element0("older")).flowchart.steps[1].text === "Older mark");

  // ─── Reload ────────────────────────────────────────────────────────────────────────────────────────────────
  await page.reload({ timeout: 120_000 });
  await page.locator('[data-slide-id="flow"]').waitFor();
  for (const [slide, id, mark] of [["flow", flow, "Flow mark"], ["cycle", cycle, "Cycle mark"], ["mind", mind, "Mind mark"], ["tree", tree, "Tree mark"], ["factor", factor, "Factor mark"], ["older", "no-settings", "Older mark"]]) {
    await goToSlide(slide);
    await element(id).waitFor();
    check(`after reload: ${slide} shows its text`, (await texts(id)).includes(mark), (await texts(id)).join());
  }
  check("opening counts as no change", (await button("Save (Ctrl+S)").innerText()).trim() === "Saved", await button("Save (Ctrl+S)").innerText());

  // ─── Present ───────────────────────────────────────────────────────────────────────────────────────────────
  await goToSlide("flow");
  await page.locator('button[title="Present (fullscreen)"]').first().click();
  const screen = page.locator(".fixed.inset-0.z-50").filter({ has: button("Exit presentation (Esc)") });
  const shown = screen.locator('[aria-hidden="false"]');
  for (const [i, mark] of ["Flow mark", "Cycle mark", "Mind mark", "Tree mark", "Factor mark"].entries()) {
    if (i > 0) await page.keyboard.press("ArrowRight");
    // Its two words can be drawn on two lines.
    await shown.locator("svg text").filter({ hasText: new RegExp(mark.replace(" ", "\\s*")) }).first().waitFor();
    check(`present: slide ${i + 1} shows "${mark}"`, true);
    check(`present: slide ${i + 1} has no + or ×`, (await screen.locator(ALL_BUTTONS.replaceAll("[data-slide-id] ", "")).count()) === 0);
  }
  check("present: nothing can be typed in", (await screen.locator("textarea").count()) === 0);
  await page.screenshot({ path: SHOTS + "diagrams-present.png" });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.mouse.move(800, 300);
  await page.mouse.move(810, 310);
  await button("Exit presentation (Esc)").click();
  await screen.waitFor({ state: "detached" });
  check("presenting counts as no change", (await button("Save (Ctrl+S)").innerText()).trim() === "Saved", await button("Save (Ctrl+S)").innerText());

  await page.goto(`${APP}/presentation/${presentationId}`, { timeout: 120_000 });
  await page.getByText("Diagrams e2e", { exact: true }).first().waitFor();
  check("the view page opens too", (await page.getByText("Something went wrong", { exact: true }).count()) === 0);

  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (error) {
  check("run finished without an exception", false, String(error).split("\n").slice(0, 14).join(" "));
  await page.screenshot({ path: SHOTS + "diagrams-failure.png" }).catch(() => {});
} finally {
  await browser.close();
  await deleteTeacher(teacher);
}

finish();
