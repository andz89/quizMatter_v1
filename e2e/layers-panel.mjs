// The editor's Layers panel: lists the slide's elements box by box, top layer first, with groups; a click selects a
// hidden element; hovering outlines it; dragging a row changes the order (one undo step, and it saves).
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { APP, SHOTS, api, check, deleteTeacher, finish, loggedIn, makeTeacher } from "./lib.mjs";

const el = (id, assetId, x, y, size, extra = {}) => ({
  id, assetId, x, y, width: size, height: size, color: "#3B82F6", containerId: null, ...extra,
});

const teacher = await makeTeacher({ first: "Layers", last: "Panel" });
const presentationId = randomUUID();
await api("/rest/v1/presentations", {
  method: "POST",
  body: JSON.stringify({ id: presentationId, owner_id: teacher.id, title: "Layers e2e", data_version: 1 }),
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
        question: "Which is round?",
        questionHtml: "<p>Which is round?</p>",
        layout: "grid",
        options: [
          { id: "s1-a", text: "A" },
          { id: "s1-b", text: "B" },
          { id: "s1-c", text: "C" },
          { id: "s1-d", text: "D" },
        ],
        correctOptionId: null,
        questionHeight: 150,
        // Bottom to top: a small circle, then a big rectangle covering it, a group of two stars, and a star in answer B.
        elements: [
          el("small", "circle", 520, 400, 60),
          el("big", "rectangle", 400, 300, 400),
          el("g1", "star", 50, 300, 80, { groupId: "G" }),
          el("g2", "star", 150, 300, 80, { groupId: "G" }),
          el("inB", "star", 10, 10, 50, { containerId: "s1-b" }),
        ],
      },
    },
    // True or false: answer C isn't shown, so its star isn't listed.
    {
      presentation_id: presentationId,
      id: "s2",
      position: 1,
      data: {
        id: "s2",
        type: "true-false",
        question: "The sun is a star.",
        questionHtml: "<p>The sun is a star.</p>",
        layout: "grid",
        options: ["a", "b", "c", "d"].map((x) => ({ id: `s2-${x}`, text: x })),
        correctOptionId: null,
        questionHeight: 150,
        elements: [el("free2", "circle", 50, 600, 60), el("inC", "star", 10, 10, 50, { containerId: "s2-c" })],
      },
    },
    // Hidden, so locked: the panel says so instead of listing.
    {
      presentation_id: presentationId,
      id: "s3",
      position: 2,
      data: {
        id: "s3",
        type: "blank",
        question: "",
        layout: "grid",
        options: ["a", "b", "c", "d"].map((x) => ({ id: `${x}-opt`, text: "" })),
        correctOptionId: null,
        questionHeight: 150,
        hidden: true,
        elements: [el("h1", "circle", 50, 50, 60)],
      },
    },
    // 1,000 elements (the most a slide takes), for speed.
    {
      presentation_id: presentationId,
      id: "s4",
      position: 3,
      data: {
        id: "s4",
        type: "blank",
        question: "",
        layout: "grid",
        options: ["a", "b", "c", "d"].map((x) => ({ id: `${x}-opt4`, text: "" })),
        correctOptionId: null,
        questionHeight: 150,
        elements: Array.from({ length: 1000 }, (_, i) => el(`m${i}`, i % 2 ? "circle" : "star", (i % 40) * 31, Math.floor(i / 40) * 28, 24)),
      },
    },
    // Review fixes: a star in answer A covered by a rectangle; a free circle and a group of three stars.
    {
      presentation_id: presentationId,
      id: "s5",
      position: 4,
      data: {
        id: "s5",
        type: "choice",
        question: "Pick one",
        questionHtml: "<p>Pick one</p>",
        layout: "grid",
        options: ["a", "b", "c", "d"].map((x) => ({ id: `s5-${x}`, text: x })),
        correctOptionId: null,
        questionHeight: 150,
        elements: [
          el("x5", "circle", 50, 620, 60),
          el("h1", "star", 300, 620, 60, { groupId: "H" }),
          el("h2", "star", 400, 620, 60, { groupId: "H" }),
          el("h3", "star", 500, 620, 60, { groupId: "H" }),
          el("sa", "star", 20, 20, 40, { containerId: "s5-a" }),
          el("cover", "rectangle", 0, 0, 120, { containerId: "s5-a" }),
        ],
      },
    },
  ]),
});

