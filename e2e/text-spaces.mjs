// Spaces a teacher types on purpose (several in a row, or at the start of a line) stay after saving and opening
// again: in the editor (Tiptap's `parseOptions`) and the read-only text (`toSafeHtml`). Before, loading saved HTML
// squeezed each run of spaces into one.
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { APP, SHOTS, api, check, deleteTeacher, finish, loggedIn, makeTeacher } from "./lib.mjs";

const SAVED = "Name:     Score:";
const INDENTED = "   Indented";
const teacher = await makeTeacher({ first: "Text", last: "Spaces" });
const presentationId = randomUUID();
await api("/rest/v1/presentations", {
  method: "POST",
  body: JSON.stringify({ id: presentationId, owner_id: teacher.id, title: "Text spaces e2e", data_version: 1 }),
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
        question: "Question",
        layout: "grid",
        options: [
          { id: "s1-a", text: "A" },
          { id: "s1-b", text: "B" },
          { id: "s1-c", text: "C" },
          { id: "s1-d", text: "D" },
        ],
        correctOptionId: null,
        elements: [
          {
            id: "tb",
            assetId: "text-box",
            x: 760,
            y: 20,
            width: 480,
            height: 120,
            color: "#1B1530",
            containerId: null,
            text: { html: `<p>${SAVED}</p><p>${INDENTED}</p>` },
          },
        ],
        questionHeight: 150,
      },
    },
  ]),
});

const lines = (locator) => locator.evaluate((root) => [...root.querySelectorAll("p")].map((p) => p.textContent));
// The spaces also show on screen: the text keeps them in its CSS (a squeezing `white-space` would show one).
const spacesShow = (locator) =>
  locator.evaluate((root) => [...root.querySelectorAll("p")].every((p) => ["break-spaces", "pre-wrap"].includes(getComputedStyle(p).whiteSpace)));

const browser = await chromium.launch();
const page = await (await loggedIn(browser, teacher, { width: 1600, height: 1000 })).newPage();
page.setDefaultTimeout(60_000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

try {
  await page.goto(`${APP}/presentation/${presentationId}/edit`, { timeout: 120_000 });
  const slide = page.locator('[data-slide-id="s1"]');
  await slide.waitFor();
  const box = slide.locator(".ProseMirror", { hasText: "Score:" });
  await box.waitFor();
  const opened = await lines(box);
  check("the editor keeps a saved run of spaces", opened[0] === SAVED, JSON.stringify(opened));
  check("the editor keeps spaces at the start of a line", opened[1] === INDENTED, JSON.stringify(opened));

  // Type more spaces, save, and open again.
  await box.dblclick();
  await slide.locator('[contenteditable="true"]').waitFor();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("    end");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+s");
  let json = "";
  for (let i = 0; i < 30 && !json.includes("end"); i++) {
    await page.waitForTimeout(500);
    const [saved] = await api(`/rest/v1/slides?presentation_id=eq.${presentationId}&select=data`);
    json = JSON.stringify(saved?.data ?? {});
  }
  check("the save keeps typed spaces", json.includes(`${INDENTED}    end`), json.slice(0, 400));

  await page.reload({ timeout: 120_000 });
  await box.waitFor();
  const reopened = await lines(box);
  check("the editor shows them on screen", await spacesShow(box));
  check("after opening again the editor keeps them", JSON.stringify(reopened) === JSON.stringify([SAVED, `${INDENTED}    end`]), JSON.stringify(reopened));

  // Presenting fullscreen (SlideStaticView → SlideText → toSafeHtml).
  await page.locator('button[title="Present (fullscreen)"]').first().click();
  const presented = page.locator('[aria-hidden="false"]').filter({ hasText: "Score:" }).first();
  await presented.waitFor();
  await page.waitForTimeout(1000);
  // The whole slide shows (question and choices first): the text box's lines are the last two.
  const presentedLines = (await lines(presented)).slice(-2);
  check("presenting fullscreen keeps them", JSON.stringify(presentedLines) === JSON.stringify([SAVED, `${INDENTED}    end`]), JSON.stringify(presentedLines));
  check("presenting shows them on screen", await spacesShow(presented));
  await page.screenshot({ path: `${SHOTS}text-spaces-present.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // The view page (SlideText → toSafeHtml).
  await page.goto(`${APP}/presentation/${presentationId}`, { timeout: 120_000 });
  const shown = page.locator("div", { hasText: "Score:" }).filter({ has: page.locator("p") }).last();
  await shown.waitFor();
  const viewed = await lines(shown);
  check("the view page keeps them", JSON.stringify(viewed) === JSON.stringify([SAVED, `${INDENTED}    end`]), JSON.stringify(viewed));
  check("the view page shows them on screen", await spacesShow(shown));
  await page.screenshot({ path: `${SHOTS}text-spaces-view.png` });

  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("ran without throwing", false, e.message);
  await page.screenshot({ path: `${SHOTS}text-spaces-error.png` }).catch(() => {});
} finally {
  await browser.close();
  await deleteTeacher(teacher);
}
finish();
