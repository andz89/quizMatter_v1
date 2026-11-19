// The top bar's middle toolbars at laptop width while typing in a table (text toolbar + table toolbar, too wide for
// one line): the first row stays inside the bar, none goes off the top of the screen, and a single toolbar still sits
// in the middle of the bar's height.
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { APP, SHOTS, api, check, deleteTeacher, finish, loggedIn, makeTeacher } from "./lib.mjs";

const teacher = await makeTeacher({ first: "Toolbarrows" });
const presentationId = randomUUID();
await api("/rest/v1/presentations", {
  method: "POST",
  body: JSON.stringify({ id: presentationId, owner_id: teacher.id, title: "", data_version: 1 }),
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
        type: "blank",
        question: "",
        layout: "grid",
        options: ["a", "b", "c", "d"].map((o) => ({ id: `s1-${o}`, text: "" })),
        correctOptionId: null,
        elements: [],
        questionHeight: 100,
      },
    },
  ]),
});

const browser = await chromium.launch();
const page = await (await loggedIn(browser, teacher, { width: 1280, height: 720 })).newPage();
page.setDefaultTimeout(60_000);

/** The bar's box and each toolbar's box inside the middle area. */
const measure = () =>
  page.evaluate(() => {
    const bar = document.querySelector("header");
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
    };
    return { bar: box(bar), toolbars: [...bar.querySelector(":scope > .order-last").children].map(box) };
  });

try {
  await page.goto(`${APP}/presentation/${presentationId}/edit`, { timeout: 120_000 });
  const slide = page.locator('[data-slide-id="s1"]');
  await slide.waitFor();

  await page.locator('button[title="Elements"]').click();
  await page.getByRole("button", { name: "Table", exact: true }).click();
  const grid = slide.locator("[data-element-id] .grid").first();
  await grid.waitFor();
  await page.locator('button[title="Elements"]').click();

  // The table picked, not typing: one toolbar, in the middle of the bar's height.
  await page.locator('[data-element-toolbar]').waitFor();
  const one = await measure();
  const [only] = one.toolbars;
  check(
    "a single toolbar sits in the middle of the bar",
    one.toolbars.length === 1 && Math.abs(only.top - one.bar.top - (one.bar.bottom - only.bottom)) <= 4,
    JSON.stringify(one),
  );

  // Typing in a cell: the text toolbar and the table's toolbar, too wide for one line.
  await grid.locator('[data-table-row="0"][data-table-column="0"]').dblclick();
  await slide.locator('[contenteditable="true"]').waitFor();
  await page.locator('button[title="Bold (Ctrl+B)"]').waitFor();

  const two = await measure();
  await page.screenshot({ path: SHOTS + "toolbar-rows.png", clip: { x: 0, y: 0, width: 1280, height: 140 } });
  check("both toolbars show", two.toolbars.length === 2, JSON.stringify(two));
  check("no toolbar goes off the top of the screen", two.toolbars.every((t) => t.top >= 0), JSON.stringify(two));
  check("the first toolbar is inside the bar", two.toolbars[0].top >= two.bar.top && two.toolbars[0].bottom <= two.bar.bottom, JSON.stringify(two));
} finally {
  await browser.close();
  await deleteTeacher(teacher);
}
finish();