const browser = await chromium.launch();
const page = await (await loggedIn(browser, teacher, { width: 1600, height: 1000 })).newPage();
page.setDefaultTimeout(60_000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

// The saved order of the slide's element ids, bottom to top.
const savedOrder = async () => {
  const rows = await api(`/rest/v1/slides?presentation_id=eq.${presentationId}&id=eq.s1&select=data`);
  return rows[0].data.elements.map((e) => e.id).join(",");
};

try {
  await page.goto(`${APP}/presentation/${presentationId}/edit`, { timeout: 120_000 });
  await page.locator('[data-slide-id="s1"]').waitFor();
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  const panel = page.locator("h2", { hasText: "Layers" }).locator("xpath=../..");
  await panel.waitFor();

  const labels = await panel.locator("span.uppercase").allTextContents();
  check("boxes: on the slide, then answer B", labels.join("|") === "On the slide|Answer B", labels.join("|"));
  const rowNames = () => panel.locator("[data-layer-row][title]").evaluateAll((rows) => rows.map((r) => r.getAttribute("title")));
  const names = await rowNames();
  check("top layer first, group folded", names.join("|") === "Group · 2 items|Rectangle|Circle|Star", names.join("|"));

  // Opening the group shows its two members.
  await panel.getByRole("button", { name: "Show the group's items" }).click();
  check("group members show", (await rowNames()).length === 6, (await rowNames()).join("|"));

  // Hover outlines the hidden circle on the slide; a click selects it.
  const circleRow = panel.locator('[data-layer-row][title="Circle"]');
  await circleRow.hover();
  const outline = await page.locator('[data-slide-id="s1"] [data-svg-element]:not([data-element-id])').evaluateAll((items) =>
    items.filter((i) => i.style.outline.includes("solid")).length
  );
  check("hover outlines one element", outline === 1, String(outline));
  await circleRow.click();
  check("click selects the hidden circle", (await circleRow.getAttribute("class")).includes("bg-accent-soft"));
  await page.screenshot({ path: `${SHOTS}layers-panel.png` });

  // Drag the circle above the rectangle.
  const rectRow = panel.locator('[data-layer-row][title="Rectangle"]');
  const from = await circleRow.boundingBox();
  const to = await rectRow.boundingBox();
  await page.mouse.move(from.x + 100, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 100, from.y + from.height / 2 - 10, { steps: 3 });
  await page.mouse.move(to.x + 100, to.y + 5, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const afterDrag = (await rowNames()).filter((n) => !n.startsWith("Star")).join("|");
  check("drag puts the circle above the rectangle", afterDrag === "Group · 2 items|Circle|Rectangle", afterDrag);

  await page.keyboard.press("Control+s");
  await page.waitForTimeout(2500);
  const order = await savedOrder();
  check("the new order is saved", order === "big,small,g1,g2,inB", order);

  // Undo takes it back in one step.
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(300);
  const undone = (await rowNames()).filter((n) => !n.startsWith("Star")).join("|");
  check("one undo puts it back", undone === "Group · 2 items|Rectangle|Circle", undone);

  // Enter on a focused row picks it, like a click.
  await rectRow.focus();
  await page.keyboard.press("Enter");
  check("Enter picks the focused row", (await rectRow.getAttribute("class")).includes("bg-accent-soft"));

  // Dropped far down, over the next box's row: it still lands in its own box, at the bottom.
  const r = await rectRow.boundingBox();
  const starB = await panel.locator("section", { hasText: "Answer B" }).locator("[data-layer-row][title]").boundingBox();
  await page.mouse.move(r.x + 100, r.y + r.height / 2);
  await page.mouse.down();
  await page.mouse.move(r.x + 100, r.y + r.height / 2 + 10, { steps: 3 });
  await page.mouse.move(r.x + 100, starB.y + starB.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const afterEdgeDrop = (await rowNames()).filter((n) => !n.startsWith("Star")).join("|");
  check("a drop over the next box stays in its own box", afterEdgeDrop === "Group · 2 items|Circle|Rectangle", afterEdgeDrop);

  const showSlide = async (id) => {
    await page.locator(`[data-slide-id="${id}"]`).evaluate((s) => s.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(800);
  };

  // True or false: answer C isn't on the slide, so its star isn't listed.
  await showSlide("s2");
  const s2Labels = (await panel.locator("span.uppercase").allTextContents()).join("|");
  check("a box the slide doesn't show isn't listed", s2Labels === "On the slide", s2Labels);
  check("only the shown element is listed", (await rowNames()).join("|") === "Circle", (await rowNames()).join("|"));

  await showSlide("s3");
  check("a hidden slide says so", await panel.getByText("This slide is hidden").isVisible());

  // 1,000 elements: the panel lists them all, fast, and dragging one on the slide stays quick with it open.
  let started = Date.now();
  await showSlide("s4");
  await panel.locator("[data-layer-row][title]").nth(999).waitFor({ state: "attached" });
  const openMs = Date.now() - started - 800;
  check("1,000 rows show within 3 seconds", openMs < 3000, `${openMs} ms`);

  const dragOnSlide = async () => {
    const box = await page.locator('[data-slide-id="s4"] [data-element-id="m500"]').boundingBox();
    const t = Date.now();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 30; i++) await page.mouse.move(box.x + box.width / 2 + i * 3, box.y + box.height / 2 + i);
    await page.mouse.up();
    return Date.now() - t;
  };
  const withPanel = await dragOnSlide();
  await page.keyboard.press("Control+z");
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  const withoutPanel = await dragOnSlide();
  await page.keyboard.press("Control+z");
  // Each row is redrawn only when its own element changes (before, every row redrew on every move: about 2.4×).
  check("a drag on the slide isn't much slower with the panel open", withPanel < withoutPanel * 1.6 + 300, `${withPanel} ms open, ${withoutPanel} ms closed`);
  await page.getByRole("button", { name: "Layers", exact: true }).click();

  // Review fixes, on slide 5.
  await showSlide("s5");
  const s5Labels = (await panel.locator("span.uppercase").allTextContents()).join("|");
  check("slide 5 lists the slide and answer A", s5Labels === "On the slide|Answer A", s5Labels);
  const s5 = page.locator('[data-slide-id="s5"]');

  // A star covered by a rectangle in its box: picked from the panel, its handles are above the rectangle.
  await panel.locator("section", { hasText: "Answer A" }).locator('[data-layer-row][title="Star"]').click();
  const handleOnTop = await s5.locator('[title="Resize"]').evaluateAll((handles) =>
    handles.map((h) => {
      const r = h.getBoundingClientRect();
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.getAttribute("title");
    })
  );
  check("a covered element's handles in a box are on top", handleOnTop.length === 4 && handleOnTop.every((t) => t === "Resize"), handleOnTop.join("|"));

  // Shift-clicking a group member's row adds (and then takes out) only that member.
  const freeRows = panel.locator("section", { hasText: "On the slide" });
  const xRow = freeRows.locator('[data-layer-row][title="Circle"]');
  const groupRow = freeRows.locator('[data-layer-row][title^="Group"]');
  await xRow.click();
  await freeRows.getByRole("button", { name: "Show the group's items" }).click();
  const memberRows = freeRows.locator("li li[data-layer-row]");
  const picked = async () => {
    const all = [xRow, memberRows.nth(0), memberRows.nth(1), memberRows.nth(2)];
    return (await Promise.all(all.map(async (r) => ((await r.getAttribute("class")).includes("bg-accent-soft") ? 1 : 0)))).join("");
  };
  await memberRows.nth(1).click({ modifiers: ["Shift"] });
  check("Shift adds only that member", (await picked()) === "1010", await picked());
  await memberRows.nth(1).click({ modifiers: ["Shift"] });
  check("Shift again takes out only that member", (await picked()) === "1000", await picked());

  // Dragging an open group's row moves its members with it.
  const g = await groupRow.boundingBox();
  const memberBefore = await memberRows.nth(2).boundingBox();
  await page.mouse.move(g.x + 100, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + 100, g.y + g.height / 2 + 10, { steps: 3 });
  await page.mouse.move(g.x + 100, g.y + g.height / 2 + 40, { steps: 5 });
  await page.waitForTimeout(300);
  const gMoved = (await groupRow.boundingBox()).y - g.y;
  const memberMoved = (await memberRows.nth(2).boundingBox()).y - memberBefore.y;
  check("the members move with the dragged group row", gMoved > 20 && Math.abs(gMoved - memberMoved) < 3, `${gMoved} / ${memberMoved}`);
  const xBox = await xRow.boundingBox();
  await page.mouse.move(g.x + 100, xBox.y + xBox.height - 5, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const freeNames = (await freeRows.locator(":scope > ul > [data-layer-row], :scope > ul > li > [data-layer-row]").evaluateAll((rows) => rows.map((r) => r.getAttribute("title")))).join("|");
  check("the group lands below the circle", freeNames === "Circle|Group · 3 items", freeNames);

  // A hovered row whose element is deleted takes its outline with it: undo brings the element back unoutlined.
  await xRow.hover();
  await xRow.click();
  await page.keyboard.press("Delete");
  await page.waitForTimeout(300);
  check("Delete removes the circle's row", (await xRow.count()) === 0);
  // Off the panel, so the circle's row doesn't come back under the pointer (that would hover it again, rightly).
  await page.mouse.move(5, 5);
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(300);
  const stuck = await s5.locator("[data-svg-element]:not([data-element-id])").evaluateAll((items) =>
    items.filter((i) => i.style.outline.includes("solid")).length
  );
  check("no hover outline is left after undo", stuck === 0, String(stuck));

  // Escape closes the panel.

  await page.keyboard.press("Escape");
  check("Escape closes the panel", (await page.locator("h2", { hasText: "Layers" }).count()) === 0);
  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  await page.screenshot({ path: `${SHOTS}layers-fail.png` }).catch(() => {});
  console.log("errors:", errors.join(" | "));
  throw e;
} finally {
  await browser.close();
  await deleteTeacher(teacher);
}
finish();
