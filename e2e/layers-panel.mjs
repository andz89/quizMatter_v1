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
  const rowNames = () => panel.locator("li[title]").evaluateAll((rows) => rows.map((r) => r.getAttribute("title")));
  const names = await rowNames();
  check("top layer first, group folded", names.join("|") === "Group · 2 items|Rectangle|Circle|Star", names.join("|"));

  // Opening the group shows its two members.
  await panel.getByRole("button", { name: "Show the group's items" }).click();
  check("group members show", (await rowNames()).length === 6, (await rowNames()).join("|"));

  // Hover outlines the hidden circle on the slide; a click selects it.
  const circleRow = panel.locator('li[title="Circle"]');
  await circleRow.hover();
  const outline = await page.locator('[data-slide-id="s1"] [data-svg-element]:not([data-element-id])').evaluateAll((items) =>
    items.filter((i) => i.style.outline.includes("solid")).length
  );
  check("hover outlines one element", outline === 1, String(outline));
  await circleRow.click();
  check("click selects the hidden circle", (await circleRow.getAttribute("class")).includes("bg-accent-soft"));
  await page.screenshot({ path: `${SHOTS}layers-panel.png` });

  // Drag the circle above the rectangle.
  const rectRow = panel.locator('li[title="Rectangle"]');
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

  // Escape closes the panel.
  await page.keyboard.press("Escape");
  check("Escape closes the panel", (await page.locator("h2", { hasText: "Layers" }).count()) === 0);
  check("no page errors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  await deleteTeacher(teacher);
}
finish();
