// Hidden slides: hide one in the editor, save, present (→ / ← skip it), the "Show all slides" grid, show it again.
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { APP, SHOTS, api, check, deleteTeacher, finish, loggedIn, makeTeacher } from "./lib.mjs";

// A teacher and a presentation with 3 question slides (Alpha, Beta, Gamma).
const teacher = await makeTeacher({ first: "Hidden" });
const presentationId = randomUUID();
await api("/rest/v1/presentations", {
  method: "POST",
  body: JSON.stringify({ id: presentationId, owner_id: teacher.id, title: "Hidden slides e2e", data_version: 1 }),
});
const slide = (id, question) => ({
  id,
  type: "choice",
  question,
  layout: "grid",
  options: ["a", "b", "c", "d"].map((o) => ({ id: `${id}-${o}`, text: o.toUpperCase() })),
  correctOptionId: null,
  elements: [],
  questionHeight: 100,
});
await api("/rest/v1/slides", {
  method: "POST",
  body: JSON.stringify(
    [slide("s1", "Alpha"), slide("s2", "Beta"), slide("s3", "Gamma")].map((data, position) => ({
      presentation_id: presentationId,
      id: data.id,
      position,
      data,
    })),
  ),
});

/** The saved data of a slide, straight from the local database. */
async function savedSlide(id) {
  const rows = await api(`/rest/v1/slides?presentation_id=eq.${presentationId}&id=eq.${id}&select=data`);
  return rows[0]?.data;
}
async function waitForSaved(id, test) {
  for (let i = 0; i < 40; i++) {
    if (test(await savedSlide(id))) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const browser = await chromium.launch();
const page = await (await loggedIn(browser, teacher, { width: 1600, height: 1000 })).newPage();
page.setDefaultTimeout(60_000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

try {
  await page.goto(`${APP}/presentation/${presentationId}/edit`, { timeout: 120_000 });
  const slideBox = (id) => page.locator(`[data-slide-id="${id}"]`);
  // The question number badge (min-w-12 tells it from the option letters' circles).
  const badge = (id) => slideBox(id).locator(".rounded-full.text-2xl.min-w-12");
  await slideBox("s3").waitFor();
  await badge("s3").first().waitFor();

  check("before hiding: Gamma is number 3", (await badge("s3").first().textContent()) === "3");

  // Hide Beta.
  await slideBox("s2").locator('button[title="Hide slide when presenting"]').click();
  await slideBox("s2").getByText("Hidden", { exact: true }).waitFor();
  check('hidden slide shows the "Hidden" pill', true);
  check("hidden slide is greyed out", (await slideBox("s2").locator(".grayscale").count()) > 0);
  check("hidden slide has no number", (await badge("s2").count()) === 0);
  check("Gamma closes the gap: now number 2", (await badge("s3").first().textContent()) === "2");
  check("hidden slide's toolbar has no Rename", (await slideBox("s2").locator('button[title="Rename slide"]').count()) === 0);
  check("hidden slide has nothing to type into", (await slideBox("s2").locator('[contenteditable="true"]').count()) === 0);

  // Save (Ctrl+S) and check the database.
  await page.keyboard.press("Control+s");
  check("saved: Beta has hidden: true in the database", await waitForSaved("s2", (d) => d?.hidden === true));
  check("saved: Alpha has no hidden field", await waitForSaved("s1", (d) => d && !("hidden" in d)));

  // Reload: still hidden.
  await page.reload();
  await slideBox("s2").getByText("Hidden", { exact: true }).waitFor();
  check("after reload: Beta is still hidden", true);

  // Present from slide 1: → skips Beta, ← comes back to Alpha.
  await slideBox("s1").scrollIntoViewIfNeeded();
  await page.locator('button[title="Present (fullscreen)"]').first().click();
  const shown = page.locator('[aria-hidden="false"]').filter({ hasText: /Alpha|Beta|Gamma/ });
  await shown.first().waitFor();
  check("presenting starts on Alpha", (await shown.first().textContent()).includes("Alpha"));
  await page.waitForTimeout(1500);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(1500);
  check("→ skips hidden Beta and shows Gamma", (await shown.first().textContent()).includes("Gamma"));
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(1500);
  check("← skips hidden Beta and goes back to Alpha", (await shown.first().textContent()).includes("Alpha"));
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(500);
  check("← on the first slide stays on Alpha", (await shown.first().textContent()).includes("Alpha"));

  // "Show all slides": Beta is there, faded, and opens when clicked.
  await page.mouse.move(800, 300);
  await page.mouse.move(810, 310);
  await page.locator('button[title="Show all slides"]').click();
  const thumbs = page.locator(".grid > button");
  await thumbs.first().waitFor();
  check("all-slides grid lists all 3 slides", (await thumbs.count()) === 3);
  check("all-slides grid: Beta is faded", (await thumbs.nth(1).locator(".grayscale").count()) > 0);
  check("all-slides grid: Alpha isn't faded", (await thumbs.nth(0).locator(".grayscale").count()) === 0);
  await thumbs.nth(1).click();
  await page.waitForTimeout(1500);
  check("clicking hidden Beta in the grid opens it", (await shown.first().textContent()).includes("Beta"));

  // Leave presenting.
  await page.keyboard.press("Escape");
  await slideBox("s2").waitFor();

  // Show Beta again: editable and numbered again.
  await slideBox("s2").locator('button[title="Show slide"]').click();
  await page.waitForTimeout(500);
  check("shown again: no Hidden pill", (await slideBox("s2").getByText("Hidden", { exact: true }).count()) === 0);
  check("shown again: Beta is number 2", (await badge("s2").first().textContent()) === "2");
  check("shown again: Gamma is number 3", (await badge("s3").first().textContent()) === "3");
  await page.keyboard.press("Control+s");
  check("saved: Beta has no hidden field any more", await waitForSaved("s2", (d) => d && !("hidden" in d)));

  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (error) {
  check("run finished without an exception", false, String(error).split("\n").slice(0, 4).join(" "));
  await page.screenshot({ path: SHOTS + "hidden-slides-failure.png" });
} finally {
  await browser.close();
  await deleteTeacher(teacher);
}

finish();
