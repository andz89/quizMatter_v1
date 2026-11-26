// Element effects (docs/superpowers/specs/2026-11-26-element-effects-design.md): on a blank slide, elements with an
// effect come in one click at a time while presenting; Back hides them again; a question slide ignores them; the
// editor's Effects panel sets one and shows its step number on the slide.
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { APP, SHOTS, api, check, deleteTeacher, finish, loggedIn, makeTeacher } from "./lib.mjs";

const teacher = await makeTeacher({ first: "Effects" });
const presentationId = randomUUID();
await api("/rest/v1/presentations", {
  method: "POST",
  body: JSON.stringify({ id: presentationId, owner_id: teacher.id, title: "Element effects e2e", data_version: 7, transition: "none" }),
});
const star = (id, x, effect) => ({ id, assetId: "star", x, y: 200, width: 150, height: 150, color: "#6B3DF5", containerId: null, ...(effect ? { effect } : {}) });
const options = (id) => ["a", "b", "c", "d"].map((o) => ({ id: `${id}-${o}`, text: `${o.toUpperCase()}` }));
const slides = [
  {
    id: "s1", type: "blank", question: "", layout: "grid", options: options("s1"), correctOptionId: null, questionHeight: 100,
    elements: [star("a", 100, { type: "fade", order: 1, speed: 3 }), star("b", 400, { type: "pop", order: 2, speed: 3 }), star("c", 700)],
  },
  {
    id: "s2", type: "choice", question: "Quiz", layout: "grid", options: options("s2"), correctOptionId: null, questionHeight: 100,
    elements: [star("q", 900, { type: "fade", order: 1, speed: 3 })],
  },
];
await api("/rest/v1/slides", {
  method: "POST",
  body: JSON.stringify(slides.map((data, position) => ({ presentation_id: presentationId, id: data.id, position, data }))),
});

const browser = await chromium.launch();
const page = await (await loggedIn(browser, teacher, { width: 1600, height: 1000 })).newPage();
page.setDefaultTimeout(60_000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

try {
  await page.goto(`${APP}/presentation/${presentationId}/edit`, { timeout: 120_000 });
  const slideBox = (id) => page.locator(`[data-slide-id="${id}"]`);
  await slideBox("s2").waitFor();

  // On screen while presenting: the element's box in the slide being shown, and how see-through it is.
  const shownEl = (id) => page.locator(`[aria-hidden="false"] div[data-element-id="${id}"]`);
  const opacity = async (id) => Number(await shownEl(id).evaluate((el) => getComputedStyle(el).opacity));
  const isShown = async (id) => (await shownEl(id).count()) === 1 && (await opacity(id)) === 1;
  const isHidden = async (id) => (await shownEl(id).count()) === 1 && (await opacity(id)) === 0;
  const settle = () => page.waitForTimeout(900);

  // The editor shows everything.
  check("the editor shows elements with effects", (await slideBox("s1").locator('[data-element-id="a"]').count()) === 1);

  await slideBox("s1").scrollIntoViewIfNeeded();
  await page.locator('button[title="Present (fullscreen)"]').first().click();
  await shownEl("c").waitFor();
  check("presenting: an element without an effect shows at once", await isShown("c"));
  check("presenting: elements with effects start hidden", (await isHidden("a")) && (await isHidden("b")));

  await page.keyboard.press("ArrowRight");
  await settle();
  check("Next shows step 1 (Fade) only", (await isShown("a")) && (await isHidden("b")));
  await page.keyboard.press(" ");
  await settle();
  check("Space shows step 2 (Pop up)", (await isShown("a")) && (await isShown("b")));
  const transform = await shownEl("b").evaluate((el) => getComputedStyle(el).transform);
  check("Pop up ends at full size", transform === "none" || transform === "matrix(1, 0, 0, 1, 0, 0)", transform);

  await page.keyboard.press("ArrowRight");
  await shownEl("q").waitFor();
  await settle();
  check("Next after the last step goes to the next slide", (await shownEl("a").count()) === 0);
  check("a question slide ignores element effects", await isShown("q"));

  await page.keyboard.press("ArrowLeft");
  await shownEl("a").waitFor();
  await settle();
  check("Back to a slide shows all its steps", (await isShown("a")) && (await isShown("b")));
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(200);
  check("Back hides the last step", (await isShown("a")) && (await isHidden("b")));
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(200);
  check("Back again hides step 1", (await isHidden("a")) && (await isHidden("b")));

  // Two quick presses: the first effect ends at once and both end fully shown.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(1000);
  check("two quick presses leave both fully shown", (await isShown("a")) && (await isShown("b")));
  const quickTransform = await shownEl("b").evaluate((el) => getComputedStyle(el).transform);
  check("…and Pop up isn't left half size", quickTransform === "none" || quickTransform === "matrix(1, 0, 0, 1, 0, 0)", quickTransform);
  await page.screenshot({ path: SHOTS + "element-effects-present.png" });

  await page.keyboard.press("Escape");
  await slideBox("s1").waitFor();

  // The editor: pick c, give it Fade in the Element effects tab, and its badge says 3.
  await slideBox("s1").scrollIntoViewIfNeeded();
  await slideBox("s1").locator('[data-element-id="c"]').click();
  await page.locator('button[title="Slide and element effects"]').first().click();
  await page.getByRole("tab", { name: "Element effects" }).click();
  const rows = page.locator("ol li");
  check("a picked element with no effect gets the dashed row", await page.getByText("No effect yet: pick one").isVisible());
  check("…and the list has only the 2 steps", (await rows.count()) === 2);
  await page.getByRole("radio", { name: "Fade" }).click();
  const badge = slideBox("s1").locator('[title="Comes in at click 3"]');
  await badge.waitFor({ timeout: 3000 }).catch(() => {});
  check("the Effects panel gives c step 3 and its badge shows", (await badge.count()) === 1);
  check("On this slide lists 3 steps", (await rows.count()) === 3);
  check("the dashed row is gone", (await page.getByText("No effect yet: pick one").count()) === 0);
  check("the picked step's row opens with its switch and speed inside", (await rows.nth(2).getByRole("radio", { name: "Fade" }).getAttribute("aria-checked")) === "true" && (await rows.nth(2).getByLabel("Speed").count()) === 1);
  check("the other rows stay closed", (await rows.nth(0).getByRole("radiogroup").count()) === 0);
  // Clicking another row picks its element and opens that row instead; its switch changes the effect.
  await rows.nth(0).getByRole("button", { name: /Star/ }).click();
  await rows.nth(0).getByRole("radio", { name: "Pop up" }).click();
  check("a row's switch changes its effect", (await rows.nth(0).textContent()).includes("Pop up") && (await rows.nth(2).getByRole("radiogroup").count()) === 0);
  await page.screenshot({ path: SHOTS + "element-effects-panel.png" });

  // On a question slide the tab only says where effects work.
  await slideBox("s2").locator('[data-element-id="q"]').click();
  check("a question slide's tab says effects work on Blank and Title slides", await page.getByText("Element effects work on Blank and Title slides.").isVisible());

  check("no page errors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  await deleteTeacher(teacher);
}
finish();
