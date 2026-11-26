// Presenting fullscreen: the tip at the bottom center (fades in, stays 6 seconds, its ✕ closes it sooner)
// and the Space key (shows / hides the answer key; on a slide without one it goes to the next slide).
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { APP, SHOTS, api, check, deleteTeacher, finish, loggedIn, makeTeacher } from "./lib.mjs";

const TIP_TEXT = "If this slide has a saved answer key, click the check icon at the bottom left or press Space to reveal it.";

// Alpha: a choice slide with B correct. Manila: a short-answer slide. Gamma: a choice slide with no answer. Delta: last.
const teacher = await makeTeacher({ first: "Answer" });
const presentationId = randomUUID();
await api("/rest/v1/presentations", {
  method: "POST",
  body: JSON.stringify({ id: presentationId, owner_id: teacher.id, title: "Answer key e2e", data_version: 1 }),
});
const slide = (id, question, extra = {}) => ({
  id,
  type: "choice",
  question,
  layout: "grid",
  options: ["a", "b", "c", "d"].map((o) => ({ id: `${id}-${o}`, text: `${question} ${o.toUpperCase()}` })),
  correctOptionId: null,
  elements: [],
  questionHeight: 100,
  ...extra,
});
const slides = [
  slide("s1", "Alpha", { correctOptionId: "s1-b" }),
  slide("s2", "Capital of the Philippines", {
    type: "short-answer",
    options: ["a", "b", "c", "d"].map((o) => ({ id: `s2-${o}`, text: "" })),
    correctAnswer: "Manila",
  }),
  slide("s3", "Gamma"),
  slide("s4", "Delta"),
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
  await slideBox("s4").waitFor();

  const shown = page.locator('[aria-hidden="false"]').filter({ hasText: /Alpha|Capital|Gamma|Delta/ });
  const shownText = async () => (await shown.first().textContent()) ?? "";
  const tip = page.getByRole("status").filter({ hasText: TIP_TEXT });
  const answerPopup = page.locator(".fixed.inset-0.z-\\[60\\]");
  const present = async () => {
    await slideBox("s1").scrollIntoViewIfNeeded();
    await page.locator('button[title="Present (fullscreen)"]').first().click();
    await shown.first().waitFor();
  };

  // 1. The tip: shows on open, still there at 4.5 seconds, gone after 6 (plus the fade).
  await present();
  const openedAt = Date.now();
  await tip.waitFor({ state: "visible" });
  check("tip shows when presenting starts", true);
  const tipBox = await tip.boundingBox();
  const checkBox = await page.locator('button[title$="(Space)"]').boundingBox();
  const screenWidth = await page.evaluate(() => window.innerWidth);
  check(
    "tip sits at the bottom center, clear of the bottom-left buttons, on its white card",
    !!tipBox &&
      !!checkBox &&
      Math.abs(tipBox.x + tipBox.width / 2 - screenWidth / 2) < 2 &&
      tipBox.x > checkBox.x + checkBox.width &&
      Math.abs(tipBox.y + tipBox.height - (checkBox.y + checkBox.height)) < 2 &&
      (await tip.evaluate((el) => getComputedStyle(el).backgroundColor)) === "rgb(255, 255, 255)",
    JSON.stringify({ tipBox, checkBox, screenWidth }),
  );
  const fadedIn = await page
    .waitForFunction((text) => [...document.querySelectorAll('[role="status"]')].some((el) => el.textContent?.includes(text) && getComputedStyle(el).opacity === "1"), TIP_TEXT, { timeout: 2000 })
    .then(() => true, () => false);
  check("tip fades in (opacity reaches 1)", fadedIn);
  await page.waitForTimeout(Math.max(0, 4500 - (Date.now() - openedAt)));
  check("tip is still there after 4.5 seconds (buttons hid at 3)", await tip.isVisible());
  await page.waitForTimeout(Math.max(0, 5700 - (Date.now() - openedAt)));
  check("tip is still there at 5.7 seconds", await tip.isVisible());
  await tip.waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
  const goneAfter = Date.now() - openedAt;
  check("tip is gone after about 6 seconds (with its fade)", (await tip.count()) === 0 && goneAfter >= 6000 && goneAfter < 8000, `${goneAfter} ms`);
  check("tip didn't change the slide", (await shownText()).includes("Alpha"));

  // 2. Its ✕ closes it sooner, and the click doesn't go to the next slide.
  await page.keyboard.press("Escape");
  await slideBox("s1").waitFor();
  await present();
  await tip.waitFor({ state: "visible" });
  // Wait until it has fully faded in, so the fade out below plays its whole half second.
  await page.waitForFunction((text) => [...document.querySelectorAll('[role="status"]')].some((el) => el.textContent?.includes(text) && getComputedStyle(el).opacity === "1"), TIP_TEXT);
  const closedAt = Date.now();
  await tip.locator('button[title="Close tip"]').click();
  await page.waitForTimeout(150);
  const fadingOpacity = Number(await tip.evaluate((el) => getComputedStyle(el).opacity).catch(() => "0"));
  check("tip's ✕ fades it out (part way after 150 ms)", fadingOpacity > 0 && fadingOpacity < 1, String(fadingOpacity));
  await tip.waitFor({ state: "detached", timeout: 2000 }).catch(() => {});
  const closeMs = Date.now() - closedAt;
  check("tip's ✕ closes it long before 6 seconds (after the fade)", (await tip.count()) === 0 && closeMs >= 400 && closeMs < 2000, `${closeMs} ms`);
  check("clicking the tip's ✕ doesn't change the slide", (await shownText()).includes("Alpha"));

  // 3. Space on a choice slide with an answer: the ✓ shows on B, Space again hides it, the slide stays.
  const tick = shown.first().getByText("✓", { exact: true });
  check("choice slide: no ✓ before Space", (await tick.count()) === 0);
  await page.keyboard.press(" ");
  await tick.waitFor({ timeout: 2000 }).catch(() => {});
  check("choice slide: Space shows the ✓ on the right answer", (await tick.count()) === 1);
  check("choice slide: Space stays on the slide", (await shownText()).includes("Alpha"));
  await page.keyboard.press(" ");
  await page.waitForTimeout(300);
  check("choice slide: Space again hides the ✓", (await tick.count()) === 0);
  check("choice slide: still on the slide", (await shownText()).includes("Alpha"));

  // 4. Space on a short-answer slide opens the answer popup, Space again closes it; Escape closes it too.
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(1500);
  check("→ goes to the short-answer slide", (await shownText()).includes("Capital"));
  await page.keyboard.press(" ");
  await answerPopup.waitFor({ timeout: 2000 }).catch(() => {});
  check("short answer: Space opens the answer popup", (await answerPopup.count()) === 1 && (await answerPopup.textContent()).includes("Manila"));
  await page.screenshot({ path: SHOTS + "present-answer-key-popup.png" });
  await page.keyboard.press(" ");
  await page.waitForTimeout(300);
  check("short answer: Space again closes the popup", (await answerPopup.count()) === 0);
  check("short answer: still on the slide", (await shownText()).includes("Capital"));
  await page.keyboard.press(" ");
  await answerPopup.waitFor({ timeout: 2000 }).catch(() => {});
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("short answer: Escape closes the popup and keeps presenting", (await answerPopup.count()) === 0 && (await shownText()).includes("Capital"));

  // 5. A slide with no answer key: Space goes to the next slide, as before.
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(1500);
  check("→ goes to the slide with no answer", (await shownText()).includes("Gamma"));
  await page.keyboard.press(" ");
  await page.waitForTimeout(1500);
  check("no answer key: Space goes to the next slide", (await shownText()).includes("Delta"));

  // 6. The check button's hover text names the shortcut.
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(1500);
  await page.mouse.move(800, 300);
  await page.mouse.move(810, 310);
  check("check button's hover text says (Space)", (await page.locator('button[title$="(Space)"]').count()) === 1);

  await page.keyboard.press("Escape");
  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (error) {
  check("run finished without an exception", false, String(error).split("\n").slice(0, 4).join(" "));
  await page.screenshot({ path: SHOTS + "present-answer-key-failure.png" });
} finally {
  await browser.close();
  await deleteTeacher(teacher);
}

finish();
