// The Add slide menu: no "Embed image" any more (the slide's + and the workspace's Add slide), the other types stay,
// and an image slide saved before still opens.
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { APP, SHOTS, api, check, deleteTeacher, finish, loggedIn, makeTeacher } from "./lib.mjs";

const teacher = await makeTeacher({ first: "Menu" });
const presentationId = randomUUID();
await api("/rest/v1/presentations", {
  method: "POST",
  body: JSON.stringify({ id: presentationId, owner_id: teacher.id, title: "Add slide menu e2e", data_version: 2 }),
});
const base = (id, type) => ({
  id,
  type,
  question: "",
  layout: "grid",
  options: ["a", "b", "c", "d"].map((o) => ({ id: `${id}-${o}`, text: "" })),
  correctOptionId: null,
  correctAnswer: "",
  elements: [],
  questionHeight: 100,
});
await api("/rest/v1/slides", {
  method: "POST",
  body: JSON.stringify(
    [
      { ...base("s1", "choice"), question: "First" },
      // An image slide made before "Embed image" left the menu.
      { ...base("s2", "image"), embedUrl: "https://example.com/old-picture.jpg" },
    ].map((data, position) => ({ presentation_id: presentationId, id: data.id, position, data })),
  ),
});

const browser = await chromium.launch();
const page = await (await loggedIn(browser, teacher, { width: 1600, height: 1000 })).newPage();
page.setDefaultTimeout(60_000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

/** The labels of the open Add slide menu. */
async function menuLabels() {
  const menu = page.getByText("Assessment slide", { exact: true }).locator("xpath=ancestor::div[contains(@class,'w-56')][1]");
  await menu.waitFor();
  return (await menu.locator("button").allTextContents()).map((t) => t.trim());
}

try {
  await page.goto(`${APP}/presentation/${presentationId}/edit`, { timeout: 120_000 });
  await page.locator('[data-slide-id="s2"]').waitFor();
  check("an old image slide still opens in the editor", true);
  check("the old image slide still shows its picture", (await page.locator('[data-slide-id="s2"] img[src="https://example.com/old-picture.jpg"]').count()) === 1);

  for (const [where, button] of [
    ["the slide's +", page.locator('[data-slide-id="s1"] button[title="Add slide after"]')],
    ["the workspace's Add slide", page.locator('button[title="Add slide"]')],
  ]) {
    await button.scrollIntoViewIfNeeded();
    await button.click();
    const labels = await menuLabels();
    check(`${where}: no "Embed image"`, !labels.includes("Embed image"), labels.join(", "));
    check(
      `${where}: the other 8 types stay`,
      ["Multiple choice", "Short answer", "True or false", "Custom question", "Title slide", "Blank slide", "Embed video", "Embed slides"].every((l) => labels.includes(l)),
      labels.join(", "),
    );
    await page.keyboard.press("Escape");
    await page.mouse.click(5, 500);
  }

  // Outside the editor a picture from another website waits for a click: loading it by itself would show that
  // website the internet address of every teacher who only looks at the presentation.
  let pictureRequests = 0;
  await page.context().route("https://example.com/**", (route) => {
    pictureRequests++;
    return route.fulfill({ contentType: "image/svg+xml", headers: { "Cache-Control": "no-store" }, body: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>' });
  });
  const picture = 'img[src="https://example.com/old-picture.jpg"]';
  await page.goto(`${APP}/presentation/${presentationId}`, { timeout: 120_000 });
  await page.locator('button[title="Next slide"]').click();
  await page.getByText("Picture from example.com").first().waitFor();
  await page.waitForTimeout(1500);
  check("the view page names the website instead of loading the picture", pictureRequests === 0 && (await page.locator(picture).count()) === 0, `${pictureRequests} requests`);

  await page.goto(`${APP}/presentation/${presentationId}/edit`, { timeout: 120_000 });
  await page.locator(`[data-slide-id="s2"] ${picture}`).waitFor();
  check("the owner's editor still loads it", pictureRequests > 0);
  await page.locator('button[title="Present (fullscreen)"]').first().click();
  const screen = page.locator(".fixed.inset-0.z-50").filter({ has: page.locator('button[title="Exit presentation (Esc)"]') });
  await screen.waitFor();
  const showButton = screen.locator('[aria-hidden="false"]').getByRole("button", { name: "Show picture" });
  for (let i = 0; i < 2 && !(await showButton.isVisible().catch(() => false)); i++) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(1500);
  }
  check("presenting: the picture waits behind Show picture", (await showButton.isVisible()) && (await screen.locator(picture).count()) === 0);
  await showButton.click();
  await screen.locator(`[aria-hidden="false"] ${picture}`).waitFor();
  check("Show picture loads it and stays on the slide", true);
  await page.keyboard.press("Escape");

  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (error) {
  check("run finished without an exception", false, String(error).split("\n").slice(0, 4).join(" "));
  await page.screenshot({ path: SHOTS + "add-slide-menu-failure.png" });
} finally {
  await browser.close();
  await deleteTeacher(teacher);
}

finish();
